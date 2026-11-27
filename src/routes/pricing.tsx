import { brandText } from "@/lib/brand";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BadgeCheck, Minus, Sparkles, Building2, ArrowUpRight } from "lucide-react";
import { Btn, Panel } from "@/components/kit";
import { PeriodToggle, PlanCards, useCheckout } from "@/components/site/PlanCards";
import { PageShell } from "@/components/site/PageShell";
import { useAuth } from "@/lib/auth-context";
import { type PlanId, PLANS, TRIAL_DAYS, kelviqCheckoutUrl } from "@/lib/plans";

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
  ["Parsed transactions / month", "30", "500", "Unlimited"],
  ["AI quality", "Limited", "Standard", "Highest"],
  ["AI variety / tools", "Core only", "Standard set", "Full set"],
  ["Real-time market data", true, true, true],
  ["Unrealized P&L tracking", true, true, true],
  ["Tax profiles", "1", "2", "Unlimited"],
  ["CSV export", true, true, true],
  ["PDF tax reports", false, true, true],
  ["Anomaly detection", false, true, true],
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
  const { session, profile } = useAuth();
  const { period, setPeriod } = useCheckout();

  function handlePlanClick(plan: PlanId) {
    if (!session) {
      navigate({ to: "/signup", search: { plan } });
      return;
    }
    window.location.href = kelviqCheckoutUrl({ plan, period, orgId: profile?.org_id ?? null });
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
            <p className="text-sm font-semibold">Business Starter</p>
            <p className="tnum mt-4 text-3xl font-semibold">$499<span className="text-sm font-normal" style={{ color: "var(--ink-3)" }}>/month</span></p>
            <p className="mt-2 text-xs" style={{ color: "var(--ink-3)" }}>For a small brokerage operations team</p>
            <ul className="mt-5 space-y-2 text-sm" style={{ color: "var(--ink-2)" }}>
              <li>• One legal entity and one team</li>
              <li>• One agreed reconciliation workflow</li>
              <li>• Limited source formats, scoped at onboarding</li>
              <li>• Exception review and standard exports</li>
              <li>• Email support during business hours</li>
            </ul>
            <p className="mt-5 border-t pt-4 text-xs" style={{ borderColor: "var(--hairline)", color: "var(--ink-3)" }}>Indicative onboarding: $1,000–$2,500</p>
            <Btn className="mt-5 w-full" variant="secondary" onClick={() => navigate({ to: "/contact" })}>Discuss a pilot</Btn>
          </Panel>
          <Panel className="h-full" style={{ border: "1px solid var(--color-accent)" }}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Business Growth</p>
              <span className="rounded-md px-2 py-1 text-[10px] font-semibold" style={{ background: "var(--accent-8)", color: "var(--color-accent)" }}>Pilot focus</span>
            </div>
            <p className="tnum mt-4 text-3xl font-semibold">$1,500<span className="text-sm font-normal" style={{ color: "var(--ink-3)" }}>/month</span></p>
            <p className="mt-2 text-xs" style={{ color: "var(--ink-3)" }}>For growing teams with multiple data sources</p>
            <ul className="mt-5 space-y-2 text-sm" style={{ color: "var(--ink-2)" }}>
              <li>• Multiple agreed source formats</li>
              <li>• Expanded transaction allowance</li>
              <li>• Reviewer workflow and exception ownership</li>
              <li>• Operational exports and reporting</li>
              <li>• Priority support during agreed hours</li>
            </ul>
            <p className="mt-5 border-t pt-4 text-xs" style={{ borderColor: "var(--hairline)", color: "var(--ink-3)" }}>Indicative onboarding: $3,000–$7,500</p>
            <Btn className="mt-5 w-full" variant="primary" onClick={() => navigate({ to: "/contact" })}>Scope a brokerage pilot</Btn>
          </Panel>
          <Panel className="h-full">
            <p className="text-sm font-semibold">Enterprise</p>
            <p className="mt-4 text-3xl font-semibold">Custom</p>
            <p className="mt-2 text-xs" style={{ color: "var(--ink-3)" }}>For multi-team and multi-entity operations</p>
            <ul className="mt-5 space-y-2 text-sm" style={{ color: "var(--ink-2)" }}>
              <li>• Multiple entities and teams</li>
              <li>• Custom integration and deployment scope</li>
              <li>• Security and access-control discovery</li>
              <li>• Agreed support and service requirements</li>
              <li>• Annual commercial agreement</li>
            </ul>
            <p className="mt-5 border-t pt-4 text-xs" style={{ borderColor: "var(--hairline)", color: "var(--ink-3)" }}>Implementation quoted after discovery</p>
            <Btn className="mt-5 w-full" variant="secondary" onClick={() => navigate({ to: "/contact" })}>Contact enterprise sales</Btn>
          </Panel>
        </div>
        <div className="mt-5 flex items-start gap-2 rounded-lg px-4 py-3 text-xs" style={{ background: "var(--accent-4)", color: "var(--ink-2)" }}>
          <ArrowUpRight size={14} className="mt-0.5 shrink-0" />
          <p>All brokerage prices are proposed starting points. Usage bands, supported formats, integrations, hosting, security controls and support commitments are written into each pilot order. No 24/7 SLA, certification or integration is implied unless agreed and delivered.</p>
        </div>
        <div className="mt-3 text-xs" style={{ color: "var(--ink-3)" }}>
          First brokerage pilot: proposed $2,500–$7,500 for 4–6 weeks, scoped to one team and one or two source formats. The pilot fee may be credited toward an annual contract by agreement.
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
