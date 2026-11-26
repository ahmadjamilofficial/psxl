import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const PLANS = {
  "brokerage-pilot": { chargePeriod: "ONE_TIME", priceIdentifier: "brokerage-pilot" },
  "brokerage-operations": { chargePeriod: "MONTHLY", priceIdentifier: "brokerage-operations" },
  "brokerage-enterprise": { chargePeriod: "MONTHLY", priceIdentifier: "brokerage-enterprise" },
} as const;

type BusinessPlan = keyof typeof PLANS;

export const Route = createFileRoute("/api/kelviq-business-checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization") ?? "";
          const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
          if (!accessToken) return Response.json({ error: "Authentication required." }, { status: 401 });

          const body = await request.json().catch(() => null) as { plan?: string; orgId?: string } | null;
          if (!body || !Object.prototype.hasOwnProperty.call(PLANS, body.plan ?? "") || !body.orgId) {
            return Response.json({ error: "Choose a valid Business plan and workspace." }, { status: 400 });
          }
          const plan = body.plan as BusinessPlan;
          const supabaseUrl = process.env["SUPABASE_URL"] ?? (import.meta.env["VITE_SUPABASE_URL"] as string | undefined);
          const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ??
            (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined) ??
            (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined);
          const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
          const kelviqKey = process.env["KELVIQ_SERVER_API_KEY"] ?? "";
          if (!supabaseUrl || !publishableKey || !serviceRoleKey || !kelviqKey) {
            return Response.json({ error: "Business billing is not fully configured on the server." }, { status: 503 });
          }

          const authClient = createClient(supabaseUrl, publishableKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
          if (authError || !authData.user) return Response.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
          if (authData.user.user_metadata?.["workspace_type_selected"] !== true) {
            return Response.json({ error: "Choose your PSXL workspace before continuing." }, { status: 403 });
          }

          const admin = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: profile, error: profileError } = await admin
            .from("profiles").select("org_id, role").eq("user_id", authData.user.id).maybeSingle();
          if (profileError || !profile?.org_id || profile.org_id !== body.orgId ||
              !["owner", "admin"].includes(profile.role)) {
            return Response.json({ error: "Only a Business workspace owner or admin can start checkout." }, { status: 403 });
          }

          const { data: organization, error: orgError } = await admin
            .from("organizations").select("workspace_type").eq("id", profile.org_id).maybeSingle();
          if (orgError || organization?.workspace_type !== "business") {
            return Response.json({ error: "Business subscriptions require a Business workspace." }, { status: 403 });
          }

          const intentId = crypto.randomUUID();
          const expiresAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();
          const period = PLANS[plan].chargePeriod;
          const { error: intentError } = await (admin as any).from("business_checkout_intents").insert({
            intent_id: intentId,
            org_id: profile.org_id,
            user_id: authData.user.id,
            plan,
            charge_period: period,
            expires_at: expiresAt,
          });
          if (intentError) throw intentError;

          const environment = (process.env["KELVIQ_ENVIRONMENT"] ?? "production").toLowerCase();
          const apiRoot = environment === "sandbox"
            ? "https://sandboxapi.kelviq.com/api/v1"
            : "https://api.kelviq.com/api/v1";
          const origin = new URL(request.url).origin;
          const response = await fetch(`${apiRoot}/checkout/`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${kelviqKey}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              planIdentifier: PLANS[plan].priceIdentifier,
              chargePeriod: period,
              customerId: profile.org_id,
              successUrl: `${origin}/app/overview?business_checkout=success`,
              cancelUrl: `${origin}/pricing?business_checkout=cancelled`,
              lockEmail: true,
              metadata: {
                checkout_intent_id: intentId,
                org_id: profile.org_id,
                product_area: "business",
                plan,
              },
            }),
            signal: AbortSignal.timeout(12000),
          });
          const payload = await response.json().catch(() => ({})) as {
            checkoutUrl?: string;
            checkoutSessionId?: string;
            data?: { checkoutUrl?: string; checkoutSessionId?: string };
          };
          const checkoutUrl = payload.checkoutUrl ?? payload.data?.checkoutUrl;
          const checkoutSessionId = payload.checkoutSessionId ?? payload.data?.checkoutSessionId;
          if (!response.ok || !checkoutUrl || !checkoutSessionId) {
            await (admin as any).from("business_checkout_intents")
              .update({ status: "failed" }).eq("intent_id", intentId);
            console.error("[Kelviq Business] Checkout session creation failed:", response.status);
            return Response.json({ error: "Kelviq could not create a Business checkout session. Please retry." }, { status: 502 });
          }

          const { error: sessionError } = await (admin as any).from("business_checkout_intents")
            .update({ kelviq_checkout_session_id: checkoutSessionId })
            .eq("intent_id", intentId);
          if (sessionError) throw sessionError;

          return Response.json({ checkoutUrl });
        } catch (error) {
          console.error("[Kelviq Business] Checkout failed:", error);
          return Response.json({ error: "Secure Business checkout is temporarily unavailable." }, { status: 503 });
        }
      },
    },
  },
});
