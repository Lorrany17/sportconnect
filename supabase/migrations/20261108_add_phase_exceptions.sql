-- Adiciona suporte a exceções de regras por fase (ex: Final Melhor de 5, Semifinal Melhor de 5)
ALTER TABLE public.tournaments
ADD COLUMN IF NOT EXISTS phase_exceptions jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tournaments.phase_exceptions IS
  'Mapa JSONB de exceções de regras por fase (ex: {"final": {"bestOf": 5, "pointsPerSet": 11, "tieBreakPoints": 11}})';

