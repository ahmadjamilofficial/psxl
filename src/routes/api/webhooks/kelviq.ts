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

          const handledAsBusiness = await processBusinessKelviqEvent(body, supabase);
          if (!handledAsBusiness) await processKelviqEvent(body, supabase);

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

type BusinessPlanId = "brokerage-pilot" | "brokerage-operations" | "brokerage-enterprise";

function mapBusinessPlan(identifier: string | undefined): BusinessPlanId | null {
  if (identifier === "brokerage-pilot") return "brokerage-pilot";
  if (identifier === "brokerage-operations") return "brokerage-operations";
  if (identifier === "brokerage-enterprise") return "brokerage-enterprise";
  return null;
}

function businessStatus(raw: string | undefined): "active" | "past_due" | "paused" | "cancelled" | "expired" | "pending" {
  const status = (raw ?? "active").toLowerCase();
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "incomplete") return "past_due";
  if (status === "paused") return "paused";
  if (status === "cancelled" || status === "canceled" || status === "superseded") return "cancelled";
  if (status === "expired" || status === "incomplete_expired") return "expired";
  return "pending";
}

/**
 * Separate Business billing lifecycle. Checkout metadata is the correlation key
 * and is trusted only after the signed Kelviq webhook has been verified above.
 * Kelviq documents checkout.completed as payment confirmation; subscription.created
 * follows separately and supplies the recurring subscription ID.
 */
