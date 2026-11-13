-- ==============================================================================
-- MIGRAÇÃO DE BANCO DE DADOS (SUPABASE)
-- TABELA: teams
-- Descrição: Garante a existência das colunas JSONB custom_responses e
-- custom_registration_answers (além de declared_skill_level) na tabela teams
-- para armazenamento de todos os campos customizados e metadados de inscrição.
-- ==============================================================================

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS custom_responses JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS custom_registration_answers JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS declared_skill_level TEXT;

-- Sincroniza registros existentes para que custom_responses e custom_registration_answers tenham os mesmos dados
UPDATE public.teams
SET custom_responses = custom_registration_answers
WHERE (custom_responses IS NULL OR custom_responses = '{}'::jsonb)
  AND custom_registration_answers IS NOT NULL
  AND custom_registration_answers != '{}'::jsonb;

-- Recarrega o cache de schema da API do PostgREST imediatamente
NOTIFY pgrst, 'reload schema';

