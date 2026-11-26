import { createFileRoute } from "@tanstack/react-router";
import { Loader2, PackageCheck } from "lucide-react";
import { ArrowUpRight, CreditCard, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Btn, Panel, StatusPill } from "@/components/kit";
import { PeriodToggle, PlanCards } from "@/components/site/PlanCards";
import { useAuth } from "@/lib/auth-context";
import {
  MONTHLY_DAYS,
  YEARLY_DAYS,
  pausePaidClock,
  resolveEntitlement,
  resumePaidClock,
} from "@/lib/entitlement";
import {
  type ChargePeriod,
  type PlanId,
  PLANS,
  TRIAL_DAYS,
  createKelviqCheckoutSession,
  normalizePlanId,
} from "@/lib/plans";
import { supabase } from "@/lib/supabase";
import { clearTrialClock, getTrialClock, isTrialExpired, trialDaysRemaining } from "@/lib/trial";

export const Route = createFileRoute("/app/billing")({
  component: Billing,
});

interface SubRow {
  plan: string;
  status: string;
  trial_end_at: string | null;
  charge_period?: string | null;
  current_period_end?: string | null;
  created_at?: string | null;
}

function Billing() {
  const { profile, user, refreshProfile } = useAuth();
  const [sub, setSub] = useState<SubRow | null>(null);
  const [period, setPeriod] = useState<ChargePeriod>("monthly");
  const [clockTick, setClockTick] = useState(0);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogResult, setCatalogResult] = useState<string | null>(null);

  async function runCatalogAction(action: "audit" | "provision") {
    if (action === "provision" && !window.confirm("Create the missing PSXL Brokerage product and three unpublished draft plans in your Kelviq production catalog? This will not publish or charge customers.")) return;
    setCatalogBusy(true);
    setCatalogResult(null);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Please sign in again.");
      const response = await fetch("/api/kelviq-catalog", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "provision" ? { confirmation: "CREATE_PSXL_BROKERAGE_CATALOG" } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Kelviq catalog request failed.");
      setCatalogResult(JSON.stringify(payload, null, 2));
      toast.success(action === "audit" ? "Kelviq catalog audit complete" : "Brokerage draft catalog created");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Catalog request failed.";
      setCatalogResult(message);
      toast.error(message);
    } finally {
      setCatalogBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    const orgId = profile?.org_id;
    if (!orgId) return;
    void (async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("plan, status, trial_end_at, charge_period, current_period_end, created_at")
        .eq("org_id", orgId)
        .maybeSingle();
      if (!alive) return;
      setSub((data as SubRow | null) ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [profile?.org_id, clockTick]);

  const orgId = profile?.org_id ?? "";
  const userId = user?.id ?? "";
  const clock = getTrialClock(orgId, userId);
  const serverEnds = sub?.trial_end_at ?? null;
  const entitlement = resolveEntitlement({
    orgId,
    userId,
    subPlan: sub?.plan ?? profile?.plan,
    subStatus: sub?.status ?? profile?.plan_status,
    chargePeriod: sub?.charge_period,
    currentPeriodEnd: sub?.current_period_end,
    createdAt: sub?.created_at,
  });
  const currentPlan = normalizePlanId(entitlement.featurePlan);
  const status = sub?.status ?? profile?.plan_status ?? "active";
  const onTrial =
    status === "trialing" ||
    (Boolean(clock) && !isTrialExpired(clock, serverEnds) && currentPlan === "standard");
  const trialDays = trialDaysRemaining(clock, serverEnds);
  const trialExpired =
    (status === "trialing" && isTrialExpired(clock, serverEnds)) ||
    (Boolean(clock) &&
      isTrialExpired(clock, serverEnds) &&
      currentPlan !== "pro" &&
      status !== "active");

  const priceNow =
    currentPlan === "free"
      ? "$0"
      : period === "yearly" || sub?.charge_period === "YEARLY"
        ? `$${PLANS[currentPlan].yearlyPrice}/year`
        : `$${PLANS[currentPlan].monthlyPrice}/month`;

  async function revertToFree() {
    if (!orgId || !userId) return;
    pausePaidClock(orgId, userId);
    try {
      await supabase
        .from("subscriptions")
        .update({ cancel_at_period_end: true } as never)
        .eq("org_id", orgId);
    } catch {
      /* local pause still applies */
    }
    setClockTick((n) => n + 1);
    await refreshProfile();
    toast.success(
      "Reverted to Basic ($0). You can restore your paid plan for free until the paid window ends.",
    );
  }

  async function restorePaid(plan: PlanId) {
    if (!orgId || !userId) return;
    if (plan !== "standard" && plan !== "pro") return;
    if (!entitlement.canRestore || entitlement.paidPlan !== plan) return;
    resumePaidClock(orgId, userId);
    try {
      await supabase
        .from("subscriptions")
        .update({ cancel_at_period_end: false, status: "active", plan } as never)
        .eq("org_id", orgId);
    } catch {
      /* local resume still applies */
    }
    setClockTick((n) => n + 1);
    await refreshProfile();
    toast.success(
      `Restored ${PLANS[plan].name} at no extra charge. ${entitlement.daysLeft} day(s) left in this cycle.`,
    );
  }

  function openPlan(plan: PlanId) {
    if (plan === "free") {
      if (currentPlan === "free") {
        toast.info("You are already on Basic.");
        return;
      }
      void revertToFree();
      return;
    }
    if (entitlement.canRestore && entitlement.paidPlan === plan && !entitlement.expired) {
      void restorePaid(plan);
      return;
    }
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session?.access_token) throw new Error("Please sign in again to continue.");
        const checkoutUrl = await createKelviqCheckoutSession({
          plan,
          period,
          accessToken: data.session.access_token,
        });
        window.location.assign(checkoutUrl);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to open secure checkout.");
      }
    })();
  }

  async function handleStartTrial() {
    if (!orgId || !userId) {
      toast.error("Sign in to start the free trial.");
      return;
    }
    // Checkout is only intent. Never write a paid/trialing entitlement here:
    // Kelviq's payment webhook is the source of truth and activates the plan.
    clearTrialClock(orgId, userId);
    setClockTick((n) => n + 1);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error("Please sign in again to continue.");
      const checkoutUrl = await createKelviqCheckoutSession({
        plan: "standard",
        period: "monthly",
        accessToken: data.session.access_token,
        trialDays: TRIAL_DAYS,
      });
      window.location.assign(checkoutUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to open secure checkout.");
    }
  }

  function handleStayBasic() {
    clearTrialClock(orgId, userId);
    void revertToFree();
  }

  return (
    <div className="space-y-6 p-3 sm:p-6">
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: "1.5rem" }}>Billing</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Manage your plan, usage and payment details.
        </p>
      </div>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium" style={{ color: "var(--ink-3)" }}>
              CURRENT PLAN
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-xl font-semibold">{PLANS[currentPlan].name}</p>
              <StatusPill tone={onTrial ? "info" : trialExpired ? "bad" : "ok"}>
                {onTrial
                  ? `Free trial · ${trialDays} day${trialDays === 1 ? "" : "s"} left`
                  : trialExpired
                    ? "Trial ended"
                    : currentPlan === "free"
                      ? "Free"
                      : "Active"}
              </StatusPill>
            </div>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
              {priceNow}
              {onTrial
                ? " · free until your trial ends"
                : currentPlan === "free" && entitlement.canRestore
                  ? ` · Basic now · ${entitlement.paidPlan ? PLANS[entitlement.paidPlan].name : "paid"} can be restored free for ${entitlement.daysLeft} day${entitlement.daysLeft === 1 ? "" : "s"}`
                  : currentPlan === "free"
                    ? " · completely free"
                    : ` · billed every ${period === "yearly" ? `${YEARLY_DAYS} days` : `${MONTHLY_DAYS} days`}${
                        entitlement.daysLeft
                          ? ` · ${entitlement.daysLeft} day${entitlement.daysLeft === 1 ? "" : "s"} left in this cycle`
                          : ""
                      }`}
            </p>
          </div>
          <Btn
            variant="secondary"
            onClick={() => openPlan(currentPlan === "free" ? "standard" : currentPlan)}
          >
            <CreditCard size={15} strokeWidth={1.75} />
            Manage payment
          </Btn>
        </div>
      </Panel>

      {trialExpired && (
        <div
          className="rounded-2xl px-5 py-4"
          style={{
            background: "color-mix(in srgb, var(--bad) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--bad) 24%, transparent)",
          }}
        >
          <p className="text-sm font-semibold">Your {TRIAL_DAYS}-day Standard trial has ended</p>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
            Upgrade to keep Standard or Pro features, or switch back to Basic at $0 with limited AI
            quality and tools.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn variant="primary" onClick={() => openPlan("standard")}>
              Upgrade to Standard
            </Btn>
            <Btn variant="secondary" onClick={() => openPlan("pro")}>
              Upgrade to Pro
            </Btn>
            <Btn variant="secondary" onClick={handleStayBasic}>
              Continue on Basic $0
            </Btn>
          </div>
        </div>
      )}

      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4"
        style={{ background: "var(--accent-6)", border: "1px solid var(--accent-15)" }}
      >
        <div className="flex items-start gap-3">
          <Sparkles
            size={16}
            strokeWidth={1.75}
            style={{ color: "var(--color-accent)", marginTop: 2 }}
          />
          <div>
            <p className="text-sm font-semibold">
              {onTrial
                ? `${TRIAL_DAYS}-day Standard trial — ${trialDays} day${trialDays === 1 ? "" : "s"} remaining`
                : trialExpired
                  ? "Trial ended — upgrade or switch to Basic"
                  : `Start a ${TRIAL_DAYS}-day free trial of Standard`}
            </p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
              This card is the only way to start a free trial. Days are counted strictly from the
              start date and continue if you sign out or sign back in. After {TRIAL_DAYS} days you
              choose Standard, Pro, or Basic $0.
            </p>
          </div>
        </div>
        <Btn
          variant="primary"
          disabled={onTrial}
          onClick={() => {
            if (trialExpired) openPlan("standard");
            else void handleStartTrial();
          }}
        >
          {onTrial
            ? "Trial active"
            : trialExpired
              ? "Upgrade to Standard"
              : `Start ${TRIAL_DAYS}-day free trial`}
        </Btn>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">Available Plans</p>
        <PeriodToggle period={period} onChange={setPeriod} />
      </div>
      <PlanCards
        period={period}
        {...(trialExpired ? {} : { currentPlan })}
        onSelect={openPlan}
        ctaFor={(id) => {
          if (id === "free") return currentPlan === "free" ? "Current plan" : "Revert to Basic $0";
          if (entitlement.canRestore && entitlement.paidPlan === id) {
            return `Restore ${PLANS[id].name} free · ${entitlement.daysLeft}d left`;
          }
          return `Subscribe to ${PLANS[id].name}`;
        }}
      />

      {["owner", "admin"].includes(profile?.role ?? "") && (
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <PackageCheck size={18} style={{ color: "var(--color-accent)", marginTop: 2 }} />
              <div>
                <p className="text-sm font-semibold">Kelviq Brokerage Catalog</p>
                <p className="mt-1 max-w-2xl text-xs" style={{ color: "var(--ink-2)" }}>
                  Uses the existing production server key on the server. Audit first, then create the separate Brokerage product and unpublished plan drafts. Individual subscriptions are not changed.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn variant="secondary" disabled={catalogBusy} onClick={() => void runCatalogAction("audit")}>
                {catalogBusy ? <Loader2 size={14} className="animate-spin" /> : null}
                Audit catalog
              </Btn>
              <Btn variant="primary" disabled={catalogBusy} onClick={() => void runCatalogAction("provision")}>
                {catalogBusy ? <Loader2 size={14} className="animate-spin" /> : null}
                Create draft catalog
              </Btn>
            </div>
          </div>
          {catalogResult && (
            <pre className="mt-4 max-h-72 overflow-auto rounded-xl p-3 text-xs" style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}>{catalogResult}</pre>
          )}
        </Panel>
      )}

      <div
        className="flex items-start gap-2.5 rounded-2xl px-5 py-4 text-sm"
        style={{ background: "var(--accent-6)", border: "1px solid var(--accent-15)" }}
      >
        <ArrowUpRight
          size={15}
          strokeWidth={1.75}
          style={{ color: "var(--color-accent)", marginTop: 2, flexShrink: 0 }}
        />
        <p style={{ color: "var(--ink-2)" }}>
          <strong>Plans:</strong> Basic is $0. Switching to Basic from a paid plan happens in the
          app — no Kelviq checkout. If your paid cycle is still active ({MONTHLY_DAYS} days monthly
          / {YEARLY_DAYS} days yearly, counted strictly), you can restore that paid plan at no extra
          charge. New paid cycles still go through Kelviq. A {TRIAL_DAYS}-day trial applies only to
          Standard from the trial card above.
        </p>
      </div>
    </div>
  );
}
