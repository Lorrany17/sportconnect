-- ============================================================================
-- Blindagem de Segurança RLS (Row Level Security) - SportConnect
-- Regra de Ouro: Um torneio, suas partidas e suas inscrições só podem sofrer
-- UPDATE ou DELETE se auth.uid() corresponder ao owner_id (organizador) do torneio.
-- ============================================================================

-- 1. Habilitar RLS nas tabelas críticas
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

-- 2. Limpeza de políticas permissivas legadas
DROP POLICY IF EXISTS "Allow public read on tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Allow organizer insert on tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Allow organizer update on tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Allow organizer delete on tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.tournaments;
DROP POLICY IF EXISTS "Enable update for all users" ON public.tournaments;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.tournaments;

DROP POLICY IF EXISTS "Allow public read on teams" ON public.teams;
DROP POLICY IF EXISTS "Allow organizer update on teams" ON public.teams;
DROP POLICY IF EXISTS "Allow organizer delete on teams" ON public.teams;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.teams;
DROP POLICY IF EXISTS "Enable update for all users" ON public.teams;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.teams;

DROP POLICY IF EXISTS "Allow public read on matches" ON public.matches;
DROP POLICY IF EXISTS "Allow organizer update on matches" ON public.matches;
DROP POLICY IF EXISTS "Allow organizer delete on matches" ON public.matches;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.matches;
DROP POLICY IF EXISTS "Enable update for all users" ON public.matches;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.matches;

-- 3. Políticas Estritas para TOURNAMENTS
CREATE POLICY "tournaments_select_public"
  ON public.tournaments
  FOR SELECT
  USING (true);

CREATE POLICY "tournaments_insert_owner"
  ON public.tournaments
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "tournaments_update_owner"
  ON public.tournaments
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "tournaments_delete_owner"
  ON public.tournaments
  FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);

-- 4. Políticas Estritas para TEAMS
CREATE POLICY "teams_select_public"
  ON public.teams
  FOR SELECT
  USING (true);

CREATE POLICY "teams_insert_authenticated"
  ON public.teams
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = teams.tournament_id AND t.owner_id = auth.uid()
    )
  );

CREATE POLICY "teams_update_owner"
  ON public.teams
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = teams.tournament_id AND t.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = teams.tournament_id AND t.owner_id = auth.uid()
    )
  );

CREATE POLICY "teams_delete_owner"
  ON public.teams
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = teams.tournament_id AND t.owner_id = auth.uid()
    )
  );

-- 5. Políticas Estritas para MATCHES
CREATE POLICY "matches_select_public"
  ON public.matches
  FOR SELECT
  USING (true);

CREATE POLICY "matches_insert_owner"
  ON public.matches
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = matches.tournament_id AND t.owner_id = auth.uid()
    )
  );

CREATE POLICY "matches_update_owner"
  ON public.matches
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = matches.tournament_id AND t.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = matches.tournament_id AND t.owner_id = auth.uid()
    )
  );

CREATE POLICY "matches_delete_owner"
  ON public.matches
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = matches.tournament_id AND t.owner_id = auth.uid()
    )
  );

