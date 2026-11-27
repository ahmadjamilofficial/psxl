import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  Bell,
  Building2,
  Copy,
  CreditCard,
  Download,
  Activity,
  Trash2,
  Loader2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Btn, Panel } from "@/components/kit";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { setNotificationPrefs } from "@/lib/notifications";
import {
  useAiUsage30Days,
  useMonthlyDocumentCount,
  useDeleteOrganization,
  useMonthlyTransactionCount,
  useTransactions,
} from "@/lib/data-hooks";
import { normalizePlanId, planOf } from "@/lib/plans";
import { DirectSourceConnect } from "@/components/app/DirectSourceConnect";

export const Route = createFileRoute("/app/settings")({
  component: Settings,
});

type Tab = "org" | "usage" | "tax-profiles" | "import" | "notifications";

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: "org", label: "Organisation", icon: Building2 },
  { id: "usage", label: "Usage", icon: Activity },
  { id: "tax-profiles", label: "Tax Profiles", icon: CreditCard },
  { id: "import", label: "Import Data", icon: Download },
  { id: "notifications", label: "Notifications", icon: Bell },
];

function Settings() {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentHref = useRouterState({ select: (state) => state.location.href });
  const [tab, setTab] = useState<Tab>("org");
  useEffect(() => {
    const params = new URL(currentHref, window.location.origin).searchParams;
    setTab(params.get("tab") === "usage" ? "usage" : "org");
  }, [currentHref]);
  const [orgName, setOrgName] = useState(profile?.org_name ?? "My Organisation");
  const [jurisdiction, setJurisdiction] = useState(profile?.jurisdiction ?? "CUSTOM");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletingOrg, setDeletingOrg] = useState(false);
  const canManageOrganisation = profile?.role === "owner" || profile?.role === "admin";
  const canDeleteOrganisation = profile?.role === "owner";

  useEffect(() => {
    setOrgName(profile?.org_name ?? "My Organisation");
    setJurisdiction(profile?.jurisdiction ?? "CUSTOM");
  }, [profile?.org_id, profile?.org_name, profile?.jurisdiction]);

  const deleteOrgMutation = useDeleteOrganization();
  const { data: aiUsage } = useAiUsage30Days(user?.id);
  const { data: monthlyDocuments = 0 } = useMonthlyDocumentCount(profile?.org_id);
  const { data: monthlyTransactions = 0 } = useMonthlyTransactionCount(profile?.org_id);
  const { data: ledgerTransactions = [] } = useTransactions(profile?.org_id);
  const activePlan = planOf(normalizePlanId(profile?.plan));
  const aiLimit = activePlan.monthlyAiCredits;
  const transactionLimit = activePlan.transactionsPerMonth;
  const aiUsed = aiUsage?.credits_used_month ?? 0;
  const aiPercent = Math.min(100, Math.round((aiUsed / aiLimit) * 100));
  const uploadPercent = Math.min(100, Math.round((monthlyDocuments / activePlan.uploadsPerMonth) * 100));
  const transactionPercent =
    transactionLimit === null
      ? 0
      : Math.min(100, Math.round((monthlyTransactions / transactionLimit) * 100));

  const [notifications, setNotifications] = useState({
    lowConfidenceAlert: true,
    reconciliationFlag: true,
    taxComputationUpdate: false,
    monthlyDigest: true,
  });

  const displayName = profile?.full_name || user?.email?.split("@")[0] || "User";
  const initials = displayName.charAt(0).toUpperCase();
  const avatarUrl =
    profile?.avatar_url || (user?.user_metadata?.["avatar_url"] as string | undefined);

  async function save() {
    if (!profile?.org_id) return;

    setSaving(true);
    try {
      const cleanName = orgName.trim();
      if (cleanName.length < 2) throw new Error("Organisation name must contain at least 2 characters.");

      const { data, error } = await supabase
        .from("organizations")
        .update({
          name: cleanName,
          jurisdiction_default: jurisdiction,
          updated_at: new Date().toISOString(),
        })
        .eq("id", profile.org_id)
        .select("id, name, jurisdiction_default")
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new Error("No organisation was updated. Check that you are an organisation owner or admin and that the settings migration is applied.");

      setOrgName(data.name);
      setJurisdiction(data.jurisdiction_default);
      await refreshProfile();
      await queryClient.invalidateQueries({ queryKey: ["org-members", profile.org_id] });

      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save organisation settings");
    } finally {
      setSaving(false);
    }
  }

  async function deleteOrganisation() {
    if (!profile?.org_id) return;
    if (deleteConfirm !== profile.org_name) {
      toast.error("Type the organisation name exactly to confirm");
      return;
    }
    setDeletingOrg(true);
    try {
      await deleteOrgMutation.mutateAsync({ orgId: profile.org_id });
      toast.success("Organisation deleted");
      await signOut();
      navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete organisation");
    } finally {
      setDeletingOrg(false);
    }
  }

  async function updateNotificationSettings() {
    if (!profile?.org_id) return;

    try {
      const { error } = await supabase.from("org_settings").upsert({
        org_id: profile.org_id,
        notification_preferences: notifications,
      });

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["org_settings"] });
      toast.success("Notification preferences updated");
    } catch (error) {
      console.error("Failed to update notification settings:", error);
    }
  }

  function handleNotificationChange(key: keyof typeof notifications, value: boolean) {
    const newPrefs = { ...notifications, [key]: value };
    setNotifications(newPrefs);
    setNotificationPrefs(newPrefs);
    updateNotificationSettings();

    if (value) {
      const messages: Record<keyof typeof notifications, string> = {
        lowConfidenceAlert: "Low-confidence extraction alerts enabled",
        reconciliationFlag: "Reconciliation flag notifications enabled",
        taxComputationUpdate: "Tax computation updates enabled",
        monthlyDigest: "Monthly ledger digest enabled",
      };
      toast.success(messages[key]);
    }
  }

  return (
    <div className="space-y-6 p-3 sm:p-6">
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: "1.5rem" }}>Settings</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Manage your organisation, tax profiles, team, and notifications.
        </p>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <nav
          className="hidden w-44 shrink-0 rounded-2xl bg-surface p-2 lg:block"
          style={{ border: "1px solid var(--hairline)", alignSelf: "start" }}
        >
          {TABS.map(({ id, label, icon: Ic }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors"
              style={{
                background: tab === id ? "var(--accent-10)" : "transparent",
                color: tab === id ? "var(--color-accent)" : "var(--ink-2)",
              }}
            >
              <Ic size={16} strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </nav>

        <div className="w-full lg:hidden">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TABS.map(({ id, label, icon: Ic }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className="flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-center text-xs font-medium transition-colors"
                style={{
                  background: tab === id ? "var(--color-accent)" : "var(--color-login-bg)",
                  color: tab === id ? "var(--accent-fg)" : "var(--ink-2)",
                }}
                aria-current={tab === id ? "page" : undefined}
              >
                <Ic size={15} strokeWidth={1.8} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 w-full flex-1 space-y-4">
          {tab === "org" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <Panel>
                <p className="mb-4 text-sm font-semibold">Organisation Details</p>
                <div className="space-y-4">
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-medium"
                      style={{ color: "var(--ink-2)" }}
                    >
                      Organisation name
                    </label>
                    <input
                      type="text"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      className="w-full rounded-[10px] border bg-surface px-4 py-3 text-sm outline-none focus:ring-2"
                      style={{
                        borderColor: "var(--hairline)",
                        maxWidth: 400,
                        ["--tw-ring-color" as string]: "var(--color-accent)",
                      }}
                    />
                  </div>
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-medium"
                      style={{ color: "var(--ink-2)" }}
                    >
                      Default jurisdiction
                    </label>
                    <select
                      value={jurisdiction}
                      onChange={(e) => setJurisdiction(e.target.value)}
                      className="w-full rounded-[10px] border bg-surface px-4 py-3 text-sm outline-none"
                      style={{ borderColor: "var(--hairline)", maxWidth: 400 }}
                    >
                      <option value="PSX">PSX — Pakistan</option>
                      <option value="NSE">NSE — India</option>
                      <option value="CUSTOM">Other / Global</option>
                    </select>
                  </div>
                  <Btn onClick={save} variant="primary" disabled={saving || !canManageOrganisation}>
                    {saving ? (
                      <>
                        <Loader2 size={15} strokeWidth={1.75} className="animate-spin" />
                        Saving...
                      </>
                    ) : saved ? (
                      "Saved ✓"
                    ) : (
                      "Save changes"
                    )}
                  </Btn>
                </div>
              </Panel>

              <Panel
                style={{ border: "1px solid color-mix(in srgb, var(--bad) 20%, transparent)" }}
              >
                <p className="mb-2 text-sm font-semibold" style={{ color: "var(--bad)" }}>
                  Danger Zone
                </p>
                <p className="mb-4 text-sm" style={{ color: "var(--ink-2)" }}>
                  Deleting your organisation permanently removes all transactions, tax computations,
                  and audit logs. This action cannot be undone.
                </p>
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder={`Type "${profile?.org_name ?? ""}" to confirm`}
                  className="mb-8 mt-2 w-full rounded-[10px] border bg-surface px-4 py-3 text-sm outline-none"
                  style={{ borderColor: "var(--hairline)", maxWidth: 400, marginBottom: "3rem" }}
                />
                <Btn
                  variant="ghost"
                  onClick={deleteOrganisation}
                  disabled={deletingOrg || !canDeleteOrganisation}
                  className="!text-[var(--bad)] border border-[var(--bad)]/30 hover:!bg-red-50"
                >
                  {deletingOrg ? (
                    <Loader2 size={15} strokeWidth={1.75} className="animate-spin" />
                  ) : (
                    <Trash2 size={15} strokeWidth={1.75} />
                  )}
                  Delete organisation
                </Btn>
              </Panel>
            </motion.div>
          )}

          {tab === "usage" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <Panel>
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">Usage</p>
                    <p className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>
                      Current limits for your {activePlan.name} plan. AI credits and uploads use a rolling 30-day window; transactions reset each calendar month.
                    </p>
                  </div>
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={{ background: "var(--accent-10)", color: "var(--color-accent)" }}
                  >
                    {activePlan.name}
                  </span>
                </div>
                <div className="space-y-5">
                  <UsageMeter
                    label="AI credits"
                    used={aiUsed}
                    limit={aiLimit}
                    percent={aiPercent}
                    suffix="credits / rolling 30 days"
                  />
                  <UsageMeter
                    label="Statement uploads"
                    used={monthlyDocuments}
                    limit={activePlan.uploadsPerMonth}
                    percent={uploadPercent}
                    suffix="uploads / rolling 30 days"
                  />
                  <UsageMeter
                    label="Ledger records"
                    used={ledgerTransactions.length}
                    limit={null}
                    percent={0}
                    suffix="All imported and manually entered records in this organisation"
                  />
                  <UsageMeter
                    label="Monthly transaction allowance"
                    used={monthlyTransactions}
                    limit={transactionLimit}
                    percent={transactionPercent}
                    suffix="New records created this calendar month"
                  />
                </div>
              </Panel>
              {(aiPercent >= 80 || transactionPercent >= 80 || uploadPercent >= 80) && (
                <Panel>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold">You’re getting close to your plan limit</p>
                      <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
                        Upgrade to Standard or Pro for a larger AI and data allowance. Your records remain accessible on every plan.
                      </p>
                    </div>
                    <Btn onClick={() => navigate({ to: "/app/billing" })}>Explore plans</Btn>
                  </div>
                </Panel>
              )}
              <Panel>
                <p className="mb-3 text-sm font-semibold">What counts?</p>
                <ul className="space-y-2 text-xs leading-relaxed" style={{ color: "var(--ink-2)" }}>
                  <li>
                    • Each successful PSXL AI prompt uses one credit. The allowance is measured over a rolling 30-day window and requests stop at the plan limit.
                  </li>
                  <li>
                    • Imported or manually created ledger transactions count toward the monthly transaction allowance.
                  </li>
                  <li>
                    • Each uploaded statement counts toward the rolling 30-day upload allowance. Existing documents and ledger history remain accessible when you reach a limit.
                  </li>
                  <li>
                    • Requests accepted for processing are metered before streaming begins; provider
                    errors are shown without changing your ledger.
                  </li>
                </ul>
              </Panel>
            </motion.div>
          )}

          {tab === "tax-profiles" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Panel>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Tax Profiles</p>
                    <p className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>Set and save custom capital-gains rules for markets without a built-in tax profile.</p>
                  </div>
                  <Btn variant="secondary" onClick={() => navigate({ to: "/app/tax" })}>Configure tax rules</Btn>
                </div>
                <div className="space-y-3">
                  {[
                    {
                      name: "PSX — Pakistan",
                      key: "PSX",
                      rules: "CGT 15% ST / 12.5% LT, Filer WHT 10%",
                    },
                    {
                      name: "NSE — India",
                      key: "NSE",
                      rules: "STCG 20%, LTCG 12.5% (post Budget 2024)",
                    },
                    {
                      name: "Other markets — Custom",
                      key: "CUSTOM",
                      rules: "Configure tax rules for your local jurisdiction in Tax Center",
                    },
                  ].map((p) => {
                    const isActive = jurisdiction === p.key;
                    return (
                      <div
                        key={p.name}
                        className="flex flex-col items-start justify-between gap-3 rounded-xl px-4 py-3 sm:flex-row sm:items-center"
                        style={{
                          background: isActive ? "var(--accent-6)" : "var(--color-login-bg)",
                          border: `1px solid ${isActive ? "var(--accent-20)" : "transparent"}`,
                        }}
                      >
                        <div>
                          <p className="text-sm font-medium">{p.name}</p>
                          <p className="text-xs" style={{ color: "var(--ink-3)" }}>
                            {p.rules}
                          </p>
                        </div>
                        {isActive && (
                          <span
                            className="rounded-full px-2.5 py-1 text-xs font-medium"
                            style={{ background: "var(--color-accent)", color: "var(--accent-fg)" }}
                          >
                            Active
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Panel>
            </motion.div>
          )}

          {tab === "import" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Panel>
                <p className="mb-1 text-sm font-semibold">Import Data</p>
                <p className="mb-5 text-xs" style={{ color: "var(--ink-3)" }}>
                  Upload an Excel / CSV file or connect a Google Sheet. PSXL will ask for permission
                  before touching any of your data.
                </p>
                <DirectSourceConnect
                  orgId={profile?.org_id ?? ""}
                  onComplete={() => setTab("org")}
                />
              </Panel>
            </motion.div>
          )}

          {tab === "notifications" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Panel>
                <p className="mb-4 text-sm font-semibold">Notification Preferences</p>
                <div className="space-y-4">
                  {[
                    {
                      key: "lowConfidenceAlert" as const,
                      label: "Low-confidence extraction alert",
                      desc: "When a parsed field falls below 0.75",
                    },
                    {
                      key: "reconciliationFlag" as const,
                      label: "Reconciliation flag detected",
                      desc: "When a discrepancy is found",
                    },
                    {
                      key: "taxComputationUpdate" as const,
                      label: "Tax computation update",
                      desc: "When new gains are computed",
                    },
                    {
                      key: "monthlyDigest" as const,
                      label: "Monthly ledger digest",
                      desc: "Summary of your monthy performance",
                    },
                  ].map((n) => (
                    <div key={n.key} className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium">{n.label}</p>
                        <p className="text-xs" style={{ color: "var(--ink-3)" }}>
                          {n.desc}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={notifications[n.key]}
                        onChange={(e) => handleNotificationChange(n.key, e.target.checked)}
                        className="size-4 rounded accent-[var(--color-accent)]"
                      />
                    </div>
                  ))}
                </div>
              </Panel>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

function UsageMeter({
  label,
  used,
  limit,
  percent,
  suffix,
}: {
  label: string;
  used: number;
  limit: number | null;
  percent: number;
  suffix: string;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>
            {suffix}
          </p>
        </div>
        <p className="text-sm font-semibold">
          {used.toLocaleString()}{" "}
          <span className="font-normal" style={{ color: "var(--ink-3)" }}>
            / {limit === null ? "Unlimited" : limit.toLocaleString()}
          </span>
        </p>
      </div>
      {limit !== null && (
        <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--accent-6)" }}>
          <div
            className="h-full rounded-full transition-[width]"
            style={{
              width: `${percent}%`,
              background:
                percent >= 90
                  ? "var(--bad)"
                  : percent >= 70
                    ? "var(--warn)"
                    : "var(--color-accent)",
            }}
          />
        </div>
      )}
    </div>
  );
}
