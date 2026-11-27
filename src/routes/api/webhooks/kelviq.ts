import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Verify Kelviq's raw-body signature, then delegate all privileged database
// mutations to a narrowly scoped SECURITY DEFINER RPC protected by the same
// shared secret. No Supabase service-role key is required by this endpoint.

const KELVIQ_WEBHOOK_SECRET = process.env["KELVIQ_WEBHOOK_SECRET"] ?? "";

export const Route = createFileRoute("/api/webhooks/kelviq")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!KELVIQ_WEBHOOK_SECRET) {
            return new Response("Webhook signing is not configured", { status: 503 });
          }

          const rawBody = await request.text();
          const signature = request.headers.get("x-kelviq-signature") ?? "";
          const supplied = signature.replace(/^sha256=/i, "").trim();
          const expected = createHmac("sha256", KELVIQ_WEBHOOK_SECRET)
            .update(rawBody)
            .digest("hex");
          const valid =
            supplied.length === expected.length &&
            timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
          if (!valid) return new Response("Invalid signature", { status: 401 });

          const body = JSON.parse(rawBody) as KelviqWebhookEvent;
          if (!body.id || !body.type || !body.data || typeof body.data !== "object") {
            return new Response("Invalid webhook payload", { status: 400 });
          }

          const supabaseUrl =
            process.env["SUPABASE_URL"] ??
            (import.meta.env["VITE_SUPABASE_URL"] as string | undefined);
          const supabaseKey =
            process.env["SUPABASE_PUBLISHABLE_KEY"] ??
            process.env["SUPABASE_ANON_KEY"] ??
            (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined);

          if (!supabaseUrl || !supabaseKey) {
            return new Response("Supabase URL or publishable key is missing", { status: 500 });
          }

          const supabase = createClient(supabaseUrl, supabaseKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data, error } = await supabase.rpc("process_kelviq_webhook", {
            p_event: body as never,
            p_secret: KELVIQ_WEBHOOK_SECRET,
          });

          if (error) {
            // Keep provider response generic; detailed errors stay server-side.
            console.error("[Kelviq webhook] RPC failed:", error.message);
            return new Response("Webhook database processing failed", { status: 500 });
          }

          return new Response(
            (data as { duplicate?: boolean } | null)?.duplicate
              ? "Event already processed"
              : "Webhook processed",
            { status: 200 },
          );
        } catch (error) {
          console.error("[Kelviq webhook] Processing failed:", error);
          return new Response("Webhook processing failed", { status: 500 });
        }
      },
    },
  },
});

interface KelviqWebhookEvent {
  id: string;
  type: string;
  data: {
    plan_identifier?: string;
    customer_id?: string;
    subscription_id?: string;
    customer_email?: string;
    charge_period?: string;
    trial_end?: string;
    current_period_end?: string;
    status?: string;
    cancel_at_period_end?: boolean;
    metadata?: Record<string, unknown>;
  };
  created_at: string;
}
