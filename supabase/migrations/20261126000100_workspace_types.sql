-- PSXL workspace classification: one shared platform, distinct business and personal workspaces.
-- Existing organisations default to business so current customers and data remain unchanged.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS workspace_type text NOT NULL DEFAULT 'business';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_workspace_type_check'
      AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_workspace_type_check
      CHECK (workspace_type IN ('business', 'individual'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS organizations_workspace_type_idx
  ON public.organizations (workspace_type);

-- Only the owner of their newly provisioned organisation may set its type.
-- This is called immediately after the existing provision_current_user RPC.
CREATE OR REPLACE FUNCTION public.set_current_workspace_type(_workspace_type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF _workspace_type NOT IN ('business', 'individual') THEN
    RAISE EXCEPTION 'Invalid workspace type.';
  END IF;

  UPDATE public.organizations o
     SET workspace_type = _workspace_type,
         updated_at = now()
   WHERE o.id = (
     SELECT p.org_id
       FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.role = 'owner'
      LIMIT 1
   );

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.set_current_workspace_type(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_current_workspace_type(text) TO authenticated;