async function processBusinessKelviqEvent(
  event: KelviqWebhookEvent,
  supabase: ReturnType<typeof createClient<Database>>,
): Promise<boolean> {
  const db = supabase as any;
  const data = event.data.object as KelviqObject & {
    amount?: string;
    amount_units?: number;
    currency?: string;
    customer_id?: string;
    customer?: { id?: string; customer_id?: string };
    billing_period_end_time?: string | null;
    subscription_id?: string;
    status?: string;
    end_date?: string | null;
  };
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const planIdentifier = data.plan?.identifier ?? data.plan_identifier;
  let plan = mapBusinessPlan(planIdentifier);
  const subscriptionIdHint = data.subscription_id ?? (event.type.startsWith("subscription.") ? data.id : undefined);
  let matchedBusinessSubscription: { org_id: string; plan: string } | null = null;
  if (!metadata["product_area"] && !plan && subscriptionIdHint) {
    const { data: existingBusiness, error: lookupError } = await db.from("business_subscriptions")
      .select("org_id,plan").eq("kelviq_subscription_id", subscriptionIdHint).maybeSingle();
    if (lookupError) throw lookupError;
    matchedBusinessSubscription = existingBusiness;
    plan = mapBusinessPlan(existingBusiness?.plan);
  }
  const isBusiness = metadata["product_area"] === "business" || Boolean(plan) || Boolean(matchedBusinessSubscription);
  if (!isBusiness) return false;
  if (!plan) throw new Error("Business webhook has no recognised Brokerage plan identifier.");

  const intentId = typeof metadata["checkout_intent_id"] === "string"
    ? metadata["checkout_intent_id"] as string
    : null;
  const loadIntent = async (id: string) => {
    const { data: row, error } = await db.from("business_checkout_intents")
      .select("*").eq("intent_id", id).maybeSingle();
    if (error) throw error;
    return row;
  };
  const customerId = data.customer?.id ?? data.customer_id ?? null;
  const customerReference = data.customer?.customer_id ?? null;

  if (event.type === "checkout.completed") {
    if (!intentId) throw new Error("Business checkout completion is missing its checkout intent metadata.");
    const intent = await loadIntent(intentId);
    const replayOfSameEvent = intent?.status === "completed" && intent.kelviq_event_id === event.id;
    if (!intent || (!replayOfSameEvent && (intent.status !== "pending" || new Date(intent.expires_at).getTime() < Date.now()))) {
      throw new Error("Business checkout intent is missing, expired or already consumed.");
    }
    if (intent.plan !== plan || intent.charge_period !== (plan === "brokerage-pilot" ? "ONE_TIME" : "MONTHLY")) {
      throw new Error("Business plan or billing period does not match its server-created checkout intent.");
    }
    if (data.status && !["success", "complete", "completed"].includes(data.status.toLowerCase())) {
      throw new Error("Kelviq checkout event does not report a successful payment.");
    }
    if (!replayOfSameEvent) {
      const { error: intentError } = await db.from("business_checkout_intents").update({
        status: "completed",
        kelviq_customer_id: customerId,
        kelviq_event_id: event.id,
        amount: data.amount ? Number(data.amount) : null,
        currency: data.currency ?? null,
        completed_at: new Date().toISOString(),
      }).eq("intent_id", intentId);
      if (intentError) throw intentError;
    }

    if (plan === "brokerage-pilot") {
      const { error } = await db.from("business_subscriptions").upsert({
        org_id: intent.org_id,
        plan,
        status: "active",
        charge_period: "ONE_TIME",
        kelviq_customer_id: customerId,
        kelviq_checkout_session_id: data.id ?? intent.kelviq_checkout_session_id,
        kelviq_plan_identifier: plan,
        last_paid_at: new Date().toISOString(),
        activated_at: new Date().toISOString(),
        metadata: { product_area: "business", checkout_intent_id: intentId, kelviq_event_id: event.id, amount: data.amount ?? null, currency: data.currency ?? null },
      }, { onConflict: "org_id" });
      if (error) throw error;
    }
    return true;
  }

  if (event.type === "subscription.created" || event.type === "subscription.updated" ||
      event.type === "subscription.plan_changed" || event.type === "subscription.resumed") {
    const subscriptionId = data.subscription_id ?? data.id;
    if (!subscriptionId) throw new Error("Business subscription webhook is missing its subscription ID.");

    let intent: any = null;
    if (intentId) intent = await loadIntent(intentId);
    if (!intent && customerReference) {
      const { data: found, error } = await db.from("business_checkout_intents")
        .select("*")
        .eq("org_id", customerReference)
        .eq("plan", plan)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      intent = found;
    }
    const { data: existing, error: existingError } = await db.from("business_subscriptions")
      .select("org_id, plan, metadata")
      .eq("kelviq_subscription_id", subscriptionId)
      .maybeSingle();
    if (existingError) throw existingError;
    const orgId = existing?.org_id ?? intent?.org_id ??
      (customerReference && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(customerReference) ? customerReference : null);
    if (!orgId || (!existing && (!intent || intent.status !== "completed" || intent.plan !== plan))) {
      throw new Error("Could not securely match this Brokerage subscription to a completed PSXL checkout.");
    }
    const status = businessStatus(data.status);
    const { error } = await db.from("business_subscriptions").upsert({
      org_id: orgId,
      plan,
      status,
      charge_period: "MONTHLY",
      kelviq_customer_id: customerId,
      kelviq_subscription_id: subscriptionId,
      kelviq_checkout_session_id: intent.kelviq_checkout_session_id,
      kelviq_plan_identifier: planIdentifier,
      current_period_end: data.billing_period_end_time ?? null,
      end_date: data.end_date ?? null,
      activated_at: status === "active" ? new Date().toISOString() : null,
      metadata: { product_area: "business", checkout_intent_id: intent.intent_id, kelviq_event_id: event.id, recurrence: data.recurrence ?? null },
    }, { onConflict: "org_id" });
    if (error) throw error;
    return true;
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const subscriptionId = data.subscription_id;
    if (!subscriptionId) return true;
    const patch = event.type === "invoice.paid"
      ? { status: "active", last_paid_at: new Date().toISOString(), last_invoice_id: data.id ?? null }
      : { status: "past_due" };
    const { error } = await db.from("business_subscriptions")
      .update(patch).eq("kelviq_subscription_id", subscriptionId);
    if (error) throw error;
    return true;
  }

  if (event.type === "subscription.cancelled" || event.type === "subscription.paused") {
    const subscriptionId = data.subscription_id ?? data.id;
    if (subscriptionId) {
      const { error } = await db.from("business_subscriptions").update({
        status: event.type === "subscription.paused" ? "paused" : "cancelled",
        end_date: data.end_date ?? new Date().toISOString(),
        metadata: { ...metadata, last_lifecycle_event: event.type, last_lifecycle_event_id: event.id },
      }).eq("kelviq_subscription_id", subscriptionId);
      if (error) throw error;
    }
    return true;
  }

  if (event.type === "order.refunded" && plan === "brokerage-pilot") {
    const orgId = customerReference;
    if (orgId) {
      const { error } = await db.from("business_subscriptions").update({
        status: "refunded",
        refunded_at: new Date().toISOString(),
        metadata: { ...metadata, refund_event_id: event.id },
      }).eq("org_id", orgId).eq("plan", "brokerage-pilot");
      if (error) throw error;
    }
    return true;
  }

  // Business-related event recorded for audit; no entitlement transition.
  return true;
}

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
  let checkoutIntent: { org_id?: string; plan?: string; expires_at?: string } | null = null;
  const loadIntent = async (intentId: string) => {
    const { data: intentRow, error } = await supabase
      .from("subscription_events")
      .select("event_data")
      .eq("kelviq_event_id", `checkout_intent:${intentId}`)
      .eq("event_type", "checkout.intent.created")
      .maybeSingle();
    if (error) throw error;
    const value = intentRow?.event_data as { org_id?: string; plan?: string; expires_at?: string } | null;
    if (!value || !value.expires_at || new Date(value.expires_at).getTime() < Date.now()) return null;
    return value;
  };

  const directIntentId = metadata["checkout_intent_id"];
  if (typeof directIntentId === "string") checkoutIntent = await loadIntent(directIntentId);

  if (!checkoutIntent && data.customer?.id) {
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
    const intentId = checkoutData?.object?.metadata?.["checkout_intent_id"];
    if (typeof intentId === "string") checkoutIntent = await loadIntent(intentId);
  }

  if (checkoutIntent && plan && checkoutIntent.plan !== plan) {
    throw new Error("Kelviq plan does not match the server-created checkout intent.");
  }
  const orgIdCandidate =
    checkoutIntent?.org_id ??
    existing?.org_id ??
    (typeof data.customer?.customer_id === "string" ? data.customer.customer_id : null) ??
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
    case "checkout.completed": {
      const intentId = metadata["checkout_intent_id"];
      if (typeof intentId !== "string") throw new Error("Checkout completion is missing its PSXL checkout intent.");
      const intent = await loadIntent(intentId);
      if (!intent || !intent.org_id || !intent.plan) throw new Error("Checkout intent is invalid or expired.");
      if (plan && intent.plan !== plan) throw new Error("Checkout plan does not match the selected PSXL plan.");
      break;
    }

    case "subscription.created":
    case "subscription.updated":
    case "subscription.plan_changed":
    case "subscription.resumed": {
      if (!subscriptionId) throw new Error("Kelviq subscription event is missing its subscription ID.");
      if (!plan || plan === "free") break; // Unmapped Business/Enterprise plans do not receive Individual entitlements.
      if (!orgId) throw new Error("Could not correlate Kelviq subscription to a PSXL workspace; retry after checkout.completed is processed.");
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
      const paused = event.type === "subscription.paused";
      const { error } = await supabase
        .from("subscriptions")
        .update(paused
          ? {
              status: "cancelled",
              metadata: {
                ...((existing?.metadata ?? {}) as Record<string, unknown>),
                kelviq_paused: true,
                paused_at: new Date().toISOString(),
              } as never,
            }
          : {
              status: "cancelled",
              cancelled_at: new Date().toISOString(),
              metadata: {
                ...((existing?.metadata ?? {}) as Record<string, unknown>),
                kelviq_paused: false,
              } as never,
            })
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
