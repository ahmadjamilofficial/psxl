// ─── Document Upload + Autonomous Ingestion ───────────────────────────────────
// Accepts a multipart upload, stores the file in Supabase Storage, records it
// in the documents table, and enqueues an agent_jobs row for autonomous
// extraction → reconciliation → anomaly detection.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

export const Route = createFileRoute("/api/documents/upload")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }: { request: Request }) => {
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401, headers: CORS });
        }

        const supabaseUrl =
          process.env["SUPABASE_URL"] ??
          (import.meta.env["VITE_SUPABASE_URL"] as string | undefined) ??
          "";
        const anonKey =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ??
          (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined) ??
          (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined) ??
          "";

        const db = createClient<Database>(supabaseUrl, anonKey, {
          global: { headers: { Authorization: auth } },
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const {
          data: { user },
          error: authErr,
        } = await db.auth.getUser();
        if (authErr || !user) {
          return new Response("Unauthorized", { status: 401, headers: CORS });
        }

        // Get org_id from profiles
        const { data: profile } = await db
          .from("profiles")
          .select("org_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!profile?.org_id) {
          return new Response("Profile not found", { status: 404, headers: CORS });
        }
        const orgId = profile.org_id;

        // Parse multipart form
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return new Response("Invalid form data", { status: 400, headers: CORS });
        }

        const uploaded: Array<{ document_id: string; filename: string; job_id: string | null }> =
          [];
        const files = [...form.values()].filter((value): value is File => value instanceof File);
        if (files.length === 0)
          return new Response("Select at least one file to upload", { status: 400, headers: CORS });
        if (files.length > 10)
          return new Response("Upload up to 10 files at a time", { status: 413, headers: CORS });
        const allowed = ["pdf", "png", "jpg", "jpeg", "webp", "csv", "xlsx", "xls", "txt", "tsv"];
        for (const file of files) {
          const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
          if (!allowed.includes(ext))
            return new Response(`Unsupported file type: ${file.name}`, {
              status: 415,
              headers: CORS,
            });
          if (file.size === 0)
            return new Response(`The file ${file.name} is empty`, { status: 400, headers: CORS });
          const limit = ["pdf", "png", "jpg", "jpeg", "webp"].includes(ext) ? 10 : 50;
          if (file.size > limit * 1024 * 1024)
            return new Response(
              `${file.name} exceeds the ${limit} MB limit for ${ext.toUpperCase()} files`,
              { status: 413, headers: CORS },
            );
        }

        for (const value of files) {
          const filename = value.name;
          const ext = filename.split(".").pop()?.toLowerCase() ?? "";
          const mimeType = ext === "tsv" ? "text/csv" : value.type || "application/octet-stream";

          const bytes = await value.arrayBuffer();
          const storagePath = `${orgId}/${crypto.randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

          // Upload to Supabase Storage bucket "documents"
          const { error: storageErr } = await db.storage
            .from("documents")
            .upload(storagePath, bytes, { contentType: mimeType, upsert: false });

          if (storageErr) {
            console.error("[upload] storage error:", storageErr.message);
            return new Response(`Could not store ${filename}: ${storageErr.message}`, {
              status: 500,
              headers: CORS,
            });
          }

          // Insert document record
          const { data: doc, error: docErr } = await db
            .from("documents")
            .insert({
              org_id: orgId,
              storage_path: storagePath,
              doc_type: "trade_confirmation",
              status: "processing",
              uploaded_by: user.id,
            } as never)
            .select("id")
            .single();

          if (docErr || !doc) {
            console.error("[upload] document insert error:", docErr?.message);
            await db.storage.from("documents").remove([storagePath]);
            return new Response(
              `Could not register ${filename}: ${docErr?.message ?? "database error"}`,
              { status: 500, headers: CORS },
            );
          }

          // Enqueue autonomous extraction job
          const idempotencyKey = `upload:${orgId}:${doc.id}`;
          let jobId: string | null = null;

          const { data: job, error: jobErr } = await db
            .from("agent_jobs")
            .insert({
              org_id: orgId,
              trigger_type: "upload",
              trigger_payload: {
                document_id: doc.id,
                storage_path: storagePath,
                mime_type: mimeType,
                filename,
              } as never,
              idempotency_key: idempotencyKey,
            } as never)
            .select("id")
            .single();

          if (!jobErr && job) {
            jobId = job.id;

            // Poke the Edge Function runner (fire-and-forget)
            const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
            if (serviceKey) {
              const runnerUrl = supabaseUrl.replace(
                ".supabase.co",
                ".supabase.co/functions/v1/agent-runner",
              );
              fetch(runnerUrl, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${serviceKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ job_id: jobId }),
              }).catch(() => undefined);
            }
          } else {
            console.error("[upload] job enqueue error:", jobErr?.message);
            await db
              .from("documents")
              .update({ status: "failed" } as never)
              .eq("id", doc.id)
              .eq("org_id", orgId);
            return new Response(
              `File stored, but extraction could not be queued: ${jobErr?.message ?? "job creation failed"}`,
              { status: 503, headers: CORS },
            );
          }

          uploaded.push({ document_id: doc.id, filename, job_id: jobId });
        }

        const body = JSON.stringify({ ok: true, uploaded });
        return new Response(body, {
          status: 200,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      },
    } as never,
  },
});
