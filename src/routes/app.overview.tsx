// ─── Wab Mission Control Dashboard ────────────────────────────────────────
// "What is happening in my financial world right now?"
// Every number is deterministic. AI only explains.

import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  FileSearch,
  GitFork,
  Search,
  Sparkles,
  TrendingUp,
  Upload,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { reveal, Panel } from "@/components/kit";
import { useAuth } from "@/lib/auth-context";
import { useTransactions, useReconciliationFlags } from "@/lib/data-hooks";
import { computeTax } from "@/lib/tax";
import {
  useHealthScore,
  usePortfolioSummary,
  usePriorities,
  useFinancialEvents,
  useFinancialInsights,
  useDailyBriefing,
} from "@/lib/financial-intelligence-hooks";
import { DailyBriefing } from "@/components/intelligence/DailyBriefing";
import { PortfolioRiskSnapshot } from "@/components/portfolio/PortfolioRiskSnapshot";
import { PortfolioAnalyticsLab } from "@/components/portfolio/PortfolioAnalyticsLab";
import { PortfolioMarketTerminal } from "@/components/portfolio/PortfolioMarketTerminal";
import { useLedgerContext } from "@/lib/use-ledger-context";
import { FinancialHealthScore } from "@/components/intelligence/FinancialHealthScore";
import { PriorityCard, PriorityCardSkeleton } from "@/components/intelligence/PriorityCard";
import {
  FinancialTimeline,
  generateTimelineFromTransactions,
} from "@/components/intelligence/FinancialTimeline";
import { InsightCard, InsightCardEmpty } from "@/components/intelligence/InsightCard";
import { useCommandBar } from "@/components/intelligence/AuditXCommandBar";
import type { InsightData } from "@/components/intelligence/InsightCard";
import type { EventSeverity } from "@/lib/financial-intelligence";

export const Route = createFileRoute("/app/overview")({
  component: MissionControl,
});

// Distinct premium hues so each holding remains identifiable in the allocation ring.
const allocationColors = ["#34D399", "#60A5FA", "#A78BFA", "#FBBF24", "#F472B6", "#22D3EE"];

// ── Metric Card ───────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  tone,
  i,
  askWhy,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "ok" | "bad" | "warn" | "info";
  i: number;
  askWhy?: string;
}) {
  const { setOpen } = useCommandBar();

  const toneColors = {
    ok: "var(--ok)",
    bad: "var(--bad)",
    warn: "var(--warn)",
    info: "var(--color-accent)",
  };

  return (
    <motion.div variants={reveal} custom={i} initial="hidden" animate="visible">
      <div
        className="group relative overflow-hidden rounded-xl bg-surface p-5 transition-shadow hover:shadow-md"
        style={{ border: "1px solid var(--hairline)" }}
      >
        <p className="text-xs font-medium" style={{ color: "var(--ink-2)" }}>
          {label}
        </p>
        <p className="tnum mt-2 text-2xl font-bold" style={{ color: "var(--color-text)" }}>
          {value}
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>
          {sub}
        </p>
      </div>
    </motion.div>
  );
}

// ── "Wab Found Something" ─────────────────────────────────────────────────

function FoundSomethingSection({
  insights,
  flags,
  currency,
}: {
  insights: ReturnType<typeof useFinancialInsights>["data"];
  flags: ReturnType<typeof useReconciliationFlags>["data"];
  currency: string;
}) {
  // Build insight data from real sources
  const insightData: InsightData[] = [];

  // Convert DB financial insights
  for (const ins of (insights ?? []).slice(0, 3)) {
    insightData.push({
      id: ins.id,
      type: ins.insight_type,
      severity: ins.severity as EventSeverity,
      title: ins.title,
      summary: ins.summary,
      confidence: ins.confidence,
      evidenceCount: (ins.evidence_ids ?? []).length,
      actionLabel: "Investigate",
      actionLink: "/app/investigations",
      secondaryActionLabel: "View Evidence",
      secondaryActionLink: "/app/reconciliation",
    });
  }

  // Synthesize from reconciliation flags when no DB insights yet
  if (insightData.length === 0 && (flags ?? []).length > 0) {
    const criticalFlags = (flags ?? []).filter((f) => f.severity === "bad");
    const warnFlags = (flags ?? []).filter((f) => f.severity === "warn");

    if (criticalFlags.length > 0) {
      const totalImpact = criticalFlags.reduce(
        (s, f) => s + Math.abs((f.actual ?? 0) - (f.expected ?? 0)),
        0,
      );
      insightData.push({
        id: "synth-critical",
        type: "FEE_DISCREPANCY",
        severity: "CRITICAL",
        title: `${criticalFlags.length} Critical Reconciliation Flag${criticalFlags.length > 1 ? "s" : ""}`,
        summary:
          criticalFlags[0]?.description ??
          "Critical data integrity issues detected requiring immediate review.",
        confidence: 0.95,
        financialImpact: totalImpact,
        currency,
        evidenceCount: criticalFlags.length,
        actionLabel: "Investigate",
        actionLink: "/app/investigations",
        secondaryActionLabel: "View Flags",
        secondaryActionLink: "/app/reconciliation",
      });
    }

    if (warnFlags.length > 0) {
      insightData.push({
        id: "synth-warn",
        type: "ANOMALY_DETECTED",
        severity: "HIGH",
        title: `${warnFlags.length} Potential Discrepanc${warnFlags.length > 1 ? "ies" : "y"} Detected`,
        summary: `Wab identified ${warnFlags.length} transactions with reconciliation warnings that may affect your financial records.`,
        confidence: 0.88,
        evidenceCount: warnFlags.length,
        actionLabel: "Review",
        actionLink: "/app/reconciliation",
      });
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="flex size-8 items-center justify-center rounded-lg"
            style={{ background: "var(--accent-10)" }}
          >
            <Sparkles size={15} style={{ color: "var(--color-accent)" }} />
          </div>
          <div>
            <h2 className="text-sm font-bold">Wab Found Something</h2>
            <p className="text-xs" style={{ color: "var(--ink-3)" }}>
              Proactively surfaced findings from your financial data
            </p>
          </div>
        </div>
        <Link
          to="/app/insights"
          className="flex items-center gap-1 text-xs font-semibold"
          style={{ color: "var(--color-accent)" }}
        >
          All insights <ChevronRight size={13} />
        </Link>
      </div>
      {insightData.length === 0 ? (
        <InsightCardEmpty />
      ) : (
        <div className="space-y-3">
          {insightData.map((ins, i) => (
            <InsightCard key={ins.id} insight={ins} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

function MissionControl() {
  const { profile } = useAuth();
  const { jurisdiction: detectedJurisdiction, currency } = useLedgerContext();

  const { data: transactions = [], isLoading: txLoading } = useTransactions(profile?.org_id);
  const { data: flags = [] } = useReconciliationFlags(profile?.org_id);

  const currentYear = String(new Date().getFullYear());
  const { score, isLoading: scoreLoading } = useHealthScore();
  const { summary, isLoading: summaryLoading } = usePortfolioSummary();
  const { priorities, isLoading: prioritiesLoading } = usePriorities();
  const { data: events = [], isLoading: eventsLoading } = useFinancialEvents(30);
  const { data: insights = [] } = useFinancialInsights(5);

  const tax = computeTax(transactions, {
    jurisdiction: detectedJurisdiction,
    filerStatus: "Filer",
    taxYear: currentYear,
  });
  const unreconciledCount = transactions.filter((t) => t.status === "needs_review").length;

  // Portfolio allocation — use live market data from summary
  const allocationData = (summary?.tickerBreakdown ?? [])
    .slice(0, 6)
    .map((d, i) => ({ name: d.ticker, value: d.value, color: allocationColors[i] ?? "#ccc" }));

  const totalPortfolioValue = summary?.totalValue ?? 0;

  // Cumulative P&L chart
  const pnlByMonth: Record<string, number> = {};
  for (const lot of tax.lots) {
    const month = lot.sellDate?.slice(0, 7);
    if (month) pnlByMonth[month] = (pnlByMonth[month] ?? 0) + lot.gain;
  }
  const pnlData = Object.entries(pnlByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce<{ month: string; value: number }[]>((acc, [key, gain]) => {
      const prev = acc[acc.length - 1]?.value ?? 0;
      acc.push({ month: key.slice(5), value: Math.round(prev + gain) });
      return acc;
    }, []);

  // Timeline entries — use DB events if available, else synthesize
  const timelineEntries =
    events.length > 0
      ? events.map((e) => ({
          id: e.id,
          date: e.created_at,
          isToday: new Date(e.created_at).toDateString() === new Date().toDateString(),
          isYesterday:
            new Date(e.created_at).toDateString() ===
            new Date(Date.now() - 86400000).toDateString(),
          severity: e.severity as EventSeverity,
          title: e.title,
          description: e.description,
          confidence: e.confidence,
          eventType: e.event_type,
          actionLabel: "View details",
          actionLink: "/app/timeline",
        }))
      : generateTimelineFromTransactions(transactions, flags, currency);

  const fmt = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 0 });

  const actionChartData = ["BUY", "SELL", "DIV"].map((action) => ({
    action,
    count: transactions.filter((transaction) => transaction.action === action).length,
  }));
  const quantityBuckets = [
    { range: "1–10", min: 1, max: 10 },
    { range: "11–50", min: 11, max: 50 },
    { range: "51–100", min: 51, max: 100 },
    { range: "101–500", min: 101, max: 500 },
    { range: "500+", min: 501, max: Number.POSITIVE_INFINITY },
  ].map((bucket) => ({
    range: bucket.range,
    count: transactions.filter((transaction) => {
      const quantity = Number(transaction.quantity) || 0;
      return quantity >= bucket.min && quantity <= bucket.max;
    }).length,
  }));
  const tickerActivity = Object.entries(
    transactions.reduce<Record<string, number>>((counts, transaction) => {
      const ticker = transaction.ticker || "Other";
      counts[ticker] = (counts[ticker] ?? 0) + 1;
      return counts;
    }, {}),
  )
    .map(([ticker, count]) => ({ ticker, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Empty state
  if (!txLoading && transactions.length === 0) {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center p-6 text-center">
        <div
          className="flex size-20 items-center justify-center rounded-3xl"
          style={{ background: "var(--accent-8)" }}
        >
          <Upload size={36} style={{ color: "var(--color-accent)" }} />
        </div>
        <h1 className="mt-6 text-2xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
          No transactions yet
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
          Upload your first broker statement and Wab will extract and reconcile it.
        </p>
        <Link
          to="/app/parser"
          className="mt-6 flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold"
          style={{
            background: "var(--color-accent)",
            color: "var(--accent-fg)",
            boxShadow: "var(--shadow-accent)",
          }}
        >
          <Upload size={16} />
          Upload records
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5 p-3 sm:space-y-6 sm:p-6">
      {/* Header Section */}
      <div className="overview-hero flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "1.75rem",
              color: "var(--brand-panel-fg)",
            }}
          >
            Portfolio overview
          </h1>
          <p
            className="mt-1 text-sm"
            style={{ color: "color-mix(in srgb, var(--brand-panel-fg) 64%, transparent)" }}
          >
            Portfolio health and ledger-based intelligence
          </p>
        </div>
        <Link
          to="/app/parser"
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-85"
          style={{ background: "var(--brand-panel-fg)", color: "var(--brand-panel)" }}
        >
          <Upload size={16} />
          Upload Data
        </Link>
      </div>

      {/* Daily Briefing */}
      <DailyBriefing />

      {/* Key Metrics Grid */}
      <div
        className="rounded-xl bg-surface p-4 sm:p-6"
        style={{ border: "1px solid var(--hairline)" }}
      >
        <div className="mb-4">
          <h2 className="text-sm font-bold">Key Metrics</h2>
          <p className="text-xs" style={{ color: "var(--ink-3)" }}>
            Live portfolio valuation and performance
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Recorded Cost Basis"
            value={summaryLoading ? "—" : `${currency} ${fmt(totalPortfolioValue)}`}
            sub="Remaining position cost basis"
            tone="info"
            i={0}
            askWhy="Why did my portfolio value change?"
          />
          <MetricCard
            label="Realized Gains YTD"
            value={summaryLoading ? "—" : `${currency} ${fmt(summary?.realizedGains ?? 0)}`}
            sub="FIFO lot matching"
            tone={(summary?.realizedGains ?? 0) >= 0 ? "ok" : "bad"}
            i={1}
            askWhy="Why did my realized gains change?"
          />
          <MetricCard
            label="Unrealized P&L"
            value={summaryLoading ? "—" : "Not priced"}
            sub="Requires a verified quote source"
            tone="info"
            i={2}
            askWhy="Why did my unrealized gains change?"
          />
          <MetricCard
            label="Estimated Tax Liability"
            value={`${currency} ${fmt(tax.estimatedTaxDue)}`}
            sub={`FIFO · ${jurisdiction} Filer`}
            tone="warn"
            i={3}
            askWhy="Why did my estimated tax change?"
          />
        </div>
      </div>

      {/* AVMIRS-inspired, ledger-derived analytics suite */}
      <PortfolioAnalyticsLab transactions={transactions} currency={currency} />
      <PortfolioMarketTerminal transactions={transactions} currency={currency} />

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Ledger analytics">
        <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
          <div className="mb-4">
            <p className="text-sm font-bold">Trade activity</p>
            <p className="text-xs" style={{ color: "var(--ink-3)" }}>Ledger transactions by action type</p>
          </div>
          {transactions.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={actionChartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--hairline)" vertical={false} />
                <XAxis dataKey="action" tick={{ fontSize: 11, fill: "var(--ink-3)" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--ink-3)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--sidebar)", border: "1px solid var(--hairline)", borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="count" name="Transactions" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="flex h-[220px] items-center justify-center text-xs" style={{ color: "var(--ink-3)" }}>No transactions to chart yet.</p>}
        </div>
        <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
          <div className="mb-4">
            <p className="text-sm font-bold">Trade-size histogram</p>
            <p className="text-xs" style={{ color: "var(--ink-3)" }}>Distribution by recorded share quantity</p>
          </div>
          {transactions.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={quantityBuckets} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--hairline)" vertical={false} />
                <XAxis dataKey="range" tick={{ fontSize: 10, fill: "var(--ink-3)" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--ink-3)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--sidebar)", border: "1px solid var(--hairline)", borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="count" name="Transactions" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="flex h-[220px] items-center justify-center text-xs" style={{ color: "var(--ink-3)" }}>No transaction sizes available yet.</p>}
        </div>
        <div className="rounded-2xl p-5 lg:col-span-2" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
          <div className="mb-4">
            <p className="text-sm font-bold">Ticker activity blocks</p>
            <p className="text-xs" style={{ color: "var(--ink-3)" }}>Your most active ledger symbols</p>
          </div>
          {tickerActivity.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {tickerActivity.map((item, index) => (
                <div key={item.ticker} className="flex min-h-20 flex-col justify-between rounded-xl p-3"
                  style={{ background: index % 2 === 0 ? "var(--accent-10)" : "var(--color-login-bg)", border: "1px solid var(--hairline)" }}>
                  <span className="truncate text-xs font-semibold">{item.ticker}</span>
                  <span className="tnum text-xl font-bold">{item.count.toLocaleString()}</span>
                  <span className="text-[10px]" style={{ color: "var(--ink-3)" }}>transactions</span>
                </div>
              ))}
            </div>
          ) : <p className="flex h-20 items-center justify-center text-xs" style={{ color: "var(--ink-3)" }}>Ticker blocks appear when transactions are recorded.</p>}
        </div>
      </section>

      {/* Two-column layout */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:gap-6">
        {/* Left column - Main charts and insights */}
        <div className="min-w-0 space-y-5">
          {/* P&L Chart */}
          {pnlData.length > 0 && (
            <div
              className="rounded-xl bg-surface p-6"
              style={{ border: "1px solid var(--hairline)" }}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-bold">Cumulative Realized P&L</p>
                  <p className="text-xs" style={{ color: "var(--ink-3)" }}>
                    {currency} · YTD {currentYear} · FIFO lot matching
                  </p>
                </div>
                <TrendingUp size={16} style={{ color: "var(--color-accent)" }} />
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={pnlData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: "var(--ink-3)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--ink-3)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v: number) => [`${currency} ${fmt(v)}`, "Realized P&L"]}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 10,
                      border: "1px solid var(--hairline)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    fill="url(#pnlGrad)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Wab Found Something */}
          <FoundSomethingSection insights={insights} flags={flags} currency={currency} />

          {/* Financial Timeline */}
          <div
            className="rounded-xl bg-surface p-6"
            style={{ border: "1px solid var(--hairline)" }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold">Financial Timeline</h2>
                <p className="text-xs" style={{ color: "var(--ink-3)" }}>
                  Meaningful financial events — automatically recorded
                </p>
              </div>
              <Link
                to="/app/timeline"
                className="flex items-center gap-1 text-xs font-semibold"
                style={{ color: "var(--color-accent)" }}
              >
                Full timeline <ChevronRight size={13} />
              </Link>
            </div>
            <FinancialTimeline
              entries={timelineEntries.slice(0, 8)}
              isLoading={eventsLoading && transactions.length === 0}
            />
          </div>
        </div>

        {/* Right column - Sidebar widgets */}
        <div className="min-w-0 space-y-5">
          {/* Health Score */}
          <div
            className="rounded-xl bg-surface p-6"
            style={{ border: "1px solid var(--hairline)" }}
          >
            <FinancialHealthScore score={score} isLoading={scoreLoading} />
          </div>

          {/* Holdings Allocation */}
          {allocationData.length > 0 && (
            <div
              className="rounded-xl bg-surface p-6"
              style={{ border: "1px solid var(--hairline)" }}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-bold">Holdings</p>
                  <p className="text-xs" style={{ color: "var(--ink-3)" }}>
                    By ticker · current positions
                  </p>
                </div>
                <BarChart3 size={16} style={{ color: "var(--ink-3)" }} />
              </div>
              <div className="flex justify-center">
                <ResponsiveContainer width={140} height={140}>
                  <PieChart>
                    <Pie
                      data={allocationData}
                      cx="50%"
                      cy="50%"
                      innerRadius={42}
                      outerRadius={65}
                      dataKey="value"
                      paddingAngle={2}
                    >
                      {allocationData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 8,
                        border: "1px solid var(--hairline)",
                      }}
                      formatter={(v: number) => [`${currency} ${fmt(v)}`, ""]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 space-y-1.5">
                {allocationData.map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5" style={{ color: "var(--ink-2)" }}>
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={{ background: d.color }}
                      />
                      {d.name}
                    </div>
                    <span className="tnum font-medium" style={{ color: "var(--color-text)" }}>
                      {((d.value / totalPortfolioValue) * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Portfolio concentration snapshot */}
          <PortfolioRiskSnapshot positions={summary?.tickerBreakdown ?? []} currency={currency} />

          {/* Secondary Metrics */}
          <div
            className="rounded-xl bg-surface p-6"
            style={{ border: "1px solid var(--hairline)" }}
          >
            <div className="mb-4">
              <p className="text-sm font-bold">Data Quality</p>
              <p className="text-xs" style={{ color: "var(--ink-3)" }}>
                Ledger health and reconciliation status
              </p>
            </div>
            <div className="space-y-3">
              <MetricCard
                label="Unreconciled Items"
                value={String(unreconciledCount)}
                sub={unreconciledCount > 0 ? "Requires review" : "All matched"}
                tone={unreconciledCount > 0 ? "warn" : "ok"}
                i={0}
                askWhy="Why are these transactions unreconciled?"
              />
              <MetricCard
                label="Total Transactions"
                value={String(transactions.length)}
                sub="In your ledger"
                tone="info"
                i={1}
              />
              <MetricCard
                label="Open Flags"
                value={String(flags.length)}
                sub={flags.length > 0 ? "Need attention" : "Clean book"}
                tone={flags.length > 0 ? "warn" : "ok"}
                i={2}
              />
            </div>
          </div>

          {/* Priorities */}
          {(priorities.length > 0 || prioritiesLoading) && (
            <div
              className="rounded-xl bg-surface p-6"
              style={{ border: "1px solid var(--hairline)" }}
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold">Requires Attention</p>
                  <p className="text-xs" style={{ color: "var(--ink-3)" }}>
                    Priority issues
                  </p>
                </div>
                <Link
                  to="/app/reconciliation"
                  className="flex items-center gap-1 text-xs font-semibold"
                  style={{ color: "var(--color-accent)" }}
                >
                  All <ChevronRight size={13} />
                </Link>
              </div>
              <div className="space-y-3">
                {prioritiesLoading
                  ? [0, 1].map((i) => <PriorityCardSkeleton key={i} />)
                  : priorities.slice(0, 2).map((p) => <PriorityCard key={p.id} priority={p} />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
