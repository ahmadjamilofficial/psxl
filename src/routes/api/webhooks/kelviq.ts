import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const KELVIQ_WEBHOOK_SECRET = process.env["KELVIQ_WEBHOOK_SECRET"] ?? "";

export const Route = createFileRoute("/api/webhooks/kelviq")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const rawBody = await request.text();

          // Kelviq's dashboard verification probe is an empty, unsigned POST.
          if (!rawBody.trim()) return Response.json({ received: true, verification: true });

          if (!KELVIQ_WEBHOOK_SECRET) {
            console.error("[Kelviq] Webhook signing secret is not configured.");
            return new Response("Webhook endpoint is not configured", { status: 503 });
          }

          const webhookId = request.headers.get("webhook-id") ?? "";
          const timestamp = request.headers.get("webhook-timestamp") ?? "";
          const signatureHeader = request.headers.get("webhook-signature") ?? "";
          const timestampSeconds = Number(timestamp);
          if (!webhookId || !Number.isInteger(timestampSeconds) || !signatureHeader) {
            return new Response("Missing or invalid webhook headers", { status: 400 });
          }
          if (Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > 300) {
            return new Response("Webhook timestamp outside the 5-minute tolerance", { status: 400 });
          }

          // Kelviq signs: webhook-id.webhook-timestamp.raw-request-body
          const signedPayload = `${webhookId}.${timestamp}.${rawBody}`;
          const expected = createHmac("sha256", KELVIQ_WEBHOOK_SECRET)
            .update(signedPayload, "utf8")
            .digest();
          const suppliedHex = signatureHeader.split(",", 2)[1]?.trim() ?? "";
          if (!/^[a-f0-9]{64}$/i.test(suppliedHex)) {
            return new Response("Invalid webhook signature", { status: 401 });
          }
          const supplied = Buffer.from(suppliedHex, "hex");
          if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) {
            return new Response("Invalid webhook signature", { status: 401 });
          }

          const body = JSON.parse(rawBody) as KelviqWebhookEvent;
          if (!body.id || !body.type || body.id !== webhookId || !body.data?.object) {
            return new Response("Invalid Kelviq event envelope", { status: 400 });
          }

          // Signed test events validate the endpoint without mutating customer data.
          if (body.test === true) return Response.json({ received: true, test: true });

          const supabaseUrl = process.env["SUPABASE_URL"] ??
            (import.meta.env["VITE_SUPABASE_URL"] as string | undefined);
          const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
          if (!supabaseUrl || !serviceRoleKey) {
            return new Response("Server database configuration missing", { status: 500 });
          }

          const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const { data: existingEvent, error: lookupError } = await supabase
            .from("subscription_events")
            .select("id, processed")
            .eq("kelviq_event_id", body.id)
            .maybeSingle();
          if (lookupError) throw lookupError;
          if (existingEvent?.processed) return Response.json({ received: true, duplicate: true });

          if (!existingEvent) {
            const { error: eventError } = await supabase.from("subscription_events").insert({
              kelviq_event_id: body.id,
              event_type: body.type,
              event_data: body.data as never,
              processed: false,
            });
            if (eventError) throw eventError;
          }

          await processKelviqEvent(body, supabase);

          const { error: processedError } = await supabase
            .from("subscription_events")
            .update({ processed: true, processed_at: new Date().toISOString() })
            .eq("kelviq_event_id", body.id);
          if (processedError) throw processedError;

          return Response.json({ received: true });
        } catch (error) {
          console.error("[Kelviq] Webhook processing failed:", error);
          return new Response("Webhook processing failed", { status: 500 });
        }
      },
    },
  },
});

type KelviqObject = {
  id?: string;
  subscription_id?: string;
  customer_id?: string;
  customer?: { id?: string; customer_id?: string };
  plan?: { identifier?: string };
  plan_identifier?: string;
  status?: string;
  recurrence?: string;
  trial_end?: string | null;
  billing_period_end_time?: string | null;
  end_date?: string | null;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, unknown>;
};

