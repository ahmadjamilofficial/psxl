import { describe, expect, it } from "vitest";
import { runReconciliation, type ReconciliationTransaction } from "./reconciliation-engine";

function tx(overrides: Partial<ReconciliationTransaction> = {}): ReconciliationTransaction {
  return {
    id: "1",
    ticker: "OGDC",
    action: "BUY",
    quantity: 10,
    price: 100,
    trade_date: "2026-01-01",
    ref_id: "REF-1",
    broker: "Broker A",
    exchange: "PSX",
    status: "posted",
    ...overrides,
  };
}

describe("runReconciliation", () => {
  it("ignores unposted review rows", () => {
    expect(runReconciliation([tx({ status: "needs_review", quantity: -5 })])).toEqual([]);
  });

  it("uses pre-filter history to calculate later oversells", () => {
    const result = runReconciliation([
      tx({ id: "buy", action: "BUY", quantity: 100, trade_date: "2026-01-01" }),
      tx({ id: "sell", action: "SELL", quantity: 120, trade_date: "2026-03-01", ref_id: "REF-2" }),
    ], { dateFrom: "2026-03-01" });
    const oversell = result.find((item) => item.flag_type === "Oversell");
    expect(oversell?.expected).toBe(100);
    expect(oversell?.actual).toBe(120);
  });

  it("does not mix inventory between brokers", () => {
    const result = runReconciliation([
      tx({ id: "buy", broker: "Broker A", action: "BUY", quantity: 100 }),
      tx({ id: "sell", broker: "Broker B", action: "SELL", quantity: 20, ref_id: "REF-2" }),
    ]);
    expect(result.some((item) => item.flag_type === "Oversell")).toBe(true);
  });

  it("does not treat dividends as share inventory", () => {
    const result = runReconciliation([
      tx({ id: "div", action: "DIV", quantity: 1000 }),
      tx({ id: "sell", action: "SELL", quantity: 1, ref_id: "REF-2" }),
    ]);
    expect(result.some((item) => item.flag_type === "Oversell")).toBe(true);
  });

  it("deduplicates by broker reference, not just ticker and date", () => {
    const result = runReconciliation([
      tx({ id: "one", ref_id: "CONTRACT-1" }),
      tx({ id: "two", ref_id: "CONTRACT-1" }),
    ]);
    expect(result.filter((item) => item.flag_type === "Duplicate Entry")).toHaveLength(1);
  });

  it("does not flag identical executions with different broker references as duplicates", () => {
    const result = runReconciliation([
      tx({ id: "one", ref_id: "CONTRACT-1" }),
      tx({ id: "two", ref_id: "CONTRACT-2" }),
    ]);
    expect(result.some((item) => item.flag_type === "Duplicate Entry")).toBe(false);
  });

  it("is deterministic regardless of input ordering", () => {
    const rows = [
      tx({ id: "buy", action: "BUY", quantity: 10 }),
      tx({ id: "sell", action: "SELL", quantity: 12, ref_id: "REF-2", trade_date: "2026-02-01" }),
    ];
    expect(runReconciliation(rows)).toEqual(runReconciliation([...rows].reverse()));
  });
});
