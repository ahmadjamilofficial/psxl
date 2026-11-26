import { brandText } from "@/lib/brand";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BadgeCheck, Minus, Sparkles, Building2, ArrowUpRight } from "lucide-react";
import { Btn, Panel } from "@/components/kit";
import { PeriodToggle, PlanCards, useCheckout } from "@/components/site/PlanCards";
import { PageShell } from "@/components/site/PageShell";
import { useAuth } from "@/lib/auth-context";
import { type PlanId, PLANS, TRIAL_DAYS, createKelviqCheckoutSession } from "@/lib/plans";
import { toast } from "sonner";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: brandText("{{brand}} Pricing — Basic, Standard and Pro") },
      {
        name: "description",
        content:
          brandText("Compare {{brand}} plans: Basic at $0, Standard at $5/month or $50/year with a 7-day free trial, Pro at $12/month or $120/year."),
      },
      { property: "og:title", content: brandText("{{brand}} Pricing") },
      {
        property: "og:description",
        content:
          "Basic is free. Standard and Pro add higher AI quality, more tools, and a 7-day trial on Standard only.",
      },
    ],
  }),
  component: Pricing,
});

const rows: [string, string | boolean, string | boolean, string | boolean][] = [
  ["Ledger transactions / month", "500", "10,000", "100,000"],
  ["AI quality", "Limited", "Standard", "Highest"],
  ["AI variety / tools", "Core only", "Standard set", "Full set"],
  ["Market data access (provider coverage applies)", true, true, true],
  ["Unrealized P&L tracking", true, true, true],
  ["Tax profiles", "1", "2", "Unlimited"],
  ["CSV export", true, true, true],
  ["PDF tax reports", false, true, true],
  ["Anomaly detection", true, true, true],
  ["Tax-loss harvesting", false, false, true],
  ["Background task execution", false, false, true],
  ["Advanced integrations", false, false, true],
  ["7-day free trial", false, true, false],
];

function Cell({ v }: { v: string | boolean }) {
  if (v === true)
    return <BadgeCheck size={18} strokeWidth={1.75} style={{ color: "var(--color-accent)" }} />;
  if (v === false) return <Minus size={18} strokeWidth={1.75} style={{ color: "var(--ink-3)" }} />;
  return <span className="tnum text-sm">{v}</span>;
}

