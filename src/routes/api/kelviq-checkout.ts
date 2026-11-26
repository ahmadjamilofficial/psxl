import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

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
            chargePeriod?: string;
            trialPeriod?: number;
          } | null;
          if (!body || !["standard", "pro"].includes(body.plan ?? "") || !["MONTHLY", "YEARLY"].includes(body.chargePeriod ?? "") || (body.trialPeriod !== undefined && (!Number.isInteger(body.trialPeriod) || body.trialPeriod < 1 || body.trialPeriod > 30 || body.plan !== "standard"))) {
            return Response.json({ error: "Choose a valid Individual plan and billing period." }, { status: 400 });
          }

          const supabaseUrl = process.env["SUPABASE_URL"] ?? (import.meta.env["VITE_SUPABASE_URL"] as string | undefined);
          const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ??
            (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined) ??
            (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined);
          const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
          const kelviqKey = process.env["KELVIQ_SERVER_API_KEY"] ?? "";
          if (!supabaseUrl || !publishableKey || !serviceRoleKey || !kelviqKey) {
            return Response.json({ error: "Billing is not configured on the server. Contact support." }, { status: 503 });
          }

          const authClient = createClient(supabaseUrl, publishableKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
          if (authError || !authData.user) return Response.json({ error: "Your session has expired. Sign in again." }, { status: 401 });

          const admin = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: profile, error: profileError } = await admin
            .from("profiles")
            .select("org_id")
            .eq("user_id", authData.user.id)
            .maybeSingle();
          if (profileError || !profile?.org_id) return Response.json({ error: "Your PSXL workspace could not be found." }, { status: 403 });

          const sandbox = (process.env["KELVIQ_ENVIRONMENT"] ?? "production").toLowerCase() === "sandbox";
          const apiUrl = process.env["KELVIQ_API_BASE_URL"] ??
            (sandbox ? "https://sandboxapi.kelviq.com/api/v1/checkout/" : "https://api.kelviq.com/api/v1/checkout/");
          const planIdentifier = body.plan === "pro" ? "pro-plan" : "standard-plan";
          // Pakistan-accessible launch pricing is charged in USD via Kelviq's documented custom_amount field.
          // Existing subscriptions keep their original recurring price; this only applies to new checkouts.
          const customAmount = body.plan === "pro"
            ? (body.chargePeriod === "YEARLY" ? 120 : 12)
            : (body.chargePeriod === "YEARLY" ? 50 : 5);
          const successUrl = new URL("/app/billing?checkout=success", request.url).toString();

          const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${kelviqKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              planIdentifier,
              chargePeriod: body.chargePeriod,
              custom_amount: customAmount,
              currency_code: "USD",
              successUrl,
              customerId: profile.org_id,
              ...(body.trialPeriod ? { trialPeriod: body.trialPeriod } : {}),
              metadata: { org_id: profile.org_id, source: "psxl_app", workspace: "individual" },
            }),
            signal: AbortSignal.timeout(10000),
          });
          const payload = await response.json().catch(() => ({})) as { checkoutUrl?: string };
          if (!response.ok || !payload.checkoutUrl) {
            console.error("[Kelviq] Checkout session creation failed:", response.status);
            return Response.json({ error: "Kelviq could not create checkout. Please retry or contact support." }, { status: 502 });
          }
          return Response.json({ checkoutUrl: payload.checkoutUrl });
        } catch (error) {
          console.error("[Kelviq] Checkout endpoint failed:", error);
          return Response.json({ error: "Checkout is temporarily unavailable. Please retry." }, { status: 503 });
        }
      },
    },
  },
});
