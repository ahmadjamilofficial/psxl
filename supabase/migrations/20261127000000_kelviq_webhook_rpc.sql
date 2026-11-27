-- Kelviq webhook RPC for deployments that intentionally do not store a Supabase service-role key.
-- BEFORE RUNNING: replace __PASTE_THE_EXISTING_KELVIQ_WEBHOOK_SECRET_HERE__ below
-- with the exact value already configured as KELVIQ_WEBHOOK_SECRET in Vercel.
-- The database stores only its SHA-256 digest.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.kelviq_webhook_config (
  singleton boolean primary key default true check (singleton),
  secret_sha256 text not null
);

insert into private.kelviq_webhook_config (singleton, secret_sha256)
values (
  true,
  encode(
    extensions.digest(
      convert_to('__PASTE_THE_EXISTING_KELVIQ_WEBHOOK_SECRET_HERE__', 'UTF8'),
      'sha256'
    ),
    'hex'
  )
)
on conflict (singleton) do update
set secret_sha256 = excluded.secret_sha256;

revoke all on private.kelviq_webhook_config from public, anon, authenticated;

create or replace function public.process_kelviq_webhook(
  p_event jsonb,
  p_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id text := p_event->>'id';
  v_event_type text := p_event->>'type';
  v_data jsonb := p_event->'data';
  v_secret_hash text;
  v_subscription_id text := p_event->'data'->>'subscription_id';
  v_org_id uuid;
  v_plan text;
  v_plan_identifier text := p_event->'data'->>'plan_identifier';
  v_charge_period text := coalesce(p_event->'data'->>'charge_period', 'MONTHLY');
  v_period_end timestamptz;
  v_existing_metadata jsonb;
  v_existing_period_end timestamptz;
  v_at_period_end boolean;
begin
  if p_event is null or v_event_id is null or v_event_type is null or jsonb_typeof(v_data) <> 'object' then
    raise exception 'Invalid webhook event';
  end if;

  select c.secret_sha256 into v_secret_hash
  from private.kelviq_webhook_config c
  where c.singleton = true;

  if v_secret_hash is null or p_secret is null
     or encode(extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256'), 'hex') <> v_secret_hash then
    raise exception 'Unauthorized webhook';
  end if;

  if exists (
    select 1 from public.subscription_events e
    where e.kelviq_event_id = v_event_id
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  insert into public.subscription_events (
    kelviq_event_id, event_type, event_data, processed
  ) values (
    v_event_id, v_event_type, v_data, false
  );

  v_plan := case v_plan_identifier
    when 'standard-plan' then 'standard'
    when 'pro-plan' then 'pro'
    when 'free-plan' then 'free'
    else null
  end;

  if v_event_type in ('payment.succeeded', 'invoice.paid') then
    begin
      v_org_id := (v_data->'metadata'->>'org_id')::uuid;
    exception when others then
      v_org_id := null;
    end;

    if v_subscription_id is not null and v_org_id is not null and v_plan in ('standard', 'pro') then
      if nullif(v_data->>'current_period_end', '') is not null then
        v_period_end := (v_data->>'current_period_end')::timestamptz;
      else
        v_period_end := coalesce(nullif(p_event->>'created_at', '')::timestamptz, now())
          + case when upper(v_charge_period) = 'YEARLY' then interval '365 days' else interval '30 days' end;
      end if;

      insert into public.subscriptions (
        org_id, kelviq_customer_id, kelviq_subscription_id, plan, status,
        charge_period, current_period_end, metadata, updated_at
      ) values (
        v_org_id,
        v_data->>'customer_id',
        v_subscription_id,
        v_plan,
        'active',
        upper(v_charge_period),
        v_period_end,
        coalesce(v_data->'metadata', '{}'::jsonb) || jsonb_build_object('payment_confirmed_at', now()),
        now()
      )
      on conflict (org_id) do update set
        kelviq_customer_id = excluded.kelviq_customer_id,
        kelviq_subscription_id = excluded.kelviq_subscription_id,
        plan = excluded.plan,
        status = 'active',
        charge_period = excluded.charge_period,
        current_period_end = excluded.current_period_end,
        metadata = coalesce(public.subscriptions.metadata, '{}'::jsonb) || excluded.metadata,
        cancel_at_period_end = false,
        cancelled_at = null,
        updated_at = now();
    end if;

  elsif v_event_type = 'subscription.updated' then
    select s.metadata, s.current_period_end
      into v_existing_metadata, v_existing_period_end
    from public.subscriptions s
    where s.kelviq_subscription_id = v_subscription_id;

    if found and coalesce(v_existing_metadata, '{}'::jsonb) ? 'payment_confirmed_at'
       and v_plan in ('standard', 'pro') then
      update public.subscriptions
      set plan = v_plan,
          status = coalesce(nullif(v_data->>'status', ''), 'active'),
          current_period_end = coalesce(
            nullif(v_data->>'current_period_end', '')::timestamptz,
            v_existing_period_end
          ),
          cancel_at_period_end = coalesce((v_data->>'cancel_at_period_end')::boolean, false),
          metadata = coalesce(v_existing_metadata, '{}'::jsonb) || coalesce(v_data->'metadata', '{}'::jsonb),
          updated_at = now()
      where kelviq_subscription_id = v_subscription_id;
    end if;

  elsif v_event_type = 'subscription.cancelled' then
    v_at_period_end := coalesce((v_data->>'cancel_at_period_end')::boolean, false);
    update public.subscriptions
    set status = case when v_at_period_end then 'active' else 'cancelled' end,
        cancelled_at = case when v_at_period_end then null else now() end,
        cancel_at_period_end = v_at_period_end,
        updated_at = now()
    where kelviq_subscription_id = v_subscription_id;

  elsif v_event_type in ('payment.failed', 'invoice.payment_failed') then
    update public.subscriptions
    set status = 'past_due', updated_at = now()
    where kelviq_subscription_id = v_subscription_id;
  end if;

  update public.subscription_events
  set processed = true, processed_at = now()
  where kelviq_event_id = v_event_id;

  return jsonb_build_object('ok', true, 'duplicate', false);
end;
$$;

revoke all on function public.process_kelviq_webhook(jsonb, text) from public, authenticated;
grant execute on function public.process_kelviq_webhook(jsonb, text) to anon;
