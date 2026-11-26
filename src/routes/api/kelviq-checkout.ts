import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const INDIVIDUAL_PLAN_IDENTIFIERS = {
  standard: "standard-plan",
  pro: "pro-plan",
} as const;

const INDIVIDUAL_CHECKOUT_PRODUCT =
  "https://www.kelviq.com/buy/ac42e10b-db2e-44ca-b212-6d4f0429b6e3/";

export const Route = createFileRoute("/api/kelviq-checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization") ?? "";
          const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
          if (!accessToken) return Response.json({ error: "Authentication required." }, { status: 401 });

          const body = await request.json().catch(() => null) as {
            plan?: string;
            orgId?: string;
            chargePeriod?: string;
            trialPeriod?: number;
          } | null;
          if (!body || !["standard", "pro"].includes(body.plan ?? "") ||
              !["MONTHLY", "YEARLY"].includes(body.chargePeriod ?? "") ||
              !body.orgId ||
              body.trialPeriod !== undefined) {
            return Response.json({ error: "Choose a valid plan and billing period. Trial periods are not supported by the plan-specific hosted checkout links." }, { status: 400 });
          }

          const supabaseUrl = process.env["SUPABASE_URL"] ?? (import.meta.env["VITE_SUPABASE_URL"] as string | undefined);
          const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ??
            (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined) ??
            (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined);
          const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
          if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
            return Response.json({ error: "Workspace billing is not fully configured on the server." }, { status: 503 });
          }

          const authClient = createClient(supabaseUrl, publishableKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
          if (authError || !authData.user) return Response.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
          if (authData.user.user_metadata?.["workspace_type_selected"] !== true) {
            return Response.json({ error: "Choose your PSXL workspace before continuing to checkout." }, { status: 403 });
          }

          const admin = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: profile, error: profileError } = await admin
            .from("profiles")
            .select("org_id")
            .eq("user_id", authData.user.id)
            .maybeSingle();
          if (profileError || !profile?.org_id || profile.org_id !== body.orgId) {
            return Response.json({ error: "Your PSXL workspace could not be verified." }, { status: 403 });
          }
          const { data: organization, error: orgError } = await admin
            .from("organizations")
            .select("workspace_type")
            .eq("id", profile.org_id)
            .maybeSingle();
          if (orgError || organization?.workspace_type !== "individual") {
            return Response.json({ error: "Individual subscriptions require an Individual workspace." }, { status: 403 });
          }

          const intentId = crypto.randomUUID();
          // Kelviq Checkout API sessions remain open for up to four days.
          const expiresAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();
          const intent = {
            intent_id: intentId,
            org_id: profile.org_id,
            user_id: authData.user.id,
            plan: body.plan,
            charge_period: body.chargePeriod,
            expires_at: expiresAt,
          };
          const intentEventId = `checkout_intent:${intentId}`;
          const { error: insertError } = await admin.from("subscription_events").insert({
            kelviq_event_id: intentEventId,
            event_type: "checkout.intent.created",
            event_data: intent as never,
            processed: false,
          });
          if (insertError) throw insertError;

          // Use the dedicated static hosted link for this exact plan and billing period.
          // The org UUID is passed as Kelviq's customer_id so the shared signed
          // webhook can correlate the payment without requiring checkout metadata.
          const checkoutUrl = new URL(INDIVIDUAL_CHECKOUT_PRODUCT);
          checkoutUrl.searchParams.set("enabled", "free-plan,pro-plan,standard-plan");
          checkoutUrl.searchParams.set("plan_identifier", INDIVIDUAL_PLAN_IDENTIFIERS[body.plan as "standard" | "pro"]);
          checkoutUrl.searchParams.set("charge_period", body.chargePeriod);
          checkoutUrl.searchParams.set("customer_id", profile.org_id);
          checkoutUrl.searchParams.set("success_url", `${new URL(request.url).origin}/app/billing?checkout=success`);
          return Response.json({ checkoutUrl: checkoutUrl.toString() });
        } catch (error) {
          console.error("[Kelviq] Individual checkout intent creation failed:", error);
          return Response.json({ error: "Secure checkout is temporarily unavailable. Please retry." }, { status: 503 });
        }
      },
    },
  },
});
