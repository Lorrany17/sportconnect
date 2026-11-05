import { Team, Match, Tournament } from "@/types";

export interface GroupStandingRow {
  position: number;
  team: Team;
  teamId: string;
  teamName: string;
  groupName: string;
  pts: number;
  points: number;
  j: number;
  played: number;
  v: number;
  wins: number;
  e: number;
  draws: number;
  d: number;
  losses: number;
  pro: number;
  goalsFor: number;
  contra: number;
  goalsAgainst: number;
  sg: number;
  goalDiff: number;
}

export function normalizeGroupLetter(raw?: string | null): string {
  if (!raw) return "";
  return String(raw)
    .toUpperCase()
    .replace(/^GRUPO\s+/i, "")
    .trim();
}

export function extractMatchGroupName(
  match: Partial<Match> & Record<string, any>,
  teamGroupLookup?: Map<string, string>
): string {
  if (match.group_name) {
    return normalizeGroupLetter(match.group_name);
  }
  if (typeof match.details === "object" && match.details?.group_name) {
    return normalizeGroupLetter(match.details.group_name);
  }
  if (typeof match.details === "string") {
    try {
      const parsed = JSON.parse(match.details);
      if (parsed?.group_name) {
        return normalizeGroupLetter(parsed.group_name);
      }
    } catch {
      // ignore JSON parse error
    }
  }
  if (typeof match.phase === "string" && match.phase.toLowerCase().includes("grupo")) {
    return normalizeGroupLetter(match.phase);
  }
  if (teamGroupLookup) {
    const t1 = match.team1_id || match.team_a_id || match.teamA?.id;
    const t2 = match.team2_id || match.team_b_id || match.teamB?.id;
    if (t1 && teamGroupLookup.has(t1)) return teamGroupLookup.get(t1)!;
    if (t2 && teamGroupLookup.has(t2)) return teamGroupLookup.get(t2)!;
  }
  return "";
}

/**
 * Motor de Classificação Dinâmica (`calculateGroupStandings`)
 *
 * - Filtra as equipes e as partidas pelo `group_name` (se informado) e status finalizado (`FINISHED` / `COMPLETED`).
 * - Calcula para cada equipe:
 *   - Pontos (Pts): Vitória = 3, Empate = 1, Derrota = 0
 *   - Jogos (J), Vitórias (V), Empates (E), Derrotas (D)
 *   - Saldo (SG): Pontos marcados menos pontos sofridos (`score_team1`/`score_a` vs `score_team2`/`score_b`)
 * - Ordena primeiro por Pontos (descendente) e depois por Saldo (SG descendente).
 */
