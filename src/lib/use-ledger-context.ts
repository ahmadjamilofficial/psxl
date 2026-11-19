// ─── useLedgerContext ─────────────────────────────────────────────────────────
// Single source of truth for jurisdiction, currency, and current tax year.
// Detects exchange from real transaction data rather than relying on the org
// profile default (which may be "PSX" even for NSE holdings).

import { useMemo } from "react";
import { useAuth } from "./auth-context";
import { useTransactions } from "./data-hooks";
import { currencyForExchange } from "./market-currency";

export type Jurisdiction = "PSX" | "NSE" | "CUSTOM";

export interface LedgerContext {
  jurisdiction: Jurisdiction;
  currency: string;
  taxYear: string; // current calendar year as string
  isLoading: boolean;
}

export function useLedgerContext(): LedgerContext {
  const { profile } = useAuth();
  const { data: transactions = [], isLoading } = useTransactions(profile?.org_id);

  const { jurisdiction, currency } = useMemo(() => {
    if (!transactions.length) {
      // No data yet — fall back to org profile default
      const orgJ = (profile?.jurisdiction as Jurisdiction | undefined) ?? "CUSTOM";
      return { jurisdiction: orgJ, currency: orgJ === "NSE" ? "INR" : orgJ === "PSX" ? "PKR" : "USD" };
    }
    const counts = transactions.reduce<Record<string, number>>((acc, tx) => { acc[tx.exchange] = (acc[tx.exchange] ?? 0) + 1; return acc; }, {});
    const exchange = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "CUSTOM";
    const j: Jurisdiction = exchange === "PSX" || exchange === "NSE" ? exchange : "CUSTOM";
    const currencies = [...new Set(transactions.map(tx => tx.currency ?? currencyForExchange(tx.exchange)))];
    return { jurisdiction: j, currency: currencies.length === 1 ? currencies[0]! : "MIXED" };
  }, [transactions, profile?.jurisdiction]);

  const taxYear = String(new Date().getFullYear());

  return { jurisdiction, currency, taxYear, isLoading };
}
