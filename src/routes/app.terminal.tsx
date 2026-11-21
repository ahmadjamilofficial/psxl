import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart3, BrainCircuit, BriefcaseBusiness,
  Calculator, CandlestickChart, Download, FlaskConical, RefreshCw, ShieldAlert,
  Target, TrendingUp, Wallet,
} from "lucide-react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useAuth } from "@/lib/auth-context";
import { useTransactions } from "@/lib/data-hooks";
import { fetchMarketPrices, type MarketPrice } from "@/lib/market-data";
import { computeTax } from "@/lib/tax";
import { supabase } from "@/lib/supabase";
import type { Transaction } from "@/lib/demo-data";

export const Route = createFileRoute("/app/terminal")({ component: InvestmentTerminal });

type Tab = "portfolio" | "markets" | "quant" | "tax";
type Position = {
  key: string; ticker: string; exchange: string; currency: string; quantity: number;
  averageCost: number; costBasis: number; marketPrice?: number; marketValue?: number;
  unrealized?: number; changePercent?: number;
};

const INDEXES = [
  { ticker: "^KSE", exchange: "PSX", label: "KSE-100", currency: "PKR" },
  { ticker: "^NSEI", exchange: "NSE", label: "NIFTY 50", currency: "INR" },
  { ticker: "^GSPC", exchange: "NYSE", label: "S&P 500", currency: "USD" },
  { ticker: "^IXIC", exchange: "NASDAQ", label: "NASDAQ Composite", currency: "USD" },
];

function buildPositions(transactions: Transaction[]): Position[] {
  const map = new Map<string, Position>();
  for (const tx of [...transactions].filter(t => t.status === "posted").sort((a,b) => a.trade_date.localeCompare(b.trade_date))) {
    const key = `${tx.exchange}:${tx.ticker}`;
    const p = map.get(key) ?? {
      key, ticker: tx.ticker, exchange: tx.exchange, currency: tx.currency ?? (tx.exchange === "PSX" ? "PKR" : tx.exchange === "NSE" ? "INR" : "USD"),
      quantity: 0, averageCost: 0, costBasis: 0,
    };
    if (tx.action === "BUY") {
      const nextQty = p.quantity + tx.quantity;
      p.costBasis += tx.quantity * tx.price + tx.fees;
      p.quantity = nextQty;
      p.averageCost = nextQty > 0 ? p.costBasis / nextQty : 0;
    } else if (tx.action === "SELL" && p.quantity > 0) {
      const sold = Math.min(p.quantity, tx.quantity);
      p.quantity -= sold;
      p.costBasis = Math.max(0, p.costBasis - sold * p.averageCost);
      p.averageCost = p.quantity > 0 ? p.costBasis / p.quantity : 0;
    }
    map.set(key, p);
  }
  return [...map.values()].filter(p => p.quantity > 0).sort((a,b) => b.costBasis-a.costBasis);
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}
function pct(value: number | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
function csvCell(value: unknown) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}
function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function Metric({ label, value, detail, icon: Icon, tone = "normal" }: {
  label: string; value: string; detail: string; icon: typeof Wallet; tone?: "normal" | "good" | "bad";
}) {
  return <div className="rounded-2xl border p-4 sm:p-5" style={{ borderColor: "var(--hairline)", background: "var(--color-sheet)" }}>
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium" style={{ color: "var(--ink-2)" }}>{label}</span>
      <Icon size={16} style={{ color: tone === "good" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : "var(--ink-3)" }} />
    </div>
    <div className="mt-3 truncate text-2xl font-semibold tracking-tight tnum">{value}</div>
    <div className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>{detail}</div>
  </div>;
}

