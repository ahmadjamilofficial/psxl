-- Enable organisation-scoped Supabase Realtime events for the PSXL workspace.
-- Idempotent: safe to apply when some tables are already in supabase_realtime.
DO $$
DECLARE
  target_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;

  FOREACH target_table IN ARRAY ARRAY[
    'transactions',
    'reconciliation_flags',
    'documents',
    'agent_jobs',
    'agent_approvals',
    'broker_accounts',
    'audit_log',
    'connected_sources',
    'notifications',
    'tax_profiles'
  ] LOOP
    IF to_regclass(format('public.%I', target_table)) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = target_table
      )
    THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target_table);
    END IF;
  END LOOP;
END $$;
