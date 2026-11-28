// ─── Plan definitions, pricing, checkout, and entitlement checks ─────────────

export type PlanId = "free" | "standard" | "pro";

export type ChargePeriod = "monthly" | "yearly";

export interface PlanLimits {
  id: PlanId;
  name: string;
  note: string;
  kelviqPlan: "free-plan" | "standard-plan" | "pro-plan";
  monthlyPrice: number;
  yearlyPrice: number;
  trialDays: number;
  popular: boolean;
  /** null = unlimited */
  transactionsPerMonth: number | null;
  taxProfiles: number | null;
  brokerAccounts: number | null;
  monthlyAiCredits: number;
  uploadsPerMonth: number;
  maxAgentSteps: number;
  aiQuality: "limited" | "standard" | "high";
  features: {
    csvExport: boolean;
    pdfExport: boolean;
    anomalyDetection: boolean;
    taxLossHarvesting: boolean;
    multiAccount: boolean;
    teamRoles: boolean;
    apiAccess: boolean;
    backgroundTasks: boolean;
    advancedIntegrations: boolean;
    specialistAgents: boolean;
  };
  highlights: string[];
}

export const TRIAL_DAYS = 7;

export const KELVIQ_CHECKOUT_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta.env?.["VITE_KELVIQ_CHECKOUT_URL"] as string | undefined)) ||
  "https://www.kelviq.com/buy/ac42e10b-db2e-44ca-b212-6d4f0429b6e3/?enabled=free-plan%2Cpro-plan%2Cstandard-plan&plan_identifier=free-plan&charge_period=ONE_TIME";

