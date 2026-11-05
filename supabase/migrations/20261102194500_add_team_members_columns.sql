-- ==============================================================================
-- MIGRAÇÃO DE BANCO DE DADOS (SUPABASE)
-- TABELA: team_members
-- Descrição: Garante que todas as colunas necessárias para o formulário público
-- existam na tabela team_members (name, cpf, email, phone, is_captain)
-- e recarrega o cache de schema do PostgREST (corrige PGRST204).
-- ==============================================================================

ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS cpf TEXT;
ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS is_captain BOOLEAN DEFAULT FALSE;

-- Recarrega o cache de schema da API do PostgREST imediatamente
NOTIFY pgrst, 'reload schema';

