-- PSXL workspace types
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS workspace_type text NOT NULL DEFAULT 'business';
