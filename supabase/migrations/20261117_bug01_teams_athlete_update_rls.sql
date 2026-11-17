-- ============================================================================
-- Migration: 20261117_bug01_teams_athlete_update_rls.sql
-- Motivo (BUG-01): Permitir que o capitão/atleta (user_id da equipe) atualize
-- seu comprovante de pagamento (payment_proof_url) e submeta a inscrição
-- para aprovação (payment_status = 'WAITING_APPROVAL') enquanto estiver PENDING.
-- Além disso, permite que o atleta exclua (DELETE) sua própria equipe não confirmada
-- durante o fluxo de rollback se o processo de inscrição falhar.
-- ============================================================================

-- 1. Remover policies restritivas anteriores
DROP POLICY IF EXISTS "teams_athlete_submit_proof" ON public.teams;
DROP POLICY IF EXISTS "teams_athlete_rollback_delete" ON public.teams;

-- 2. UPDATE: O capitão pode atualizar o comprovante e colocar em espera de aprovação
CREATE POLICY "teams_athlete_submit_proof"
  ON public.teams
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND (payment_status IS NULL OR payment_status IN ('PENDING', 'WAITING_APPROVAL'))
  )
  WITH CHECK (
    auth.uid() = user_id
    AND payment_status IN ('PENDING', 'WAITING_APPROVAL')
  );

-- 3. DELETE: O capitão pode excluir sua inscrição pendente em caso de rollback
CREATE POLICY "teams_athlete_rollback_delete"
  ON public.teams
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND (payment_status IS NULL OR payment_status IN ('PENDING', 'WAITING_APPROVAL'))
  );
