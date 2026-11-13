import { Match } from "@/types";

export interface BracketRoundGroup {
  key: string;
  roundOrder: number;
  title: string;
  matches: Match[];
}

/**
 * Classifica a fase/rodada de uma partida eliminatória com base em múltiplas heurísticas:
 * 1. Nome da fase (phase: 'semi_finals', 'final', 'quarter_finals', etc.)
 * 2. Labels e títulos em details (details.round_label, details.match_title)
 * 3. Relação de alimentação da árvore (next_match_id)
 * 4. Posição estrutural e ordem dos confrontos
 */
export function classifyMatchStage(
  m: Match,
  allMatches: Match[]
): { key: string; order: number; title: string } {
  const phaseStr = String(m.phase || "").toLowerCase().trim();
  const detailsObj = m.details as Record<string, unknown> | undefined;
  const roundLabel = String(detailsObj?.round_label || "").toLowerCase().trim();
  const matchTitle = String(detailsObj?.match_title || "").toLowerCase().trim();
  const fullText = `${phaseStr} ${roundLabel} ${matchTitle}`;

  // 1. Verificação explícita de Final (não pode ser semifinal, quartas, etc.)
  const isFinalText =
    (fullText.includes("final") ||
      fullText.includes("decisão") ||
      fullText.includes("titulo") ||
      fullText.includes("título")) &&
    !fullText.includes("semi") &&
    !fullText.includes("quarta") &&
    !fullText.includes("quarter") &&
    !fullText.includes("oitava") &&
    !fullText.includes("round_of") &&
    !fullText.includes("3") &&
    !fullText.includes("terceiro");

  // 2. Verificação explícita de Semifinal
  const isSemiText =
    fullText.includes("semi") ||
    fullText.includes("sf") ||
    phaseStr === "semi_final" ||
    phaseStr === "semi_finals" ||
    phaseStr === "semifinal";

  // 3. Verificação explícita de Quartas de Final
  const isQuarterText =
    fullText.includes("quarta") ||
    fullText.includes("quarter") ||
    fullText.includes("qf") ||
    phaseStr === "quarter_finals" ||
    phaseStr === "quarterfinals";

  // 4. Verificação explícita de Oitavas de Final
  const isR16Text =
    fullText.includes("oitava") ||
    fullText.includes("round_of_16") ||
    fullText.includes("of") ||
    phaseStr === "round_of_16";

  // 5. Verificação explícita de 3º Lugar
  const is3rdText =
    fullText.includes("terceiro") ||
    fullText.includes("3º") ||
    fullText.includes("third");

  if (is3rdText) {
    return { key: "third_place", order: 99, title: "Disputa de 3º Lugar" };
  }

  if (isFinalText) {
    return { key: "final", order: 50, title: "Grande Final" };
  }

  if (isSemiText) {
    return { key: "semi_finals", order: 40, title: "Semifinais" };
  }

  if (isQuarterText) {
    return { key: "quarter_finals", order: 30, title: "Quartas de Final" };
  }

  if (isR16Text) {
    return { key: "round_of_16", order: 20, title: "Oitavas de Final" };
  }

  // 6. Relações de alimentação de árvore (next_match_id)
  const feedsIntoThis = allMatches.filter((other) => other.next_match_id === m.id);
  const thisFeedsInto = allMatches.find((other) => other.id === m.next_match_id);

  if (feedsIntoThis.length > 0 && !m.next_match_id) {
    return { key: "final", order: 50, title: "Grande Final" };
  }

  if (thisFeedsInto && !thisFeedsInto.next_match_id) {
    return { key: "semi_finals", order: 40, title: "Semifinais" };
  }

  if (
    thisFeedsInto &&
    allMatches.some(
      (root) => root.id === thisFeedsInto.next_match_id && !root.next_match_id
    )
  ) {
    return { key: "quarter_finals", order: 30, title: "Quartas de Final" };
  }

  // 7. Heurística baseada no número total de partidas de mata-mata
  // Caso comum de 4 equipes classificadas (2 Semifinais + 1 Final = 3 partidas)
  if (allMatches.length === 3) {
    const isPlaceholderMatch =
      (!m.team1_id && !m.team2_id && !m.team_a_id && !m.team_b_id) ||
      (m.teamA?.name?.toLowerCase().includes("definir") &&
        m.teamB?.name?.toLowerCase().includes("definir")) ||
      m.match_order === 3;

    if (isPlaceholderMatch || m.round === 2 || Number(m.round) === 2) {
      return { key: "final", order: 50, title: "Grande Final" };
    }
    return { key: "semi_finals", order: 40, title: "Semifinais" };
  }

  // Caso comum de 8 equipes classificadas (4 Quartas + 2 Semis + 1 Final = 7 partidas)
  if (allMatches.length === 7) {
    const sortedByOrder = [...allMatches].sort(
      (a, b) => (Number(a.match_order) || 0) - (Number(b.match_order) || 0)
    );
    const idx = sortedByOrder.findIndex((x) => x.id === m.id);
    if (idx === 6 || m.match_order === 7) {
      return { key: "final", order: 50, title: "Grande Final" };
    }
    if (idx === 4 || idx === 5 || m.match_order === 5 || m.match_order === 6) {
      return { key: "semi_finals", order: 40, title: "Semifinais" };
    }
    return { key: "quarter_finals", order: 30, title: "Quartas de Final" };
  }

  // 8. Fallback para round numérico se presente
  const numericRound = Number(m.round);
  if (!isNaN(numericRound) && numericRound > 0) {
    return {
      key: `round_${numericRound}`,
      order: numericRound * 10,
      title: `Rodada ${numericRound}`,
    };
  }

  return { key: "round_1", order: 10, title: "Rodada 1" };
}

