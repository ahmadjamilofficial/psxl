// ─── Deterministic FIFO tax engine ───────────────────────────────────────────
// No AI is involved here. All numbers are computed from first principles.

import type { Transaction } from "./demo-data";

// ── Tax profile types ─────────────────────────────────────────────────────────

export type Jurisdiction = "PSX" | "NSE" | "CUSTOM";

export interface TaxProfile {
  jurisdiction: Jurisdiction;
  filerStatus: "Filer" | "Non-Filer"; // PSX only
  taxYear: string; // e.g. "2025"
  customShortTermRate?: number;
  customLongTermRate?: number;
  customLongTermDays?: number;
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface FifoLot {
  buyDate: string;
  sellDate: string;
  ticker: string;
  exchange: string;
  quantity: number;
  costBasis: number; // per unit
  salePrice: number; // per unit
  holdingDays: number;
  gain: number; // total PKR / INR
  isShortTerm: boolean;
  taxRate: number; // 0-1
  taxDue: number;
}

export interface TaxComputation {
  jurisdiction: Jurisdiction;
  taxYear: string;
  filerStatus: string;
  lots: FifoLot[];
  shortTermGain: number;
  longTermGain: number;
  totalGain: number;
  dividendWHT: number;
  shortTermTax: number;
  longTermTax: number;
  estimatedTaxDue: number;
  computedAt: string;
}

// ── PSX CGT rules (FY2025) ────────────────────────────────────────────────────
// Per Finance Act 2024 Pakistan schedule:
// Holding < 12 months → 15% CGT
// Holding 12-24 months → 12.5% CGT
// Holding > 24 months → 0%
function psxCgtRate(holdingDays: number): number {
  if (holdingDays < 365) return 0.15;
  if (holdingDays < 730) return 0.125;
  return 0;
}

// ── NSE CGT rules (FY2025) ────────────────────────────────────────────────────
// India: STCG (< 12 months) → 20%, LTCG (> 12 months) → 12.5% (post Budget 2024)
function nseCgtRate(holdingDays: number): number {
  if (holdingDays < 365) return 0.2;
  return 0.125;
}

// ── Core FIFO engine ──────────────────────────────────────────────────────────

export function computeTax(txs: Transaction[], profile: TaxProfile): TaxComputation {
  const yearTxs = txs.filter((t) => t.status === "posted" && t.trade_date.startsWith(profile.taxYear));
  const events = [...txs]
    .filter((t) => t.status === "posted" && (t.action === "BUY" || t.action === "SELL"))
    .sort((a, b) =>
      a.trade_date.localeCompare(b.trade_date) ||
      (a.action === b.action ? 0 : a.action === "BUY" ? -1 : 1) ||
      a.id.localeCompare(b.id),
    );

  // Replay the complete transaction history so earlier disposals consume their
  // lots before a later tax-year sale is matched. A current-year-only replay
  // overstates the remaining cost basis whenever the account sold previously.
  const buyQueues: Record<string, Array<{ date: string; qty: number; price: number }>> = {};
  const lots: FifoLot[] = [];

  for (const event of events) {
    const marketKey = event.exchange + ":" + event.ticker + ":" + (event.currency ?? "");
    if (event.action === "BUY") {
      if (!buyQueues[marketKey]) buyQueues[marketKey] = [];
      const unitCost = event.price + (event.quantity > 0 ? event.fees / event.quantity : 0);
      buyQueues[marketKey]!.push({ date: event.trade_date, qty: event.quantity, price: unitCost });
      continue;
    }

    let remaining = event.quantity;
    const queue = buyQueues[marketKey] ?? [];
    const isTaxYearDisposal = event.trade_date.startsWith(profile.taxYear);
    const netSalePrice = event.price - (event.quantity > 0 ? event.fees / event.quantity : 0);

    while (remaining > 0 && queue.length > 0) {
      const lot = queue[0]!;
      // Same-day purchases are processed before same-day disposals. Earlier
      // sales cannot be funded by purchases dated in the future.
      if (lot.date > event.trade_date) break;
      const matched = Math.min(remaining, lot.qty);
      const holdingDays = Math.max(0, Math.floor(
        (new Date(event.trade_date).getTime() - new Date(lot.date).getTime()) / (1000 * 60 * 60 * 24),
      ));

      if (isTaxYearDisposal) {
        const gain = (netSalePrice - lot.price) * matched;
        const longTermDays = profile.customLongTermDays ?? 365;
        const isShortTerm = holdingDays < (profile.jurisdiction === "CUSTOM" ? longTermDays : 365);
        const taxRate = profile.jurisdiction === "PSX"
          ? psxCgtRate(holdingDays)
          : profile.jurisdiction === "NSE"
            ? nseCgtRate(holdingDays)
            : Math.max(0, Math.min(1, (isShortTerm ? profile.customShortTermRate : profile.customLongTermRate) ?? 0));

        lots.push({
          buyDate: lot.date,
          sellDate: event.trade_date,
          ticker: event.ticker,
          exchange: event.exchange,
          quantity: matched,
          costBasis: lot.price,
          salePrice: netSalePrice,
          holdingDays,
          gain,
          isShortTerm,
          taxRate,
          taxDue: Math.max(0, gain * taxRate),
        });
      }

      remaining -= matched;
      lot.qty -= matched;
      if (lot.qty <= 1e-10) queue.shift();
    }
  }

  const dividendWHT = yearTxs.filter((t) => t.action === "DIV").reduce((sum, t) => sum + t.wht, 0);
  const shortTermGain = lots.filter((l) => l.isShortTerm).reduce((s, l) => s + l.gain, 0);
  const longTermGain = lots.filter((l) => !l.isShortTerm).reduce((s, l) => s + l.gain, 0);
  const shortTermTax = lots.filter((l) => l.isShortTerm).reduce((s, l) => s + l.taxDue, 0);
  const longTermTax = lots.filter((l) => !l.isShortTerm).reduce((s, l) => s + l.taxDue, 0);

  return {
    jurisdiction: profile.jurisdiction,
    taxYear: profile.taxYear,
    filerStatus: profile.filerStatus ?? "Filer",
    lots,
    shortTermGain,
    longTermGain,
    totalGain: shortTermGain + longTermGain,
    dividendWHT,
    shortTermTax,
    longTermTax,
    estimatedTaxDue: shortTermTax + longTermTax,
    computedAt: new Date().toISOString(),
  };
}

// ── Tax-loss harvesting suggestions ──────────────────────────────────────────

export interface HarvestSuggestion {
  ticker: string;
  exchange: string;
  unrealizedLoss: number;
  potentialOffset: number;
  holdingDays: number;
  rationale: string;
}

// Current prices must be supplied by a verified market-data source. The tax
// engine deliberately does not ship hard-coded or illustrative quotes.
export function suggestHarvesting(
  txs: Transaction[],
  realizedGain: number,
  currentPrices: Record<string, number> = {},
): HarvestSuggestion[] {
  const positions: Record<string, {
    ticker: string; qty: number; avgCost: number; exchange: string; firstBuy: string;
  }> = {};

  for (const tx of [...txs].filter(t => t.status === "posted").sort((a, b) => a.trade_date.localeCompare(b.trade_date))) {
    const key = tx.exchange + ":" + tx.ticker;
    if (!positions[key]) positions[key] = { ticker: tx.ticker, qty: 0, avgCost: 0, exchange: tx.exchange, firstBuy: tx.trade_date };
    const position = positions[key]!;
    if (tx.action === "BUY") {
      const nextQty = position.qty + tx.quantity;
      position.avgCost = nextQty > 0
        ? (position.avgCost * position.qty + tx.price * tx.quantity + tx.fees) / nextQty
        : 0;
      position.qty = nextQty;
    } else if (tx.action === "SELL" && position.qty > 0) {
      const sold = Math.min(position.qty, tx.quantity);
      position.qty -= sold;
    }
  }

  const suggestions: HarvestSuggestion[] = [];
  for (const position of Object.values(positions)) {
    if (position.qty <= 0) continue;
    const currentPrice = currentPrices[`${position.exchange}:${position.ticker}`] ?? currentPrices[position.ticker];
    if (!Number.isFinite(currentPrice) || currentPrice == null || currentPrice <= 0) continue;
    const unrealizedLoss = (currentPrice - position.avgCost) * position.qty;
    if (unrealizedLoss >= 0) continue;
    const potentialOffset = Math.min(Math.abs(unrealizedLoss), Math.max(0, realizedGain));
    const holdingDays = Math.max(0, Math.floor((Date.now() - new Date(position.firstBuy).getTime()) / (1000 * 60 * 60 * 24)));
    suggestions.push({
      ticker: position.ticker,
      exchange: position.exchange,
      unrealizedLoss,
      potentialOffset,
      holdingDays,
      rationale: `Selling ${position.qty} ${position.ticker} at the supplied verified price would realize an estimated loss of ${Math.abs(unrealizedLoss).toLocaleString("en-PK", { maximumFractionDigits: 0 })}. Confirm jurisdiction-specific loss-offset rules before acting.`,
    });
  }
  return suggestions.sort((a, b) => a.unrealizedLoss - b.unrealizedLoss);
}