async function processKelviqEvent(
  event: KelviqWebhookEvent,
  supabase: ReturnType<typeof createClient<Database>>,
) {
  // Kelviq's current event envelope puts the affected resource in data.object.
  const data = event.data.object;
  const subscriptionId = data.subscription_id ?? data.id;
  const plan = mapKelviqPlan(data.plan?.identifier ?? data.plan_identifier);
  let existing: { org_id: string; plan: string; metadata: unknown } | null = null;

  if (subscriptionId && event.type !== "subscription.created") {
    const { data: row, error } = await supabase
      .from("subscriptions")
      .select("org_id, plan, metadata")
      .eq("kelviq_subscription_id", subscriptionId)
      .maybeSingle();
    if (error) throw error;
    existing = row;
  }

  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  let checkoutOrgId: string | null = null;
  if (!metadata["org_id"] && data.customer?.id) {
    const { data: checkoutEvent, error: checkoutLookupError } = await supabase
      .from("subscription_events")
      .select("event_data")
      .eq("event_type", "checkout.completed")
      .contains("event_data", { object: { customer: { id: data.customer.id } } })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (checkoutLookupError) throw checkoutLookupError;
    const checkoutData = checkoutEvent?.event_data as { object?: { metadata?: Record<string, unknown> } } | null;
    const linkedOrg = checkoutData?.object?.metadata?.["org_id"];
    if (typeof linkedOrg === "string") checkoutOrgId = linkedOrg;
  }
  const orgIdCandidate =
    (typeof metadata["org_id"] === "string" ? metadata["org_id"] : null) ??
    checkoutOrgId ??
    existing?.org_id ??
    null;
  const orgId = orgIdCandidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orgIdCandidate)
    ? orgIdCandidate
    : null;

  const updateProfilePlan = async (targetOrgId: string, targetPlan: "free" | "standard" | "pro") => {
    const { error } = await supabase
      .from("profiles")
      .update({ plan: targetPlan } as never)
      .eq("org_id", targetOrgId);
    if (error) throw error;
  };

  switch (event.type) {
    case "subscription.created":
    case "subscription.updated":
    case "subscription.plan_changed":
    case "subscription.resumed": {
      if (!subscriptionId || !orgId || !plan || plan === "free") break;
      const rawStatus = (data.status ?? "active").toLowerCase();
      const hasUnexpiredTrial = Boolean(data.trial_end && new Date(data.trial_end).getTime() > Date.now());
      const status =
        rawStatus === "trialing" || (rawStatus === "active" && hasUnexpiredTrial) ? "trialing" :
        rawStatus === "active" ? "active" :
        rawStatus === "cancelled" || rawStatus === "canceled" ? "cancelled" :
        rawStatus === "expired" ? "expired" : "past_due";
      const { error } = await supabase.from("subscriptions").upsert(
        {
          org_id: orgId,
          kelviq_customer_id: data.customer?.id ?? data.customer_id ?? null,
          kelviq_subscription_id: subscriptionId,
          plan,
          status,
          charge_period: /year/i.test(data.recurrence ?? "") ? "YEARLY" : "MONTHLY",
          trial_end_at: data.trial_end ? new Date(data.trial_end).toISOString() : null,
          current_period_end: data.billing_period_end_time
            ? new Date(data.billing_period_end_time).toISOString()
            : null,
          cancel_at_period_end: Boolean(data.end_date),
          metadata: { ...metadata, kelviq_plan_identifier: data.plan?.identifier ?? data.plan_identifier ?? null },
        },
        { onConflict: "kelviq_subscription_id" },
      );
      if (error) throw error;
      await updateProfilePlan(orgId, plan);
      break;
    }

    case "subscription.cancelled":
    case "subscription.paused": {
      if (!subscriptionId) break;
      const { error } = await supabase
        .from("subscriptions")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("kelviq_subscription_id", subscriptionId);
      if (error) throw error;
      if (existing?.org_id) await updateProfilePlan(existing.org_id, "free");
      break;
    }

    case "invoice.paid": {
      if (!subscriptionId) break;
      const { error } = await supabase
        .from("subscriptions")
        .update({
          status: "active",
          metadata: {
            ...((existing?.metadata ?? {}) as Record<string, unknown>),
            payment_confirmed_at: new Date().toISOString(),
            last_paid_invoice_id: data.id ?? null,
          } as never,
        })
        .eq("kelviq_subscription_id", subscriptionId);
      if (error) throw error;
      if (existing?.org_id && (existing.plan === "standard" || existing.plan === "pro")) {
        await updateProfilePlan(existing.org_id, existing.plan);
      }
      break;
    }

    case "invoice.payment_failed": {
      if (!subscriptionId) break;
      const { error } = await supabase
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("kelviq_subscription_id", subscriptionId);
      if (error) throw error;
      break;
    }

    default:
      // Other Kelviq events are recorded for audit but do not change entitlements.
      break;
  }
}

function mapKelviqPlan(identifier: string | undefined): "free" | "standard" | "pro" | null {
  if (identifier === "free-plan" || identifier === "free") return "free";
  if (identifier === "standard-plan" || identifier === "standard") return "standard";
  if (identifier === "pro-plan" || identifier === "pro") return "pro";
  // Crucially, a Business/Enterprise plan must never silently become Standard.
  return null;
}

interface KelviqWebhookEvent {
  id: string;
  type: string;
  created_at?: string;
  test?: boolean;
  data: {
    object: KelviqObject;
    previous_attributes?: Record<string, unknown>;
  };
}
