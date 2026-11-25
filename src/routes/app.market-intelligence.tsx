import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Activity, ArrowRight, BarChart3, Layers3, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTransactions } from "@/lib/data-hooks";
import { currencyForExchange } from "@/lib/market-currency";
import { PortfolioMarketTerminal } from "@/components/portfolio/PortfolioMarketTerminal";
import { PortfolioAnalyticsLab } from "@/components/portfolio/PortfolioAnalyticsLab";

export const Route = createFileRoute("/app/market-intelligence")({
  component: MarketIntelligence,
});

function MarketIntelligence() {
  const { profile } = useAuth();
  const {
    data: transactions = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useTransactions(profile?.org_id);

  // Build the instrument universe from the organisation's posted ledger.
  // Keep exchange as part of the identity: the same ticker can exist on
  // multiple exchanges and must not be merged into one instrument.
  const instruments = useMemo(() => {
    const map = new Map<string, { ticker: string; exchange: string; currency: string }>();
    for (const tx of transactions) {
      if (tx.status !== "posted" || tx.action === "DIV") continue;
      const ticker = tx.ticker?.trim().toUpperCase();
      const exchange = tx.exchange?.trim().toUpperCase();
      if (!ticker || !exchange || !/^(?:\\^)?[A-Z0-9][A-Z0-9.&_=-]{0,19}$/.test(ticker)) continue;
      const key = exchange + ":" + ticker;
      if (!map.has(key)) {
        map.set(key, {
          ticker,
          exchange,
          currency: tx.currency ?? currencyForExchange(exchange),
        });
      }
    }
    return [...map.values()].sort((a, b) =>
      a.exchange.localeCompare(b.exchange) || a.ticker.localeCompare(b.ticker),
    );
  }, [transactions]);

  const currency = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.status !== "posted") continue;
      const code = tx.currency ?? currencyForExchange(tx.exchange);
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    if (counts.size > 1) return "MIXED";
    const onlyCurrency = [...counts.keys()][0];
    if (onlyCurrency) return onlyCurrency;
    return profile?.jurisdiction === "PSX" ? "PKR" : "USD";
  }, [transactions, profile?.jurisdiction]);

  const exchanges = [...new Set(instruments.map((item) => item.exchange))];
  const postedCount = transactions.filter((tx) => tx.status === "posted").length;

  return (
    <div className="space-y-6 p-3 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em]" style={{ color: "var(--ink-3)" }}>
            <Activity size={14} /> Ledger-connected intelligence
          </p>
          <h1 className="mt-1 text-2xl font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
            Market Intelligence
          </h1>
          <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--ink-2)" }}>
            Market charts and portfolio analytics built from your posted broker ledger. Symbols are discovered automatically; no separate watchlist setup is required.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching || isLoading}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--color-accent)" }}
        >
          <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
          {isFetching ? "Refreshing ledger…" : "Refresh ledger"}
        </button>
      </header>

      {isError && (
        <section className="rounded-2xl border p-4" style={{ borderColor: "var(--bad)", background: "color-mix(in srgb, var(--bad) 7%, transparent)" }}>
          <p className="text-sm font-semibold">Could not load your ledger</p>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
            {error instanceof Error ? error.message : "The transaction service is temporarily unavailable."}
          </p>
          <button type="button" onClick={() => void refetch()} className="mt-3 text-xs font-semibold underline">Try again</button>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--hairline)", background: "var(--color-sheet)" }}>
          <p className="text-xs" style={{ color: "var(--ink-3)" }}>Ledger instruments</p>
          <p className="tnum mt-1 text-2xl font-semibold">{isLoading ? "—" : instruments.length}</p>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>Unique ticker + exchange pairs</p>
        </div>
        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--hairline)", background: "var(--color-sheet)" }}>
          <p className="text-xs" style={{ color: "var(--ink-3)" }}>Exchanges represented</p>
          <p className="tnum mt-1 text-2xl font-semibold">{isLoading ? "—" : exchanges.length}</p>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>{exchanges.length ? exchanges.join(" · ") : "No posted exchange data"}</p>
        </div>
        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--hairline)", background: "var(--color-sheet)" }}>
          <p className="text-xs" style={{ color: "var(--ink-3)" }}>Posted ledger trades</p>
          <p className="tnum mt-1 text-2xl font-semibold">{isLoading ? "—" : postedCount.toLocaleString()}</p>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>Only approved/posted records are analysed</p>
        </div>
      </section>

      {isLoading ? (
        <section className="flex min-h-56 items-center justify-center rounded-2xl border" style={{ borderColor: "var(--hairline)", color: "var(--ink-3)" }}>
          <div className="text-center"><RefreshCw size={20} className="mx-auto animate-spin" /><p className="mt-3 text-sm">Reading your organisation ledger…</p></div>
        </section>
      ) : instruments.length === 0 ? (
        <section className="rounded-2xl border p-8 text-center" style={{ borderColor: "var(--hairline)", background: "var(--color-sheet)" }}>
          <Layers3 size={28} className="mx-auto" style={{ color: "var(--ink-3)" }} />
          <h2 className="mt-3 text-base font-semibold">No posted instruments to analyse yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm" style={{ color: "var(--ink-2)" }}>
            Market Intelligence automatically discovers symbols from posted BUY and SELL transactions. Import a broker statement or post a ledger transaction to populate this workspace.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link to="/app/broker-desk" className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white" style={{ background: "var(--color-accent)" }}>
              Open Broker Desk <ArrowRight size={14} />
            </Link>
            <Link to="/app/ledger" className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--hairline)" }}>
              Open Ledger
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border p-4 sm:p-5" style={{ borderColor: "var(--hairline)", background: "var(--color-sheet)" }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Automatically discovered instruments</h2>
                <p className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>Derived from posted ledger records · grouped by exchange</p>
              </div>
              <span className="text-xs tabular-nums" style={{ color: "var(--ink-3)" }}>{instruments.length} symbols</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {instruments.map((item) => (
                <span key={item.exchange + ":" + item.ticker} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: "var(--accent-8)", color: "var(--color-accent)" }}>
                  {item.ticker}<span className="ml-1.5 opacity-70">{item.exchange}</span>
                </span>
              ))}
            </div>
          </section>

          <PortfolioMarketTerminal transactions={transactions} currency={currency} />

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <BarChart3 size={17} style={{ color: "var(--color-accent)" }} />
              <div>
                <h2 className="text-base font-semibold">Ledger analytics</h2>
                <p className="text-xs" style={{ color: "var(--ink-3)" }}>Cash-flow trends, ticker contribution, trade activity and drawdown analysis</p>
              </div>
            </div>
            <PortfolioAnalyticsLab transactions={transactions} currency={currency} />
          </section>

          <p className="text-[11px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
            Market quotes and historical prices depend on Yahoo Finance coverage and may be delayed or unavailable for some exchanges. Ledger analytics are calculated from posted transactions and represent recorded cash flows, not live market performance. PSXL does not execute trades or provide personalised buy/sell recommendations.
          </p>
        </>
      )}
    </div>
  );
}
