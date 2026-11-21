-- Allow organisation members to manage their organisation's tax profiles.
ALTER TABLE public.tax_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_select_tax_profiles" ON public.tax_profiles;
CREATE POLICY "org_members_select_tax_profiles"
  ON public.tax_profiles FOR SELECT
  USING (
    org_id IN (SELECT org_id FROM public.profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "org_members_insert_tax_profiles" ON public.tax_profiles;
CREATE POLICY "org_members_insert_tax_profiles"
  ON public.tax_profiles FOR INSERT
  WITH CHECK (
    org_id IN (SELECT org_id FROM public.profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "org_members_update_tax_profiles" ON public.tax_profiles;
CREATE POLICY "org_members_update_tax_profiles"
  ON public.tax_profiles FOR UPDATE
  USING (
    org_id IN (SELECT org_id FROM public.profiles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT org_id FROM public.profiles WHERE user_id = auth.uid())
  );