function InvestmentTerminal() {
  const { profile } = useAuth();
  const { data: transactions = [], isLoading } = useTransactions(profile?.org_id);
  const [tab, setTab] = useState<Tab>("portfolio");
  const [quotes, setQuotes] = useState<Record<string, MarketPrice>>({});
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [marketHistory, setMarketHistory] = useState<Array<{ date: string; close: number }>>([]);
  const [historyLabel, setHistoryLabel] = useState("KSE-100");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [psxIndexSelected, setPsxIndexSelected] = useState(false);
  const [ticker, setTicker] = useState("OGDC");
  const [exchange, setExchange] = useState("PSX");
  const [fastWindow, setFastWindow] = useState(20);
  const [slowWindow, setSlowWindow] = useState(50);
  const [feeBps, setFeeBps] = useState(15);
  const [backtest, setBacktest] = useState<{ rows: Array<{ date: string; strategy: number; benchmark: number }>; stats: { strategyReturn: number; benchmarkReturn: number; sharpe: number | null; maxDrawdown: number; trades: number; observations: number } } | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState("");
  const [taxYear, setTaxYear] = useState("");
  const [taxYearManuallySelected, setTaxYearManuallySelected] = useState(false);
  const [taxCurrency, setTaxCurrency] = useState("PKR");
  const [portfolioCurrency, setPortfolioCurrency] = useState("PKR");
  const [customTaxRules, setCustomTaxRules] = useState<{ short: number; long: number; days: number } | null>(null);
  const [customTaxLoading, setCustomTaxLoading] = useState(false);
  const [taxJurisdiction, setTaxJurisdiction] = useState<"PSX" | "NSE" | "CUSTOM">("PSX");

  const posted = useMemo(() => transactions.filter(t => t.status === "posted"), [transactions]);
  const positions = useMemo(() => buildPositions(posted), [posted]);
  const activePortfolioCurrency = positions.some(p => p.currency === portfolioCurrency) ? portfolioCurrency : positions[0]?.currency ?? "PKR";
  const portfolioPositions = positions.filter(p => p.currency === activePortfolioCurrency);
  const quoteTargets = useMemo(() => [
    ...positions.map(p => ({ ticker: p.ticker, exchange: p.exchange })),
    ...INDEXES.filter(index => index.exchange !== "PSX").map(({ ticker, exchange }) => ({ ticker, exchange })),
  ], [positions]);
  const enrichedPositions = useMemo(() => positions.map(p => {
    const q = quotes[p.key];
    return q ? { ...p, marketPrice: q.price, marketValue: q.price * p.quantity, unrealized: (q.price - p.averageCost) * p.quantity, changePercent: q.changePercent } : p;
  }), [positions, quotes]);
  const priced = enrichedPositions.filter(p => p.currency === activePortfolioCurrency && p.marketValue != null);
  const totalMarketValue = priced.reduce((s,p) => s + (p.marketValue ?? 0), 0);
  const unrealized = priced.reduce((s,p) => s + (p.unrealized ?? 0), 0);
  const pricedCoverage = portfolioPositions.length ? priced.length / portfolioPositions.length : 0;
  const concentration = totalMarketValue > 0 ? Math.max(...priced.map(p => (p.marketValue ?? 0) / totalMarketValue * 100)) : null;
  const hhi = totalMarketValue > 0 ? priced.reduce((s,p) => s + Math.pow((p.marketValue ?? 0) / totalMarketValue, 2), 0) : null;
  const taxCurrencyOptions = [...new Set(transactions.map(t => t.currency ?? (t.exchange === "PSX" ? "PKR" : t.exchange === "NSE" ? "INR" : "USD")))].sort();
  const activeTaxCurrency = taxCurrencyOptions.includes(taxCurrency) ? taxCurrency : taxJurisdiction === "NSE" && taxCurrencyOptions.includes("INR") ? "INR" : taxCurrencyOptions.includes("PKR") ? "PKR" : taxCurrencyOptions[0] ?? taxCurrency;
  const taxYearOptions = [...new Set(transactions.map(t => t.trade_date.slice(0, 4)).filter(y => /^\d{4}$/.test(y)))].sort((a,b) => b.localeCompare(a));
  useEffect(() => {
    if (!taxYearManuallySelected && !isLoading) setTaxYear(taxYearOptions[0] ?? String(new Date().getFullYear()));
  }, [taxYearManuallySelected, taxYearOptions, isLoading]);
  const taxYearRecords = transactions.filter(t => t.trade_date.startsWith(taxYear) && (t.currency ?? (t.exchange === "PSX" ? "PKR" : t.exchange === "NSE" ? "INR" : "USD")) === activeTaxCurrency);
  const taxPostedRecords = taxYearRecords.filter(t => t.status === "posted");
  const taxReviewRecords = taxYearRecords.filter(t => t.status !== "posted");
  const taxBuys = taxPostedRecords.filter(t => t.action === "BUY").length;
  const taxSales = taxPostedRecords.filter(t => t.action === "SELL").length;
  const taxDividends = taxPostedRecords.filter(t => t.action === "DIV").length;
  const taxTransactions = posted.filter(t => (t.currency ?? (t.exchange === "PSX" ? "PKR" : t.exchange === "NSE" ? "INR" : "USD")) === activeTaxCurrency);
  useEffect(() => {
    if (!profile?.org_id) return;
    let cancelled = false;
    setCustomTaxLoading(true);
    void supabase.from("tax_profiles").select("cgt_rules").eq("org_id", profile.org_id).eq("jurisdiction", "CUSTOM").order("created_at", { ascending: false }).limit(1).maybeSingle().then(({ data }) => {
      if (cancelled) return;
      const rules = (data?.cgt_rules ?? {}) as Record<string, unknown>;
      const short = Number(rules.short_term_rate_percent);
      const long = Number(rules.long_term_rate_percent);
      const days = Number(rules.long_term_days);
      setCustomTaxRules(Number.isFinite(short) && Number.isFinite(long) && Number.isInteger(days) && short >= 0 && short <= 100 && long >= 0 && long <= 100 && days >= 1 ? { short, long, days } : null);
      setCustomTaxLoading(false);
    }).catch(() => { if (!cancelled) { setCustomTaxRules(null); setCustomTaxLoading(false); } });
    return () => { cancelled = true; };
  }, [profile?.org_id]);
  const tax = useMemo(() => computeTax(taxTransactions, { jurisdiction: taxJurisdiction, filerStatus: "Filer", taxYear, customShortTermRate: (customTaxRules?.short ?? 0) / 100, customLongTermRate: (customTaxRules?.long ?? 0) / 100, customLongTermDays: customTaxRules?.days ?? 365 }), [taxTransactions, taxJurisdiction, taxYear, customTaxRules]);

  async function refreshQuotes() {
    if (!quoteTargets.length) return;
    setQuotesLoading(true); setQuoteError("");
    try {
      const result = await fetchMarketPrices(quoteTargets);
      const next: Record<string, MarketPrice> = {};
      for (const [key, value] of result.entries()) next[key] = value;
      setQuotes(next);
      if (!result.size) setQuoteError("The market-data provider returned no quotes. Your ledger and cost-basis analytics remain available.");
    } catch {
      setQuoteError("Market data is temporarily unavailable. No prices have been estimated.");
    } finally { setQuotesLoading(false); }
  }

  useEffect(() => { if (!isLoading) void refreshQuotes(); }, [isLoading, quoteTargets]);

  async function loadIndexHistory(index: typeof INDEXES[number]) {
    setHistoryLoading(true); setHistoryLabel(index.label); setMarketHistory([]);
    try {
      setPsxIndexSelected(index.exchange === "PSX");
      if (index.exchange === "PSX") {
        setQuoteError("");
        return;
      }
      const params = new URLSearchParams({ symbol: index.ticker, exchange: index.exchange, range: "1y", interval: "1d" });
      const response = await fetch(`/api/market-data?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Historical index data unavailable.");
      setMarketHistory((payload.points ?? []).map((p: { time: number; price: number }) => ({
        date: new Date(p.time).toLocaleDateString(undefined, { month: "short", day: "numeric" }), close: p.price,
      })));
      if (!(payload.points ?? []).length) throw new Error("The provider returned no historical observations for this index.");
    } catch (e) { setQuoteError(e instanceof Error ? e.message : "Could not load index history."); }
    finally { setHistoryLoading(false); }
  }

  useEffect(() => { if (tab === "markets") void loadIndexHistory(INDEXES[0]); }, [tab]);

  async function runBacktest() {
    setBacktestLoading(true); setBacktestError(""); setBacktest(null);
    try {
      if (!/^[A-Z0-9.^=_-]{1,20}$/i.test(ticker.trim())) throw new Error("Enter a valid ticker symbol.");
      if (fastWindow < 2 || slowWindow <= fastWindow || slowWindow > 200) throw new Error("Slow window must be greater than fast window (maximum 200).");
      const params = new URLSearchParams({ symbol: ticker.trim().toUpperCase(), exchange, range: "1y", interval: "1d" });
      const response = await fetch(`/api/market-data?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Historical price data unavailable.");
      const points = (payload.points ?? []).filter((p: { time: number; price: number }) => Number.isFinite(p.price) && p.price > 0).sort((a: {time:number},b:{time:number}) => a.time-b.time);
      if (points.length <= slowWindow + 5) throw new Error(`Not enough daily observations for a ${slowWindow}-day strategy. Received ${points.length} points.`);
      let equity = 1, benchmark = 1, peak = 1, maxDrawdown = 0, position = 0, trades = 0;
      const returns: number[] = [];
      const rows: Array<{ date: string; strategy: number; benchmark: number }> = [];
      for (let i = 1; i < points.length; i++) {
        const start = Math.max(0, i - slowWindow);
        const history = points.slice(start, i).map((p: {price:number}) => p.price);
        if (history.length < slowWindow) continue;
        const fast = history.slice(-fastWindow).reduce((s:number,v:number)=>s+v,0)/fastWindow;
        const slow = history.reduce((s:number,v:number)=>s+v,0)/slowWindow;
        const target = fast > slow ? 1 : 0;
        const priceReturn = points[i].price / points[i-1].price - 1;
        const turnover = Math.abs(target - position);
        const strategyReturn = position * priceReturn - turnover * (feeBps / 10000);
        if (turnover) trades++;
        position = target;
        equity *= 1 + strategyReturn;
        benchmark *= 1 + priceReturn;
        returns.push(strategyReturn);
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
        rows.push({ date: new Date(points[i].time).toLocaleDateString(undefined, { month: "short", day: "numeric" }), strategy: (equity - 1) * 100, benchmark: (benchmark - 1) * 100 });
      }
      const avg = returns.reduce((s,v)=>s+v,0)/Math.max(1,returns.length);
      const variance = returns.reduce((s,v)=>s+Math.pow(v-avg,2),0)/Math.max(1,returns.length-1);
      const sharpe = variance > 0 ? avg / Math.sqrt(variance) * Math.sqrt(252) : null;
      setBacktest({ rows, stats: { strategyReturn: (equity-1)*100, benchmarkReturn: (benchmark-1)*100, sharpe, maxDrawdown: maxDrawdown*100, trades, observations: rows.length } });
    } catch (e) { setBacktestError(e instanceof Error ? e.message : "Backtest failed."); }
    finally { setBacktestLoading(false); }
  }

  function exportTaxPack() {
    const rows: unknown[][] = [
      ["PSXL TAX WORKPAPER — NOT AN OFFICIAL TAX RETURN"],
      ["Tax year", taxYear], ["Jurisdiction", taxJurisdiction], ["Currency", activeTaxCurrency],
      ["Realized gain", tax.totalGain], ["Short-term gain", tax.shortTermGain], ["Custom rates configured", taxJurisdiction !== "CUSTOM" || !!customTaxRules],
      ["Long-term gain", tax.longTermGain], ["Estimated CGT", tax.estimatedTaxDue],
      ["Dividend withholding tax recorded", tax.dividendWHT], [],
      ["Ticker","Exchange","Buy date","Sell date","Quantity","Cost per unit","Sale per unit","Holding days","Gain","Tax rate","Estimated tax"],
      ...tax.lots.map(l => [l.ticker,l.exchange,l.buyDate,l.sellDate,l.quantity,l.costBasis,l.salePrice,l.holdingDays,l.gain,l.taxRate,l.taxDue]),
    ];
    downloadCsv(`psxl-tax-workpaper-${taxJurisdiction}-${taxYear}.csv`, rows);
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof BriefcaseBusiness }> = [
    { id: "portfolio", label: "Portfolio intelligence", icon: BriefcaseBusiness },
    { id: "markets", label: "Markets & indices", icon: CandlestickChart },
    { id: "quant", label: "Quant Lab", icon: FlaskConical },
    { id: "tax", label: "Tax workpapers", icon: Calculator },
  ];
  const card = "rounded-2xl border p-4 sm:p-5";
  const cardStyle = { borderColor: "var(--hairline)", background: "var(--color-sheet)" };
  const muted = { color: "var(--ink-2)" };
  const subtle = { color: "var(--ink-3)" };

  return <div className="mx-auto w-full max-w-[1500px] space-y-6 p-3 pb-24 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-accent)" }}><Activity size={14}/> Investment intelligence</div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Investment Terminal</h1>
        <p className="mt-1 max-w-2xl text-sm" style={muted}>A decision workspace for your portfolio, markets, systematic research and tax records.</p>
      </div>
      <button onClick={() => void refreshQuotes()} disabled={quotesLoading || isLoading} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium disabled:opacity-50" style={{ borderColor: "var(--hairline)", background: "var(--color-sheet)" }}>
        <RefreshCw size={15} className={quotesLoading ? "animate-spin" : ""}/> Refresh market data
      </button>
    </div>

    <div className="flex gap-1 overflow-x-auto rounded-xl border p-1" style={{ borderColor: "var(--hairline)", background: "var(--color-sheet)" }}>
      {tabs.map(item => <button key={item.id} onClick={() => setTab(item.id)} className="inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors sm:text-sm" style={{ background: tab === item.id ? "var(--sidebar-accent)" : "transparent", color: tab === item.id ? "var(--color-accent)" : "var(--ink-2)" }}><item.icon size={15}/>{item.label}</button>)}
    </div>

    {quoteError && <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "var(--warn)", color: "var(--color-text)", background: "var(--color-sheet)" }}>{quoteError}</div>}

    {tab === "portfolio" && <>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs" style={muted}>Portfolio metrics are calculated within one currency; no unsupported FX conversion is applied.</p><label className="text-xs" style={muted}>Reporting currency <select value={activePortfolioCurrency} onChange={e=>setPortfolioCurrency(e.target.value)} className="ml-2 rounded-lg border bg-transparent px-2 py-1.5 text-xs" style={{borderColor:"var(--hairline)",color:"var(--color-text)"}}>{[...new Set(positions.map(p=>p.currency))].map(v=><option key={v}>{v}</option>)}</select></label></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Market value" value={priced.length ? money(totalMarketValue, activePortfolioCurrency) : "Unavailable"} detail={priced.length ? `${priced.length} of ${portfolioPositions.length} positions priced · ${activePortfolioCurrency}` : "Waiting for verified market quotes"} icon={Wallet}/>
        <Metric label="Unrealized P&L" value={priced.length ? money(unrealized, activePortfolioCurrency) : "—"} detail="Market price less weighted-average cost basis" icon={unrealized >= 0 ? ArrowUpRight : ArrowDownRight} tone={unrealized >= 0 ? "good" : "bad"}/>
        <Metric label="Invested cost" value={portfolioPositions.length ? money(portfolioPositions.reduce((s,p)=>s+p.costBasis,0), activePortfolioCurrency) : "—"} detail="Open positions, posted transactions only" icon={BriefcaseBusiness}/>
        <Metric label="Largest position" value={concentration == null ? "—" : `${concentration.toFixed(1)}%`} detail={hhi == null ? "Requires priced positions" : `Concentration index ${(hhi*10000).toFixed(0)} / 10,000 · ${activePortfolioCurrency}`} icon={Target} tone={concentration != null && concentration > 35 ? "bad" : "normal"}/>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
        <section className={card} style={cardStyle}>
          <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-semibold">Holdings & exposure</h2><p className="mt-1 text-xs" style={subtle}>Live valuation where a quote is available; otherwise no price is assumed.</p></div><span className="text-xs" style={muted}>{portfolioPositions.length} positions · {activePortfolioCurrency}</span></div>
          {isLoading ? <p className="py-10 text-center text-sm" style={muted}>Loading your ledger…</p> : portfolioPositions.length === 0 ? <div className="py-12 text-center"><BriefcaseBusiness className="mx-auto mb-3" style={subtle}/><p className="font-medium">Your portfolio starts with your ledger</p><p className="mt-1 text-sm" style={muted}>Import or add posted trades to unlock holdings, risk and quant research.</p></div> :
            <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-sm"><thead><tr className="text-left text-xs" style={subtle}><th className="pb-3 font-medium">Instrument</th><th className="pb-3 text-right font-medium">Quantity</th><th className="pb-3 text-right font-medium">Avg. cost</th><th className="pb-3 text-right font-medium">Last price</th><th className="pb-3 text-right font-medium">Market value</th><th className="pb-3 text-right font-medium">Unrealized</th></tr></thead><tbody>{enrichedPositions.map(p=><tr key={p.key} className="border-t" style={{ borderColor: "var(--hairline)" }}><td className="py-3"><div className="font-semibold">{p.ticker}</div><div className="text-xs" style={subtle}>{p.exchange}</div></td><td className="py-3 text-right tnum">{p.quantity.toLocaleString()}</td><td className="py-3 text-right tnum">{money(p.averageCost,p.currency)}</td><td className="py-3 text-right tnum">{p.marketPrice == null ? "—" : money(p.marketPrice,p.currency)}</td><td className="py-3 text-right tnum">{p.marketValue == null ? "—" : money(p.marketValue,p.currency)}</td><td className="py-3 text-right tnum" style={{ color: p.unrealized == null ? "var(--ink-3)" : p.unrealized >= 0 ? "var(--ok)" : "var(--bad)" }}>{p.unrealized == null ? "—" : money(p.unrealized,p.currency)}</td></tr>)}</tbody></table></div>}
          {positions.length > 0 && pricedCoverage < 1 && <p className="mt-3 text-xs" style={subtle}>Quote coverage: {Math.round((portfolioPositions.length ? priced.length / portfolioPositions.length : 0)*100)}%. Unpriced positions are excluded from market value and concentration calculations.</p>}
        </section>
        <section className={card} style={cardStyle}>
          <div className="mb-4 flex items-center gap-2"><ShieldAlert size={17} style={{ color: "var(--color-accent)" }}/><h2 className="font-semibold">Portfolio risk snapshot</h2></div>
          <div className="space-y-4">
            <div><div className="flex justify-between text-sm"><span style={muted}>Largest position</span><strong>{concentration == null ? "—" : `${concentration.toFixed(1)}%`}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "var(--hairline)" }}><div className="h-full rounded-full" style={{ width: `${Math.min(100,concentration ?? 0)}%`, background: "var(--color-accent)" }}/></div></div>
            <div><div className="flex justify-between text-sm"><span style={muted}>Priced holdings</span><strong>{priced.length}/{positions.length}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "var(--hairline)" }}><div className="h-full rounded-full" style={{ width: `${pricedCoverage*100}%`, background: "var(--ok)" }}/></div></div>
            <div className="rounded-xl p-3" style={{ background: "var(--sidebar-accent)" }}><p className="text-xs font-semibold">Risk interpretation</p><p className="mt-1 text-sm" style={muted}>{concentration == null ? "Refresh verified market prices to calculate concentration." : concentration > 35 ? "Your largest holding exceeds 35% of priced portfolio value. Review single-name exposure and downside scenarios." : concentration > 20 ? "Your portfolio has a meaningful single-name exposure. Monitor position sizing." : "No single priced holding exceeds 20% of portfolio value."}</p></div>
            <p className="text-xs" style={subtle}>This is a concentration diagnostic, not a full volatility, VaR or beta model. Those require reliable historical price series for every holding.</p>
          </div>
        </section>
      </div>
    </>}

    {tab === "markets" && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{INDEXES.map(index=>{const q=quotes[`${index.exchange}:${index.ticker}`]; return <button key={index.ticker} onClick={()=>void loadIndexHistory(index)} className="rounded-2xl border p-4 text-left transition-colors hover:bg-surface-hover" style={cardStyle}><div className="text-xs font-medium" style={muted}>{index.label}</div><div className="mt-2 text-xl font-semibold tnum">{q ? q.price.toLocaleString(undefined,{maximumFractionDigits:2}) : "—"}</div><div className="mt-1 text-xs" style={{color:q ? q.changePercent>=0?"var(--ok)":"var(--bad)":"var(--ink-3)"}}>{q ? `${q.change>=0?"+":""}${q.change.toFixed(2)} · ${pct(q.changePercent)}` : index.exchange === "PSX" ? "Official PSX data" : "Quote unavailable"}</div><div className="mt-3 text-[10px]" style={subtle}>{index.exchange === "PSX" ? "Click to open official index source" : "Click to inspect 1-year history"}</div></button>})}</div>
      <section className={card} style={cardStyle}><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{historyLabel} · 1 year</h2><p className="text-xs" style={subtle}>Daily closing observations · Yahoo Finance feed</p></div><span className="text-xs" style={muted}>{historyLoading ? "Loading…" : `${marketHistory.length} observations`}</span></div><div className="h-[300px] w-full">{marketHistory.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={marketHistory}><CartesianGrid stroke="var(--hairline)" strokeDasharray="3 3"/><XAxis dataKey="date" tick={{fontSize:11,fill:"var(--ink-3)"}} minTickGap={35}/><YAxis domain={["auto","auto"]} tick={{fontSize:11,fill:"var(--ink-3)"}} width={65}/><Tooltip contentStyle={{background:"var(--color-sheet)",border:"1px solid var(--hairline)",borderRadius:12,color:"var(--color-text)"}}/><Line dataKey="close" name="Close" type="monotone" dot={false} stroke="var(--chart-1)" strokeWidth={2}/></LineChart></ResponsiveContainer>  : <div className="flex h-full flex-col items-center justify-center gap-2 text-sm" style={subtle}>{historyLoading ? "Fetching index history…" : psxIndexSelected ? <>The PSX index feed is not available through the configured historical-data provider. <a className="font-semibold underline" style={{color:"var(--color-accent)"}} href="https://dps.psx.com.pk/indices" target="_blank" rel="noreferrer">Open official PSX index data ↗</a></> : "Select an index above to load its historical series."}</div>}</div></section>
      <p className="text-xs" style={subtle}>Index availability and delay depend on the upstream market-data provider and symbol mapping. Market breadth, constituents and sector heatmaps are not shown until a verified exchange-wide feed is connected.</p>
    </>}

    {tab === "quant" && <>
      <section className={card} style={cardStyle}>
        <div className="mb-4 flex items-center gap-2"><FlaskConical size={18} style={{color:"var(--color-accent)"}}/><div><h2 className="font-semibold">Moving-average crossover research</h2><p className="text-xs" style={subtle}>A reproducible daily-bar backtest with next-bar execution and transaction-cost assumptions.</p></div></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs" style={muted}>Ticker<input value={ticker} onChange={e=>setTicker(e.target.value.toUpperCase())} className="mt-1.5 w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm" style={{borderColor:"var(--hairline)",color:"var(--color-text)"}}/></label>
          <label className="text-xs" style={muted}>Exchange<select value={exchange} onChange={e=>setExchange(e.target.value)} className="mt-1.5 w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm" style={{borderColor:"var(--hairline)",color:"var(--color-text)"}}>{["PSX","NSE","NYSE","NASDAQ","LSE"].map(v=><option key={v}>{v}</option>)}</select></label>
          <label className="text-xs" style={muted}>Fast SMA<input type="number" min={2} max={100} value={fastWindow} onChange={e=>setFastWindow(Number(e.target.value))} className="mt-1.5 w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm" style={{borderColor:"var(--hairline)",color:"var(--color-text)"}}/></label>
          <label className="text-xs" style={muted}>Slow SMA<input type="number" min={3} max={200} value={slowWindow} onChange={e=>setSlowWindow(Number(e.target.value))} className="mt-1.5 w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm" style={{borderColor:"var(--hairline)",color:"var(--color-text)"}}/></label>
          <label className="text-xs" style={muted}>One-way costs (bps)<input type="number" min={0} max={500} value={feeBps} onChange={e=>setFeeBps(Math.max(0,Math.min(500,Number(e.target.value))))} className="mt-1.5 w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm" style={{borderColor:"var(--hairline)",color:"var(--color-text)"}}/></label>
        </div>
        <button onClick={()=>void runBacktest()} disabled={backtestLoading} className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{background:"var(--color-accent)"}}><Activity size={15} className={backtestLoading?"animate-pulse":""}/>{backtestLoading?"Running simulation…":"Run backtest"}</button>
        {backtestError && <p className="mt-3 text-sm" style={{color:"var(--bad)"}}>{backtestError}</p>}
      </section>
      {backtest && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Strategy return" value={pct(backtest.stats.strategyReturn)} detail="Net of modeled transaction costs" icon={TrendingUp} tone={backtest.stats.strategyReturn>=0?"good":"bad"}/>
          <Metric label="Buy & hold" value={pct(backtest.stats.benchmarkReturn)} detail="Same instrument and observation window" icon={BarChart3}/>
          <Metric label="Annualized Sharpe" value={backtest.stats.sharpe == null ? "—" : backtest.stats.sharpe.toFixed(2)} detail="252 trading-day annualization" icon={Target}/>
          <Metric label="Maximum drawdown" value={pct(-backtest.stats.maxDrawdown)} detail={`${backtest.stats.trades} position changes · ${backtest.stats.observations} daily returns`} icon={ShieldAlert} tone="bad"/>
        </div>
        <section className={card} style={cardStyle}><h2 className="mb-1 font-semibold">Strategy vs. buy & hold</h2><p className="mb-4 text-xs" style={subtle}>Cumulative return from the first simulated observation</p><div className="h-[320px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={backtest.rows}><CartesianGrid stroke="var(--hairline)" strokeDasharray="3 3"/><XAxis dataKey="date" tick={{fontSize:11,fill:"var(--ink-3)"}} minTickGap={35}/><YAxis tick={{fontSize:11,fill:"var(--ink-3)"}} tickFormatter={v=>`${v}%`}/><Tooltip formatter={(v:number)=>[`${v.toFixed(2)}%`]} contentStyle={{background:"var(--color-sheet)",border:"1px solid var(--hairline)",borderRadius:12,color:"var(--color-text)"}}/><Line dataKey="strategy" name="SMA strategy" type="monotone" dot={false} stroke="var(--chart-1)" strokeWidth={2}/><Line dataKey="benchmark" name="Buy & hold" type="monotone" dot={false} stroke="var(--chart-2)" strokeWidth={1.7}/></LineChart></ResponsiveContainer></div></section>
        <div className="rounded-xl border p-4 text-xs leading-5" style={{borderColor:"var(--hairline)",...muted}}><strong>Research limitations:</strong> This is a single-instrument, long/cash SMA demonstration using the available 1-year daily feed. It does not include dividends, corporate actions, borrow costs, market impact, survivorship-bias controls, walk-forward validation or portfolio-level position sizing. It is research, not a trading recommendation.</div>
      </>}
      {!backtest && !backtestLoading && <div className="rounded-2xl border p-8 text-center" style={cardStyle}><BrainCircuit size={26} className="mx-auto mb-3" style={subtle}/><p className="font-medium">Turn a hypothesis into a measurable experiment</p><p className="mt-1 text-sm" style={muted}>Run a moving-average strategy on one supported ticker and compare it with buy-and-hold using the same price history.</p></div>}
    </>}

    {tab === "tax" && <>
      <section className={card} style={cardStyle}>
        <div className="mb-4 flex items-center gap-2"><Calculator size={18} style={{color:"var(--color-accent)"}}/><div><h2 className="font-semibold">Tax return preparation pack</h2><p className="text-xs" style={subtle}>Reproducible realized-gain workpapers from posted broker transactions.</p></div></div>
        {taxJurisdiction === "CUSTOM" && <div className="mb-4 rounded-xl border p-3 text-sm" style={{borderColor:"var(--hairline)",...muted}}>{customTaxLoading ? "Loading saved custom tax rules…" : customTaxRules ? `Using saved custom rates: short-term ${customTaxRules.short}%, long-term ${customTaxRules.long}%, long-term threshold ${customTaxRules.days} days.` : <>No saved custom rates found. <Link to="/app/tax" className="font-semibold underline" style={{color:"var(--color-accent)"}}>Configure tax rules in Tax Center</Link> before relying on this estimate.</>}</div>}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs" style={muted}>Tax year<select value={taxYear} onChange={e=>{setTaxYearManuallySelected(true);setTaxYear(e.target.value);}} className="mt-1.5 w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm" style={{borderColor:"var(--hairline)",color:"var(--color-text)"}}>{(taxYearOptions.length ? taxYearOptions : [String(new Date().getFullYear())]).map(y=><option key={y} value={y}>{y}</option>)}</select></label>
          <label className="text-xs" style={muted}>Jurisdiction<select value={taxJurisdiction} onChange={e=>{const next=e.target.value as typeof taxJurisdiction;setTaxJurisdiction(next);if(next==="PSX"&&taxCurrencyOptions.includes("PKR"))setTaxCurrency("PKR");if(next==="NSE"&&taxCurrencyOptions.includes("INR"))setTaxCurrency("INR");}} className="mt-1.5 w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm" style={{borderColor:"var(--hairline)",color:"var(--color-text)"}}><option value="PSX">Pakistan · PSX</option><option value="NSE">India · NSE</option><option value="CUSTOM">Custom rules</option></select></label>
          <label className="text-xs" style={muted}>Transaction currency<select value={activeTaxCurrency} onChange={e=>setTaxCurrency(e.target.value)} className="mt-1.5 w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm" style={{borderColor:"var(--hairline)",color:"var(--color-text)"}}>{taxCurrencyOptions.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
        </div>
        {taxJurisdiction !== "CUSTOM" && <p className="mt-3 text-xs" style={subtle}>The built-in PSX/NSE schedules are reference calculations, not a guarantee of the law applicable to every tax year. Verify the selected year’s rules before filing.</p>}
        <div className="mt-4 rounded-xl border p-3" style={{borderColor:"var(--hairline)",background:"var(--color-sheet)"}}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Automatic ledger calculation</p><span className="text-xs" style={subtle}>{isLoading ? "Syncing ledger…" : `${taxYearRecords.length} records in ${taxYear || "selected year"}`}</span></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={muted}><span>{taxPostedRecords.length} posted</span><span>{taxReviewRecords.length} awaiting review</span><span>{taxBuys} buys</span><span>{taxSales} sells</span><span>{taxDividends} dividends</span><span>{tax.lots.length} FIFO-matched lots</span></div>{taxReviewRecords.length > 0 && <p className="mt-2 text-xs" style={{color:"var(--warn)"}}>{taxReviewRecords.length} record(s) are excluded until approved in the Review Inbox. This prevents unverified trades from entering your tax workpaper.</p>}{taxPostedRecords.length > 0 && taxSales === 0 && <p className="mt-2 text-xs" style={subtle}>Your posted records are included automatically. There are no SELL transactions in this year and currency, so realized capital gains are correctly zero; open BUY positions are unrealized, not realized gains.</p>}{taxSales > 0 && tax.lots.length === 0 && <p className="mt-2 text-xs" style={{color:"var(--warn)"}}>Sales exist but no FIFO lots could be matched. Check that earlier BUY records are posted, use the same ticker and exchange, and use the same currency.</p>}</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Realized gains" value={money(tax.totalGain,activeTaxCurrency)} detail="FIFO matched disposals" icon={TrendingUp}/>
          <Metric label="Short-term gains" value={money(tax.shortTermGain,activeTaxCurrency)} detail="Under configured holding threshold" icon={Activity}/>
          <Metric label="Long-term gains" value={money(tax.longTermGain,activeTaxCurrency)} detail="At or above configured threshold" icon={Wallet}/>
          <Metric label="Estimated CGT" value={taxJurisdiction === "CUSTOM" && !customTaxRules ? "Not configured" : money(tax.estimatedTaxDue,activeTaxCurrency)} detail="Rule-based estimate, not assessed liability" icon={Calculator}/>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl p-3" style={{background:"var(--sidebar-accent)"}}><div><p className="text-sm font-semibold">Export tax workpaper</p><p className="text-xs" style={muted}>Summary, tax assumptions and FIFO lot-level schedule in CSV.</p></div><button onClick={exportTaxPack} disabled={taxJurisdiction === "CUSTOM" && !customTaxRules} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" style={{background:"var(--color-accent)"}}><Download size={15}/> Download CSV</button></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead><tr className="text-left text-xs" style={subtle}>{["Ticker","Buy date","Sell date","Qty","Holding days","Gain","Tax"].map(x=><th key={x} className="pb-2 font-medium">{x}</th>)}</tr></thead><tbody>{tax.lots.slice(0,100).map((lot,i)=><tr key={`${lot.ticker}-${lot.sellDate}-${i}`} className="border-t" style={{borderColor:"var(--hairline)"}}><td className="py-2.5 font-medium">{lot.ticker}</td><td>{lot.buyDate}</td><td>{lot.sellDate}</td><td className="text-right">{lot.quantity}</td><td className="text-right">{lot.holdingDays}</td><td className="text-right tnum">{money(lot.gain,activeTaxCurrency)}</td><td className="text-right tnum">{money(lot.taxDue,activeTaxCurrency)}</td></tr>)}</tbody></table>{tax.lots.length===0 && <p className="py-8 text-center text-sm" style={subtle}>No FIFO-matched sales were found for this tax year and currency.</p>}</div>
      </section>
      <div className="rounded-xl border p-4 text-xs leading-5" style={{borderColor:"var(--hairline)",...muted}}><strong>Important:</strong> This is a tax-preparation workpaper, not an official tax return or filing confirmation. Confirm the applicable tax-year rules, filer status, allowable expenses, exemptions, dividends and withholding with a qualified tax professional before filing. PSXL does not submit anything to FBR or another tax authority.</div>
    </>}
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]" style={subtle}><span>Calculations use posted transactions only. Review items are excluded.</span><span>Market quotes and historical data are provider-dependent and may be delayed.</span></div>
  </div>;
}
