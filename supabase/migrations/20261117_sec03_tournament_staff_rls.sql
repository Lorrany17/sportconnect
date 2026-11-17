-- ============================================================================
-- Migration: 20261117_sec03_tournament_staff_rls.sql
-- Motivo (SEC-03): Substituir a política aberta (USING true) em tournament_staff.
-- Apenas o dono do torneio (owner_id) ou Super Admin pode adicionar, modificar ou remover membros do staff.
-- Membros do staff podem visualizar seus próprios registros ou os membros do torneio em que atuam.
-- ============================================================================

ALTER TABLE public.tournament_staff ENABLE ROW LEVEL SECURITY;

-- Limpeza idempotente das políticas anteriores
DROP POLICY IF EXISTS "Allow public read on tournament_staff" ON public.tournament_staff;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.tournament_staff;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.tournament_staff;
DROP POLICY IF EXISTS "tournament_staff_select_policy" ON public.tournament_staff;
DROP POLICY IF EXISTS "tournament_staff_insert_policy" ON public.tournament_staff;
DROP POLICY IF EXISTS "tournament_staff_update_policy" ON public.tournament_staff;
DROP POLICY IF EXISTS "tournament_staff_delete_policy" ON public.tournament_staff;

-- 1. SELECT: Dono do torneio, o próprio membro do staff ou Super Admin
CREATE POLICY "tournament_staff_select_policy"
  ON public.tournament_staff
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_staff.tournament_id AND t.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

-- 2. INSERT: Apenas o dono do torneio ou Super Admin
CREATE POLICY "tournament_staff_insert_policy"
  ON public.tournament_staff
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_staff.tournament_id AND t.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

-- 3. UPDATE: Apenas o dono do torneio ou Super Admin
CREATE POLICY "tournament_staff_update_policy"
  ON public.tournament_staff
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_staff.tournament_id AND t.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_staff.tournament_id AND t.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

-- 4. DELETE: Apenas o dono do torneio ou Super Admin
CREATE POLICY "tournament_staff_delete_policy"
  ON public.tournament_staff
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_staff.tournament_id AND t.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );
