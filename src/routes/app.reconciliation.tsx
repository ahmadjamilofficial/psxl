import { brandText } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  GitFork,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useState, useMemo } from "react";
import { runReconciliation as reconcileTransactions, type ReconciliationFinding } from "@/lib/reconciliation-engine";
import { toast } from "sonner";
import { Btn, Panel, StatusPill } from "@/components/kit";
import { useAuth } from "@/lib/auth-context";
import {
  useReconciliationFlags,
  useResolveFlag,
  useTransactions,
} from "@/lib/data-hooks";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/app/reconciliation")({
  component: Reconciliation,
});

type LocalFlag = ReconciliationFinding;

// ── Component ─────────────────────────────────────────────────────────────────

function Reconciliation() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  const [brokerFilter, setBrokerFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [aiExplanations, setAiExplanations] = useState<Record<string, string>>({});
  const [loadingAI, setLoadingAI] = useState<string | null>(null);
  const [localFlags, setLocalFlags] = useState<LocalFlag[]>([]);

  const { data: allDbFlags = [] } = useReconciliationFlags(profile?.org_id);
  const { data: transactions = [] } = useTransactions(profile?.org_id);
  const resolveMutation = useResolveFlag();

  const brokerOptions = useMemo(() => {
    const names = [...new Set(transactions.map((t) => t.broker).filter(Boolean))];
    return ["All", ...names];
  }, [transactions]);

  const allFlags = useMemo(() => {
    const dbDescriptions = new Set(allDbFlags.map((f) => f.description));
    const newLocalOnly = localFlags.filter((f) => !dbDescriptions.has(f.description));
    return [
      ...allDbFlags.map((f) => ({ ...f, severity: f.severity as "ok" | "warn" | "bad" })),
      ...newLocalOnly,
    ];
  }, [allDbFlags, localFlags]);

  const active = allFlags.filter((f) => !resolved.has(f.id));

  async function runReconciliation() {
    if (!profile?.org_id) return;
    setRunning(true);
    setRan(false);
    setLocalFlags([]);

    try {
      const castTx = transactions.map((t) => ({
        ticker: t.ticker,
        action: t.action,
        quantity: Number(t.quantity),
        price: Number(t.price),
        trade_date: t.trade_date,
        ref_id: t.ref_id,
        broker: t.broker,
        exchange: t.exchange,
        status: t.status,
      }));

      const findings = reconcileTransactions(castTx, { broker: brokerFilter, dateFrom, dateTo });
      setLocalFlags(findings);

      // Persist every finding, not only critical ones. Existing open findings are
      // reused by description so repeated runs do not flood the review queue.
      const existingDescriptions = new Set(allDbFlags.map((flag) => flag.description));
      const toPersist = findings.filter((finding) => !existingDescriptions.has(finding.description));
      if (toPersist.length > 0) {
        const { error } = await supabase.from("reconciliation_flags").insert(
          toPersist.map((finding) => ({
            org_id: profile.org_id,
            flag_type: finding.flag_type,
            severity: finding.severity,
            ticker: finding.ticker,
            ref_id: finding.ref_id,
            expected: finding.expected as never,
            actual: finding.actual as never,
            description: finding.description,
            suggested_resolution: finding.suggested_resolution,
            status: "open",
          })) as never,
        );
        if (error) throw new Error(`Could not save reconciliation findings: ${error.message}`);
      }

      await qc.invalidateQueries({ queryKey: ["reconciliation_flags", profile.org_id] });

      if (findings.length === 0) {
        toast.success("Reconciliation complete — no issues found");
      } else {
        toast.warning(`Found ${findings.length} issue${findings.length !== 1 ? "s" : ""}`);
      }
    } catch (e) {
      toast.error("Reconciliation failed: " + (e as Error).message);
    } finally {
      setRunning(false);
      setRan(true);
    }
  }

  async function fetchAIExplanation(flag: (typeof allFlags)[0]) {
    setLoadingAI(flag.id);
    try {
      const resp = await fetch("/api/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt:
            "You are a financial reconciliation expert. Explain this anomaly concisely in 2-3 sentences, identifying the most likely root cause and recommended action. Be direct and use plain language.",
          userPrompt: `Anomaly: ${flag.flag_type} for ${flag.ticker}\nExpected: ${flag.expected}, Actual: ${flag.actual}\nDescription: ${flag.description}\nJurisdiction: ${profile?.jurisdiction ?? "PSX"}`,
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
      setAiExplanations((prev) => ({
        ...prev,
        [flag.id]: explanation || "AI explanation unavailable.",
      }));
    } catch {
      setAiExplanations((prev) => ({ ...prev, [flag.id]: "AI explanation unavailable." }));
    } finally {
      setLoadingAI(null);
    }
  }

  function handleResolve(flagId: string) {
    if (!profile?.org_id) return;
    if (flagId.startsWith("local-")) {
      setResolved((p) => new Set([...p, flagId]));
      setExpanded(null);
      return;
    }
    resolveMutation.mutate(
      { flagId, orgId: profile.org_id },
      {
        onSuccess: () => {
          setResolved((p) => new Set([...p, flagId]));
          setExpanded(null);
          toast.success("Resolved");
        },
        onError: (e) => toast.error("Failed: " + (e as Error).message),
      },
    );
  }

  return (
    <div className="space-y-6 p-3 sm:p-6">
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: "1.5rem" }}>Reconciliation</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Deterministic checks — duplicates, missing fields, oversells, zero prices. No guesswork.
        </p>
      </div>

      {/* Controls */}
      <Panel>
        <p className="text-sm font-semibold">Run Reconciliation</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
              Broker
            </label>
            <select
              value={brokerFilter}
              onChange={(e) => setBrokerFilter(e.target.value)}
              className="w-full rounded-[10px] border bg-surface px-3 py-2.5 text-sm outline-none"
              style={{ borderColor: "var(--hairline)" }}
            >
              {brokerOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
              Date from
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-[10px] border bg-surface px-3 py-2.5 text-sm outline-none"
              style={{ borderColor: "var(--hairline)" }}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
              Date to
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-[10px] border bg-surface px-3 py-2.5 text-sm outline-none"
              style={{ borderColor: "var(--hairline)" }}
            />
          </div>
          <div className="flex items-end">
            <Btn onClick={() => void runReconciliation()} disabled={running} className="w-full">
              {running ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <GitFork size={16} />
                  Run Reconciliation
                </>
              )}
            </Btn>
          </div>
        </div>
      </Panel>

      {/* Results */}
      <AnimatePresence>
        {ran && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="grid grid-cols-3 gap-4">
              {[
                {
                  label: "Issues found",
                  value: localFlags.length,
                  tone: localFlags.length > 0 ? ("warn" as const) : ("ok" as const),
                },
                {
                  label: "Open in DB",
                  value: allDbFlags.length,
                  tone: allDbFlags.length > 0 ? ("bad" as const) : ("ok" as const),
                },
                { label: "Resolved", value: resolved.size, tone: "ok" as const },
              ].map(({ label, value, tone }) => (
                <Panel key={label} className="text-center">
                  <p className="tnum text-2xl font-semibold">{value}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
                    {label}
                  </p>
                  <div className="mt-2 flex justify-center">
                    <StatusPill tone={tone}>
                      {tone === "ok" ? "ok" : tone === "warn" ? "review" : "open"}
                    </StatusPill>
                  </div>
                </Panel>
              ))}
            </div>

            {active.length > 0 ? (
              <div
                className="overflow-x-auto rounded-2xl bg-surface"
                style={{ border: "1px solid var(--hairline)" }}
              >
                <div className="border-b px-5 py-4" style={{ borderColor: "var(--hairline)" }}>
                  <p className="text-sm font-semibold">Open Issues ({active.length})</p>
                </div>
                <div className="divide-y" style={{ borderColor: "var(--hairline)" }}>
                  {active.map((flag) => (
                    <div key={flag.id}>
                      <button
                        type="button"
                        className="w-full px-5 py-4 text-left transition-colors hover:bg-surface-hover"
                        onClick={() => setExpanded(expanded === flag.id ? null : flag.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <AlertTriangle
                              size={16}
                              strokeWidth={1.75}
                              style={{
                                color: flag.severity === "bad" ? "var(--bad)" : "var(--warn)",
                                flexShrink: 0,
                              }}
                            />
                            <div>
                              <p className="text-sm font-medium">{flag.flag_type}</p>
                              <p className="text-xs" style={{ color: "var(--ink-3)" }}>
                                {flag.ticker} · {flag.ref_id}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <StatusPill tone={flag.severity}>
                              {flag.severity === "bad" ? "Critical" : "Warning"}
                            </StatusPill>
                            {expanded === flag.id ? (
                              <ChevronUp size={16} style={{ color: "var(--ink-3)" }} />
                            ) : (
                              <ChevronDown size={16} style={{ color: "var(--ink-3)" }} />
                            )}
                          </div>
                        </div>
                      </button>

                      <AnimatePresence>
                        {expanded === flag.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div
                              className="border-t px-5 pb-5 pt-4"
                              style={{
                                borderColor: "var(--hairline)",
                                background: "var(--accent-2)",
                              }}
                            >
                              <p className="text-sm" style={{ color: "var(--ink-2)" }}>
                                {flag.description}
                              </p>

                              <div className="mt-4 grid grid-cols-2 gap-4">
                                <div
                                  className="rounded-xl p-3"
                                  style={{
                                    background: "color-mix(in srgb, var(--ok) 6%, transparent)",
                                  }}
                                >
                                  <p className="text-xs font-medium" style={{ color: "var(--ok)" }}>
                                    Expected
                                  </p>
                                  <p className="tnum mt-1 text-lg font-semibold">
                                    {typeof flag.expected === "number"
                                      ? flag.expected.toLocaleString("en-PK", {
                                          maximumFractionDigits: 2,
                                        })
                                      : String(flag.expected)}
                                  </p>
                                </div>
                                <div
                                  className="rounded-xl p-3"
                                  style={{
                                    background: "color-mix(in srgb, var(--bad) 6%, transparent)",
                                  }}
                                >
                                  <p
                                    className="text-xs font-medium"
                                    style={{ color: "var(--bad)" }}
                                  >
                                    Actual
                                  </p>
                                  <p className="tnum mt-1 text-lg font-semibold">
                                    {typeof flag.actual === "number"
                                      ? flag.actual.toLocaleString("en-PK", {
                                          maximumFractionDigits: 2,
                                        })
                                      : String(flag.actual)}
                                  </p>
                                </div>
                              </div>

                              <div
                                className="mt-4 rounded-xl p-3 text-sm"
                                style={{ background: "var(--accent-6)" }}
                              >
                                <span
                                  className="font-medium"
                                  style={{ color: "var(--color-accent)" }}
                                >
                                  Suggested:{" "}
                                </span>
                                <span style={{ color: "var(--ink-2)" }}>
                                  {flag.suggested_resolution}
                                </span>
                              </div>

                              <div className="mt-3">
                                {aiExplanations[flag.id] ? (
                                  <div
                                    className="rounded-xl px-4 py-3 text-sm"
                                    style={{
                                      background: "var(--accent-4)",
                                      border: "1px solid var(--accent-12)",
                                    }}
                                  >
                                    <div className="flex items-center gap-1.5 mb-1">
                                      <Sparkles
                                        size={13}
                                        style={{ color: "var(--color-accent)" }}
                                      />
                                      <span
                                        className="text-xs font-semibold"
                                        style={{ color: "var(--color-accent)" }}
                                      >
                                        {brandText("{{brand}} AI")}
                                      </span>
                                    </div>
                                    <p style={{ color: "var(--ink-2)" }}>
                                      {aiExplanations[flag.id]}
                                    </p>
                                    <p className="mt-2 text-[11px]" style={{ color: "var(--ink-3)" }}>
                                      AI analysis does not change your ledger or resolve this flag. Verify the suggested action, then mark it resolved below.
                                    </p>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => void fetchAIExplanation(flag)}
                                    disabled={loadingAI === flag.id}
                                    className="flex items-center gap-1.5 text-xs font-medium disabled:opacity-50"
                                    style={{ color: "var(--color-accent)" }}
                                  >
                                    <Sparkles size={13} />
                                    {loadingAI === flag.id ? "Asking AI…" : "Explain with AI"}
                                  </button>
                                )}
                              </div>

                              <div className="mt-4">
                                <Btn
                                  variant="primary"
                                  onClick={() => handleResolve(flag.id)}
                                  disabled={resolveMutation.isPending}
                                >
                                  {resolveMutation.isPending ? (
                                    <Loader2 size={15} className="animate-spin" />
                                  ) : (
                                    <CheckCircle2 size={15} />
                                  )}
                                  {resolveMutation.isPending ? "Applying…" : "Mark resolved"}
                                </Btn>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Panel className="py-12 text-center">
                <CheckCircle2
                  size={32}
                  strokeWidth={1.5}
                  className="mx-auto mb-3"
                  style={{ color: "var(--ok)" }}
                />
                <p className="font-semibold">No issues found</p>
                <p className="mt-1 text-sm" style={{ color: "var(--ink-3)" }}>
                  {transactions.length} transaction{transactions.length !== 1 ? "s" : ""} checked —
                  all clear.
                </p>
              </Panel>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!ran &&
        !running &&
        (allDbFlags.length > 0 ? (
          <div>
            <p className="mb-3 text-sm font-semibold">
              Open Flags from Previous Runs ({allDbFlags.length})
            </p>
            <div
              className="overflow-hidden rounded-2xl bg-surface"
              style={{ border: "1px solid var(--hairline)" }}
            >
              <div className="divide-y" style={{ borderColor: "var(--hairline)" }}>
                {allDbFlags
                  .filter((f) => !resolved.has(f.id))
                  .map((flag) => (
                    <div key={flag.id} className="flex items-center justify-between px-5 py-3">
                      <div className="flex items-center gap-3">
                        <AlertTriangle
                          size={15}
                          style={{ color: flag.severity === "bad" ? "var(--bad)" : "var(--warn)" }}
                        />
                        <div>
                          <p className="text-sm font-medium">{flag.flag_type}</p>
                          <p className="text-xs" style={{ color: "var(--ink-3)" }}>
                            {flag.ticker} · {flag.description?.slice(0, 60)}
                          </p>
                        </div>
                      </div>
                      <StatusPill tone={flag.severity}>
                        {flag.severity === "bad" ? "Critical" : "Warning"}
                      </StatusPill>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        ) : (
          <div
            className="flex flex-col items-center justify-center rounded-2xl py-20"
            style={{ background: "var(--color-login-bg)" }}
          >
            <GitFork size={36} strokeWidth={1.5} style={{ color: "var(--ink-3)" }} />
            <p className="mt-3 font-medium">No reconciliation run yet</p>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-3)" }}>
              Choose filters above and click Run Reconciliation.
            </p>
          </div>
        ))}
    </div>
  );
}
