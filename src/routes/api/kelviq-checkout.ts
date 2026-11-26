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
              (body.trialPeriod !== undefined &&
                (!Number.isInteger(body.trialPeriod) || body.trialPeriod < 1 || body.trialPeriod > 30 || body.plan !== "standard"))) {
            return Response.json({ error: "Choose a valid plan, billing period and workspace." }, { status: 400 });
          }

          const supabaseUrl = process.env["SUPABASE_URL"] ?? (import.meta.env["VITE_SUPABASE_URL"] as string | undefined);
          const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ??
            (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined) ??
            (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined);
          const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
          const kelviqKey = process.env["KELVIQ_SERVER_API_KEY"] ?? "";
          if (!supabaseUrl || !publishableKey || !serviceRoleKey || (body.trialPeriod && !kelviqKey)) {
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

          // Standard purchases use a dedicated plan + billing-period hosted URL.
          // Trial purchases retain Checkout API support because static links cannot
          // configure trial periods or carry checkout metadata.
          let checkoutUrl: string;
          if (body.trialPeriod) {
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
                planIdentifier: INDIVIDUAL_PLAN_IDENTIFIERS.standard,
                chargePeriod: body.chargePeriod,
                plansEnabled: "free-plan,pro-plan,standard-plan",
                customerId: profile.org_id,
                ...(authData.user.email ? { email: authData.user.email, lockEmail: true } : {}),
                trialPeriod: body.trialPeriod,
                successUrl: `${origin}/app/billing?checkout=success`,
                cancelUrl: `${origin}/pricing?checkout=cancelled`,
                metadata: {
                  checkout_intent_id: intentId,
                  org_id: profile.org_id,
                  product_area: "individual",
                  source: "psxl_app",
                  plan: body.plan,
                },
              }),
              signal: AbortSignal.timeout(12000),
            });
            const payload = await response.json().catch(() => ({})) as {
              checkoutUrl?: string;
              data?: { checkoutUrl?: string };
            };
            checkoutUrl = payload.checkoutUrl ?? payload.data?.checkoutUrl ?? "";
            if (!response.ok || !checkoutUrl) {
              await admin.from("subscription_events")
                .update({ processed: true, error_message: "Kelviq trial checkout session creation failed." })
                .eq("kelviq_event_id", intentEventId);
              return Response.json({ error: "Kelviq could not create your trial checkout. Please retry." }, { status: 502 });
            }
          } else {
            const hostedUrl = new URL(INDIVIDUAL_CHECKOUT_PRODUCT);
            hostedUrl.searchParams.set("enabled", "free-plan,pro-plan,standard-plan");
            hostedUrl.searchParams.set("plan_identifier", INDIVIDUAL_PLAN_IDENTIFIERS[body.plan as "standard" | "pro"]);
            hostedUrl.searchParams.set("charge_period", body.chargePeriod);
            hostedUrl.searchParams.set("customer_id", profile.org_id);
            hostedUrl.searchParams.set("success_url", `${new URL(request.url).origin}/app/billing?checkout=success`);
            checkoutUrl = hostedUrl.toString();
          }
          return Response.json({ checkoutUrl });
        } catch (error) {
          console.error("[Kelviq] Individual checkout intent creation failed:", error);
          return Response.json({ error: "Secure checkout is temporarily unavailable. Please retry." }, { status: 503 });
        }
      },
    },
  },
});
