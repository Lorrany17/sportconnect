-- =============================================================================
-- MIGRATION: SUPORTE COMPLETO AO FORMATO "GRUPOS + MATA-MATA" (COPA)
-- =============================================================================

-- 1. Na tabela de equipes/inscrições (teams), garante a coluna group_name (VARCHAR)
ALTER TABLE public.teams
ADD COLUMN IF NOT EXISTS group_name VARCHAR(10);

-- 2. Na tabela de partidas (matches), garante a coluna phase (VARCHAR, default 'KNOCKOUT') e group_name (VARCHAR, nullable)
ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS phase VARCHAR(50) DEFAULT 'KNOCKOUT';

ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS group_name VARCHAR(10) NULL;

-- 3. Índices de performance para buscas por grupo e fase
CREATE INDEX IF NOT EXISTS idx_teams_tournament_group
ON public.teams (tournament_id, group_name);

CREATE INDEX IF NOT EXISTS idx_matches_tournament_phase_group
ON public.matches (tournament_id, phase, group_name);