export function calculateGroupStandings(
  teams: Array<Partial<Team> & { id: string; name: string; group_name?: string | null }>,
  matches: Array<Partial<Match> & Record<string, any>>,
  groupName?: string | null,
  tournament?: Tournament | null
): GroupStandingRow[] {
  const targetGroup = normalizeGroupLetter(groupName);

  const activeTeams = (teams || []).filter((t: any) => {
    if (!t || !t.id || t.id === "bye") return false;
    if (
      t.cancellation_status === "REFUNDED" ||
      t.status === "CANCELLED" ||
      t.status === "CANCELED" ||
      t.payment_status === "CANCELED" ||
      t.payment_status === "CANCELLED"
    ) {
      return false;
    }
    if (targetGroup) {
      const teamG = normalizeGroupLetter(t.group_name);
      if (teamG && teamG !== targetGroup) return false;
    }
    return true;
  });

  const teamGroupLookup = new Map<string, string>();
  activeTeams.forEach((t) => {
    const g = normalizeGroupLetter(t.group_name) || targetGroup || "A";
    teamGroupLookup.set(t.id, g);
  });

  const statsMap = new Map<string, GroupStandingRow>();
  activeTeams.forEach((t) => {
    const g = teamGroupLookup.get(t.id) || targetGroup || "A";
    statsMap.set(t.id, {
      position: 0,
      team: t as Team,
      teamId: t.id,
      teamName: t.name,
      groupName: g,
      pts: 0,
      points: 0,
      j: 0,
      played: 0,
      v: 0,
      wins: 0,
      e: 0,
      draws: 0,
      d: 0,
      losses: 0,
      pro: 0,
      goalsFor: 0,
      contra: 0,
      goalsAgainst: 0,
      sg: 0,
      goalDiff: 0,
    });
  });

  const isSetsSport =
    tournament?.sport_type === "PING_PONG" || tournament?.sport_type === "VOLEI";

  // Filtra partidas finalizadas (FINISHED / COMPLETED) e pertencentes ao grupo
  const finishedGroupMatches = (matches || []).filter((m: any) => {
    if (!m) return false;
    const st = String(m.status || "").toUpperCase().trim();
    const isFinished = st === "FINISHED" || st === "COMPLETED";
    if (!isFinished) return false;

    const ph = String(m.phase || "").toUpperCase().trim();
    if (ph === "KNOCKOUT" || Boolean(m.next_match_id)) return false;

    if (targetGroup) {
      const mGroup = extractMatchGroupName(m, teamGroupLookup);
      if (mGroup && mGroup !== targetGroup) return false;
    }
    return true;
  });

  finishedGroupMatches.forEach((m: any) => {
    const team1Id = m.team1_id || m.team_a_id || m.teamA?.id;
    const team2Id = m.team2_id || m.team_b_id || m.teamB?.id;

    if (!team1Id || !team2Id || team1Id === "bye" || team2Id === "bye") return;

    const row1 = statsMap.get(team1Id);
    const row2 = statsMap.get(team2Id);
    if (!row1 || !row2) return;

    const sets1 = Number(m.sets_a ?? m.setsA ?? m.setsVencidosTimeA ?? 0);
    const sets2 = Number(m.sets_b ?? m.setsB ?? m.setsVencidosTimeB ?? 0);
    const rawScore1 = Number(
      m.score_team1 ?? m.score_a ?? m.scoreA ?? m.finalScoreA ?? 0
    );
    const rawScore2 = Number(
      m.score_team2 ?? m.score_b ?? m.scoreB ?? m.finalScoreB ?? 0
    );

    const useSets = isSetsSport && (sets1 > 0 || sets2 > 0);
    const score1 = useSets ? sets1 : rawScore1;
    const score2 = useSets ? sets2 : rawScore2;

    row1.played += 1;
    row1.j = row1.played;
    row2.played += 1;
    row2.j = row2.played;

    row1.goalsFor += score1;
    row1.pro = row1.goalsFor;
    row1.goalsAgainst += score2;
    row1.contra = row1.goalsAgainst;
    row1.goalDiff = row1.goalsFor - row1.goalsAgainst;
    row1.sg = row1.goalDiff;

    row2.goalsFor += score2;
    row2.pro = row2.goalsFor;
    row2.goalsAgainst += score1;
    row2.contra = row2.goalsAgainst;
    row2.goalDiff = row2.goalsFor - row2.goalsAgainst;
    row2.sg = row2.goalDiff;

    const winnerId = m.winner_id || m.winnerId;

    if (winnerId === team1Id || (!winnerId && score1 > score2)) {
      row1.wins += 1;
      row1.v = row1.wins;
      row1.points += 3;
      row1.pts = row1.points;

      row2.losses += 1;
      row2.d = row2.losses;
    } else if (winnerId === team2Id || (!winnerId && score2 > score1)) {
      row2.wins += 1;
      row2.v = row2.wins;
      row2.points += 3;
      row2.pts = row2.points;

      row1.losses += 1;
      row1.d = row1.losses;
    } else {
      row1.draws += 1;
      row1.e = row1.draws;
      row1.points += 1;
      row1.pts = row1.points;

      row2.draws += 1;
      row2.e = row2.draws;
      row2.points += 1;
      row2.pts = row2.points;
    }
  });

  // Ordena primeiro por Pontos (descendente) e depois por Saldo (SG descendente)
  const sorted = Array.from(statsMap.values()).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.sg !== a.sg) return b.sg - a.sg;
    if (b.v !== a.v) return b.v - a.v;
    if (b.pro !== a.pro) return b.pro - a.pro;
    return a.teamName.localeCompare(b.teamName);
  });

  return sorted.map((row, idx) => ({
    ...row,
    position: idx + 1,
  }));
}

