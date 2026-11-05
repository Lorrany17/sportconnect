-- ==============================================================================
-- SPORTCONNECT - CORREÇÃO DE POLÍTICAS DE SEGURANÇA (RLS) E ESQUEMA
-- Execute este script no SQL Editor do painel do Supabase
-- ==============================================================================

-- 1. Garantir que a coluna amount_paid exista na tabela teams
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS amount_paid numeric DEFAULT 0;

-- 2. POLÍTICAS DE SEGURANÇA (RLS) PARA A TABELA 'teams'
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- Permitir leitura pública das equipes de qualquer torneio
DROP POLICY IF EXISTS "Permitir leitura pública de equipes" ON public.teams;
CREATE POLICY "Permitir leitura pública de equipes" 
ON public.teams 
FOR SELECT 
USING (true);

-- Permitir que atletas autenticados inscrevam sua própria equipe
DROP POLICY IF EXISTS "Permitir atletas autenticados criarem equipes" ON public.teams;
CREATE POLICY "Permitir atletas autenticados criarem equipes" 
ON public.teams 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

-- Permitir que o capitão atualize os dados da sua própria equipe
DROP POLICY IF EXISTS "Permitir capitão atualizar sua equipe" ON public.teams;
CREATE POLICY "Permitir capitão atualizar sua equipe" 
ON public.teams 
FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

-- Permitir que o organizador do campeonato gerencie todas as equipes do seu torneio
DROP POLICY IF EXISTS "Permitir organizador gerenciar equipes do torneio" ON public.teams;
CREATE POLICY "Permitir organizador gerenciar equipes do torneio"
ON public.teams
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tournaments 
    WHERE tournaments.id = teams.tournament_id 
    AND tournaments.owner_id = auth.uid()
  )
);

-- 3. POLÍTICAS DE SEGURANÇA (RLS) PARA A TABELA 'team_members'
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura de membros da equipe" ON public.team_members;
CREATE POLICY "Permitir leitura de membros da equipe" 
ON public.team_members 
FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Permitir inserção de membros da equipe" ON public.team_members;
CREATE POLICY "Permitir inserção de membros da equipe" 
ON public.team_members 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir gerenciamento de membros pelo capitão" ON public.team_members;
CREATE POLICY "Permitir gerenciamento de membros pelo capitão"
ON public.team_members
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.teams 
    WHERE teams.id = team_members.team_id 
    AND teams.user_id = auth.uid()
  )
);

-- 4. POLÍTICAS DE SEGURANÇA (RLS) PARA A TABELA 'notifications'
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Permitir que organizadores autenticados enviem notificações para os atletas
DROP POLICY IF EXISTS "Organizadores podem notificar atletas" ON public.notifications;
CREATE POLICY "Organizadores podem notificar atletas" 
ON public.notifications 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Permitir que cada atleta visualize somente as suas próprias notificações
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Atletas podem ver suas notificações" ON public.notifications;
CREATE POLICY "Users can view own notifications" 
ON public.notifications 
FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

-- Permitir que o atleta marque suas notificações como lidas
DROP POLICY IF EXISTS "Atletas podem atualizar suas notificações" ON public.notifications;
CREATE POLICY "Atletas podem atualizar suas notificações" 
ON public.notifications 
FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

