-- PSXL customer-facing AI Operations control plane.
-- This timestamped migration is intentionally in supabase/migrations so Supabase CLI
-- discovers it with the normal migration runner (unlike the legacy migrations-autonomous folder).

CREATE TABLE IF NOT EXISTS public.agent_role_catalog (
  role_code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  mission TEXT NOT NULL,
  description TEXT NOT NULL,
  allowed_tools TEXT[] NOT NULL DEFAULT '{}',
  trigger_types TEXT[] NOT NULL DEFAULT '{}',
  default_policy_tier TEXT NOT NULL DEFAULT 'REVIEW'
    CHECK (default_policy_tier IN ('AUTO','NOTIFY','REVIEW','STOP')),
  success_metrics JSONB NOT NULL DEFAULT '[]',
  escalation_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.agent_role_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL REFERENCES public.agent_role_catalog(role_code) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  policy_override TEXT CHECK (policy_override IN ('AUTO','NOTIFY','REVIEW','STOP')),
  priority INT NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  daily_run_limit INT NOT NULL DEFAULT 100 CHECK (daily_run_limit > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, role_code)
);

CREATE INDEX IF NOT EXISTS agent_role_configs_org_idx
  ON public.agent_role_configs (org_id, enabled, priority DESC);

ALTER TABLE public.agent_role_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_role_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_role_catalog_members_read" ON public.agent_role_catalog;
CREATE POLICY "agent_role_catalog_members_read"
  ON public.agent_role_catalog FOR SELECT
  USING (auth.uid() IS NOT NULL AND role_code IN (
    'ingestion_sync','reconciliation','exception_triage','compliance_audit','reliability_maintenance'
  ));

DROP POLICY IF EXISTS "agent_role_configs_members_read" ON public.agent_role_configs;
CREATE POLICY "agent_role_configs_members_read"
  ON public.agent_role_configs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.org_id = agent_role_configs.org_id
  ));

DROP POLICY IF EXISTS "agent_role_configs_admin_write" ON public.agent_role_configs;
CREATE POLICY "agent_role_configs_admin_write"
  ON public.agent_role_configs FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.org_id = agent_role_configs.org_id
      AND p.role IN ('owner','admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.org_id = agent_role_configs.org_id
      AND p.role IN ('owner','admin')
  ));

INSERT INTO public.agent_role_catalog
  (role_code, display_name, mission, description, allowed_tools, trigger_types, default_policy_tier, success_metrics, escalation_path)
VALUES
  ('ingestion_sync','Ingestion & Sync','Keep connected sources fresh and imports truthful.','Verifies connected providers, imports normalized records, and reports freshness or provider failures.','{provider_adapters,connection_health,agent_jobs}','{ingestion,sheet_change,cron_nightly}','AUTO','["sync_success_rate","freshness_sla","duplicate_rate"]','Escalate provider authentication failures to the workspace owner.'),
  ('reconciliation','Reconciliation','Turn fragmented records into an explainable, balanced ledger.','Matches source records, detects gaps, and proposes ledger updates with supporting evidence.','{normalized_records,transactions,ledger_entries,evidence}','{ingestion,upload,cron_nightly}','REVIEW','["match_precision","unmatched_rate","time_to_resolution"]','Send uncertain or material matches to Review Inbox.'),
  ('exception_triage','Exception Triage','Reduce operational backlog without hiding risk.','Clusters failed, low-confidence, stale, or contradictory records and routes each to a next action.','{agent_jobs,audit_log,notifications}','{manual,ingestion,cron_nightly}','NOTIFY','["exception_age","routing_accuracy","resolution_time"]','Escalate unresolved material exceptions for human review.'),
  ('compliance_audit','Compliance & Audit','Make every automated decision inspectable and reversible.','Checks policy boundaries, provenance, audit completeness, and approval requirements before side effects.','{audit_log,agent_approvals,policy_config}','{manual,cron_monthly,cron_nightly}','STOP','["audit_completeness","policy_violations","approval_sla"]','Stop the operation and require an owner or admin decision.'),
  ('reliability_maintenance','Reliability & Maintenance','Keep the workspace dependable as usage and integrations scale.','Monitors queues, retries, dead letters, provider health, and data freshness.','{agent_jobs,provider_health,audit_log}','{cron_nightly,manual}','NOTIFY','["dead_letter_rate","recovery_time","queue_age"]','Escalate repeated or cross-workspace failures to the technical owner.')
ON CONFLICT (role_code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  mission = EXCLUDED.mission,
  description = EXCLUDED.description,
  allowed_tools = EXCLUDED.allowed_tools,
  trigger_types = EXCLUDED.trigger_types,
  default_policy_tier = EXCLUDED.default_policy_tier,
  success_metrics = EXCLUDED.success_metrics,
  escalation_path = EXCLUDED.escalation_path;

-- Backfill every existing workspace; never provision company-internal agents to customers.
INSERT INTO public.agent_role_configs (org_id, role_code)
SELECT o.id, c.role_code
FROM public.organizations o
CROSS JOIN public.agent_role_catalog c
WHERE c.role_code IN (
  'ingestion_sync','reconciliation','exception_triage','compliance_audit','reliability_maintenance'
)
ON CONFLICT (org_id, role_code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.provision_customer_agent_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.agent_role_configs (org_id, role_code)
  SELECT NEW.id, role_code
  FROM public.agent_role_catalog
  WHERE role_code IN (
    'ingestion_sync','reconciliation','exception_triage','compliance_audit','reliability_maintenance'
  )
  ON CONFLICT (org_id, role_code) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provision_customer_agent_roles_after_org_insert ON public.organizations;
CREATE TRIGGER provision_customer_agent_roles_after_org_insert
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.provision_customer_agent_roles();
