import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { Calculator, Download, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { computeTax, type Jurisdiction } from "@/lib/tax";
import { currencyForExchange } from "@/lib/market-currency";
import type { Transaction } from "@/lib/demo-data";

type Props = { transactions: Transaction[]; isLoading?: boolean };
const csvCell = (value: unknown) => '"' + String(value ?? "").replace(/"/g, '""') + '"';
function formatMoney(value: number, currency: string) {
  try { return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `${currency} ${Math.round(value).toLocaleString()}`; }
}
function downloadTaxReturn(filename: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}

export function PortfolioTaxReturns({ transactions, isLoading = false }: Props) {
  const { profile } = useAuth();
  const [customRules, setCustomRules] = useState<{ short: number; long: number; days: number } | null>(null);
  const [customRulesLoading, setCustomRulesLoading] = useState(false);
  useEffect(() => {
    if (!profile?.org_id) return;
    let cancelled = false;
    setCustomRulesLoading(true);
    void supabase.from("tax_profiles").select("cgt_rules").eq("org_id", profile.org_id).eq("jurisdiction", "CUSTOM").order("created_at", { ascending: false }).limit(1).maybeSingle().then(({ data }) => {
      if (cancelled) return;
      const rules = (data?.cgt_rules ?? {}) as Record<string, unknown>;
      const short = Number(rules.short_term_rate_percent);
      const long = Number(rules.long_term_rate_percent);
      const days = Number(rules.long_term_days);
      setCustomRules(Number.isFinite(short) && Number.isFinite(long) && Number.isInteger(days) && short >= 0 && short <= 100 && long >= 0 && long <= 100 && days >= 1 ? { short, long, days } : null);
      setCustomRulesLoading(false);
    }).catch(() => { if (!cancelled) { setCustomRules(null); setCustomRulesLoading(false); } });
    return () => { cancelled = true; };
  }, [profile?.org_id]);

  const currencies = useMemo(() => [...new Set(transactions.map(t => t.currency ?? currencyForExchange(t.exchange)).filter(c => c && c !== "MIXED"))].sort(), [transactions]);
  const years = useMemo(() => [...new Set(transactions.map(t => t.trade_date.slice(0, 4)).filter(y => /^\\d{4}$/.test(y)))].sort((a, b) => b.localeCompare(a)), [transactions]);
  const [year, setYear] = useState("");
  const [currency, setCurrency] = useState("");
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>("PSX");
  const [filerStatus, setFilerStatus] = useState<"Filer" | "Non-Filer">("Filer");
  const activeYear = years.includes(year) ? year : years[0] ?? String(new Date().getFullYear());
  const activeCurrency = currencies.includes(currency) ? currency : currencies[0] ?? "PKR";
  const yearRecords = useMemo(() => transactions.filter(t => t.trade_date.startsWith(activeYear) && (t.currency ?? currencyForExchange(t.exchange)) === activeCurrency), [transactions, activeYear, activeCurrency]);
  const posted = useMemo(() => transactions.filter(t => t.status === "posted" && (t.currency ?? currencyForExchange(t.exchange)) === activeCurrency), [transactions, activeCurrency]);
  const tax = useMemo(() => computeTax(posted, {
    jurisdiction, filerStatus, taxYear: activeYear,
    customShortTermRate: (customRules?.short ?? 0) / 100,
    customLongTermRate: (customRules?.long ?? 0) / 100,
    customLongTermDays: customRules?.days ?? 365,
  }), [posted, jurisdiction, filerStatus, activeYear, customRules]);
  const postedYear = yearRecords.filter(t => t.status === "posted");
  const awaitingReview = yearRecords.length - postedYear.length;
  const buys = postedYear.filter(t => t.action === "BUY").length;
  const sells = postedYear.filter(t => t.action === "SELL").length;
  const dividends = postedYear.filter(t => t.action === "DIV").length;
  const purchaseValue = postedYear.filter(t => t.action === "BUY").reduce((sum, t) => sum + t.quantity * t.price + t.fees, 0);
  const saleProceeds = postedYear.filter(t => t.action === "SELL").reduce((sum, t) => sum + t.quantity * t.price - t.fees, 0);
  const dividendIncome = postedYear.filter(t => t.action === "DIV").reduce((sum, t) => sum + t.quantity * t.price, 0);

  function exportReturn() {
    const rows: unknown[][] = [
      ["PSXL TAX RETURN WORKPAPER — NOT AN OFFICIAL FILING"], ["Tax year", activeYear],
      ["Jurisdiction", jurisdiction], ["Filer status", filerStatus], ["Currency", activeCurrency],
      ["Posted records", postedYear.length], ["Awaiting review", awaitingReview],
      ["Purchases", purchaseValue], ["Sale proceeds", saleProceeds], ["Dividend income", dividendIncome],
      ["Short-term gains", tax.shortTermGain], ["Long-term gains", tax.longTermGain],
      ["Total realized gains", tax.totalGain], ["Dividend withholding tax", tax.dividendWHT],
      ["Estimated capital gains tax", tax.estimatedTaxDue], ["Computed at", tax.computedAt], [],
      ["Ticker", "Exchange", "Buy date", "Sell date", "Quantity", "Cost basis", "Sale price", "Holding days", "Gain", "Tax rate", "Tax due"],
      ...tax.lots.map(lot => [lot.ticker, lot.exchange, lot.buyDate, lot.sellDate, lot.quantity, lot.costBasis, lot.salePrice, lot.holdingDays, lot.gain, lot.taxRate, lot.taxDue]),
    ];
    downloadTaxReturn(`psxl-tax-return-workpaper-${jurisdiction}-${activeYear}.csv`, rows);
  }
  const cardStyle = { border: "1px solid var(--hairline)", background: "var(--color-sheet)" };
  const muted = { color: "var(--ink-2)" }; const subtle = { color: "var(--ink-3)" };

  return <section className="space-y-5 rounded-2xl border p-4 sm:p-6" style={cardStyle}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--accent-10)" }}><Calculator size={19} style={{ color: "var(--color-accent)" }} /></div><div><h2 className="text-lg font-semibold tracking-tight">Tax calculations & returns</h2><p className="mt-1 text-xs" style={subtle}>Automatically calculated from your posted ledger transactions.</p></div></div>
      <button type="button" onClick={exportReturn} disabled={isLoading || postedYear.length === 0 || (jurisdiction === "CUSTOM" && !customRules)} className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" style={{ background: "var(--color-accent)" }}><Download size={14} /> Export tax workpaper</button>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs font-medium" style={muted}>Tax year<select value={activeYear} onChange={e => setYear(e.target.value)} className="mt-1.5 w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm" style={{ borderColor: "var(--hairline)", color: "var(--color-text)" }}>{(years.length ? years : [activeYear]).map(y => <option key={y} value={y}>{y}</option>)}</select></label>
      <label className="text-xs font-medium" style={muted}>Market / tax rules<select value={jurisdiction} onChange={e => setJurisdiction(e.target.value as Jurisdiction)} className="mt-1.5 w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm" style={{ borderColor: "var(--hairline)", color: "var(--color-text)" }}><option value="PSX">Pakistan · PSX</option><option value="NSE">India · NSE</option><option value="CUSTOM">Custom rules</option></select></label>
      <label className="text-xs font-medium" style={muted}>Currency<select value={activeCurrency} onChange={e => setCurrency(e.target.value)} className="mt-1.5 w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm" style={{ borderColor: "var(--hairline)", color: "var(--color-text)" }}>{(currencies.length ? currencies : [activeCurrency]).map(c => <option key={c} value={c}>{c}</option>)}</select></label>
    </div>
    {jurisdiction === "CUSTOM" && <div className="rounded-xl border p-3 text-xs" style={{ borderColor: "var(--hairline)", ...muted }}>
      {customRulesLoading ? "Loading saved custom tax rules…" : customRules ? `Using saved custom rates: short-term ${customRules.short}%, long-term ${customRules.long}%, threshold ${customRules.days} days.` : <>No custom rates are saved yet. <Link to="/app/tax" className="font-semibold underline" style={{ color: "var(--color-accent)" }}>Configure tax rules</Link> before using this estimate.</>}
    </div>}
    {jurisdiction === "PSX" && <div className="flex flex-wrap items-center gap-3 text-xs" style={muted}><span>Filer status</span><div className="flex rounded-lg border p-0.5" style={{ borderColor: "var(--hairline)" }}>{(["Filer", "Non-Filer"] as const).map(status => <button key={status} type="button" onClick={() => setFilerStatus(status)} className="rounded-md px-3 py-1.5 font-semibold" style={{ background: filerStatus === status ? "var(--sidebar-accent)" : "transparent", color: filerStatus === status ? "var(--color-text)" : "var(--ink-3)" }}>{status}</button>)}</div></div>}
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--hairline)", background: "var(--color-login-bg)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Ledger status</p><span className="text-xs" style={subtle}>{isLoading ? "Syncing…" : `${yearRecords.length} records · ${activeYear} · ${activeCurrency}`}</span></div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={muted}><span>{postedYear.length} posted</span><span>{awaitingReview} awaiting review</span><span>{buys} buys</span><span>{sells} sells</span><span>{dividends} dividends</span><span>{tax.lots.length} FIFO matches</span></div>
      {awaitingReview > 0 && <p className="mt-2 text-xs" style={{ color: "var(--warn)" }}>{awaitingReview} record(s) are excluded until approved in Review Inbox.</p>}
      {postedYear.length > 0 && sells === 0 && <p className="mt-2 text-xs" style={subtle}>No sales are recorded for this period. Realized capital gains are therefore zero; open buy positions are unrealized.</p>}
      {sells > 0 && tax.lots.length === 0 && <p className="mt-2 text-xs" style={{ color: "var(--warn)" }}>Sales exist but no FIFO lots matched. Check that earlier buys are posted and match ticker, exchange and currency.</p>}
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: "Realized gains", value: formatMoney(tax.totalGain, activeCurrency), note: "FIFO-matched disposals" },
        { label: "Short-term gains", value: formatMoney(tax.shortTermGain, activeCurrency), note: "Below holding threshold" },
        { label: "Long-term gains", value: formatMoney(tax.longTermGain, activeCurrency), note: "At / above holding threshold" },
        { label: "Estimated CGT", value: jurisdiction === "CUSTOM" && !customRules ? "Configure rules" : formatMoney(tax.estimatedTaxDue, activeCurrency), note: "Indicative calculation" },
      ].map(item => <div key={item.label} className="rounded-xl border p-4" style={cardStyle}><p className="text-xs" style={subtle}>{item.label}</p><p className="tnum mt-2 text-xl font-semibold">{item.value}</p><p className="mt-1 text-[11px]" style={subtle}>{item.note}</p></div>)}
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[{ label: "Purchases", value: formatMoney(purchaseValue, activeCurrency) }, { label: "Sale proceeds", value: formatMoney(saleProceeds, activeCurrency) }, { label: "Dividend income", value: formatMoney(dividendIncome, activeCurrency) }, { label: "Posted records", value: String(postedYear.length) }].map(item => <div key={item.label} className="rounded-xl p-3" style={{ background: "var(--color-login-bg)" }}><p className="text-xs" style={subtle}>{item.label}</p><p className="tnum mt-1 text-sm font-semibold">{item.value}</p></div>)}
    </div>
    <div className="overflow-x-auto">
      <div className="mb-2 flex items-center gap-2"><FileSpreadsheet size={15} style={{ color: "var(--color-accent)" }} /><h3 className="text-sm font-semibold">Tax return schedule · FIFO disposals</h3></div>
      <table className="w-full min-w-[720px] text-xs"><thead><tr className="text-left" style={subtle}>{["Ticker", "Buy date", "Sell date", "Qty", "Holding days", "Gain", "Tax"].map(label => <th key={label} className="border-b px-2 py-2 font-medium" style={{ borderColor: "var(--hairline)" }}>{label}</th>)}</tr></thead>
        <tbody>{tax.lots.slice(0, 100).map((lot, index) => <tr key={`${lot.ticker}-${lot.sellDate}-${index}`} className="border-b" style={{ borderColor: "var(--hairline)" }}><td className="px-2 py-2.5 font-semibold">{lot.ticker}</td><td className="px-2 py-2.5">{lot.buyDate}</td><td className="px-2 py-2.5">{lot.sellDate}</td><td className="px-2 py-2.5 text-right">{lot.quantity}</td><td className="px-2 py-2.5 text-right">{lot.holdingDays}</td><td className="px-2 py-2.5 text-right tnum">{formatMoney(lot.gain, activeCurrency)}</td><td className="px-2 py-2.5 text-right tnum">{formatMoney(lot.taxDue, activeCurrency)}</td></tr>)}</tbody>
      </table>
      {tax.lots.length === 0 && <p className="py-7 text-center text-sm" style={subtle}>No realized sales matched for this period. Your ledger will update this schedule automatically when posted sales are recorded.</p>}
    </div>
    <div className="flex items-start gap-2 rounded-xl border p-3 text-xs leading-5" style={{ borderColor: "var(--hairline)", ...muted }}><ShieldCheck size={15} className="mt-0.5 shrink-0" style={{ color: "var(--color-accent)" }} /><p><strong>Preparation only:</strong> This CSV is a tax workpaper, not an official return or filing. Tax rules, fiscal-year treatment, filer status and exemptions must be verified for the applicable year. PSXL does not submit returns to FBR or another tax authority.</p></div>
  </section>;
}
