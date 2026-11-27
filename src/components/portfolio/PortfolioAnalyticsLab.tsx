import { useMemo, useState } from "react";
import { Activity, BarChart3, Calculator, CandlestickChart, TrendingDown, TrendingUp } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, Brush, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, ReferenceLine,
} from "recharts";
import type { Transaction } from "@/lib/demo-data";
import { currencyForExchange } from "@/lib/market-currency";

type Props = { transactions: Transaction[]; currency: string };
type Tab = "equity" | "ticker" | "activity" | "drawdown";
const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: "equity", label: "Cash flow", icon: TrendingUp },
  { id: "ticker", label: "Ticker cash flow", icon: BarChart3 },
  { id: "activity", label: "Trade activity", icon: Activity },
  { id: "drawdown", label: "Cash-flow drawdown", icon: TrendingDown },
];
const card = { border: "1px solid var(--hairline)", background: "var(--color-sheet)" };

export function PortfolioAnalyticsLab({ transactions, currency }: Props) {
  const [tab, setTab] = useState<Tab>("equity");
  const [ticker, setTicker] = useState("ALL");
  const [selectedCurrency, setSelectedCurrency] = useState(currency === "MIXED" ? "" : currency);
  const [riskPct, setRiskPct] = useState("1");
  const [entry, setEntry] = useState("100");
  const [stop, setStop] = useState("95");
  const [capital, setCapital] = useState("100000");
  const [period, setPeriod] = useState("ALL");
  const [chartStyle, setChartStyle] = useState<"area" | "line" | "bars">("area");

  const posted = useMemo(
    () => transactions
      .filter(t => t.status === "posted" && Number.isFinite(t.quantity) && Number.isFinite(t.price))
      .slice()
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date) || String(a.id).localeCompare(String(b.id))),
    [transactions],
  );
  const currencies = useMemo(() => [...new Set(posted.map(t => t.currency ?? currencyForExchange(t.exchange)))].sort(), [posted, currency]);
  const activeCurrency = currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0] ?? "";
  const tickers = useMemo(() => [...new Set(posted.map(t => ({ key: t.exchange + ":" + t.ticker, label: t.ticker + " · " + t.exchange })))].sort((a,b)=>a.label.localeCompare(b.label)), [posted]);
  const scopedPosted = useMemo(
    () => posted.filter(t => (activeCurrency !== "" && (t.currency ?? currencyForExchange(t.exchange)) === activeCurrency) && (ticker === "ALL" || t.exchange + ":" + t.ticker === ticker)),
    [posted, ticker, activeCurrency],
  );
  const periodStart = useMemo(() => {
    if (period === "ALL" || scopedPosted.length === 0) return null;
    const days: Record<string, number> = { "1D": 0, "1W": 6, "1M": 29, "3M": 89, "6M": 179, "1Y": 364 };
    const latest = new Date(`${scopedPosted[scopedPosted.length - 1]!.trade_date}T00:00:00.000Z`);
    latest.setUTCDate(latest.getUTCDate() - (days[period] ?? 0));
    return latest.toISOString().slice(0, 10);
  }, [period, scopedPosted]);
  const filtered = useMemo(() => scopedPosted.filter(t => !periodStart || t.trade_date >= periodStart), [scopedPosted, periodStart]);

  const data = useMemo(() => {
    const byTicker = new Map<string, { ticker: string; exchange: string; buys: number; sells: number; shares: number; positionCost: number; dividends: number; sellValue: number; buyValue: number }>();
    const daily = new Map<string, { date: string; buys: number; sells: number; dividends: number; netFlow: number }>();
    for (const t of filtered) {
      const key = t.exchange + ":" + t.ticker;
      const v = byTicker.get(key) || { ticker: t.ticker, exchange: t.exchange, buys: 0, sells: 0, shares: 0, positionCost: 0, dividends: 0, sellValue: 0, buyValue: 0 };
      const d = daily.get(t.trade_date) || { date: t.trade_date, buys: 0, sells: 0, dividends: 0, netFlow: 0 };
      if (t.action === "BUY") { v.buys += t.quantity*t.price+t.fees; v.buyValue += t.quantity*t.price+t.fees; v.shares += t.quantity; v.positionCost += t.quantity*t.price+t.fees; d.buys += t.quantity*t.price; d.netFlow -= t.quantity*t.price+t.fees; }
      else if (t.action === "SELL") { v.sells += t.quantity*t.price-t.fees; v.sellValue += t.quantity*t.price-t.fees; const averageCost = v.shares > 0 ? v.positionCost / v.shares : 0; v.shares = Math.max(0, v.shares - t.quantity); v.positionCost = Math.max(0, v.positionCost - averageCost * t.quantity); d.sells += t.quantity*t.price; d.netFlow += t.quantity*t.price-t.fees; }
      else { v.dividends += t.quantity*t.price-t.wht; d.dividends += t.quantity*t.price-t.wht; d.netFlow += t.quantity*t.price-t.wht; }
      byTicker.set(key,v); daily.set(t.trade_date,d);
    }
    const activity = [...daily.values()].sort((a,b)=>a.date.localeCompare(b.date));
    const monthlyMap = new Map<string, { month: string; buys: number; sells: number; dividends: number; netFlow: number }>();
    for (const day of activity) {
      const month = day.date.slice(0, 7);
      const bucket = monthlyMap.get(month) || { month, buys: 0, sells: 0, dividends: 0, netFlow: 0 };
      bucket.buys += day.buys; bucket.sells += day.sells; bucket.dividends += day.dividends; bucket.netFlow += day.netFlow;
      monthlyMap.set(month, bucket);
    }
    let monthlyFlow = 0;
    const monthly = [...monthlyMap.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(item => {
      monthlyFlow += item.netFlow;
      return { ...item, cumulative: monthlyFlow };
    });
    const actionCounts = (["BUY", "SELL", "DIV"] as const).map(action => ({ action, count: filtered.filter(t => t.action === action).length })).filter(item => item.count > 0);
    // Build a continuous calendar-day series. Empty dates are explicit zero-flow
    // sessions, so the chart remains a real time series rather than disconnected
    // transaction dots. Ledger records have date (not intraday timestamp) precision.
    const dayMap = new Map(activity.map(day => [day.date, day]));
    const firstDate = periodStart ?? activity[0]?.date ?? "";
    const lastDate = activity.at(-1)?.date ?? "";
    const equity: { date: string; point: string; ticker: string; action: string; netFlow: number; cumulative: number; drawdown: number; buys: number; sells: number; dividends: number }[] = [];
    if (firstDate && lastDate) {
      const cursor = new Date(`${firstDate}T00:00:00.000Z`);
      const end = new Date(`${lastDate}T00:00:00.000Z`);
      let flow = 0, peak = 0;
      while (cursor <= end && equity.length < 1100) {
        const date = cursor.toISOString().slice(0, 10);
        const day = dayMap.get(date);
        const netFlow = day?.netFlow ?? 0;
        flow += netFlow;
        peak = Math.max(peak, flow);
        equity.push({
          date,
          point: date,
          ticker: day ? "Daily ledger activity" : "No transactions",
          action: day ? "DAY" : "NO ACTIVITY",
          netFlow,
          cumulative: flow,
          drawdown: peak > 0 ? ((flow - peak) / peak) * 100 : 0,
          buys: day?.buys ?? 0,
          sells: day?.sells ?? 0,
          dividends: day?.dividends ?? 0,
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    const tickerRows = [...byTicker.values()].map(v=>({ticker:v.ticker + " · " + v.exchange, buys:v.buyValue, sells:v.sellValue, dividends:v.dividends, netCash:v.sellValue+v.dividends-v.buyValue, shares:v.shares})).sort((a,b)=>b.netCash-a.netCash);
    return { activity, equity, tickerRows, divs: activity.filter(d=>d.dividends>0), monthly, actionCounts };
  }, [filtered]);

  // Keep Recharts hover cards readable in both light and dark themes.
  // Explicit label/item colors override series colors that can disappear against the tooltip surface.
  const tooltipContentStyle = { backgroundColor: "var(--color-sheet)", border: "1px solid var(--hairline)", borderRadius: 12, color: "var(--color-text)", padding: "10px 14px", boxShadow: "0 8px 28px rgba(0,0,0,.16)", opacity: 1 };
  const tooltipLabelStyle = { color: "var(--color-text)", fontWeight: 700, marginBottom: 6 };
  const tooltipItemStyle = { color: "var(--ink-2)", fontWeight: 500 };
  const fmt = (v:number) => v.toLocaleString("en-PK",{maximumFractionDigits:2});
  const dateFmt = (value: string) => {
    const dateOnly = String(value).slice(0, 10);
    const date = new Date(`${dateOnly}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });
  };
  const entryNum = Number(entry), stopNum = Number(stop), capitalNum = Number(capital), riskNum = Number(riskPct);
  const riskAmount = capitalNum * riskNum/100;
  const perShareRisk = Math.abs(entryNum-stopNum);
  const size = perShareRisk > 0 ? Math.floor(riskAmount/perShareRisk) : 0;

  // Keep unposted records visible in the audit count, but never mix them into
  // financial totals or plotted cash flow until they are approved and posted.
  const filteredAll = useMemo(
    () => transactions.filter(t =>
      (activeCurrency !== "" && (t.currency ?? currencyForExchange(t.exchange)) === activeCurrency) &&
      (ticker === "ALL" || t.exchange + ":" + t.ticker === ticker) &&
      (!periodStart || t.trade_date >= periodStart)
    ),
    [transactions, activeCurrency, ticker, periodStart],
  );
  const reviewCount = filteredAll.filter(t => t.status !== "posted").length;
  const activityRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const trade of filtered) counts.set(trade.trade_date, (counts.get(trade.trade_date) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ label: date, value }));
  }, [filtered]);
  // Keep one point per transaction (not one per calendar day), so four trades
  // on the same date remain four visible observations in the primary chart.
  const transactionPoints = useMemo(() => {
    let cumulative = 0;
    let peak = 0;
    return filtered.map((trade, index) => {
      const net = trade.action === "BUY"
        ? -(trade.quantity * trade.price + trade.fees)
        : trade.action === "SELL"
          ? trade.quantity * trade.price - trade.fees
          : trade.quantity * trade.price - trade.wht;
      cumulative += net;
      peak = Math.max(peak, cumulative);
      return {
        label: `${trade.trade_date} · ${trade.ticker} ${trade.action} #${index + 1}`,
        cumulative,
        drawdown: cumulative - peak,
      };
    });
  }, [filtered]);
  const mainData = tab === "ticker"
    ? data.tickerRows.map(item => ({ label: item.ticker, value: item.netCash }))
    : tab === "activity"
      ? activityRows
      : tab === "drawdown"
        ? transactionPoints.map(point => ({ label: point.label, value: point.drawdown }))
        : transactionPoints.length
          ? [
              { label: `Start · ${transactionPoints[0]!.label.split(" · ")[0]}`, value: 0 },
              ...transactionPoints.map(point => ({ label: point.label, value: point.cumulative })),
            ]
          : [];
  // If the ledger contains only one calendar month, monthly aggregation
  // necessarily produces one point. Fall back to transaction-level observations
  // so the trend remains visible without fabricating dates or values.
  const monthlyChartData = data.monthly.length > 1
    ? data.monthly.map(item => ({ ...item, month: item.month }))
    : (() => {
        let cumulativeFlow = 0;
        return filtered.map(trade => {
          const netFlow = trade.action === "BUY"
            ? -(trade.quantity * trade.price + trade.fees)
            : trade.action === "SELL"
              ? trade.quantity * trade.price - trade.fees
              : trade.quantity * trade.price - trade.wht;
          cumulativeFlow += netFlow;
          return {
            month: trade.trade_date,
            netFlow,
            cumulative: cumulativeFlow,
            buys: trade.action === "BUY" ? trade.quantity * trade.price : 0,
            sells: trade.action === "SELL" ? trade.quantity * trade.price : 0,
            dividends: trade.action === "DIV" ? trade.quantity * trade.price - trade.wht : 0,
          };
        });
      })();
  const monthlyChartDescription = data.monthly.length > 1
    ? "Cumulative net ledger flow by month"
    : "Transaction-level cash flow · single-month ledger";

  const mainTitle = tab === "ticker" ? "Net cash flow by ticker"
    : tab === "activity" ? "Posted transaction activity"
      : tab === "drawdown" ? "Cash-flow drawdown"
        : "Cumulative net cash flow";
  const mainUnit = tab === "activity" ? "transactions" : activeCurrency;

  return <section className="space-y-6 rounded-lg p-4 sm:p-7" style={{...card, boxShadow:"0 18px 55px rgba(15,23,42,.055)"}}>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em]" style={{color:"var(--color-accent)"}}><CandlestickChart size={14}/> PSXL MARKETS · ANALYTICS</p><h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-[28px]">Portfolio performance</h2><p className="mt-1 max-w-2xl text-xs leading-5" style={{color:"var(--ink-3)"}}>A precise view of your ledger activity, cash movements and symbol-level exposure.</p></div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Currency filter" value={activeCurrency} onChange={e=>setSelectedCurrency(e.target.value)} className="rounded-md px-3 py-2 text-xs" style={card}><option value="">Choose currency</option>{currencies.map(code=><option key={code} value={code}>{code}</option>)}</select>
        <select aria-label="Ticker filter" value={ticker} onChange={e=>setTicker(e.target.value)} className="rounded-md px-3 py-2 text-xs" style={card}><option value="ALL">All tickers</option>{tickers.map(t=><option key={t.key} value={t.key}>{t.label}</option>)}</select>
        
      </div>
    </header>
    <div className="flex gap-1 overflow-x-auto rounded-md p-1" style={{background:"var(--color-login-bg)"}}>{tabs.map(t=>{const Icon=t.icon;return <button key={t.id} onClick={()=>setTab(t.id)} className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all" style={{background:tab===t.id?"var(--color-sheet)":"transparent",color:tab===t.id?"var(--color-text)":"var(--ink-3)",boxShadow:tab===t.id?"0 1px 5px #00000012":"none"}}><Icon size={14}/>{t.label}</button>})}</div>
    <div className="space-y-4 rounded-lg p-3 sm:p-5" style={{background:"var(--color-login-bg)",border:"1px solid var(--hairline)"}}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-md p-1" style={{background:"var(--color-login-bg)"}}>
          {["1D","1W","1M","3M","6M","1Y","ALL"].map(range => (
            <button key={range} type="button" onClick={() => setPeriod(range)} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors" style={{background:period===range?"var(--color-sheet)":"transparent",color:period===range?"var(--color-text)":"var(--ink-3)",boxShadow:period===range?"0 1px 4px rgba(0,0,0,.12)":"none"}}>{range}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-md p-1" style={{background:"var(--color-login-bg)"}}>
          {(["area","line","bars"] as const).map(style => (
            <button key={style} type="button" onClick={() => setChartStyle(style)} className="rounded-lg px-3 py-1.5 text-[11px] font-semibold capitalize" style={{background:chartStyle===style?"var(--color-sheet)":"transparent",color:chartStyle===style?"var(--color-text)":"var(--ink-3)"}}>{style}</button>
          ))}
        </div>
      </div>
      {mainData.length > 0 ? <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-md px-3 py-2" style={{background:"var(--color-login-bg)"}}>
            <p className="text-[10px] font-medium uppercase tracking-wide" style={{color:"var(--ink-3)"}}>Net cash flow</p>
            <p className="tnum mt-1 text-sm font-semibold" style={{color:(data.equity.at(-1)?.cumulative ?? 0)>=0?"var(--ok)":"var(--bad)"}}>{activeCurrency} {fmt(data.equity.at(-1)?.cumulative ?? 0)}</p>
          </div>
          <div className="rounded-md px-3 py-2" style={{background:"var(--color-login-bg)"}}>
            <p className="text-[10px] font-medium uppercase tracking-wide" style={{color:"var(--ink-3)"}}>Transactions plotted</p>
            <p className="tnum mt-1 text-sm font-semibold">{filtered.length.toLocaleString()} posted</p>
            {reviewCount > 0 && <p className="mt-0.5 text-[10px]" style={{color:"var(--warn)"}}>{reviewCount} awaiting review · excluded</p>}
          </div>
          <div className="col-span-2 rounded-md px-3 py-2 sm:col-span-1" style={{background:"var(--color-login-bg)"}}>
            <p className="text-[10px] font-medium uppercase tracking-wide" style={{color:"var(--ink-3)"}}>Chart data</p>
            <p className="mt-1 text-[11px]" style={{color:"var(--ink-2)"}}>Posted ledger events · {activeCurrency}</p>
          </div>
        </div>
        <div className="rounded-lg border p-3 sm:p-4" style={{background:"var(--color-sheet)",borderColor:"var(--hairline)"}}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{mainTitle}</p>
              <p className="text-[10px]" style={{color:"var(--ink-3)"}}>{tab === "ticker" ? "Per-symbol net cash movement" : tab === "activity" ? "Number of posted records per trade date" : tab === "drawdown" ? "Distance below the running cash-flow peak" : "Running total after each individual trade"} · {mainUnit}</p>
            </div>
            <span className="shrink-0 text-[10px] font-medium" style={{color:"var(--ink-3)"}}>{mainData.length} points</span>
          </div>
          <div className="h-[260px] min-w-0 sm:h-[320px]">
            <ResponsiveContainer
              key={`main-chart-${tab}-${mainData.length}-${filtered.length}`}
              width="100%"
              height="100%"
              debounce={80}
            >
              <ComposedChart key={`main-series-${tab}-${mainData.length}-${filtered.length}-${chartStyle}`} data={mainData} margin={{top:12,right:14,left:4,bottom:tab === "ticker" ? 42 : 4}}>
                <defs>
                  <linearGradient id="psxl-cashflow-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.28}/>
                    <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--hairline)" strokeDasharray="3 5"/>
                <XAxis dataKey="label" tickFormatter={value => tab === "ticker" ? String(value).split(" · ")[0] : dateFmt(String(value).slice(0, 10))} interval="preserveStartEnd" minTickGap={32} angle={tab === "ticker" ? -28 : 0} textAnchor={tab === "ticker" ? "end" : "middle"} height={tab === "ticker" ? 58 : 28} tick={{fontSize:10,fill:"var(--ink-3)"}} axisLine={false} tickLine={false}/>
                <YAxis allowDecimals={tab === "activity"} width={76} tickFormatter={fmt} tick={{fontSize:10,fill:"var(--ink-3)"}} axisLine={false} tickLine={false}/>
                <ReferenceLine y={0} stroke="var(--ink-3)" strokeOpacity={.45} strokeDasharray="4 4"/>
                <Tooltip
                  cursor={{stroke:"var(--ink-3)",strokeOpacity:.65,strokeDasharray:"4 4"}}
                  labelFormatter={label => tab === "ticker" ? String(label) : dateFmt(String(label))}
                  formatter={(value:number) => [tab === "activity" ? value.toLocaleString() : (mainUnit || "—") + " " + fmt(value), mainTitle]}
                  contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle}
                />
                {chartStyle === "area"
                  ? <Area key={tab + "-area"} dataKey="value" name={mainTitle} type="monotone" stroke="var(--color-accent)" strokeWidth={2.6} strokeLinecap="round" fill="url(#psxl-cashflow-fill)" dot={mainData.length <= 12 ? {r:3,fill:"var(--color-accent)",strokeWidth:0} : false} activeDot={{r:6,stroke:"var(--color-sheet)",strokeWidth:2}} connectNulls isAnimationActive={false}/>
                  : chartStyle === "line"
                    ? <Line key={tab + "-line"} dataKey="value" name={mainTitle} type="monotone" stroke="var(--color-accent)" strokeWidth={2.6} strokeLinecap="round" dot={mainData.length <= 12 ? {r:3,fill:"var(--color-accent)",strokeWidth:0} : false} activeDot={{r:6,stroke:"var(--color-sheet)",strokeWidth:2}} connectNulls isAnimationActive animationBegin={80} animationDuration={1100} animationEasing="ease-out"/>
                    : <Bar key={tab + "-bars"} dataKey="value" name={mainTitle} barSize={tab === "ticker" ? 34 : 12} radius={[4,4,0,0]} isAnimationActive={false}>{mainData.map((point,index)=><Cell key={point.label + index} fill={point.value >= 0 ? "var(--ok)" : "var(--bad)"}/>)}</Bar>
                }
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="text-[10px] leading-4" style={{color:"var(--ink-3)"}}>Only posted ledger records affect financial totals. Records awaiting review are counted separately and excluded until approved. Cash flow is not the same as realized FIFO profit or market-valued equity.</p>
      </> : <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed px-6 text-center text-sm" style={{borderColor:"var(--hairline)",color:"var(--ink-3)"}}>No posted transactions in this currency and time range. Choose another currency or timeframe.</div>}
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <div className="rounded-lg p-4" style={card}>
        <div className="mb-2"><h3 className="text-sm font-semibold">Monthly cash-flow trend</h3><p className="text-[11px]" style={{color:"var(--ink-3)"}}>{monthlyChartDescription}</p></div>
        <ResponsiveContainer
          key={`monthly-chart-${monthlyChartData.length}-${filtered.length}`}
          width="100%"
          height={230}
          debounce={80}
        >
          <ComposedChart data={monthlyChartData} margin={{top:8,right:8,left:2,bottom:4}}><CartesianGrid vertical={false} stroke="var(--hairline)" strokeDasharray="3 4"/><XAxis dataKey="month" tickFormatter={(value, index) => monthlyChartData.length > 1 && data.monthly.length <= 1 && index > 0 && monthlyChartData[index - 1]?.month === value ? "" : String(value).slice(0, 7) === String(value) && String(value).length === 7 ? String(value) : String(value).slice(5)} interval="preserveStartEnd" minTickGap={24} tick={{fontSize:10,fill:"var(--ink-3)"}} axisLine={false} tickLine={false}/><YAxis tickFormatter={fmt} width={64} tick={{fontSize:10,fill:"var(--ink-3)"}} axisLine={false} tickLine={false}/><Tooltip labelFormatter={value => String(value)} formatter={(v:number,name:string)=>[(activeCurrency||"—")+" "+fmt(v),name]} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle}/><ReferenceLine y={0} stroke="var(--ink-3)" strokeOpacity={.45}/><Bar dataKey="netFlow" name={data.monthly.length > 1 ? "Monthly net flow" : "Transaction net flow"} fill="var(--color-accent)" radius={[4,4,0,0]} maxBarSize={34} isAnimationActive animationDuration={850} animationEasing="ease-out"/><Line dataKey="cumulative" name="Cumulative ledger flow" type="monotone" stroke="#2563EB" strokeWidth={2.6} dot={{r:3,fill:"#2563EB",strokeWidth:0}} activeDot={{r:6}} connectNulls isAnimationActive animationDuration={1000} animationEasing="ease-out"/></ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="rounded-lg p-4" style={card}>
        <div className="mb-2"><h3 className="text-sm font-semibold">Ticker cash-flow ranking</h3><p className="text-[11px]" style={{color:"var(--ink-3)"}}>Sell proceeds + dividends − purchases</p></div>
        <ResponsiveContainer key={`ticker-ranking-${data.tickerRows.length}-${filtered.length}`} width="100%" height={250} debounce={80}>
          <BarChart data={data.tickerRows.slice(0,8)} layout="vertical" margin={{left:8,right:12}}><CartesianGrid horizontal={false} stroke="var(--hairline)" strokeDasharray="3 4"/><XAxis type="number" tickFormatter={fmt} tick={{fontSize:10,fill:"var(--ink-3)"}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="ticker" width={118} tick={{fontSize:10,fill:"var(--ink-3)"}} axisLine={false} tickLine={false}/><ReferenceLine x={0} stroke="var(--ink-3)" strokeOpacity={0.4}/><Tooltip formatter={(v:number)=>[(activeCurrency||"—")+" "+fmt(v)]} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle}/><Bar dataKey="netCash" name="Net cash flow" radius={[0,4,4,0]} isAnimationActive animationDuration={850} animationEasing="ease-out">{data.tickerRows.slice(0,8).map((item,i)=><Cell key={item.ticker} fill={item.netCash>=0?"#059669":"#DC2626"}/>)}</Bar></BarChart>
        </ResponsiveContainer>
      </div>
      <div className="rounded-lg p-4" style={card}>
        <div className="mb-2"><h3 className="text-sm font-semibold">Transaction mix</h3><p className="text-[11px]" style={{color:"var(--ink-3)"}}>Posted buy, sell and dividend records</p></div>
        <ResponsiveContainer key={`transaction-mix-${data.actionCounts.length}-${filtered.length}`} width="100%" height={250} debounce={80}>
          <PieChart><Pie data={data.actionCounts} dataKey="count" nameKey="action" innerRadius={54} outerRadius={86} paddingAngle={3}>{data.actionCounts.map((item,i)=><Cell key={item.action} fill={["#2563EB","#059669","#A78BFA"][i%3]}/>)}</Pie><Tooltip formatter={(v:number)=>[v,"Records"]} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle}/><Legend wrapperStyle={{fontSize:10,color:"var(--ink-3)"}}/></PieChart>
        </ResponsiveContainer>
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-md p-4" style={{...card,background:"var(--color-login-bg)"}}><p className="text-xs" style={{color:"var(--ink-3)"}}>Recorded trades</p><p className="tnum mt-1 text-xl font-semibold">{filtered.filter(t=>t.action!=="DIV").length}</p><p className="mt-1 text-[10px]" style={{color:"var(--ink-3)"}}>Filtered posted BUY / SELL events</p></div>
      <div className="rounded-md p-4" style={{...card,background:"var(--color-login-bg)"}}><p className="text-xs" style={{color:"var(--ink-3)"}}>Net cash flow</p><p className="tnum mt-1 text-xl font-semibold" style={{color:data.equity.at(-1)?.cumulative>=0?"var(--ok)":"var(--bad)"}}>{activeCurrency || "—"} {fmt(data.equity.at(-1)?.cumulative||0)}</p><p className="mt-1 text-[10px]" style={{color:"var(--ink-3)"}}>Sell proceeds + dividends − buys and recorded fees</p></div>
      <div className="rounded-md p-4" style={{...card,background:"var(--color-login-bg)"}}><p className="text-xs" style={{color:"var(--ink-3)"}}>Dividend receipts</p><p className="tnum mt-1 text-xl font-semibold">{activeCurrency || "—"} {fmt(data.divs.reduce((s,d)=>s+d.dividends,0))}</p><p className="mt-1 text-[10px]" style={{color:"var(--ink-3)"}}>Recorded dividends after WHT</p></div>
    </div>
    <div className="rounded-lg p-4 sm:p-5" style={{...card,background:"linear-gradient(145deg,color-mix(in oklch,var(--color-accent) 5%,var(--color-sheet)),var(--color-sheet))"}}>
      <div className="mb-3 flex items-center gap-2"><Calculator size={15} style={{color:"var(--color-accent)"}}/><h3 className="text-sm font-semibold">Position sizing & risk calculator</h3><span className="ml-auto text-[10px]" style={{color:"var(--ink-3)"}}>Interactive · illustrative</span></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs" style={{color:"var(--ink-3)"}}>Capital ({activeCurrency || "—"})<input type="number" value={capital} onChange={e=>setCapital(e.target.value)} className="mt-1 w-full rounded-lg px-3 py-2 text-sm" style={card}/></label>
        <label className="text-xs" style={{color:"var(--ink-3)"}}>Risk %<input type="number" min="0" max="100" step=".1" value={riskPct} onChange={e=>setRiskPct(e.target.value)} className="mt-1 w-full rounded-lg px-3 py-2 text-sm" style={card}/></label>
        <label className="text-xs" style={{color:"var(--ink-3)"}}>Entry price<input type="number" min="0" step=".01" value={entry} onChange={e=>setEntry(e.target.value)} className="mt-1 w-full rounded-lg px-3 py-2 text-sm" style={card}/></label>
        <label className="text-xs" style={{color:"var(--ink-3)"}}>Stop price<input type="number" min="0" step=".01" value={stop} onChange={e=>setStop(e.target.value)} className="mt-1 w-full rounded-lg px-3 py-2 text-sm" style={card}/></label>
        <div className="rounded-lg p-3" style={{background:"var(--color-login-bg)"}}><p className="text-[10px]" style={{color:"var(--ink-3)"}}>Max shares by risk</p><p className="tnum text-lg font-semibold">{Number.isFinite(size)&&size>0?size.toLocaleString():"—"}</p><p className="text-[10px]" style={{color:"var(--ink-3)"}}>Risk budget: {activeCurrency || "—"} {fmt(Math.max(0,riskAmount))}</p></div>
      </div>
      <p className="mt-3 text-[10px]" style={{color:"var(--ink-3)"}}>Position size = risk budget ÷ absolute entry-to-stop distance. This does not include lot sizes, liquidity, fees, gaps, or personal suitability. Analytics are ledger-derived; cumulative cash flow is not a true broker equity curve or realized FIFO P&L.</p>
    </div>
  </section>;
}
