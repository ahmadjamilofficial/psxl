import { brandText } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Info,
  Leaf,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Btn, Panel, reveal, StatusPill } from "@/components/kit";
import { useAuth } from "@/lib/auth-context";
import { useTransactions } from "@/lib/data-hooks";
import { computeTax, suggestHarvesting, type Jurisdiction } from "@/lib/tax";
import { useLedgerContext } from "@/lib/use-ledger-context";
import { currencyForExchange } from "@/lib/market-currency";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/app/tax")({
  component: TaxCenter,
});

function TaxCenter() {
  const { profile } = useAuth();
  const { jurisdiction: detectedJ, taxYear: currentYear, currency: detectedCurrency } = useLedgerContext();

  const [jurisdiction, setJurisdiction] = useState<Jurisdiction | null>(null);
  const [filerStatus, setFilerStatus] = useState<"Filer" | "Non-Filer">("Filer");
  const [taxYear, setTaxYear] = useState<string | null>(null);
  const [taxCurrency, setTaxCurrency] = useState<string | null>(null);
  const [customShortTermRate, setCustomShortTermRate] = useState("");
  const [customLongTermRate, setCustomLongTermRate] = useState("");
  const [customLongTermDays, setCustomLongTermDays] = useState("365");
  const [customTaxProfileId, setCustomTaxProfileId] = useState<string | null>(null);
  const [customRatesLoading, setCustomRatesLoading] = useState(false);
  const [savingCustomRates, setSavingCustomRates] = useState(false);
  const [customRatesMessage, setCustomRatesMessage] = useState<string | null>(null);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);

  const { data: transactions = [] } = useTransactions(profile?.org_id);

  useEffect(() => {
    if (!profile?.org_id) return;
    let cancelled = false;
    setCustomRatesLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("tax_profiles")
        .select("id, cgt_rules")
        .eq("org_id", profile.org_id)
        .eq("jurisdiction", "CUSTOM")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setCustomRatesMessage("Could not load saved custom tax rules.");
      } else if (data) {
        const rules = (data.cgt_rules ?? {}) as Record<string, unknown>;
        setCustomTaxProfileId(data.id);
        if (rules.short_term_rate_percent != null) setCustomShortTermRate(String(rules.short_term_rate_percent));
        if (rules.long_term_rate_percent != null) setCustomLongTermRate(String(rules.long_term_rate_percent));
        if (rules.long_term_days != null) setCustomLongTermDays(String(rules.long_term_days));
        setCustomRatesMessage("Saved custom tax rules loaded.");
      }
      setCustomRatesLoading(false);
    })();
    return () => { cancelled = true; };
  }, [profile?.org_id]);

  async function saveCustomTaxRules() {
    if (!profile?.org_id) return;
    const shortRate = Number(customShortTermRate);
    const longRate = Number(customLongTermRate);
    const longDays = Number(customLongTermDays);
    if (
      customShortTermRate.trim() === "" ||
      customLongTermRate.trim() === "" ||
      !Number.isFinite(shortRate) || shortRate < 0 || shortRate > 100 ||
      !Number.isFinite(longRate) || longRate < 0 || longRate > 100 ||
      !Number.isInteger(longDays) || longDays < 1 || longDays > 3650
    ) {
      setCustomRatesMessage("Enter valid CGT rates from 0–100% and a holding period from 1–3650 days.");
      return;
    }

    setSavingCustomRates(true);
    setCustomRatesMessage(null);
    const cgtRules = {
      short_term_rate_percent: shortRate,
      long_term_rate_percent: longRate,
      long_term_days: longDays,
    };
    try {
      if (customTaxProfileId) {
        const { error } = await supabase
          .from("tax_profiles")
          .update({ cgt_rules: cgtRules })
          .eq("id", customTaxProfileId)
          .eq("org_id", profile.org_id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("tax_profiles")
          .insert({
            org_id: profile.org_id,
            jurisdiction: "CUSTOM",
            filer_status: filerStatus,
            cgt_rules: cgtRules,
          })
          .select("id")
          .single();
        if (error) throw error;
        setCustomTaxProfileId(data.id);
      }
      setCustomRatesMessage("Custom tax rules saved to your organisation.");
    } catch (error) {
      setCustomRatesMessage(error instanceof Error ? error.message : "Could not save custom tax rules.");
    } finally {
      setSavingCustomRates(false);
    }
  }

  // Tax computations must never add gains from different currencies together.
  const activeJurisdiction = jurisdiction ?? detectedJ;
  const detectedCurrencies = [...new Set(transactions.map((transaction) => transaction.currency ?? currencyForExchange(transaction.exchange)).filter((value) => value && value !== "MIXED"))].sort();
  const currencyOptions = detectedCurrencies.length ? detectedCurrencies : [detectedCurrency !== "MIXED" ? detectedCurrency : "USD"];
  const activeCurrency = taxCurrency ?? (currencyOptions.includes(detectedCurrency) ? detectedCurrency : currencyOptions[0] ?? "USD");
  const taxTransactions = transactions.filter((transaction) => (transaction.currency ?? currencyForExchange(transaction.exchange)) === activeCurrency);
  const transactionYears = [...new Set(taxTransactions.map((transaction) => transaction.trade_date.slice(0, 4)).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
  const defaultTaxYear = transactionYears[0] ?? currentYear;
  const activeYear = taxYear ?? defaultTaxYear;
  const customRatesConfigured = activeJurisdiction !== "CUSTOM" || (customShortTermRate.trim() !== "" && customLongTermRate.trim() !== "" && Number.isFinite(Number(customShortTermRate)) && Number.isFinite(Number(customLongTermRate)) && Number(customShortTermRate) >= 0 && Number(customShortTermRate) <= 100 && Number(customLongTermRate) >= 0 && Number(customLongTermRate) <= 100);
  const availableTaxYears = [...new Set([currentYear, ...transactionYears])].sort((a, b) => Number(b) - Number(a));

  const tax = computeTax(taxTransactions, {
    jurisdiction: activeJurisdiction,
    filerStatus,
    taxYear: activeYear,
    customShortTermRate: Number(customShortTermRate) / 100,
    customLongTermRate: Number(customLongTermRate) / 100,
    customLongTermDays: Number(customLongTermDays) || 365,
  });
  const harvest: ReturnType<typeof suggestHarvesting> = []; // No fabricated quote feed: harvesting requires verified current prices and jurisdiction-specific loss rules.
  const yearTransactions = taxTransactions.filter((transaction) => transaction.status === "posted" && transaction.trade_date.startsWith(activeYear));
  const purchaseValue = yearTransactions.filter((transaction) => transaction.action === "BUY").reduce((sum, transaction) => sum + transaction.quantity * transaction.price + transaction.fees, 0);
  const saleProceeds = yearTransactions.filter((transaction) => transaction.action === "SELL").reduce((sum, transaction) => sum + transaction.quantity * transaction.price - transaction.fees, 0);
  const dividendIncome = yearTransactions.filter((transaction) => transaction.action === "DIV").reduce((sum, transaction) => sum + transaction.quantity * transaction.price, 0);

  async function getAIExplanation() {
    setLoadingAI(true);
    try {
      const resp = await fetch("/api/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt:
            "You are a global securities tax analyst. Explain only the tax rules and assumptions supplied in the computation. Never invent jurisdiction-specific tax law. Clearly state when custom rates are user-configured. Be concise and practical.",
          userPrompt: `Tax computation for ${activeJurisdiction} in ${activeCurrency} — Filer status: ${filerStatus}\nShort-term gain: ${tax.shortTermGain}\nLong-term gain: ${tax.longTermGain}\nEstimated tax due: ${tax.estimatedTaxDue}\nTax year: ${activeYear}`,
        }),
      });
      let explanation = "";
      if (resp.ok) {
        const reader = resp.body?.getReader();
        const decoder = new TextDecoder();
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            explanation += decoder.decode(value, { stream: true });
          }
        }
      }
      setAiExplanation(explanation || "AI explanation unavailable.");
    } catch {
      setAiExplanation("AI explanation unavailable. Please try again.");
    } finally {
      setLoadingAI(false);
    }
  }

  const fmt = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 0 });

  const currency = activeCurrency;

  return (
    <div className="space-y-6 p-3 sm:p-6">
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: "1.5rem" }}>Tax Center</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Traceable FIFO calculations with clear assumptions. AI never invents your tax rates.
        </p>
      </div>

      <div
        className="rounded-xl px-4 py-3 text-sm"
        role="note"
        style={{ background: "var(--accent-6)", border: "1px solid var(--accent-15)", color: "var(--ink-2)" }}
      >
        <p className="font-semibold" style={{ color: "var(--color-text)" }}>
          {detectedJ === "PSX" ? "Pakistan · PSX market detected" : detectedJ === "NSE" ? "India · NSE market detected" : "Market not yet supported for automatic tax rules"}
        </p>
        <p className="mt-1 text-xs leading-relaxed">
          Your market is inferred from imported trades. Your tax residence can be different from the exchange country, so confirm the correct tax jurisdiction before using an estimate. Automatic rule sets are currently limited to PSX and NSE; other markets need verified local rules or a custom profile.
        </p>
      </div>

      {/* Controls */}
      <Panel>
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
              Tax year
            </label>
            <select
              value={activeYear}
              onChange={(e) => setTaxYear(e.target.value)}
              className="rounded-[10px] border bg-surface px-3 py-2.5 text-sm outline-none"
              style={{ borderColor: "var(--hairline)" }}
            >
              {availableTaxYears.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>Reporting currency</label>
            <select value={activeCurrency} onChange={(e) => setTaxCurrency(e.target.value)} className="rounded-[10px] border bg-surface px-3 py-2.5 text-sm outline-none" style={{ borderColor: "var(--hairline)" }}>
              {currencyOptions.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
              Tax rule set / market
            </label>
            <select
              value={activeJurisdiction}
              onChange={(e) => setJurisdiction(e.target.value as Jurisdiction)}
              className="rounded-[10px] border bg-surface px-3 py-2.5 text-sm outline-none"
              style={{ borderColor: "var(--hairline)" }}
            >
              <option value="PSX">PSX — Pakistan</option>
              <option value="NSE">NSE — India</option>
              <option value="CUSTOM">Other market — configure custom rules</option>
            </select>
          </div>
          {activeJurisdiction === "PSX" && (
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
                Filer status
              </label>
              <select
                value={filerStatus}
                onChange={(e) => setFilerStatus(e.target.value as "Filer" | "Non-Filer")}
                className="rounded-[10px] border bg-surface px-3 py-2.5 text-sm outline-none"
                style={{ borderColor: "var(--hairline)" }}
              >
                <option>Filer</option>
                <option>Non-Filer</option>
              </select>
            </div>
          )}
          {activeJurisdiction === "CUSTOM" && (
            <div className="grid min-w-[260px] flex-1 gap-3 sm:grid-cols-3">
              <label className="text-xs font-medium" style={{ color: "var(--ink-2)" }}>
                Short-term CGT % (local rule)
                <input type="number" min="0" max="100" step="0.1" value={customShortTermRate} onChange={(e) => setCustomShortTermRate(e.target.value)} className="mt-1 w-full rounded-[10px] border bg-surface px-3 py-2.5 text-sm" style={{ borderColor: "var(--hairline)" }} />
              </label>
              <label className="text-xs font-medium" style={{ color: "var(--ink-2)" }}>
                Long-term CGT % (local rule)
                <input type="number" min="0" max="100" step="0.1" value={customLongTermRate} onChange={(e) => setCustomLongTermRate(e.target.value)} className="mt-1 w-full rounded-[10px] border bg-surface px-3 py-2.5 text-sm" style={{ borderColor: "var(--hairline)" }} />
              </label>
              <label className="text-xs font-medium" style={{ color: "var(--ink-2)" }}>
                Long-term after (days)
                <input type="number" min="1" max="3650" step="1" value={customLongTermDays} onChange={(e) => setCustomLongTermDays(e.target.value)} className="mt-1 w-full rounded-[10px] border bg-surface px-3 py-2.5 text-sm" style={{ borderColor: "var(--hairline)" }} />
              </label>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
                <Btn onClick={saveCustomTaxRules} disabled={savingCustomRates || customRatesLoading}>
                  {savingCustomRates ? "Saving rules…" : customRatesLoading ? "Loading saved rules…" : "Save custom tax rules"}
                </Btn>
                {customRatesMessage && (
                  <p className="text-xs" role="status" style={{ color: customRatesMessage.includes("Could not") || customRatesMessage.includes("Enter valid") ? "var(--bad)" : "var(--ink-2)" }}>
                    {customRatesMessage}
                  </p>
                )}
              </div>
            </div>
          )}
          <div className="flex items-end ml-auto">
            <Btn variant="secondary" onClick={() => {
              const rows = [
                [brandText("{{brand}} Tax Report"), "Value"],
                ["Tax year", activeYear],
                ["Jurisdiction", activeJurisdiction],
                ["Filer status", filerStatus],
                ["Currency", currency],
                ["Short-term gain", tax.shortTermGain],
                ["Long-term gain", tax.longTermGain],
                ["Total gain", tax.totalGain],
                ["Dividend withholding tax", tax.dividendWHT],
                ["Estimated tax due", tax.estimatedTaxDue],
                ["Computed at", tax.computedAt],
                [],
                ["Ticker", "Exchange", "Buy date", "Sell date", "Quantity", "Cost basis", "Sale price", "Holding days", "Gain", "Tax rate", "Tax due"],
                ...tax.lots.map((lot) => [lot.ticker, lot.exchange, lot.buyDate, lot.sellDate, lot.quantity, lot.costBasis, lot.salePrice, lot.holdingDays, lot.gain, lot.taxRate, lot.taxDue]),
              ];
              const csv = rows.map((row) => row.map((cell) => {
                const value = String(cell ?? "");
                return '"' + value.replace(/"/g, '""') + '"';
              }).join(",")).join("\r\n");
              const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `psxl-tax-report-${activeJurisdiction}-${activeYear}.csv`;
              document.body.appendChild(anchor);
              anchor.click();
              anchor.remove();
              URL.revokeObjectURL(url);
            }}>
              <Download size={15} strokeWidth={1.75} />
              Generate Tax Report
            </Btn>
          </div>
        </div>
      </Panel>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            label: "Short-term Gain",
            value: `${currency} ${fmt(tax.shortTermGain)}`,
            sublabel: !customRatesConfigured ? "Configure custom rules" : tax.shortTermGain > 0 ? `${((tax.shortTermTax / tax.shortTermGain) * 100).toFixed(1)}% effective` : "No realised taxable gain",
            tone: tax.shortTermGain >= 0 ? ("ok" as const) : ("bad" as const),
            i: 0,
          },
          {
            label: "Long-term Gain",
            value: `${currency} ${fmt(tax.longTermGain)}`,
            sublabel: !customRatesConfigured ? "Configure custom rules" : tax.longTermGain > 0 ? `${((tax.longTermTax / tax.longTermGain) * 100).toFixed(1)}% effective` : "No realised taxable gain",
            tone: tax.longTermGain >= 0 ? ("ok" as const) : ("bad" as const),
            i: 1,
          },
          {
            label: "Dividend WHT",
            value: `${currency} ${fmt(tax.dividendWHT)}`,
            sublabel: "Already withheld",
            tone: "info" as const,
            i: 2,
          },
          {
            label: "Estimated Tax Due",
            value: customRatesConfigured ? `${currency} ${fmt(tax.estimatedTaxDue)}` : "Configure rates",
            sublabel: customRatesConfigured ? "FIFO · deterministic estimate" : "No tax estimate until rates are entered",
            tone: "warn" as const,
            i: 3,
          },
        ].map(({ label, value, sublabel, tone, i }) => (
          <motion.div key={label} variants={reveal} custom={i} initial="hidden" animate="visible">
            <Panel>
              <p className="text-xs" style={{ color: "var(--ink-2)" }}>
                {label}
              </p>
              <p className="tnum mt-1.5 text-xl font-semibold">{value}</p>
              <StatusPill tone={tone} className="mt-2">
                {sublabel}
              </StatusPill>
            </Panel>
          </motion.div>
        ))}
      </div>

      <Panel>
        <div className="mb-4">
          <p className="text-sm font-semibold">Ledger activity · {activeYear}</p>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>Actual posted records in {activeCurrency} for the selected year. Other currencies are calculated separately. Buy-only activity does not create a realised capital gain until a disposal is recorded.</p>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { label: "Purchases", value: purchaseValue },
            { label: "Sale proceeds", value: saleProceeds },
            { label: "Dividend income", value: dividendIncome },
            { label: "Posted records", value: yearTransactions.length },
          ].map((item) => (
            <div key={item.label} className="rounded-xl p-4" style={{ background: "var(--color-login-bg)", border: "1px solid var(--hairline)" }}>
              <p className="text-xs" style={{ color: "var(--ink-3)" }}>{item.label}</p>
              <p className="tnum mt-2 text-lg font-semibold">{item.label === "Posted records" ? item.value : `${currency} ${fmt(item.value)}`}</p>
            </div>
          ))}
        </div>
      </Panel>

      {/* AI Explanation */}
      <Panel>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} strokeWidth={1.75} style={{ color: "var(--color-accent)" }} />
            <p className="text-sm font-semibold">AI Tax Commentary</p>
          </div>
          <Btn variant="secondary" onClick={getAIExplanation} disabled={loadingAI || !customRatesConfigured}>
            {loadingAI ? "Explaining…" : !customRatesConfigured ? "Configure rates first" : aiExplanation ? "Refresh" : "Explain in plain English"}
          </Btn>
        </div>
        {aiExplanation ? (
          <div
            className="mt-5 rounded-2xl px-5 py-5 sm:px-6"
            style={{
              background: "linear-gradient(145deg, color-mix(in srgb, var(--color-accent) 4%, var(--surface)), var(--surface))",
              border: "1px solid color-mix(in srgb, var(--color-accent) 14%, var(--hairline))",
              boxShadow: "inset 0 1px 0 color-mix(in srgb, white 3%, transparent)",
            }}
          >
            <div className="tax-commentary prose prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => <h1 className="mb-3 mt-0 text-lg font-semibold tracking-tight" style={{ color: "var(--color-text)" }}>{children}</h1>,
                  h2: ({ children }) => <h2 className="mb-2 mt-5 text-base font-semibold tracking-tight" style={{ color: "var(--color-text)" }}>{children}</h2>,
                  h3: ({ children }) => <h3 className="mb-2 mt-4 text-sm font-semibold" style={{ color: "var(--color-text)" }}>{children}</h3>,
                  p: ({ children }) => <p className="mb-3 text-sm leading-7 last:mb-0" style={{ color: "var(--ink-2)" }}>{children}</p>,
                  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1.5 pl-5 text-sm leading-6" style={{ color: "var(--ink-2)" }}>{children}</ul>,
                  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-sm leading-6" style={{ color: "var(--ink-2)" }}>{children}</ol>,
                  li: ({ children }) => <li className="pl-1">{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold" style={{ color: "var(--color-text)" }}>{children}</strong>,
                  blockquote: ({ children }) => <blockquote className="my-4 rounded-r-xl border-l-2 py-2 pl-4" style={{ borderColor: "var(--color-accent)", background: "color-mix(in srgb, var(--color-accent) 5%, transparent)", color: "var(--ink-2)" }}>{children}</blockquote>,
                  hr: () => <hr className="my-4" style={{ borderColor: "var(--hairline)" }} />,
                  table: ({ children }) => <div className="my-4 overflow-x-auto"><table className="w-full text-sm">{children}</table></div>,
                  th: ({ children }) => <th className="border-b px-3 py-2 text-left text-xs font-semibold" style={{ borderColor: "var(--hairline)", color: "var(--ink-2)" }}>{children}</th>,
                  td: ({ children }) => <td className="border-b px-3 py-2" style={{ borderColor: "var(--hairline)", color: "var(--ink-2)" }}>{children}</td>,
                }}
              >
                {aiExplanation}
              </ReactMarkdown>
            </div>
            <p className="mt-5 border-t pt-3 text-[11px] leading-relaxed" style={{ borderColor: "var(--hairline)", color: "var(--ink-3)" }}>
              {brandText("AI-generated commentary for informational purposes. Verify tax rates and filing treatment with a qualified tax professional; the calculated figures above are based on the records and settings currently in {{brand}}.")}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--ink-3)" }}>
            {brandText("Generate a structured explanation of your computed tax figures. {{brand}} calculates FIFO and estimated liability in code; AI provides commentary only.")}
          </p>
        )}
      </Panel>

      {/* FIFO lots table */}
      {tax.lots.length > 0 && (
        <Panel>
          <p className="mb-4 text-sm font-semibold">FIFO Lot Matching</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--hairline)" }}>
                  {[
                    "Ticker",
                    "Exchange",
                    "Buy date",
                    "Sell date",
                    "Qty",
                    "Cost basis",
                    "Sale price",
                    "Holding",
                    "Gain",
                    "Tax rate",
                    "Tax due",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-3 text-left text-xs font-semibold"
                      style={{ color: "var(--ink-2)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tax.lots.map((lot, i) => (
                  <tr
                    key={i}
                    style={{ borderBottom: "1px solid var(--hairline)" }}
                    className="ledger-row transition-colors"
                  >
                    <td className="px-3 py-3 text-sm font-semibold">{lot.ticker}</td>
                    <td className="px-3 py-3 text-xs" style={{ color: "var(--ink-3)" }}>{lot.exchange}</td>
                    <td className="px-3 py-3 text-xs" style={{ color: "var(--ink-2)" }}>
                      {lot.buyDate}
                    </td>
                    <td className="px-3 py-3 text-xs" style={{ color: "var(--ink-2)" }}>
                      {lot.sellDate}
                    </td>
                    <td className="tnum px-3 py-3 text-sm">{lot.quantity}</td>
                    <td className="tnum px-3 py-3 text-sm">{lot.costBasis.toFixed(2)}</td>
                    <td className="tnum px-3 py-3 text-sm">{lot.salePrice.toFixed(2)}</td>
                    <td className="px-3 py-3">
                      <StatusPill tone={lot.isShortTerm ? "warn" : "ok"}>
                        {lot.holdingDays}d · {lot.isShortTerm ? "ST" : "LT"}
                      </StatusPill>
                    </td>
                    <td
                      className="tnum px-3 py-3 text-sm font-medium"
                      style={{ color: lot.gain >= 0 ? "var(--ok)" : "var(--bad)" }}
                    >
                      {lot.gain >= 0 ? "+" : ""}
                      {fmt(lot.gain)}
                    </td>
                    <td className="tnum px-3 py-3 text-sm" style={{ color: "var(--ink-2)" }}>
                      {activeJurisdiction === "CUSTOM" && !customRatesConfigured ? "—" : `${(lot.taxRate * 100).toFixed(1)}%`}
                    </td>
                    <td
                      className="tnum px-3 py-3 text-sm font-medium"
                      style={{ color: "var(--color-accent)" }}
                    >
                      {activeJurisdiction === "CUSTOM" && !customRatesConfigured ? "—" : fmt(lot.taxDue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Tax-loss harvesting */}
      {harvest.length > 0 && (
        <Panel>
          <div className="mb-4 flex items-center gap-2">
            <Leaf size={18} strokeWidth={1.75} style={{ color: "var(--ok)" }} />
            <p className="text-sm font-semibold">Tax-Loss Harvesting Opportunities</p>
          </div>
          <div className="space-y-3">
            {harvest.map((h) => (
              <div
                key={h.ticker}
                className="flex items-start justify-between rounded-xl p-4"
                style={{
                  background: "color-mix(in srgb, var(--ok) 5%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--ok) 15%, transparent)",
                }}
              >
                <div className="flex items-start gap-3">
                  <TrendingDown
                    size={16}
                    strokeWidth={1.75}
                    style={{ color: "var(--bad)", marginTop: 2 }}
                  />
                  <div>
                    <p className="text-sm font-semibold">
                      {h.ticker}
                      <span className="ml-2 text-xs font-normal" style={{ color: "var(--ink-3)" }}>
                        {h.exchange} · {h.holdingDays}d held
                      </span>
                    </p>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ink-2)" }}>
                      {h.rationale}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tnum text-sm font-semibold" style={{ color: "var(--bad)" }}>
                    {currency} {fmt(h.unrealizedLoss)}
                  </p>
                  <p className="tnum text-xs" style={{ color: "var(--ok)" }}>
                    saves ~{currency}{" "}
                    {fmt(h.potentialOffset * (activeJurisdiction === "PSX" ? 0.15 : activeJurisdiction === "NSE" ? 0.2 : Number(customShortTermRate) / 100))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tax.lots.length === 0 && (
        <Panel className="py-12 text-center">
          <Info
            size={28}
            strokeWidth={1.5}
            className="mx-auto mb-3"
            style={{ color: "var(--ink-3)" }}
          />
          <p className="font-medium">No realised gains in {activeYear}</p>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-3)" }}>
            Add sell transactions for {activeYear} to see FIFO lot matching.
          </p>
        </Panel>
      )}

      {/* Disclaimer */}
      <div
        className="flex gap-2.5 rounded-2xl px-5 py-4 text-sm"
        style={{
          background: "color-mix(in srgb, var(--info) 6%, transparent)",
          border: "1px solid color-mix(in srgb, var(--info) 15%, transparent)",
        }}
      >
        <AlertCircle
          size={16}
          strokeWidth={1.75}
          style={{ color: "var(--info)", marginTop: 2, flexShrink: 0 }}
        />
        <p style={{ color: "var(--ink-2)" }}>
          <strong>Not tax or legal advice.</strong> These calculations are indicative only and based
          on the data you have uploaded. Always consult a qualified tax professional before filing.
        </p>
      </div>
    </div>
  );
}
