import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/team/invite-email")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("Bearer ")) {
          return Response.json({ error: "Sign in to send an invitation." }, { status: 401 });
        }

        const supabaseUrl =
          process.env["SUPABASE_URL"] ??
          (import.meta.env["VITE_SUPABASE_URL"] as string | undefined) ??
          "";
        const publishableKey =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ??
          (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined) ??
          (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined) ??
          "";
        const resendKey = process.env["RESEND_API_KEY"] ?? "";
        const fromEmail = process.env["FROM_EMAIL"] ?? "";

        if (!supabaseUrl || !publishableKey) {
          return Response.json(
            { error: "Invitation server is not configured. Set the Supabase URL and publishable key." },
            { status: 503 },
          );
        }
        if (!resendKey || !fromEmail) {
          return Response.json(
            { error: "Email delivery is not configured. Set RESEND_API_KEY and FROM_EMAIL in the production environment." },
            { status: 503 },
          );
        }

        // Use the caller's JWT and publishable key. No service-role key is needed:
        // RLS scopes the profile, invitation and organisation reads to this user.
        const client = createClient<Database>(supabaseUrl, publishableKey, {
          global: { headers: { Authorization: auth } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const {
          data: { user },
          error: authError,
        } = await client.auth.getUser();
        if (authError || !user) {
          return Response.json({ error: "Your session expired. Sign in again." }, { status: 401 });
        }

        let body: { invite_id?: string };
        try {
          body = (await request.json()) as { invite_id?: string };
        } catch {
          return Response.json({ error: "Invalid JSON body." }, { status: 400 });
        }
        if (!body.invite_id) {
          return Response.json({ error: "invite_id is required." }, { status: 400 });
        }

        const { data: profile, error: profileError } = await client
          .from("profiles")
          .select("org_id, role")
          .eq("user_id", user.id)
          .maybeSingle();
        if (profileError) {
          return Response.json({ error: profileError.message }, { status: 403 });
        }
        if (!profile?.org_id || !["owner", "admin"].includes(profile.role)) {
          return Response.json(
            { error: "Only organisation owners and admins can send invitations." },
            { status: 403 },
          );
        }

        const { data: invite, error: inviteError } = await client
          .from("org_invites")
          .select("id, org_id, email, role, token, status, expires_at")
          .eq("id", body.invite_id)
          .eq("org_id", profile.org_id)
          .maybeSingle();
        if (inviteError) {
          return Response.json({ error: inviteError.message }, { status: 403 });
        }
        if (!invite || invite.status !== "pending" || new Date(invite.expires_at).getTime() <= Date.now()) {
          return Response.json({ error: "Pending invitation not found or it has expired." }, { status: 404 });
        }

        const { data: org, error: orgError } = await client
          .from("organizations")
          .select("name")
          .eq("id", invite.org_id)
          .maybeSingle();
        if (orgError || !org) {
          return Response.json({ error: orgError?.message ?? "Organisation not found." }, { status: 404 });
        }

        const escapeHtml = (value: string) =>
          value.replace(/[&<>"']/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[char] ?? char);
        const appUrl = (process.env["VITE_APP_URL"] ?? "https://psxl.live").replace(/\/$/, "");
        const acceptUrl = `${appUrl}/signup?invite=${encodeURIComponent(invite.token)}`;
        const organisationName = escapeHtml(org.name);
        const role = escapeHtml(invite.role);
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [invite.email],
            subject: `You're invited to join ${org.name} on PSXL`,
            html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717"><h2>You're invited to PSXL</h2><p>You have been invited to join <strong>${organisationName}</strong> as a <strong>${role}</strong>.</p><p>Use the secure invitation link below to sign up or sign in and join the workspace.</p><p><a href="${acceptUrl}" style="display:inline-block;background:#171717;color:#fff;padding:12px 20px;border-radius:24px;text-decoration:none">Accept invitation</a></p><p style="font-size:12px;color:#666">This invitation expires on ${new Date(invite.expires_at).toLocaleDateString()}.</p></div>`,
          }),
        });
        const result = (await response.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        if (!response.ok) {
          return Response.json(
            { error: result.message ?? result.error ?? "Email provider rejected the invitation." },
            { status: 502 },
          );
        }
        return Response.json({ ok: true });
      },
    } as never,
  },
});
