import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";

const PRODUCT_IDENTIFIER = "psxl-brokerage-operations";
const PLAN_DEFINITIONS = [
  {
    identifier: "brokerage-pilot",
    name: "Brokerage Pilot",
    description: "A scoped 4–6 week evaluation for one brokerage entity and agreed reconciliation workflows. One-time pricing is configured separately before publication.",
    ordering: 10,
  },
  {
    identifier: "brokerage-operations",
    name: "Brokerage Operations",
    description: "Recurring brokerage reconciliation operations under an annual agreement. Usage bands, integrations and support are agreed per contract.",
    ordering: 20,
  },
  {
    identifier: "brokerage-enterprise",
    name: "Brokerage Enterprise",
    description: "Sales-led enterprise plan for multi-entity deployments, custom controls, integrations and contracted support.",
    ordering: 30,
  },
] as const;

type JsonRecord = Record<string, unknown>;

function recordsFrom(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object");
  if (!payload || typeof payload !== "object") return [];
  const object = payload as JsonRecord;
  for (const key of ["results", "items", "data", "products", "plans"]) {
    const value = object[key];
    if (Array.isArray(value)) return value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object");
    if (value && typeof value === "object") {
      const nested = recordsFrom(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function idOf(value: JsonRecord | undefined): string | null {
  if (!value) return null;
  for (const key of ["id", "uuid", "product_id", "plan_id"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

export const Route = createFileRoute("/api/kelviq-catalog")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization") ?? "";
          const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
          if (!accessToken) return Response.json({ error: "Authentication required." }, { status: 401 });

          const supabaseUrl = process.env["SUPABASE_URL"] ?? (import.meta.env["VITE_SUPABASE_URL"] as string | undefined);
          const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ??
            (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined) ??
            (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined);
          const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
          const kelviqKey = process.env["KELVIQ_SERVER_API_KEY"] ?? "";
          if (!supabaseUrl || !publishableKey || !serviceRoleKey || !kelviqKey) {
            return Response.json({ error: "Server billing configuration is incomplete." }, { status: 503 });
          }

          const authClient = createClient(supabaseUrl, publishableKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
          if (authError || !authData.user) return Response.json({ error: "Your session has expired. Sign in again." }, { status: 401 });

          const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: profile, error: profileError } = await admin
            .from("profiles")
            .select("org_id, role")
            .eq("user_id", authData.user.id)
            .maybeSingle();
          if (profileError || !profile?.org_id || !["owner", "admin"].includes(profile.role)) {
            return Response.json({ error: "Only workspace owners or admins can manage billing catalog settings." }, { status: 403 });
          }

          const body = await request.json().catch(() => null) as { action?: string; confirmation?: string } | null;
          if (!body || !["audit", "provision"].includes(body.action ?? "")) {
            return Response.json({ error: "Choose audit or provision." }, { status: 400 });
          }
          if (body.action === "provision" && body.confirmation !== "CREATE_PSXL_BROKERAGE_CATALOG") {
            return Response.json({ error: "Explicit provisioning confirmation is required." }, { status: 400 });
          }

          const sandbox = (process.env["KELVIQ_ENVIRONMENT"] ?? "production").toLowerCase() === "sandbox";
          const apiRoot = sandbox ? "https://sandboxapi.kelviq.com/api/v1" : "https://api.kelviq.com/api/v1";
          const apiUrlOverride = process.env["KELVIQ_API_BASE_URL"];
          const root = apiUrlOverride ? new URL(apiUrlOverride).origin + "/api/v1" : apiRoot;
          const kelviqFetch = async (path: string, init?: RequestInit) => {
            const response = await fetch(`${root}${path}`, {
              ...init,
              headers: {
                Authorization: `Bearer ${kelviqKey}`,
                Accept: "application/json",
                "Content-Type": "application/json",
                ...init?.headers,
              },
              signal: AbortSignal.timeout(12000),
            });
            const payload = await response.json().catch(() => ({})) as unknown;
            if (!response.ok) {
              console.error("[Kelviq catalog] Request failed:", path, response.status);
              throw new Error(`Kelviq catalog request failed (${response.status}). Check the server-side API key and Kelviq permissions.`);
            }
            return payload;
          };

          const [productsPayload, plansPayload] = await Promise.all([
            kelviqFetch("/catalog/products/"),
            kelviqFetch("/catalog/plans/"),
          ]);
          const products = recordsFrom(productsPayload);
          const plans = recordsFrom(plansPayload);
          let product = products.find((item) => item.identifier === PRODUCT_IDENTIFIER);
          const created: { type: string; identifier: string; id: string | null; status: string }[] = [];

          if (!product && body.action === "provision") {
            const createdProduct = await kelviqFetch("/catalog/products/", {
              method: "POST",
              body: JSON.stringify({
                name: "PSXL Brokerage Operations",
                identifier: PRODUCT_IDENTIFIER,
                taxCode: "saas_business",
              }),
            });
            product = (createdProduct && typeof createdProduct === "object" && "data" in createdProduct
              ? (createdProduct as JsonRecord).data
              : createdProduct) as JsonRecord;
            created.push({ type: "product", identifier: PRODUCT_IDENTIFIER, id: idOf(product), status: "created" });
          }

          const productId = idOf(product);
          if (body.action === "provision" && !productId) {
            throw new Error("Kelviq did not return a product UUID. No plans were created.");
          }

          const resultingPlans = [...plans];
          if (body.action === "provision" && productId) {
            for (const definition of PLAN_DEFINITIONS) {
              let plan = resultingPlans.find((item) => item.identifier === definition.identifier);
              if (!plan) {
                const createdPlan = await kelviqFetch("/catalog/plans/", {
                  method: "POST",
                  body: JSON.stringify({
                    name: definition.name,
                    identifier: definition.identifier,
                    product: productId,
                    description: definition.description,
                    isVisible: false,
                    ordering: definition.ordering,
                  }),
                });
                plan = (createdPlan && typeof createdPlan === "object" && "data" in createdPlan
                  ? (createdPlan as JsonRecord).data
                  : createdPlan) as JsonRecord;
                resultingPlans.push(plan);
                created.push({ type: "plan", identifier: definition.identifier, id: idOf(plan), status: "created_draft" });
              }
            }
          }

          const businessPlans = resultingPlans
            .filter((item) => PLAN_DEFINITIONS.some((definition) => definition.identifier === item.identifier))
            .map((item) => ({
              identifier: typeof item.identifier === "string" ? item.identifier : null,
              id: idOf(item),
              name: typeof item.name === "string" ? item.name : null,
              isVisible: item.isVisible === true,
            }));

          return Response.json({
            ok: true,
            environment: sandbox ? "sandbox" : "production",
            action: body.action,
            product: product ? { identifier: PRODUCT_IDENTIFIER, id: productId, name: product.name ?? "PSXL Brokerage Operations" } : null,
            plans: businessPlans,
            created,
            nextStep: body.action === "audit"
              ? "Catalog inspected only. Send action=provision with the explicit confirmation string to create missing draft resources."
              : "Draft resources only. Configure and verify plan prices and feature entitlements before publishing or enabling checkout.",
          });
        } catch (error) {
          console.error("[Kelviq catalog] Provisioning failed:", error);
          return Response.json({ error: error instanceof Error ? error.message : "Kelviq catalog operation failed." }, { status: 502 });
        }
      },
    },
  },
});
