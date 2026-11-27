import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Only signed provider events may mutate subscription entitlements.

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
          {
            const supplied = signature.replace(/^sha256=/i, "").trim();
            const expected = createHmac("sha256", KELVIQ_WEBHOOK_SECRET)
              .update(rawBody)
              .digest("hex");
            const valid =
              supplied.length === expected.length &&
              timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
            if (!valid) return new Response("Invalid signature", { status: 401 });
          }
          const body = JSON.parse(rawBody) as KelviqWebhookEvent;
          if (!body.id || !body.type || !body.data || typeof body.data !== "object")
            return new Response("Invalid webhook payload", { status: 400 });

          const supabaseUrl =
            process.env["SUPABASE_URL"] ??
            (import.meta.env["VITE_SUPABASE_URL"] as string | undefined);
          const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

          if (!supabaseUrl || !supabaseKey) {
            return new Response("Database configuration missing", { status: 500 });
          }

          const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });

          // Check for duplicate event (idempotency)
          const { data: existingEvent } = await supabase
            .from("subscription_events")
            .select("id")
            .eq("kelviq_event_id", body.id)
            .maybeSingle();

          if (existingEvent) {
            return new Response("Event already processed", { status: 200 });
          }

          // Store the event
          const { error: eventError } = await supabase.from("subscription_events").insert({
            kelviq_event_id: body.id,
            event_type: body.type,
            event_data: body.data as never,
            processed: false,
          });

          if (eventError) {
            return new Response("Failed to store event", { status: 500 });
          }

          // Process the event based on type
          await processKelviqEvent(body, supabase);

          // Mark event as processed
          await supabase
            .from("subscription_events")
            .update({ processed: true, processed_at: new Date().toISOString() })
            .eq("kelviq_event_id", body.id);

          return new Response("Webhook processed", { status: 200 });
        } catch (error) {
          return new Response("Webhook processing failed", { status: 500 });
        }
      },
    },
  },
});

async function processKelviqEvent(
  event: KelviqWebhookEvent,
  supabase: ReturnType<typeof createClient<Database>>,
) {
  const eventType = event.type;
  const data = event.data;

  switch (eventType) {
    case "checkout.completed":
    case "subscription.created": {
      // Checkout/subscription creation is intent, not payment. Entitlements
      // activate only after Kelviq confirms payment below.
      break;
    }

    case "subscription.updated": {
      // A provider update is not itself proof of payment. Only mutate a row
      // that was previously activated by payment.succeeded/invoice.paid.
      const subscriptionId = data.subscription_id as string;
      const { data: existingSubscription } = await supabase
        .from("subscriptions")
        .select("org_id, metadata, current_period_end")
        .eq("kelviq_subscription_id", subscriptionId)
        .maybeSingle();
      const metadata = (existingSubscription?.metadata ?? {}) as Record<string, unknown>;
      if (!existingSubscription || !metadata["payment_confirmed_at"]) break;
      const planIdentifier = data.plan_identifier as string;
      const plan = mapKelviqPlan(planIdentifier);
      if (!plan) break;

      if (plan === "free") {
        await supabase
          .from("subscriptions")
          .update({
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
            plan: "standard",
          })
          .eq("kelviq_subscription_id", subscriptionId);
      } else {
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            plan,
            status: (data.status as string) || "active",
            current_period_end: data.current_period_end
              ? new Date(data.current_period_end as string).toISOString()
              : existingSubscription.current_period_end,
            cancel_at_period_end: (data.cancel_at_period_end as boolean) || false,
            metadata: { ...metadata, ...(data.metadata ?? {}) } as never,
          })
          .eq("kelviq_subscription_id", subscriptionId);

        if (updateError) {
          // Silent error handling
        }
      }

      // Update user's profile plan
      const { data: subscription } = await supabase
        .from("subscriptions")
        .select("org_id")
        .eq("kelviq_subscription_id", subscriptionId)
        .single();

      if (subscription) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({ plan } as never)
          .eq("org_id", subscription.org_id);

        if (profileError) {
          // Silent error handling
        }
      }
      break;
    }

    case "subscription.cancelled": {
      const subscriptionId = data.subscription_id as string;
      const atPeriodEnd = Boolean(data.cancel_at_period_end);
      const { error: cancelError } = await supabase
        .from("subscriptions")
        .update({
          status: atPeriodEnd ? "active" : "cancelled",
          cancelled_at: atPeriodEnd ? null : new Date().toISOString(),
          cancel_at_period_end: atPeriodEnd,
        })
        .eq("kelviq_subscription_id", subscriptionId);

      if (cancelError) {
        // Silent error handling
      }

      if (!atPeriodEnd) {
        const { data: subscription } = await supabase
          .from("subscriptions")
          .select("org_id")
          .eq("kelviq_subscription_id", subscriptionId)
          .single();
        if (subscription) {
          await supabase.from("profiles").update({ plan: "free" } as never).eq("org_id", subscription.org_id);
        }
      }
      break;
    }

    case "payment.succeeded":
    case "invoice.paid": {
      const subscriptionId = data.subscription_id as string | undefined;
      const orgId = data.metadata?.["org_id"] as string | undefined;
      const plan = mapKelviqPlan(data.plan_identifier as string | undefined);
      if (!subscriptionId || !orgId || !plan || plan === "free") break;
      const { error: paymentError } = await supabase.from("subscriptions").upsert(
        {
          org_id: orgId,
          kelviq_customer_id: (data.customer_id as string | undefined) ?? null,
          kelviq_subscription_id: subscriptionId,
          plan,
          status: "active",
          charge_period: (data.charge_period as string) || "MONTHLY",
          current_period_end: data.current_period_end
            ? new Date(data.current_period_end as string).toISOString()
            : new Date(new Date(event.created_at).getTime() + ((data.charge_period || "MONTHLY") === "YEARLY" ? 365 : 30) * 86_400_000).toISOString(),
          metadata: {
            ...(data.metadata ?? {}),
            payment_confirmed_at: new Date().toISOString(),
          } as never,
        },
        { onConflict: "org_id" },
      );
      if (paymentError) throw paymentError;
      await supabase
        .from("profiles")
        .update({ plan } as never)
        .eq("org_id", orgId);
      break;
    }

    case "payment.failed":
    case "invoice.payment_failed": {
      // Payment failed - mark as past_due
      const subscriptionId = data.subscription_id as string;

      const { error: failError } = await supabase
        .from("subscriptions")
        .update({
          status: "past_due",
        })
        .eq("kelviq_subscription_id", subscriptionId);

      if (failError) {
        // Silent error handling
      }
      break;
    }

    default:
      // Unhandled event type - silently ignore
      break;
  }
}

function mapKelviqPlan(planIdentifier: string | undefined): "free" | "standard" | "pro" | null {
  if (planIdentifier === "pro-plan") return "pro";
  if (planIdentifier === "standard-plan") return "standard";
  if (planIdentifier === "free-plan") return "free";
  return null;
}

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
