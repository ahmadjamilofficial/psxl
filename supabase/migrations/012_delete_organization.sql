-- Wab: safe organization deletion
-- Run in Supabase SQL Editor. The client calls this RPC instead of deleting the
-- parent row directly, which would fail when dependent records still exist.

create or replace function public.delete_current_organization(_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  current_org uuid;
begin
  select p.org_id, p.role
    into current_org, actor_role
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if auth.uid() is null or current_org is null or current_org <> _org_id then
    raise exception 'You do not have access to this organisation.' using errcode = '42501';
  end if;

  if actor_role <> 'owner' then
    raise exception 'Only the organisation owner can delete the organisation.' using errcode = '42501';
  end if;

  -- Delete tables whose rows are not guaranteed to cascade from organizations.
  -- Keep this list explicit so a future table is not silently erased until its
  -- deletion policy is reviewed and added here.
  delete from public.chat_messages where org_id = _org_id;
  delete from public.chat_threads where org_id = _org_id;
  delete from public.messages where org_id = _org_id;
  delete from public.conversation_summaries where org_id = _org_id;
  delete from public.agent_tasks where org_id = _org_id;
  delete from public.task_results where org_id = _org_id;
  delete from public.agent_memories where org_id = _org_id;
  delete from public.ai_usage where org_id = _org_id;
  delete from public.subscription_events where org_id = _org_id;
  delete from public.subscriptions where org_id = _org_id;
  delete from public.provider_events where org_id = _org_id;
  delete from public.provider_sync_runs where org_id = _org_id;
  delete from public.provider_transactions where org_id = _org_id;
  delete from public.provider_accounts where org_id = _org_id;
  delete from public.integration_audit where org_id = _org_id;
  delete from public.provider_credentials where org_id = _org_id;
  delete from public.provider_connections where org_id = _org_id;
  delete from public.tax_loss_harvest_suggestions where org_id = _org_id;
  delete from public.tax_computations where org_id = _org_id;
  delete from public.reconciliation_flags where org_id = _org_id;
  delete from public.ledger_entries where org_id = _org_id;
  delete from public.transactions where org_id = _org_id;
  delete from public.documents where org_id = _org_id;
  delete from public.broker_accounts where org_id = _org_id;
  delete from public.audit_log where org_id = _org_id;
  delete from public.notifications where org_id = _org_id;
  delete from public.org_invites where org_id = _org_id;
  delete from public.financial_events where org_id = _org_id;
  delete from public.financial_insights where org_id = _org_id;
  delete from public.financial_investigations where org_id = _org_id;
  delete from public.tax_profiles where org_id = _org_id;
  delete from public.profiles where org_id = _org_id;
  delete from public.organizations where id = _org_id;

  if not found then
    raise exception 'Organisation was not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.delete_current_organization(uuid) from public;
grant execute on function public.delete_current_organization(uuid) to authenticated;
