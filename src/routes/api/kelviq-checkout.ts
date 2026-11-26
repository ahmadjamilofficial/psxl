import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const CHECKOUT_BASE =
  process.env["KELVIQ_HOSTED_CHECKOUT_URL"] ??
  "https://www.kelviq.com/buy/ac42e10b-db2e-44ca-b212-6d4f0429b6e3/?enabled=free-plan%2Cpro-plan%2Cstandard-plan&plan_identifier=free-plan&charge_period=ONE_TIME";

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
              (body.trialPeriod !== undefined &&
                (!Number.isInteger(body.trialPeriod) || body.trialPeriod < 1 || body.trialPeriod > 30 || body.plan !== "standard"))) {
            return Response.json({ error: "Choose a valid plan, billing period and workspace." }, { status: 400 });
          }

          const supabaseUrl = process.env["SUPABASE_URL"] ?? (import.meta.env["VITE_SUPABASE_URL"] as string | undefined);
          const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ??
            (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined) ??
            (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined);
          const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
          if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
            return Response.json({ error: "Workspace billing storage is not configured. Contact support." }, { status: 503 });
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

          const intentId = crypto.randomUUID();
          const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
          const intent = {
            intent_id: intentId,
            org_id: profile.org_id,
            user_id: authData.user.id,
            plan: body.plan,
            charge_period: body.chargePeriod,
            expires_at: expiresAt,
          };
          const { error: insertError } = await admin.from("subscription_events").insert({
            kelviq_event_id: `checkout_intent:${intentId}`,
            event_type: "checkout.intent.created",
            event_data: intent as never,
            processed: false,
          });
          if (insertError) throw insertError;

          const checkoutUrl = new URL(CHECKOUT_BASE);
          checkoutUrl.searchParams.set("plan_identifier", body.plan === "pro" ? "pro-plan" : "standard-plan");
          checkoutUrl.searchParams.set("charge_period", body.chargePeriod);
          checkoutUrl.searchParams.set("metadata[checkout_intent_id]", intentId);
          checkoutUrl.searchParams.set("metadata[source]", "psxl_app");
          checkoutUrl.searchParams.set("metadata[product_area]", "individual");
          return Response.json({ checkoutUrl: checkoutUrl.toString() });
        } catch (error) {
          console.error("[Kelviq] Checkout intent creation failed:", error);
          return Response.json({ error: "Secure checkout is temporarily unavailable. Please retry." }, { status: 503 });
        }
      },
    },
  },
});
