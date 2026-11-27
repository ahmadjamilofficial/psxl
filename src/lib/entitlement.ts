import type { ChargePeriod, PlanId } from "./plans";
import { daysLeftFromIso } from "./trial";

const STORAGE_KEY = "wab.paid.clock.v1";

/** Strict recurring windows — not calendar months. */
export const MONTHLY_DAYS = 30;
export const YEARLY_DAYS = 365;

export interface PaidClock {
  orgId: string;
  userId: string;
  plan: "standard" | "pro";
  period: ChargePeriod;
  startedAt: string;
  endsAt: string;
  paused: boolean;
}

export interface Entitlement {
  /** Plan that actually unlocks features right now. */
  featurePlan: PlanId;
  paidPlan: "standard" | "pro" | null;
  periodEndsAt: string | null;
  daysLeft: number;
  paused: boolean;
  expired: boolean;
  canRestore: boolean;
}

function readClocks(): PaidClock[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PaidClock[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeClocks(clocks: PaidClock[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clocks));
  } catch {
    /* ignore */
  }
}

export function addStrictPeriod(startIso: string, period: ChargePeriod): string {
  const days = period === "yearly" ? YEARLY_DAYS : MONTHLY_DAYS;
  return new Date(new Date(startIso).getTime() + days * 86_400_000).toISOString();
}

export function getPaidClock(orgId?: string | null, userId?: string | null): PaidClock | null {
  const clocks = readClocks();
  if (orgId) {
    const byOrg = clocks.find((c) => c.orgId === orgId);
    if (byOrg) return byOrg;
  }
  if (userId) {
    const byUser = clocks.find((c) => c.userId === userId);
    if (byUser) return byUser;
  }
  return null;
}

function upsertClock(next: PaidClock) {
  const clocks = readClocks().filter((c) => c.orgId !== next.orgId && c.userId !== next.userId);
  clocks.push(next);
  writeClocks(clocks);
}

/** Starts or keeps a paid window. Never extends an existing clock. */
export function ensurePaidClock(opts: {
  orgId: string;
  userId: string;
  plan: "standard" | "pro";
  period: ChargePeriod;
  startedAt?: string | null;
  serverEndsAt?: string | null;
}): PaidClock {
  const existing = getPaidClock(opts.orgId, opts.userId);
  if (existing && !isPaidExpired(existing)) {
    return existing;
  }
  if (existing && isPaidExpired(existing)) {
    const renewed =
      opts.serverEndsAt &&
      new Date(opts.serverEndsAt).getTime() > new Date(existing.endsAt).getTime() + 86_400_000;
    if (!renewed) return existing;
  }
  const startedAt = opts.startedAt || new Date().toISOString();
  const strictEnd = addStrictPeriod(startedAt, opts.period);
  const serverEnd = opts.serverEndsAt;
  const endsAt =
    serverEnd && new Date(serverEnd).getTime() < new Date(strictEnd).getTime()
      ? serverEnd
      : strictEnd;
  const next: PaidClock = {
    orgId: opts.orgId,
    userId: opts.userId,
    plan: opts.plan,
    period: opts.period,
    startedAt,
    endsAt,
    paused: false,
  };
  upsertClock(next);
  return next;
}

export function pausePaidClock(orgId: string, userId: string): PaidClock | null {
  const existing = getPaidClock(orgId, userId);
  if (!existing) return null;
  const next = { ...existing, paused: true };
  upsertClock(next);
  return next;
}

export function resumePaidClock(orgId: string, userId: string): PaidClock | null {
  const existing = getPaidClock(orgId, userId);
  if (!existing || isPaidExpired(existing)) return null;
  const next = { ...existing, paused: false };
  upsertClock(next);
  return next;
}

export function isPaidExpired(clock: PaidClock | null): boolean {
  if (!clock) return true;
  return new Date(clock.endsAt).getTime() <= Date.now();
}

export function resolveEntitlement(opts: {
  orgId?: string | null;
  userId?: string | null;
  subPlan?: string | null;
  subStatus?: string | null;
  chargePeriod?: string | null;
  currentPeriodEnd?: string | null;
  createdAt?: string | null;
}): Entitlement {
  // A browser clock or localStorage value is never proof of payment.
  // Only a provider-confirmed subscription row with a live status and a
  // future server-side billing period end can unlock a paid plan.
  const subPlan = (opts.subPlan ?? "free").toLowerCase();
  const status = (opts.subStatus ?? "inactive").toLowerCase();
  const paidPlan = subPlan === "standard" || subPlan === "pro" ? subPlan : null;
  const endTime = opts.currentPeriodEnd ? new Date(opts.currentPeriodEnd).getTime() : Number.NaN;
  const hasValidPeriod = Number.isFinite(endTime) && endTime > Date.now();
  const active = Boolean(paidPlan && status === "active" && hasValidPeriod);
  const trialing = Boolean(paidPlan && status === "trialing" && hasValidPeriod);
  const daysLeft = hasValidPeriod ? daysLeftFromIso(opts.currentPeriodEnd) ?? 0 : 0;

  return {
    featurePlan: active || trialing ? (paidPlan as PlanId) : "free",
    paidPlan: active || trialing ? paidPlan : null,
    periodEndsAt: hasValidPeriod ? opts.currentPeriodEnd ?? null : null,
    daysLeft,
    paused: false,
    expired: Boolean(paidPlan && !hasValidPeriod),
    canRestore: false,
  };
}
