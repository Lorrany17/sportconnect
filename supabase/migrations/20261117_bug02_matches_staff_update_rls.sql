-- ============================================================================
-- Migration: 20261117_bug02_matches_staff_update_rls.sql
-- Motivo (BUG-02): Permitir UPDATE em matches tanto para o dono do torneio
-- quanto para membros do tournament_staff com papéis de edição de partida
-- ('ADMIN', 'REFEREE', 'SCOREKEEPER').
-- Isso viabiliza que mesários e árbitros designados lancem placares e
-- finalizem partidas em tempo real sem bloqueio de RLS.
-- ============================================================================

-- 1. Remover policies anteriores de UPDATE em matches
DROP POLICY IF EXISTS "matches_update_owner" ON public.matches;
DROP POLICY IF EXISTS "matches_update_owner_or_staff" ON public.matches;

-- 2. UPDATE: Dono do torneio OU membro ativo do staff com papel de operador
CREATE POLICY "matches_update_owner_or_staff"
  ON public.matches
  FOR UPDATE
  TO authenticated
  USING (
    -- Dono do torneio
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = matches.tournament_id AND t.owner_id = auth.uid()
    )
    -- Membro de staff com papel autorizado
    OR EXISTS (
      SELECT 1 FROM public.tournament_staff ts
      WHERE ts.tournament_id = matches.tournament_id
        AND ts.user_id = auth.uid()
        AND ts.role IN ('ADMIN', 'REFEREE', 'SCOREKEEPER')
    )
    -- Super Admin
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = matches.tournament_id AND t.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.tournament_staff ts
      WHERE ts.tournament_id = matches.tournament_id
        AND ts.user_id = auth.uid()
        AND ts.role IN ('ADMIN', 'REFEREE', 'SCOREKEEPER')
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );
