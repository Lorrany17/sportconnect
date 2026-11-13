-- Adiciona coluna current_stage para rastrear a transição entre fases (ex: 'group_stage', 'knockout')
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS current_stage TEXT DEFAULT 'group_stage';