/**
 * Identifica se uma partida corresponde à Disputa de 3º Lugar
 */
export function isThirdPlaceMatch(m: Match): boolean {
  const ph = String(m.phase || "").toLowerCase().trim();
  const detailsObj = m.details as Record<string, unknown> | undefined;
  const roundLabel = String(detailsObj?.round_label || "").toLowerCase().trim();
  const matchTitle = String(detailsObj?.match_title || "").toLowerCase().trim();
  const full = `${ph} ${roundLabel} ${matchTitle}`;
  return (
    ph === "third_place" ||
    ph === "terceiro_lugar" ||
    full.includes("third") ||
    full.includes("terceiro") ||
    full.includes("3º") ||
    full.includes("3o")
  );
}

/**
 * Extrai a partida de disputa de 3º lugar do conjunto de partidas (se existir)
 */
export function getThirdPlaceMatch(matches: Match[]): Match | null {
  if (!matches || matches.length === 0) return null;
  return matches.find(isThirdPlaceMatch) || null;
}

/**
 * Organiza um array de partidas de mata-mata em grupos ordenados por rodada.
 * Garante que:
 * - Semifinais e Final nunca fiquem na mesma rodada/coluna.
 * - As rodadas fiquem ordenadas da primeira fase eliminatória até a Grande Final.
 * - A Disputa de 3º Lugar seja tratada em destaque abaixo da Grande Final e não forme uma coluna espúria.
 * - Os confrontos de cada rodada fiquem ordenados por match_order.
 */
export function organizeBracketRounds(matches: Match[]): BracketRoundGroup[] {
  if (!matches || matches.length === 0) return [];

  // Filtra jogos de fase de grupos, pontos corridos e disputa de 3º lugar
  const knockoutMatches = matches.filter((m) => {
    const ph = String(m.phase || "").toUpperCase().trim();
    return (
      ph !== "GROUP_STAGE" &&
      ph !== "LEAGUE" &&
      !ph.startsWith("GROUP_STAGE_") &&
      !isThirdPlaceMatch(m)
    );
  });

  const listToProcess = knockoutMatches.length > 0 ? knockoutMatches : matches;

  const groupsMap = new Map<string, BracketRoundGroup>();

  listToProcess.forEach((m) => {
    const stage = classifyMatchStage(m, listToProcess);
    if (!groupsMap.has(stage.key)) {
      groupsMap.set(stage.key, {
        key: stage.key,
        roundOrder: stage.order,
        title: stage.title,
        matches: [],
      });
    }
    groupsMap.get(stage.key)!.matches.push(m);
  });

  // Ordena os confrontos dentro de cada rodada
  groupsMap.forEach((g) => {
    g.matches.sort(
      (a, b) => (Number(a.match_order) || 0) - (Number(b.match_order) || 0)
    );
  });

  // Ordena os grupos da primeira fase eliminatória até a Grande Final
  const sortedGroups = Array.from(groupsMap.values()).sort(
    (a, b) => a.roundOrder - b.roundOrder
  );

  // Padronização semântica dos títulos quando houver 2 ou 3 rodadas
  if (sortedGroups.length === 2) {
    sortedGroups[0].title = "Semifinais";
    sortedGroups[1].title = "Grande Final";
  } else if (sortedGroups.length === 3) {
    sortedGroups[0].title = "Quartas de Final";
    sortedGroups[1].title = "Semifinais";
    sortedGroups[2].title = "Grande Final";
  }

  return sortedGroups;
}

