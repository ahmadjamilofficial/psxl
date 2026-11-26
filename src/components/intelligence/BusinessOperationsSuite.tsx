import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, ArrowRight, Building2, ClipboardCheck, FileCheck2, ShieldCheck, Users, Workflow, Network } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

type BusinessPlan = "brokerage-pilot" | "brokerage-operations" | "brokerage-enterprise";
type BusinessSubscription = {
  plan: BusinessPlan;
  status: string;
  charge_period: string;
  current_period_end: string | null;
  end_date: string | null;
  activated_at: string | null;
};

const planNames: Record<BusinessPlan, string> = {
  "brokerage-pilot": "Brokerage Pilot",
  "brokerage-operations": "Business Operations",
  "brokerage-enterprise": "Business Enterprise",
};

export function BusinessOperationsSuite() {
  const { profile } = useAuth();
  const [subscription, setSubscription] = useState<BusinessSubscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!profile?.org_id || profile.workspace_type === "individual") {
      setSubscription(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      const { data, error } = await (supabase as any)
        .from("business_subscriptions")
        .select("plan,status,charge_period,current_period_end,end_date,activated_at")
        .eq("org_id", profile.org_id)
        .maybeSingle();
      if (!alive) return;
      setSubscription(error ? null : (data as BusinessSubscription | null));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [profile?.org_id, profile?.workspace_type]);

  if (profile?.workspace_type === "individual") return null;

  const paid = subscription?.status === "active" &&
    (subscription.plan === "brokerage-pilot" ||
      !subscription.current_period_end ||
      new Date(subscription.current_period_end).getTime() > Date.now());
  const plan = subscription?.plan;
  const features = [
    { icon: FileCheck2, title: "Broker statement intake", detail: "Import source files and review extracted records before posting.", href: "/app/parser", included: paid },
    { icon: Workflow, title: "Reconciliation workbench", detail: "Investigate mismatched fees, quantities, duplicates and ledger exceptions.", href: "/app/reconciliation", included: paid },
    { icon: ShieldCheck, title: "Approval and evidence trail", detail: "Keep material review decisions and source evidence traceable.", href: "/app/agent", included: paid },
    { icon: Users, title: "Team operations", detail: "Coordinate review and approval work across workspace members.", href: "/app/agent", included: paid && (plan === "brokerage-operations" || plan === "brokerage-enterprise") },
    { icon: Activity, title: "Operational intelligence", detail: "Monitor exception queues, document processing and ledger health.", href: "/app/overview", included: paid && (plan === "brokerage-operations" || plan === "brokerage-enterprise") },
    { icon: Network, title: "Enterprise integration scope", detail: "Enterprise onboarding for multi-entity and custom integration requirements.", href: "/app/integrations", included: paid && plan === "brokerage-enterprise" },
  ];

  return (
    <section className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6" style={{ borderColor: "var(--hairline)" }}>
        <div className="flex items-center gap-3">
          <span className="rounded-lg p-2" style={{ background: "var(--accent-10)", color: "var(--color-accent)" }}><Building2 size={17}/></span>
          <div>
            <h2 className="text-sm font-bold">PSXL Business Desk</h2>
            <p className="text-xs" style={{ color: "var(--ink-3)" }}>Brokerage-only workflows and organisation-level controls</p>
          </div>
        </div>
        {loading ? <span className="text-xs" style={{ color: "var(--ink-3)" }}>Checking access…</span> :
          paid && subscription ? <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "color-mix(in srgb, var(--ok) 12%, transparent)", color: "var(--ok)" }}>{planNames[subscription.plan]} · Active</span> :
          <Link to="/pricing" className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: "var(--color-accent)", color: "var(--accent-fg)" }}>View Business plans <ArrowRight size={13}/></Link>}
      </div>
      {!loading && !paid && (
        <p className="px-5 pt-4 text-xs" style={{ color: "var(--ink-2)" }}>
          Your organisation workspace is ready. Activate a Brokerage Pilot, Operations or Enterprise plan to unlock the Business Desk workflows.
        </p>
      )}
      <div className="grid gap-px sm:grid-cols-2 xl:grid-cols-3" style={{ background: "var(--hairline)" }}>
        {features.map((feature) => {
          const Icon = feature.icon;
          const enabled = feature.included;
          return (
            <div key={feature.title} className="flex min-h-[132px] flex-col justify-between p-4 sm:p-5" style={{ background: "var(--surface)", opacity: enabled || loading ? 1 : 0.62 }}>
              <div className="flex items-start gap-3">
                <span className="rounded-lg p-2" style={{ background: "var(--accent-6)", color: "var(--color-accent)" }}><Icon size={16}/></span>
                <div>
                  <p className="text-sm font-semibold">{feature.title}</p>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ink-3)" }}>{feature.detail}</p>
                </div>
              </div>
              {enabled ? <Link to={feature.href as any} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--color-accent)" }}>Open workflow <ArrowRight size={12}/></Link> :
                <span className="mt-3 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>{loading ? "Checking" : "Plan locked"}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
