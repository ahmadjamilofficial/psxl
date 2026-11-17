import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Kelviq webhook signature verification (if they provide one)
// For now, we'll use event ID deduplication

const KELVIQ_WEBHOOK_SECRET = process.env["KELVIQ_WEBHOOK_SECRET"] ?? "";

export const Route = createFileRoute("/api/webhooks/kelviq")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const rawBody = await request.text();
          const body = JSON.parse(rawBody) as KelviqWebhookEvent;
          const signature = request.headers.get("x-kelviq-signature") ?? "";
          if (KELVIQ_WEBHOOK_SECRET) {
            const supplied = signature.replace(/^sha256=/i, "").trim();
            const expected = createHmac("sha256", KELVIQ_WEBHOOK_SECRET)
              .update(rawBody)
              .digest("hex");
            const valid =
              supplied.length === expected.length &&
              timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
            if (!valid) return new Response("Invalid signature", { status: 401 });
          }
          if (!body.id || !body.type)
            return new Response("Invalid webhook payload", { status: 400 });

          const supabaseUrl =
            process.env["SUPABASE_URL"] ??
            (import.meta.env["VITE_SUPABASE_URL"] as string | undefined);
          const supabaseKey =
            process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
            ((import.meta.env["VITE_SUPABASE_SERVICE_ROLE_KEY"] ??
              import.meta.env["VITE_SUPABASE_ANON_KEY"]) as string | undefined);

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
        .select("org_id, metadata")
        .eq("kelviq_subscription_id", subscriptionId)
        .maybeSingle();
      const metadata = (existingSubscription?.metadata ?? {}) as Record<string, unknown>;
      if (!existingSubscription || !metadata["payment_confirmed_at"]) break;
      const planIdentifier = data.plan_identifier as string;
      const plan = mapKelviqPlan(planIdentifier);

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
              : null,
            cancel_at_period_end: (data.cancel_at_period_end as boolean) || false,
            metadata: data.metadata as never,
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
      // Subscription cancelled
      const subscriptionId = data.subscription_id as string;

      const { error: cancelError } = await supabase
        .from("subscriptions")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancel_at_period_end: (data.cancel_at_period_end as boolean) || false,
        })
        .eq("kelviq_subscription_id", subscriptionId);

      if (cancelError) {
        // Silent error handling
      }

      // Update user's profile plan to Basic ($0)
      const { data: subscription } = await supabase
        .from("subscriptions")
        .select("org_id")
        .eq("kelviq_subscription_id", subscriptionId)
        .single();

      if (subscription) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({ plan: "free" } as never)
          .eq("org_id", subscription.org_id);

        if (profileError) {
          // Silent error handling
        }
      }
      break;
    }

    case "payment.succeeded":
    case "invoice.paid": {
      const subscriptionId = data.subscription_id as string | undefined;
      const orgId = data.metadata?.["org_id"] as string | undefined;
      const plan = mapKelviqPlan(data.plan_identifier as string | undefined);
      if (!subscriptionId || !orgId || plan === "free") break;
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
            : null,
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

function mapKelviqPlan(planIdentifier: string | undefined): "free" | "standard" | "pro" {
  if (planIdentifier === "pro-plan") return "pro";
  if (planIdentifier === "free-plan") return "free";
  return "standard";
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
