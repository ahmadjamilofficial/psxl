export type ReconciliationTransaction = {
  id?: string;
  ticker: string;
  action: string;
  quantity: number;
  price: number;
  trade_date: string;
  ref_id?: string | null;
  broker?: string | null;
  exchange?: string | null;
  status?: string | null;
};

export type ReconciliationFinding = {
  id: string;
  flag_type: string;
  severity: "warn" | "bad";
  ticker: string;
  ref_id: string;
  expected: number;
  actual: number;
  description: string;
  suggested_resolution: string;
  status: "open";
};

export type ReconciliationOptions = {
  broker?: string;
  dateFrom?: string;
  dateTo?: string;
};

const isSyntheticReference = (value: string) =>
  !value || /^(AUTO-|AI-|INGESTED-)/i.test(value);

const round = (value: number) => Math.round((value + Number.EPSILON) * 1e8) / 1e8;

/**
 * Reconciles posted ledger rows only. Inventory is replayed from the beginning
 * of the selected broker history, even when the user filters the visible
 * findings to a later date range.
 */
export function runReconciliation(
  transactions: ReconciliationTransaction[],
  options: ReconciliationOptions = {},
): ReconciliationFinding[] {
  const findings: ReconciliationFinding[] = [];
  let sequence = 0;
  const add = (finding: Omit<ReconciliationFinding, "id" | "status">) => {
    findings.push({ ...finding, id: `local-${sequence++}`, status: "open" });
  };

  const brokerMatches = (tx: ReconciliationTransaction) =>
    !options.broker || options.broker === "All" || (tx.broker || "Unknown") === options.broker;
  const inVisibleRange = (tx: ReconciliationTransaction) =>
    (!options.dateFrom || tx.trade_date >= options.dateFrom) &&
    (!options.dateTo || tx.trade_date <= options.dateTo);

  const rows = transactions
    .filter((tx) => (tx.status ?? "posted") === "posted" && brokerMatches(tx))
    .map((tx) => ({
      ...tx,
      ticker: String(tx.ticker ?? "").trim().toUpperCase(),
      action: String(tx.action ?? "").trim().toUpperCase(),
      quantity: Number(tx.quantity),
      price: Number(tx.price),
      trade_date: String(tx.trade_date ?? ""),
      ref_id: String(tx.ref_id ?? "").trim(),
      broker: String(tx.broker || "Unknown"),
      exchange: String(tx.exchange || "PSX"),
    }))
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date) || String(a.id ?? "").localeCompare(String(b.id ?? "")));

  // De-duplicate by broker reference where possible. For rows without a real
  // broker reference, use a stable transaction fingerprint.
  const seen = new Map<string, ReconciliationTransaction>();
  const duplicateIds = new Set<string>();
  for (const tx of rows) {
    const synthetic = isSyntheticReference(tx.ref_id);
    const key = synthetic
      ? [tx.broker, tx.exchange, tx.ticker, tx.action, tx.quantity, tx.price, tx.trade_date].join("|")
      : [tx.broker, tx.ref_id].join("|");
    const prior = seen.get(key);
    if (prior) {
      if (tx.id) duplicateIds.add(tx.id);
      if (inVisibleRange(tx)) {
        add({
          flag_type: "Duplicate Entry",
          severity: "warn",
          ticker: tx.ticker,
          ref_id: tx.ref_id || "—",
          expected: 1,
          actual: 2,
          description: `Possible duplicate at ${tx.broker}: ${tx.ticker} ${tx.action} ${tx.quantity} @ ${tx.price} on ${tx.trade_date} shares the same ${synthetic ? "transaction fingerprint" : `broker reference ${tx.ref_id}`}.`,
          suggested_resolution: "Compare both rows with the original contract note. Keep one only after confirming they represent the same execution.",
        });
      }
    } else {
      seen.set(key, tx);
    }
  }

  for (const tx of rows) {
    if (!inVisibleRange(tx)) continue;
    if (!tx.ticker) {
      add({
        flag_type: "Missing Symbol",
        severity: "bad",
        ticker: "—",
        ref_id: tx.ref_id || "—",
        expected: 1,
        actual: 0,
        description: "A posted transaction has no ticker or instrument symbol.",
        suggested_resolution: "Correct the symbol against the broker contract note before using this record for reporting.",
      });
    }
    if (!Number.isFinite(tx.quantity) || tx.quantity <= 0) {
      add({
        flag_type: "Invalid Quantity",
        severity: "bad",
        ticker: tx.ticker || "—",
        ref_id: tx.ref_id || "—",
        expected: 1,
        actual: Number.isFinite(tx.quantity) ? tx.quantity : 0,
        description: `${tx.ref_id || "Transaction"} has a non-positive or invalid quantity.`,
        suggested_resolution: "Check the source document and correct the quantity; do not infer it.",
      });
    }
    if (!Number.isFinite(tx.price) || tx.price <= 0) {
      add({
        flag_type: "Missing Price",
        severity: "bad",
        ticker: tx.ticker || "—",
        ref_id: tx.ref_id || "—",
        expected: 1,
        actual: Number.isFinite(tx.price) ? tx.price : 0,
        description: `${tx.ref_id || "Transaction"} has a non-positive or invalid execution price.`,
        suggested_resolution: "Verify the execution price from the broker contract note.",
      });
    }
    if (isSyntheticReference(tx.ref_id)) {
      add({
        flag_type: "Missing Reference",
        severity: "warn",
        ticker: tx.ticker || "—",
        ref_id: tx.ref_id || "—",
        expected: 1,
        actual: 0,
        description: `${tx.ticker || "Transaction"} on ${tx.trade_date} has no verifiable broker reference ID.`,
        suggested_resolution: "Add the reference from the original broker contract note.",
      });
    }
    if (!["BUY", "SELL", "DIV"].includes(tx.action)) {
      add({
        flag_type: "Unsupported Action",
        severity: "bad",
        ticker: tx.ticker || "—",
        ref_id: tx.ref_id || "—",
        expected: 1,
        actual: 0,
        description: `Unsupported transaction action: ${tx.action || "(empty)"}.`,
        suggested_resolution: "Map the source row to BUY, SELL or DIV only after verifying its meaning.",
      });
    }
  }

  // Rebuild inventory across all history up to the selected end date. Group by
  // broker + exchange + ticker so one account cannot mask another account's
  // short position. Dividend rows do not affect share inventory.
  const inventory = new Map<string, number>();
  for (const tx of rows) {
    if (options.dateTo && tx.trade_date > options.dateTo) continue;
    if (duplicateIds.has(tx.id ?? "")) continue;
    if (!tx.ticker || !Number.isFinite(tx.quantity) || tx.quantity <= 0) continue;
    if (tx.action !== "BUY" && tx.action !== "SELL") continue;

    const key = [tx.broker, tx.exchange, tx.ticker].join("|");
    const available = round(inventory.get(key) ?? 0);
    if (tx.action === "BUY") {
      inventory.set(key, round(available + tx.quantity));
      continue;
    }

    const remaining = round(available - tx.quantity);
    inventory.set(key, remaining);
    if (remaining < -0.00000001 && inVisibleRange(tx)) {
      add({
        flag_type: "Oversell",
        severity: "bad",
        ticker: tx.ticker,
        ref_id: tx.ref_id || "—",
        expected: available,
        actual: tx.quantity,
        description: `SELL of ${tx.quantity} ${tx.ticker} at ${tx.broker} exceeds the available ledger inventory of ${available} shares on ${tx.trade_date}.`,
        suggested_resolution: "Check missing earlier BUY trades, broker-account mapping, corporate actions and duplicate executions before changing the ledger.",
      });
    }
  }

  return findings;
}
