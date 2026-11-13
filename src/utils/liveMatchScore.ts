/**
 * Utilitário para cálculo e extração dinâmica do placar de partidas (Sets vs. Pontos Ativos)
 * Suporta esportes de sets (Ping-Pong/Tênis de Mesa, Vôlei, Tênis, etc.) e pontuação contínua (Futsal, Dominó).
 */

export interface SetHistoryItem {
  setNumber?: number;
  set_number?: number;
  scoreA?: number;
  score_a?: number;
  teamA?: number;
  team_a?: number;
  scoreB?: number;
  score_b?: number;
  teamB?: number;
  team_b?: number;
  isFinished?: boolean;
  isClosed?: boolean;
  closed?: boolean;
  status?: string;
  inProgress?: boolean;
}

export interface LiveMatchScore {
  isSetsSport: boolean;
  isLive: boolean;
  isCompleted: boolean;
  setsA: number;
  setsB: number;
  activePointsA: number;
  activePointsB: number;
  currentSetNumber: number;
  rawScoreA: number;
  rawScoreB: number;
  historySets: Array<{ setNumber: number; scoreA: number; scoreB: number }>;
}

export function parseSetsHistory(match: any): SetHistoryItem[] {
  if (!match) return [];

  // Se a partida estiver agendada ou resetada, anula o histórico para não reter vestígios antigos
  const statusUpper = String(match.status || "").toUpperCase();
  if (statusUpper === "SCHEDULED" || statusUpper === "AGENDADA" || statusUpper === "PROGRAMADA") {
    return [];
  }

  const candidates = [
    match.detailed_score?.sets,
    match.detailed_score?.historicoSets,
    match.detailed_score?.rounds,
    match.historicoSets,
    match.details?.sets,
    match.details?.historicoSets,
    match.sets_history,
    match.set_history,
    match.historico_sets,
    match.details?.sets_history,
    match.details?.set_history,
    match.history,
  ];

  if (typeof match.detailed_score === "string") {
    try {
      const pds = JSON.parse(match.detailed_score);
      if (Array.isArray(pds)) candidates.push(pds);
      if (Array.isArray(pds?.sets)) candidates.push(pds.sets);
      if (Array.isArray(pds?.historicoSets)) candidates.push(pds.historicoSets);
      if (Array.isArray(pds?.rounds)) candidates.push(pds.rounds);
    } catch {}
  }

  if (typeof match.details === "string") {
    try {
      const pd = JSON.parse(match.details);
      if (Array.isArray(pd)) candidates.push(pd);
      if (Array.isArray(pd?.sets)) candidates.push(pd.sets);
      if (Array.isArray(pd?.historicoSets)) candidates.push(pd.historicoSets);
      if (Array.isArray(pd?.rounds)) candidates.push(pd.rounds);
    } catch {}
  }

  for (const cand of candidates) {
    if (!cand) continue;
    let val = cand;
    if (typeof val === "string") {
      try {
        val = JSON.parse(val);
      } catch {
        val = null;
      }
    }
    if (Array.isArray(val) && val.length > 0) {
      return val;
    }
  }

  return [];
}

/**
 * Extrai de forma dinâmica e resiliente o placar geral (sets) e os pontos do set em andamento.
 */
