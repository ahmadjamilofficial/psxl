import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, FileText, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTransactions, useReconciliationFlags, useDocuments, usePendingApprovals } from "@/lib/data-hooks";

type ActionItem = {
  key: string;
  title: string;
  detail: string;
  count: number;
  href: "/app/broker-desk" | "/app/reconciliation" | "/app/agent";
  action: string;
  tone: "danger" | "warning" | "neutral";
  icon: typeof AlertTriangle;
};

export function OperationsActionCenter() {
  const { profile } = useAuth();
  const orgId = profile?.org_id;
  const { data: transactions = [], isLoading: txLoading } = useTransactions(orgId);
  const { data: flags = [], isLoading: flagsLoading } = useReconciliationFlags(orgId);
  const { data: documents = [], isLoading: docsLoading } = useDocuments(orgId);
  const { data: approvals = [], isLoading: approvalsLoading } = usePendingApprovals(orgId);

  const needsReview = transactions.filter((tx) => tx.status === "needs_review").length;
  const failedDocuments = documents.filter((doc) => doc.status.toLowerCase() === "failed").length;
  const processingDocuments = documents.filter((doc) =>
    ["queued", "processing", "uploaded", "pending", "extracting"].includes(doc.status.toLowerCase())
  ).length;

  const items: ActionItem[] = [
    {
      key: "review",
      title: "Review extracted transactions",
      detail: "Verify broker-extracted trades before they enter the posted ledger.",
      count: needsReview,
      href: "/app/broker-desk",
      action: "Open review queue",
      tone: "warning",
      icon: ClipboardCheck,
    },
    {
      key: "reconcile",
      title: "Resolve reconciliation exceptions",
      detail: "Investigate fee, quantity, duplicate and statement mismatches.",
      count: flags.length,
      href: "/app/reconciliation",
      action: "Review exceptions",
      tone: "danger",
      icon: AlertTriangle,
    },
    {
      key: "failed",
      title: "Investigate failed statements",
      detail: "These documents did not complete processing and may need to be uploaded again.",
      count: failedDocuments,
      href: "/app/broker-desk",
      action: "Inspect statements",
      tone: "danger",
      icon: FileText,
    },
    {
      key: "approvals",
      title: "Approve pending agent actions",
      detail: "Review proposed operations before an agent is allowed to proceed.",
      count: approvals.length,
      href: "/app/agent",
      action: "Review approvals",
      tone: "warning",
      icon: ShieldCheck,
    },
  ];

  const activeItems = items.filter((item) => item.count > 0);
  const loading = txLoading || flagsLoading || docsLoading || approvalsLoading;
  const total = activeItems.reduce((sum, item) => sum + item.count, 0);

  return (
    <section className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--hairline)", background: "var(--color-sheet)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6" style={{ borderColor: "var(--hairline)" }}>
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck size={17} style={{ color: "var(--color-accent)" }} />
            <h2 className="text-sm font-bold">Today's operations</h2>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>A live work queue built from your organisation's actual records — not sample metrics.</p>
        </div>
        <div className="rounded-md px-3 py-1.5 text-xs font-semibold tabular-nums" style={{ background: total > 0 ? "color-mix(in srgb, var(--warn) 12%, transparent)" : "color-mix(in srgb, var(--ok) 12%, transparent)", color: total > 0 ? "var(--warn)" : "var(--ok)" }}>
          {loading ? "Checking…" : total > 0 ? `${total} items need attention` : "No open actions"}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 p-5 sm:p-6">
          {[0, 1, 2].map((n) => <div key={n} className="h-16 animate-pulse rounded-md" style={{ background: "var(--accent-4)" }} />)}
        </div>
      ) : activeItems.length === 0 && processingDocuments === 0 ? (
        <div className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="mt-0.5 shrink-0" style={{ color: "var(--ok)" }} />
            <div>
              <p className="text-sm font-semibold">Your operational queue is clear.</p>
              <p className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>Upload the latest broker statement to keep the ledger and reconciliation trail current.</p>
            </div>
          </div>
          <Link to="/app/broker-desk" className="inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: "var(--color-accent)", color: "var(--accent-fg)" }}>
            Upload statement <ArrowRight size={13} />
          </Link>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: "var(--hairline)" }}>
          {activeItems.map((item) => {
            const Icon = item.icon;
            const color = item.tone === "danger" ? "var(--bad)" : item.tone === "warning" ? "var(--warn)" : "var(--ink-2)";
            return (
              <div key={item.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 rounded-lg p-2" style={{ background: `color-mix(in srgb, ${color} 10%, transparent)`, color }}>
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{item.title}</p>
                      <span className="rounded-md px-2 py-0.5 text-[11px] font-bold tabular-nums" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>{item.count}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ink-3)" }}>{item.detail}</p>
                  </div>
                </div>
                <Link to={item.href} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold" style={{ color: "var(--color-accent)" }}>
                  {item.action} <ArrowRight size={13} />
                </Link>
              </div>
            );
          })}
          {processingDocuments > 0 && (
            <div className="flex items-center gap-3 px-5 py-3 sm:px-6">
              <FileText size={15} style={{ color: "var(--ink-3)" }} />
              <p className="text-xs" style={{ color: "var(--ink-2)" }}>{processingDocuments} statement(s) are still processing. They will appear in the review queue when extraction completes.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
