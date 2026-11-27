-- Persist organisation settings through owner/admin-scoped RLS.
-- The application uses the Supabase publishable key; no service-role key is required.

DROP POLICY IF EXISTS organizations_update_owner_admin ON public.organizations;
CREATE POLICY organizations_update_owner_admin
  ON public.organizations
  FOR UPDATE
  USING (
    id = public.current_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.org_id = organizations.id
        AND p.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    id = public.current_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.org_id = organizations.id
        AND p.role IN ('owner', 'admin')
    )
  );

-- Only owners and admins may inspect, create, revoke or resend organisation invites.
DROP POLICY IF EXISTS org_invites_select ON public.org_invites;
CREATE POLICY org_invites_select ON public.org_invites
  FOR SELECT
  USING (
    org_id = public.current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.org_id = org_invites.org_id
        AND p.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS org_invites_insert ON public.org_invites;
CREATE POLICY org_invites_insert ON public.org_invites
  FOR INSERT
  WITH CHECK (
    org_id = public.current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.org_id = org_invites.org_id
        AND p.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS org_invites_update ON public.org_invites;
CREATE POLICY org_invites_update ON public.org_invites
  FOR UPDATE
  USING (
    org_id = public.current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.org_id = org_invites.org_id
        AND p.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    org_id = public.current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.org_id = org_invites.org_id
        AND p.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS org_invites_delete ON public.org_invites;
CREATE POLICY org_invites_delete ON public.org_invites
  FOR DELETE
  USING (
    org_id = public.current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.org_id = org_invites.org_id
        AND p.role IN ('owner', 'admin')
    )
  );

-- An invite can only be accepted by the email address it was issued to.
CREATE OR REPLACE FUNCTION public.accept_org_invite(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.org_invites;
  uid uuid := auth.uid();
  signed_in_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to accept this invite.';
  END IF;

  SELECT * INTO inv
  FROM public.org_invites
  WHERE token = _token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This invite link is invalid.';
  END IF;
  IF inv.status <> 'pending' THEN
    RAISE EXCEPTION 'This invite has already been used or revoked.';
  END IF;
  IF inv.expires_at < now() THEN
    RAISE EXCEPTION 'This invite has expired.';
  END IF;
  IF lower(inv.email) <> signed_in_email THEN
    RAISE EXCEPTION 'Sign in with the email address this invitation was sent to.';
  END IF;

  UPDATE public.profiles
     SET org_id = inv.org_id,
         role = inv.role
   WHERE user_id = uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your profile is not ready yet. Finish signup and try the invite again.';
  END IF;

  UPDATE public.org_invites
     SET status = 'accepted',
         accepted_at = now()
   WHERE id = inv.id;

  RETURN jsonb_build_object('ok', true, 'org_id', inv.org_id, 'role', inv.role);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_org_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_org_invite(text) TO authenticated;
