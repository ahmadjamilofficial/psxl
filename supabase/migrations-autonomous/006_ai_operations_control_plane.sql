-- Migration 006: AI Operations Control Plane
-- A durable, auditable roster for bounded agents across the whole company.
-- Execution remains on agent_jobs; this migration adds role metadata and org policy.

CREATE TABLE IF NOT EXISTS public.agent_role_catalog (
  role_code          TEXT PRIMARY KEY,
  display_name       TEXT NOT NULL,
  mission            TEXT NOT NULL,
  description        TEXT NOT NULL,
  allowed_tools      TEXT[] NOT NULL DEFAULT '{}',
  trigger_types      TEXT[] NOT NULL DEFAULT '{}',
  default_policy_tier TEXT NOT NULL DEFAULT 'REVIEW'
                     CHECK (default_policy_tier IN ('AUTO','NOTIFY','REVIEW','STOP')),
  success_metrics    JSONB NOT NULL DEFAULT '[]',
  escalation_path    TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.agent_role_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_code         TEXT NOT NULL REFERENCES public.agent_role_catalog(role_code) ON DELETE CASCADE,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  policy_override   TEXT CHECK (policy_override IN ('AUTO','NOTIFY','REVIEW','STOP')),
  priority          INT NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  daily_run_limit   INT NOT NULL DEFAULT 100 CHECK (daily_run_limit > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, role_code)
);

CREATE INDEX IF NOT EXISTS agent_role_configs_org_idx
  ON public.agent_role_configs (org_id, enabled, priority DESC);

ALTER TABLE public.agent_role_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_role_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_role_catalog_members_read" ON public.agent_role_catalog;
CREATE POLICY "agent_role_catalog_members_read"
  ON public.agent_role_catalog FOR SELECT
  USING (auth.uid() IS NOT NULL);

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
    WHERE p.user_id = auth.uid()
      AND p.org_id = agent_role_configs.org_id
      AND p.role IN ('owner', 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.org_id = agent_role_configs.org_id
      AND p.role IN ('owner', 'admin')
  ));

INSERT INTO public.agent_role_catalog
  (role_code, display_name, mission, description, allowed_tools, trigger_types, default_policy_tier, success_metrics, escalation_path)
VALUES
  ('ingestion_sync', 'Ingestion & Sync', 'Keep connected sources fresh and imports truthful.', 'Verifies providers, imports normalized records, and reports freshness or provider failures without claiming success.', ARRAY['provider_adapters','connection_health','agent_jobs'], ARRAY['ingestion','sheet_change','cron_nightly'], 'AUTO', '["sync_success_rate","freshness_sla","duplicate_rate"]', 'Escalate provider auth failures to the workspace owner.'),
  ('reconciliation', 'Reconciliation', 'Turn fragmented records into an explainable, balanced ledger.', 'Matches source records, detects gaps, and proposes canonical ledger projections with evidence.', ARRAY['normalized_records','transactions','ledger_entries','evidence'], ARRAY['ingestion','upload','cron_nightly'], 'REVIEW', '["match_precision","unmatched_rate","time_to_resolution"]', 'Send uncertain or material matches to Review Inbox.'),
  ('exception_triage', 'Exception Triage', 'Reduce operational backlog without hiding risk.', 'Clusters failed, low-confidence, stale, or contradictory records and routes each to a next action.', ARRAY['agent_jobs','audit_log','notifications'], ARRAY['manual','ingestion','cron_nightly'], 'NOTIFY', '["exception_age","routing_accuracy","resolution_time"]', 'Escalate unresolved material exceptions to an operator.'),
  ('compliance_audit', 'Compliance & Audit', 'Make every automated decision inspectable and reversible.', 'Checks policy boundaries, provenance, audit completeness, and approval requirements before side effects.', ARRAY['audit_log','agent_approvals','policy_config'], ARRAY['manual','cron_monthly','cron_nightly'], 'STOP', '["audit_completeness","policy_violations","approval_sla"]', 'Stop the operation and require an owner or admin decision.'),
  ('customer_support', 'Customer Support', 'Resolve product questions with evidence and a clear handoff.', 'Drafts grounded support responses from workspace status, activity, and documented product behavior.', ARRAY['activity_feed','help_center','notifications'], ARRAY['email','manual'], 'REVIEW', '["first_response_time","grounded_resolution_rate","escalation_rate"]', 'Escalate account, billing, security, or financial interpretation issues to a human.'),
  ('reliability_maintenance', 'Reliability & Maintenance', 'Keep the product dependable as usage and integrations scale.', 'Monitors queues, retries, dead letters, provider health, freshness, and deployment signals.', ARRAY['agent_jobs','provider_health','audit_log'], ARRAY['cron_nightly','manual'], 'NOTIFY', '["dead_letter_rate","recovery_time","queue_age"]', 'Page the technical owner for repeated or cross-tenant failures.'),
  ('customer_success', 'Customer Success & Onboarding', 'Get each workspace to its first trusted ledger quickly.', 'Guides source connection, verification, first sync, review, and activation without making unsupported financial claims.', ARRAY['connected_sources','activity_feed','notifications'], ARRAY['manual','ingestion'], 'REVIEW', '["time_to_first_ledger","activation_rate","retention"]', 'Escalate stalled onboarding to a customer operator.'),
  ('marketing_growth', 'Marketing & Growth', 'Turn verified product value into focused, permissioned growth.', 'Drafts evidence-led lifecycle messages, case-study candidates, and experiments; never publishes without approval.', ARRAY['product_metrics','content_drafts','approvals'], ARRAY['manual','cron_monthly'], 'STOP', '["qualified_activation","experiment_learning","unsubscribe_rate"]', 'Require owner approval before external publication or customer claims.'),
  ('founder_metrics', 'Founder Metrics & Reporting', 'Give the team a truthful operating picture.', 'Builds recurring reports on ingestion reliability, value delivered, retention, support, and commercial learning.', ARRAY['audit_log','agent_jobs','product_metrics'], ARRAY['cron_nightly','cron_monthly','manual'], 'NOTIFY', '["report_freshness","metric_completeness","decision_latency"]', 'Escalate missing or contradictory metrics to the operating owner.')
ON CONFLICT (role_code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  mission = EXCLUDED.mission,
  description = EXCLUDED.description,
  allowed_tools = EXCLUDED.allowed_tools,
  trigger_types = EXCLUDED.trigger_types,
  default_policy_tier = EXCLUDED.default_policy_tier,
  success_metrics = EXCLUDED.success_metrics,
  escalation_path = EXCLUDED.escalation_path;

-- New organizations receive the full roster; existing organizations are backfilled safely.
INSERT INTO public.agent_role_configs (org_id, role_code)
SELECT o.id, c.role_code
FROM public.organizations o CROSS JOIN public.agent_role_catalog c
ON CONFLICT (org_id, role_code) DO NOTHING;

-- Service-role provisioning can call this for organizations created after migration.
CREATE OR REPLACE FUNCTION public.provision_agent_role_configs(p_org_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INT;
BEGIN
  INSERT INTO public.agent_role_configs (org_id, role_code)
  SELECT p_org_id, role_code FROM public.agent_role_catalog
  ON CONFLICT (org_id, role_code) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
