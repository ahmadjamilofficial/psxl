-- Business billing is separate from Individual subscriptions.
-- Kelviq checkout intents bind a purchase to an authenticated PSXL organisation.
CREATE TABLE IF NOT EXISTS public.business_checkout_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL UNIQUE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('brokerage-pilot','brokerage-operations','brokerage-enterprise')),
  charge_period text NOT NULL CHECK (charge_period IN ('ONE_TIME','MONTHLY')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','expired','failed')),
  kelviq_checkout_session_id text UNIQUE,
  kelviq_customer_id text,
  kelviq_event_id text,
  amount numeric(14,2),
  currency text,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_checkout_intents_org_idx
  ON public.business_checkout_intents(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS business_checkout_intents_customer_idx
  ON public.business_checkout_intents(kelviq_customer_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS public.business_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('brokerage-pilot','brokerage-operations','brokerage-enterprise')),
  status text NOT NULL CHECK (status IN ('pending','active','past_due','paused','cancelled','expired','refunded')),
  charge_period text NOT NULL CHECK (charge_period IN ('ONE_TIME','MONTHLY')),
  kelviq_customer_id text,
  kelviq_subscription_id text UNIQUE,
  kelviq_checkout_session_id text,
  kelviq_plan_identifier text NOT NULL,
  current_period_end timestamptz,
  end_date timestamptz,
  last_paid_at timestamptz,
  last_invoice_id text,
  refunded_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_subscriptions_status_idx
  ON public.business_subscriptions(status);
CREATE INDEX IF NOT EXISTS business_subscriptions_customer_idx
  ON public.business_subscriptions(kelviq_customer_id);

ALTER TABLE public.business_checkout_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_checkout_intents_org_select ON public.business_checkout_intents;
CREATE POLICY business_checkout_intents_org_select
  ON public.business_checkout_intents FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS business_subscriptions_org_select ON public.business_subscriptions;
CREATE POLICY business_subscriptions_org_select
  ON public.business_subscriptions FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE user_id = auth.uid()));

-- No client insert/update/delete policies: service-role webhook and server endpoints only.
REVOKE ALL ON public.business_checkout_intents FROM anon, authenticated;
GRANT SELECT ON public.business_checkout_intents TO authenticated;
REVOKE ALL ON public.business_subscriptions FROM anon, authenticated;
GRANT SELECT ON public.business_subscriptions TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_business_billing_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS business_checkout_intents_touch_updated_at ON public.business_checkout_intents;
CREATE TRIGGER business_checkout_intents_touch_updated_at
  BEFORE UPDATE ON public.business_checkout_intents
  FOR EACH ROW EXECUTE FUNCTION public.touch_business_billing_updated_at();
DROP TRIGGER IF EXISTS business_subscriptions_touch_updated_at ON public.business_subscriptions;
CREATE TRIGGER business_subscriptions_touch_updated_at
  BEFORE UPDATE ON public.business_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_business_billing_updated_at();
