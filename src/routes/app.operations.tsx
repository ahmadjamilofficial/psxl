import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  Loader2,
  PauseCircle,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAiOperations } from "@/lib/data-hooks";
import type { AgentPolicyTier, AgentRole } from "@/lib/ai-operations";

export const Route = createFileRoute("/app/operations")({ component: OperationsPage });

const tierColor: Record<AgentPolicyTier, string> = {
  AUTO: "var(--ok)",
  NOTIFY: "var(--warn)",
  REVIEW: "var(--color-accent)",
  STOP: "var(--bad)",
};

const roleIcon: Record<string, typeof Bot> = {
  ingestion_sync: ArrowRight,
  reconciliation: CheckCircle2,
  exception_triage: AlertTriangle,
  compliance_audit: ShieldCheck,
  customer_support: Users,
  reliability_maintenance: Wrench,
  customer_success: Sparkles,
  marketing_growth: Users,
  founder_metrics: Clock3,
};

function Stat({
  label,
  value,
  tone = "var(--color-text)",
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div
      className="rounded-2xl px-4 py-4"
      style={{ border: "1px solid var(--hairline)", background: "var(--surface)" }}
    >
      <div className="text-2xl font-semibold tabular-nums" style={{ color: tone }}>
        {value}
      </div>
      <div className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
        {label}
      </div>
    </div>
  );
}

function RoleCard({ role }: { role: AgentRole }) {
  const Icon = roleIcon[role.role_code] ?? Bot;
  const tier = role.policy_override ?? role.default_policy_tier;
  return (
    <article
      className="rounded-2xl p-5"
      style={{ border: "1px solid var(--hairline)", background: "var(--surface)" }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: "var(--accent-8)", color: "var(--color-accent)" }}
        >
          <Icon size={17} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{role.display_name}</h2>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                color: tierColor[tier],
                background: `color-mix(in srgb, ${tierColor[tier]} 10%, transparent)`,
              }}
            >
              {tier}
            </span>
            {!role.enabled && (
              <span className="text-[10px]" style={{ color: "var(--ink-3)" }}>
                paused
              </span>
            )}
          </div>
          <p className="mt-1 text-xs font-medium" style={{ color: "var(--ink-2)" }}>
            {role.mission}
          </p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6" style={{ color: "var(--ink-2)" }}>
        {role.description}
      </p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {role.trigger_types.map((trigger) => (
          <span
            key={trigger}
            className="rounded-md px-2 py-1 text-[10px]"
            style={{ background: "var(--surface-2)", color: "var(--ink-3)" }}
          >
            {trigger}
          </span>
        ))}
      </div>
      <div
        className="mt-4 border-t pt-3 text-xs leading-5"
        style={{ borderColor: "var(--hairline)", color: "var(--ink-3)" }}
      >
        <span className="font-medium" style={{ color: "var(--ink-2)" }}>
          Escalation:
        </span>{" "}
        {role.escalation_path}
      </div>
    </article>
  );
}

function OperationsPage() {
  const { profile } = useAuth();
  const { data, isLoading, isError, refetch, isFetching } = useAiOperations(profile?.org_id);
  const health = data?.health;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div
            className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em]"
            style={{ color: "var(--color-accent)" }}
          >
            <Bot size={14} /> AI operations
          </div>
          <h1 className="text-2xl font-bold tracking-tight">The operating system behind PSXL</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: "var(--ink-2)" }}>
            Every agent has a narrow mission, explicit permissions, a policy tier, and a human
            escalation path. The queue remains durable and auditable; automation never silently
            becomes financial authority.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/app/review"
            className="rounded-xl px-3 py-2 text-sm font-medium"
            style={{ border: "1px solid var(--hairline)" }}
          >
            Review inbox
          </Link>
          <Link
            to="/app/activity"
            className="rounded-xl px-3 py-2 text-sm font-medium"
            style={{ background: "var(--color-accent)", color: "white" }}
          >
            Open activity
          </Link>
        </div>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin" style={{ color: "var(--color-accent)" }} />
        </div>
      ) : isError ? (
        <div
          className="rounded-2xl p-6"
          style={{
            border: "1px solid color-mix(in srgb, var(--bad) 30%, transparent)",
            background: "color-mix(in srgb, var(--bad) 5%, transparent)",
          }}
        >
          <p className="text-sm font-medium">AI operations metadata is not available yet.</p>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
            Apply migration 006 to enable the control plane. Existing queue and ledger operations
            are unchanged.
          </p>
        </div>
      ) : (
        <>
          <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-6">
            <Stat label="Jobs · 30 days" value={health?.total ?? 0} />
            <Stat label="Queued" value={health?.queued ?? 0} tone="var(--color-accent)" />
            <Stat label="Running" value={health?.running ?? 0} tone="var(--color-accent)" />
            <Stat label="Completed" value={health?.completed ?? 0} tone="var(--ok)" />
            <Stat label="Failed" value={health?.failed ?? 0} tone="var(--bad)" />
            <Stat label="Approvals" value={health?.approvalCount ?? 0} tone="var(--warn)" />
          </section>

          <section className="mb-6 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Agent roster</h2>
              <p className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>
                Nine bounded functions cover the company, not just engineering.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium"
              style={{ border: "1px solid var(--hairline)" }}
            >
              <Loader2 size={13} className={isFetching ? "animate-spin" : ""} /> Refresh
            </button>
          </section>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {(data?.roles ?? []).map((role) => (
              <RoleCard key={role.role_code} role={role} />
            ))}
          </div>

          <section
            className="mt-8 rounded-2xl p-5"
            style={{ border: "1px solid var(--hairline)", background: "var(--surface)" }}
          >
            <div className="flex items-start gap-3">
              <PauseCircle size={17} style={{ color: "var(--warn)" }} />
              <div>
                <h2 className="text-sm font-semibold">Operating contract</h2>
                <p className="mt-1 text-sm leading-6" style={{ color: "var(--ink-2)" }}>
                  AUTO handles bounded, reversible work. NOTIFY informs operators. REVIEW drafts or
                  proposes a material action. STOP cannot proceed without an owner or admin
                  approval. Provider failures, low confidence, policy violations, and dead-letter
                  jobs remain visible instead of being hidden.
                </p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