function Pricing() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { period, setPeriod } = useCheckout();

  async function handlePlanClick(plan: PlanId) {
    if (!session) {
      navigate({ to: "/signup", search: { plan } });
      return;
    }
    if (plan === "free") {
      navigate({ to: "/app/overview" });
      return;
    }
    try {
      const checkoutUrl = await createKelviqCheckoutSession({
        plan,
        period,
        accessToken: session.access_token,
      });
      window.location.assign(checkoutUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to open secure checkout.");
    }
  }

  function handleTrial() {
    if (!session) {
      navigate({ to: "/signup", search: { plan: "trial" } });
      return;
    }
    navigate({ to: "/app/billing" });
  }

  return (
    <PageShell
      eyebrow="Pricing"
      title="Simple, transparent pricing"
      sub="Individual plans for traders, plus separately scoped brokerage operations packages. Brokerage pricing depends on transaction volume, source integrations, entities and support requirements."
    >
      <div
        className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4"
        style={{ background: "var(--accent-6)", border: "1px solid var(--accent-15)" }}
      >
        <div className="flex items-start gap-3">
          <Sparkles
            size={16}
            strokeWidth={1.75}
            style={{ color: "var(--color-accent)", marginTop: 2 }}
          />
          <div>
            <p className="text-sm font-semibold">{TRIAL_DAYS}-day free trial of Standard</p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
              This is the only way to start a free trial. After {TRIAL_DAYS} days, upgrade or continue
              on Basic $0.
            </p>
          </div>
        </div>
        <Btn variant="primary" onClick={handleTrial}>
          Start {TRIAL_DAYS}-day free trial
        </Btn>
      </div>

      <div className="mt-10 flex justify-center">
        <PeriodToggle period={period} onChange={setPeriod} />
      </div>
      <div className="mt-8">
        <PlanCards
          period={period}
          onSelect={handlePlanClick}
          ctaFor={(id) =>
            id === "free" ? "Use Basic for $0" : `Choose ${PLANS[id].name}`
          }
        />
      </div>

      <section className="mt-16 border-t pt-12" style={{ borderColor: "var(--hairline)" }}>
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-accent)" }}>
            <Building2 size={15} /> Brokerage operations
          </div>
          <h2 className="mt-3 text-2xl font-semibold">Pricing built around your operation</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
            For brokerages that need statement intake, reconciliation and exception workflows. These are proposed pilot starting prices, not instant self-serve subscriptions. Final scope and fees are confirmed after a technical discovery call.
          </p>
        </div>
        <div className="mt-7 grid gap-4 md:grid-cols-3">
          <Panel className="h-full">
            <p className="text-sm font-semibold">Brokerage pilot</p>
            <p className="mt-4 text-3xl font-semibold">$750–$2,000</p>
            <p className="mt-2 text-xs" style={{ color: "var(--ink-3)" }}>One-time, scoped pilot · ≈ PKR 208k–554k</p>
            <ul className="mt-5 space-y-2 text-sm" style={{ color: "var(--ink-2)" }}>
              <li>• One reconciliation workflow</li>
              <li>• One or two agreed source formats</li>
              <li>• Defined transaction volume and acceptance criteria</li>
              <li>• Exception review and evidence export</li>
              <li>• 4–6 week delivery window, subject to discovery</li>
            </ul>
            <p className="mt-5 border-t pt-4 text-xs" style={{ borderColor: "var(--hairline)", color: "var(--ink-3)" }}>One-time pilot fee, quoted after discovery</p>
            <Btn className="mt-5 w-full" variant="primary" onClick={() => navigate({ to: "/contact" })}>Scope a pilot</Btn>
          </Panel>
          <Panel className="h-full" style={{ border: "1px solid var(--color-accent)" }}>
            <p className="text-sm font-semibold">Business operations</p>
            <p className="mt-4 text-3xl font-semibold">$250–$600/mo</p>
            <p className="mt-2 text-xs" style={{ color: "var(--ink-3)" }}>Annual agreement · ≈ PKR 69k–166k/mo</p>
            <ul className="mt-5 space-y-2 text-sm" style={{ color: "var(--ink-2)" }}>
              <li>• Agreed monthly transaction and file volumes</li>
              <li>• Multiple source formats and workflows, as scoped</li>
              <li>• Reviewer roles and exception ownership</li>
              <li>• Reporting, exports and operational support</li>
              <li>• Defined service hours and response targets</li>
            </ul>
            <p className="mt-5 border-t pt-4 text-xs" style={{ borderColor: "var(--hairline)", color: "var(--ink-3)" }}>Recurring fee quoted against measured scope</p>
            <Btn className="mt-5 w-full" variant="secondary" onClick={() => navigate({ to: "/contact" })}>Discuss business pricing</Btn>
          </Panel>
          <Panel className="h-full">
            <p className="text-sm font-semibold">Enterprise</p>
            <p className="mt-4 text-3xl font-semibold">From $1,000/mo</p>
            <p className="mt-2 text-xs" style={{ color: "var(--ink-3)" }}>Custom annual agreement · ≈ PKR 277k/mo</p>
            <ul className="mt-5 space-y-2 text-sm" style={{ color: "var(--ink-2)" }}>
              <li>• Multi-entity deployment scope</li>
              <li>• Custom integration and deployment assessment</li>
              <li>• Security, access-control and data-residency review</li>
              <li>• Agreed support, resilience and service requirements</li>
              <li>• Annual commercial agreement</li>
            </ul>
            <p className="mt-5 border-t pt-4 text-xs" style={{ borderColor: "var(--hairline)", color: "var(--ink-3)" }}>Implementation and recurring fees quoted separately</p>
            <Btn className="mt-5 w-full" variant="secondary" onClick={() => navigate({ to: "/contact" })}>Contact enterprise sales</Btn>
          </Panel>
        </div>
        <div className="mt-5 flex items-start gap-2 rounded-lg px-4 py-3 text-xs" style={{ background: "var(--accent-4)", color: "var(--ink-2)" }}>
          <ArrowUpRight size={14} className="mt-0.5 shrink-0" />
          <p>Indicative Pakistan-market starting ranges, not binding offers. Final brokerage pricing depends on transaction volume, entities, integrations, deployment and support. Pilot and recurring Business checkout remain separate from Individual subscriptions. No 24/7 SLA, certification or integration is implied unless agreed and delivered.</p>
        </div>
        <div className="mt-3 text-xs" style={{ color: "var(--ink-3)" }}>
          Pilot fees are quoted after scope and acceptance criteria are agreed. New Individual checkouts use Kelviq's server-side custom amount support in USD; existing subscribers retain their original price. Recurring business subscriptions must use a separate published Kelviq Business product and must not reuse Individual plan identifiers.
        </div>
      </section>

      <div className="mt-16 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--hairline)" }}>
              {["Feature", "Basic", "Standard", "Pro"].map((h) => (
                <th key={h} className="py-3 text-sm font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]} style={{ borderBottom: "1px solid var(--hairline)" }}>
                <td
                  className="sticky left-0 bg-surface py-3 pr-4 text-sm"
                  style={{ color: "var(--ink-2)" }}
                >
                  {r[0]}
                </td>
                <td className="py-3">
                  <Cell v={r[1]} />
                </td>
                <td className="py-3">
                  <Cell v={r[2]} />
                </td>
                <td className="py-3">
                  <Cell v={r[3]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Panel className="mt-14">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h3 className="text-lg font-semibold">Trial, then you choose</h3>
            <p className="mt-1.5 text-sm" style={{ color: "var(--ink-2)" }}>
              The Standard trial lasts {TRIAL_DAYS} calendar days from the moment you start it — signing
              out does not pause the clock. When it ends, upgrade or switch back to Basic at $0.
            </p>
          </div>
        </div>
      </Panel>
    </PageShell>
  );
}
