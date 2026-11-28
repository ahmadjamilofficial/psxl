import { supabase } from "./supabase";

export type AgentPolicyTier = "AUTO" | "NOTIFY" | "REVIEW" | "STOP";

// Customer workspaces only receive agents that operate on their PSXL data.
// Marketing, customer support/success, and founder reporting are internal roles.
export const CUSTOMER_AGENT_ROLE_CODES = [
  "ingestion_sync",
  "reconciliation",
  "exception_triage",
  "compliance_audit",
  "reliability_maintenance",
] as const;

export interface AgentRole {
  role_code: string;
  display_name: string;
  mission: string;
  description: string;
  allowed_tools: string[];
  trigger_types: string[];
  default_policy_tier: AgentPolicyTier;
  success_metrics: string[];
  escalation_path: string;
  enabled: boolean;
  policy_override: AgentPolicyTier | null;
  priority: number;
}

export interface AgentJobSummary {
  id: string;
  trigger_type: string;
  status: string;
  created_at: string;
  error_message: string | null;
  result_summary: Record<string, unknown> | null;
}

export interface OperationsHealth {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  deadLetter: number;
  approvalCount: number;
}

export async function fetchAgentOperations(orgId: string): Promise<{
  roles: AgentRole[];
  recentJobs: AgentJobSummary[];
  health: OperationsHealth;
}> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [rolesResult, configsResult, jobsResult, recentJobsResult, approvalsResult] =
    await Promise.all([
      supabase
        .from("agent_role_catalog" as never)
        .select("*")
        .in("role_code", [...CUSTOMER_AGENT_ROLE_CODES])
        .order("display_name"),
      supabase
        .from("agent_role_configs" as never)
        .select("role_code, enabled, policy_override, priority")
        .eq("org_id", orgId)
        .in("role_code", [...CUSTOMER_AGENT_ROLE_CODES]),
      supabase.from("agent_jobs").select("status").eq("org_id", orgId).gte("created_at", since),
      supabase
        .from("agent_jobs")
        .select("id, trigger_type, status, created_at, error_message, result_summary")
        .eq("org_id", orgId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("agent_approvals")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "pending"),
    ]);

  if (rolesResult.error) throw new Error(`Agent catalog: ${rolesResult.error.message}`);
  if (configsResult.error) throw new Error(`Workspace agent settings: ${configsResult.error.message}`);
  if (jobsResult.error) throw new Error(`Agent job history: ${jobsResult.error.message}`);
  if (recentJobsResult.error) throw new Error(`Recent agent activity: ${recentJobsResult.error.message}`);
  if (approvalsResult.error) throw new Error(`Pending approvals: ${approvalsResult.error.message}`);

  const configs = new Map(
    ((configsResult.data ?? []) as Array<Record<string, unknown>>).map((config) => [
      String(config.role_code),
      config,
    ]),
  );
  const roles = ((rolesResult.data ?? []) as unknown[]).map((raw) => {
    const row = raw as Record<string, unknown>;
    const config = configs.get(String(row.role_code)) ?? {};
    return {
      role_code: String(row.role_code),
      display_name: String(row.display_name),
      mission: String(row.mission),
      description: String(row.description),
      allowed_tools: (row.allowed_tools as string[] | null) ?? [],
      trigger_types: (row.trigger_types as string[] | null) ?? [],
      default_policy_tier: String(row.default_policy_tier) as AgentPolicyTier,
      success_metrics: (row.success_metrics as string[] | null) ?? [],
      escalation_path: String(row.escalation_path),
      enabled: config.enabled !== false,
      policy_override: (config.policy_override as AgentPolicyTier | null) ?? null,
      priority: Number(config.priority ?? 50),
    } satisfies AgentRole;
  });
  const statuses = ((jobsResult.data ?? []) as Array<{ status: string }>).map((job) => job.status);

  return {
    roles,
    recentJobs: (recentJobsResult.data ?? []) as AgentJobSummary[],
    health: {
      total: statuses.length,
      queued: statuses.filter((status) => status === "pending").length,
      running: statuses.filter((status) => status === "running").length,
      completed: statuses.filter((status) => status === "done").length,
      failed: statuses.filter((status) => status === "failed" || status === "failed_invariant").length,
      deadLetter: statuses.filter((status) => status === "dead_letter").length,
      approvalCount: approvalsResult.count ?? 0,
    },
  };
}