export function getLiveMatchScore(match: any, tournamentSport?: string): LiveMatchScore {
  if (!match) {
    return {
      isSetsSport: false,
      isLive: false,
      isCompleted: false,
      setsA: 0,
      setsB: 0,
      activePointsA: 0,
      activePointsB: 0,
      currentSetNumber: 1,
      rawScoreA: 0,
      rawScoreB: 0,
      historySets: [],
    };
  }

  const statusUpper = String(match.status || "").toUpperCase();
  const isLive =
    statusUpper === "LIVE" ||
    statusUpper === "IN_PROGRESS" ||
    statusUpper === "IN_GAME" ||
    statusUpper === "PLAYING";
  const isCompleted =
    statusUpper === "COMPLETED" ||
    statusUpper === "FINISHED" ||
    statusUpper === "ENCERRADA";

  const rawSetsA = Number(match.sets_a ?? match.setsA ?? match.setsVencidosTimeA ?? 0);
  const rawSetsB = Number(match.sets_b ?? match.setsB ?? match.setsVencidosTimeB ?? 0);
  const rawScoreA = Number(match.score_a ?? match.scoreA ?? 0);
  const rawScoreB = Number(match.score_b ?? match.scoreB ?? 0);

  const rawHistory = parseSetsHistory(match);

  const sportUpper = String(tournamentSport || match.sport_type || "").toUpperCase();
  const isKnownSetsSport =
    sportUpper === "PING_PONG" ||
    sportUpper === "VOLEI" ||
    sportUpper === "TENIS" ||
    sportUpper === "BADMINTON" ||
    sportUpper === "BEACH_TENNIS";

  const hasSetsRecorded = rawSetsA > 0 || rawSetsB > 0 || rawHistory.length > 0;
  const isBestOf = Number(match.best_of ?? match.bestOf ?? 1) > 1;

  const isSetsSport = isKnownSetsSport || hasSetsRecorded || isBestOf;

  // Processa o histórico formatado
  const historySets = rawHistory.map((item, idx) => {
    const setNumber =
      Number(item.setNumber ?? item.set_number) || idx + 1;
    const scoreA =
      Number(item.scoreA ?? item.score_a ?? item.teamA ?? item.team_a ?? 0) || 0;
    const scoreB =
      Number(item.scoreB ?? item.score_b ?? item.teamB ?? item.team_b ?? 0) || 0;
    return { setNumber, scoreA, scoreB };
  });

  // Localiza set ativo
  let activePointsA = rawScoreA;
  let activePointsB = rawScoreB;
  let currentSetNumber = rawSetsA + rawSetsB + 1;

  // Procura se algum item do histórico é explicitamente o set ativo (não finalizado)
  const explicitActive = rawHistory.find((s) => {
    return (
      s.isFinished === false ||
      s.isClosed === false ||
      s.closed === false ||
      s.status === "IN_PROGRESS" ||
      s.inProgress === true
    );
  });

  if (explicitActive) {
    activePointsA =
      Number(
        explicitActive.scoreA ??
          explicitActive.score_a ??
          explicitActive.teamA ??
          explicitActive.team_a ??
          0
      ) || 0;
    activePointsB =
      Number(
        explicitActive.scoreB ??
          explicitActive.score_b ??
          explicitActive.teamB ??
          explicitActive.team_b ??
          0
      ) || 0;
    currentSetNumber =
      Number(explicitActive.setNumber ?? explicitActive.set_number) ||
      currentSetNumber;
  } else if (rawHistory.length > rawSetsA + rawSetsB) {
    // Se o histórico contém mais sets que a soma de sets fechados, o último é o set ativo
    const lastItem = rawHistory[rawHistory.length - 1];
    activePointsA =
      Number(
        lastItem.scoreA ??
          lastItem.score_a ??
          lastItem.teamA ??
          lastItem.team_a ??
          rawScoreA
      ) || 0;
    activePointsB =
      Number(
        lastItem.scoreB ??
          lastItem.score_b ??
          lastItem.teamB ??
          lastItem.team_b ??
          rawScoreB
      ) || 0;
    currentSetNumber =
      Number(lastItem.setNumber ?? lastItem.set_number) ||
      rawHistory.length;
  } else {
    // Sets gravados no histórico são apenas os sets fechados;
    // os pontos do set atual estão em score_a / score_b
    activePointsA = rawScoreA;
    activePointsB = rawScoreB;
    currentSetNumber = rawSetsA + rawSetsB + 1;
  }

  // Se a partida estiver agendada ou resetada (SCHEDULED), garante valores estritamente zerados e Set 1
  if (!isLive && !isCompleted) {
    activePointsA = 0;
    activePointsB = 0;
    currentSetNumber = 1;
  } else if (isCompleted) {
    // Se a partida estiver encerrada, não há pontos de set ativo em andamento
    activePointsA = 0;
    activePointsB = 0;
    currentSetNumber = Math.max(1, rawSetsA + rawSetsB);
  }

  return {
    isSetsSport,
    isLive,
    isCompleted,
    setsA: rawSetsA,
    setsB: rawSetsB,
    activePointsA,
    activePointsB,
    currentSetNumber,
    rawScoreA,
    rawScoreB,
    historySets,
  };
}

