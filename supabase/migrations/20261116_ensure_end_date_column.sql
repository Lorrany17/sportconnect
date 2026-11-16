-- Garante que a coluna end_date exista na tabela tournaments para eventos de múltiplos dias
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ;