const KELVIQ_PLAN_CHECKOUT_URLS: Partial<Record<PlanId, string>> = {
  standard:
    "https://www.kelviq.com/buy/ac42e10b-db2e-44ca-b212-6d4f0429b6e3/?enabled=standard-plan&plan_identifier=standard-plan&charge_period=MONTHLY",
  pro:
    "https://www.kelviq.com/buy/ac42de10b-db2e-44ca-b212-6d4f0429b6e3/?enabled=pro-plan&plan_identifier=pro-plan&charge_period=MONTHLY",
};

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    id: "free",
    name: "Basic",
    note: "Free forever. A complete trading ledger with a practical monthly AI allowance.",
    kelviqPlan: "free-plan",
    monthlyPrice: 0,
    yearlyPrice: 0,
    trialDays: 0,
    popular: false,
    transactionsPerMonth: 500,
    taxProfiles: 1,
    brokerAccounts: 1,
    monthlyAiCredits: 30,
    uploadsPerMonth: 2,
    maxAgentSteps: 4,
    aiQuality: "limited",
    features: {
      csvExport: true,
      pdfExport: false,
      anomalyDetection: true,
      taxLossHarvesting: false,
      multiAccount: false,
      teamRoles: false,
      apiAccess: false,
      backgroundTasks: false,
      advancedIntegrations: false,
      specialistAgents: false,
    },
    highlights: [
      "Completely free — no card required",
      "500 ledger transactions / month",
      "30 AI prompts / credits per month",
      "2 statement uploads / month",
      "Basic anomaly detection and CSV export",
      "1 tax profile · 1 broker account",
    ],
  },
  standard: {
    id: "standard",
    name: "Standard",
    note: "For individuals who need intelligent financial assistance",
    kelviqPlan: "standard-plan",
    monthlyPrice: 5,
    yearlyPrice: 50,
    trialDays: TRIAL_DAYS,
    popular: false,
    transactionsPerMonth: 10000,
    taxProfiles: 2,
    brokerAccounts: 3,
    monthlyAiCredits: 300,
    uploadsPerMonth: 30,
    maxAgentSteps: 8,
    aiQuality: "standard",
    features: {
      csvExport: true,
      pdfExport: true,
      anomalyDetection: true,
      taxLossHarvesting: false,
      multiAccount: true,
      teamRoles: true,
      apiAccess: false,
      backgroundTasks: false,
      advancedIntegrations: false,
      specialistAgents: false,
    },
    highlights: [
      "10,000 ledger transactions / month",
      "300 AI credits / month",
      "30 statement uploads / month",
      "Standard AI quality",
      "Natural conversations and memory",
      "Document and transaction analysis",
      "PDF tax summary",
      "Anomaly detection",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    note: "For active traders and professionals",
    kelviqPlan: "pro-plan",
    monthlyPrice: 12,
    yearlyPrice: 120,
    trialDays: 0,
    popular: true,
    transactionsPerMonth: 100000,
    taxProfiles: null,
    brokerAccounts: 10,
    monthlyAiCredits: 1500,
    uploadsPerMonth: 1000,
    maxAgentSteps: 12,
    aiQuality: "high",
    features: {
      csvExport: true,
      pdfExport: true,
      anomalyDetection: true,
      taxLossHarvesting: true,
      multiAccount: true,
      teamRoles: true,
      apiAccess: false,
      backgroundTasks: true,
      advancedIntegrations: true,
      specialistAgents: true,
    },
    highlights: [
      "Up to 100,000 ledger transactions / month",
      "1,500 AI credits / month",
      "High-volume statement uploads (fair use)",
      "Highest AI quality and variety",
      "Everything in Standard",
      "Advanced portfolio and risk intelligence",
      "Tax-loss harvesting",
      "Background agent tasks",
      "Advanced integrations",
      "Priority processing",
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "standard", "pro"];

export type FeatureKey = keyof PlanLimits["features"];

export function normalizePlanId(plan: string | null | undefined): PlanId {
  const id = (plan ?? "free").toLowerCase();
  if (id === "pro" || id === "enterprise") return "pro";
  if (id === "standard") return "standard";
  return "free";
}

export function planOf(plan: string | null | undefined): PlanLimits {
  return PLANS[normalizePlanId(plan)];
}

export function hasFeature(plan: string | null | undefined, feature: FeatureKey): boolean {
  return planOf(plan).features[feature];
}

export function withinLimit(
  plan: string | null | undefined,
  limit: "transactionsPerMonth" | "taxProfiles" | "brokerAccounts",
  current: number,
): boolean {
  const max = planOf(plan)[limit];
  return max === null || current < max;
}

export function limitLabel(
  plan: string | null | undefined,
  limit: "transactionsPerMonth" | "taxProfiles" | "brokerAccounts",
): string {
  const max = planOf(plan)[limit];
  return max === null ? "Unlimited" : String(max);
}

export function priceLabel(plan: PlanLimits, period: ChargePeriod): string {
  if (plan.monthlyPrice === 0) return "$0";
  const amount = period === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
  return `$${amount}`;
}

export function periodSuffix(plan: PlanLimits, period: ChargePeriod): string {
  if (plan.monthlyPrice === 0) return "";
  return period === "yearly" ? "/yr" : "/mo";
}

export function kelviqCheckoutUrl(opts: {
  plan: PlanId;
  period?: ChargePeriod | undefined;
  orgId?: string | null | undefined;
  checkoutBase?: string | undefined;
}): string {
  const base =
    opts.plan === "free"
      ? opts.checkoutBase || KELVIQ_CHECKOUT_URL
      : KELVIQ_PLAN_CHECKOUT_URLS[opts.plan]!;
  const url = new URL(base);
  if (opts.orgId) url.searchParams.set("metadata[org_id]", opts.orgId);
  return url.toString();
}

/** Prefer cheaper cascade entries for Basic; keep full quality for Pro. */
export function pickCascadeForPlan<
  T extends { modelId: string },
>(cascade: T[], plan: string | null | undefined, fallback: T): T {
  // Gemini is the product's primary AI provider on every plan.
  // Plan tiers may constrain features/usage, but must never silently replace
  // the configured primary provider with a different vendor.
  const gemini = cascade.find((entry) => /^gemini-/i.test(entry.modelId));
  if (gemini) return gemini;
  const id = normalizePlanId(plan);
  if (id === "pro" || cascade.length === 0) return fallback;
  const lowCost = (m: string) =>
    /mini|flash-lite|haiku|:free|8b|7b|small|lite/i.test(m);
  const premium = (m: string) =>
    /gpt-6|gpt-4o(?!-mini)|claude-3-5|claude-3-7|deepseek-r1|70b|pro/i.test(m);
  if (id === "free") {
    return cascade.find((c) => lowCost(c.modelId)) ?? fallback;
  }
  if (id === "standard") {
    return cascade.find((c) => !lowCost(c.modelId) && !/flash-lite|:free|8b|7b/i.test(c.modelId))
      ?? cascade.find((c) => /flash|mini/i.test(c.modelId))
      ?? fallback;
  }
  return cascade.find((c) => premium(c.modelId)) ?? fallback;
}
