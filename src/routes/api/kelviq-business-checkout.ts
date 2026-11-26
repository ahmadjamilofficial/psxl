import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const PLANS = {
  "brokerage-pilot": {
    chargePeriod: "ONE_TIME",
    checkoutUrl: "https://www.kelviq.com/buy/9eee9bc3-92d5-46c9-9f6b-a2fe97f7181c/?enabled=brokerage-pilot&plan_identifier=brokerage-pilot&charge_period=ONE_TIME",
  },
  "brokerage-operations": {
    chargePeriod: "MONTHLY",
    checkoutUrl: "https://www.kelviq.com/buy/9eee9bc3-92d5-46c9-9f6b-a2fe97f7181c/?enabled=brokerage-operations&plan_identifier=brokerage-operations&charge_period=MONTHLY",
  },
  "brokerage-enterprise": {
    chargePeriod: "MONTHLY",
    checkoutUrl: "https://www.kelviq.com/buy/9eee9bc3-92d5-46c9-9f6b-a2fe97f7181c/?enabled=brokerage-enterprise&plan_identifier=brokerage-enterprise&charge_period=MONTHLY",
  },
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
          if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
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

          // Dedicated static Kelviq product link per Brokerage tier.
          // Attach the verified PSXL organisation as customer_id for webhook correlation.
          const checkoutUrl = new URL(PLANS[plan].checkoutUrl);
          checkoutUrl.searchParams.set("customer_id", profile.org_id);
          checkoutUrl.searchParams.set("success_url", `${new URL(request.url).origin}/app/overview?business_checkout=success`);

          return Response.json({ checkoutUrl: checkoutUrl.toString() });
        } catch (error) {
          console.error("[Kelviq Business] Checkout failed:", error);
          return Response.json({ error: "Secure Business checkout is temporarily unavailable." }, { status: 503 });
        }
      },
    },
  },
});
