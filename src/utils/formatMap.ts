export const formatMap: Record<string, string> = {
  KNOCKOUT: "Mata-Mata",
  LEAGUE: "Pontos Corridos",
  GROUPS: "Grupos + Eliminatórias",
  GROUPS_KNOCKOUT: "Grupos + Eliminatórias",
  ROUND_ROBIN: "Pontos Corridos",
};

/**
 * Traduz o formato do torneio vindo do banco de dados (ex: 'KNOCKOUT', 'LEAGUE', 'GROUPS')
 * para uma label amigável em português para a interface do usuário.
 */
export function translateTournamentFormat(rawFormat?: string | null): string {
  if (!rawFormat) return "Mata-Mata";
  const trimmed = String(rawFormat).trim();
  const upper = trimmed.toUpperCase();

  if (formatMap[upper]) {
    return formatMap[upper];
  }

  if (upper.includes("GRUPO") || upper.includes("GROUP")) {
    return "Grupos + Eliminatórias";
  }

  if (
    upper.includes("PONTOS") ||
    upper.includes("CORRIDO") ||
    upper.includes("LIGA") ||
    upper.includes("ROUND_ROBIN")
  ) {
    return "Pontos Corridos";
  }

  if (
    upper.includes("MATA") ||
    upper.includes("KNOCKOUT") ||
    upper.includes("ELIMINAT")
  ) {
    return "Mata-Mata";
  }

  return trimmed;
}

export const phaseNameMap: Record<string, string> = {
  group_stage: "Fase de Grupos",
  groups: "Fase de Grupos",
  group: "Fase de Grupos",
  fase_de_grupos: "Fase de Grupos",
  round_of_32: "16 avos de Final",
  dsa: "16 avos de Final",
  round_of_16: "Oitavas de Final",
  oitavas: "Oitavas de Final",
  of: "Oitavas de Final",
  quarter_finals: "Quartas de Final",
  quarterfinals: "Quartas de Final",
  quartas: "Quartas de Final",
  qf: "Quartas de Final",
  semi_finals: "Semifinal",
  semifinals: "Semifinal",
  semifinal: "Semifinal",
  sf: "Semifinal",
  final: "Grande Final",
  finals: "Grande Final",
  grande_final: "Grande Final",
  f: "Grande Final",
  third_place: "Disputa de 3º Lugar",
  terceiro_lugar: "Disputa de 3º Lugar",
  knockout: "Fase Eliminatória",
  league: "Pontos Corridos",
  round_robin: "Pontos Corridos",
};

/**
 * Traduz o identificador de fase do banco de dados (ex: 'group_stage', 'quarter_finals', 'semi_finals', 'final')
 * para um nome de exibição amigável em português (PT-BR).
 */
export function formatPhaseName(rawPhase?: string | null): string {
  if (!rawPhase) return "Fase Inicial";
  const trimmed = String(rawPhase).trim();
  const lower = trimmed.toLowerCase();

  if (phaseNameMap[lower]) {
    return phaseNameMap[lower];
  }

  if (lower.startsWith("group_stage_") || lower.startsWith("group_")) {
    const suffix = trimmed.split("_").pop()?.toUpperCase();
    return suffix ? `Fase de Grupos - Grupo ${suffix}` : "Fase de Grupos";
  }

  if (lower.includes("group") || lower.includes("grupo")) {
    if (lower === "group stage" || lower === "group_stage") {
      return "Fase de Grupos";
    }
    return trimmed;
  }

  if (lower.includes("round_of_16") || lower.includes("oitava")) {
    return "Oitavas de Final";
  }

  if (lower.includes("quarter") || lower.includes("quarta")) {
    return "Quartas de Final";
  }

  if (lower.includes("semi")) {
    return "Semifinal";
  }

  if (lower === "final" || lower === "finals" || lower === "grande final") {
    return "Grande Final";
  }

  return trimmed;
}

import type { PhaseRuleOverride, SportType, Tournament } from "../types";

/**
 * Converte qualquer variação de fase (ex: 'Semifinal', 'semi_finals', 'SF', 'Final', 'Grande Final', 'Grupo A')
 * para a chave canônica usada em `phase_exceptions`:
 * 'group_stage' | 'round_of_16' | 'quarter_finals' | 'semi_finals' | 'final' | 'third_place'
 */
export function normalizePhaseKey(rawPhase?: string | null): string {
  if (!rawPhase) return "group_stage";
  const trimmed = String(rawPhase).trim();
  const lower = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    lower === "group_stage" ||
    lower === "groups" ||
    lower === "group" ||
    lower === "fase_de_grupos" ||
    lower === "fase de grupos" ||
    lower.startsWith("group_") ||
    lower.startsWith("grupo") ||
    lower.includes("group") ||
    lower.includes("grupo") ||
    lower === "league" ||
    lower === "round_robin" ||
    lower.includes("pontos corridos")
  ) {
    return "group_stage";
  }

  if (
    lower === "round_of_16" ||
    lower === "oitavas" ||
    lower === "oitavas de final" ||
    lower === "of" ||
    lower.includes("round_of_16") ||
    lower.includes("oitava")
  ) {
    return "round_of_16";
  }

  if (
    lower === "quarter_finals" ||
    lower === "quarterfinals" ||
    lower === "quartas" ||
    lower === "quartas de final" ||
    lower === "qf" ||
    lower.includes("quarter") ||
    lower.includes("quarta")
  ) {
    return "quarter_finals";
  }

  if (
    lower === "semi_finals" ||
    lower === "semifinals" ||
    lower === "semifinal" ||
    lower === "sf" ||
    lower.includes("semi")
  ) {
    return "semi_finals";
  }

  if (
    lower === "third_place" ||
    lower === "terceiro_lugar" ||
    lower.includes("3o") ||
    lower.includes("3º") ||
    lower.includes("terceiro")
  ) {
    return "third_place";
  }

  if (
    lower === "final" ||
    lower === "finals" ||
    lower === "grande_final" ||
    lower === "grande final" ||
    lower === "f" ||
    lower.includes("final")
  ) {
    return "final";
  }

  return lower;
}

export interface ResolvedMatchRules {
  sportType: SportType;
  canonicalPhase: string;
  isPhaseException: boolean;
  // Sets (Ping Pong, Vôlei, Dominó Melhor de X)
  bestOf: number;
  best_of_sets: number;
  requiredSets: number;
  pointsPerSet: number;
  points_per_set: number;
  tieBreakPoints: number;
  tie_break_points: number;
  requiresTwoPointAdvantage: boolean;
  requires_two_point_advantage: boolean;
  // Pontuação Acumulada (Dominó)
  targetScore: number;
  target_score: number;
  maxRounds: number;
  max_rounds: number;
  // Tempo (Futsal)
  halvesCount: number;
  halves_count: number;
  halfDurationMinutes: number;
  half_duration_minutes: number;
  hasExtraTime: boolean;
  has_extra_time: boolean;
  extraTimeDuration: number;
  extra_time_duration: number;
  hasPenalties: boolean;
  has_penalties: boolean;
  // Texto dinâmico formatado para a Súmula Digital
  ruleText: string;
}

function parseRuleNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseRuleBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/**
 * Calcula dinamicamente as regras aplicáveis para uma partida combinando as regras globais
 * do torneio com eventuais exceções configuradas para a fase (`phase_exceptions`).
 */
export function getMatchRules(
  tournament?: Tournament | Record<string, any> | null,
  matchPhase?: string | null,
  fallbackSport?: SportType
): ResolvedMatchRules {
  const sportType: SportType =
    (tournament?.sport_type as SportType) || fallbackSport || "DOMINO";

  const rawMatchRules =
    tournament?.match_rules && typeof tournament.match_rules === "object"
      ? (tournament.match_rules as Record<string, any>)
      : {};

  const rawPhaseExceptions: Record<string, PhaseRuleOverride> = {
    ...(rawMatchRules?.phase_exceptions &&
    typeof rawMatchRules.phase_exceptions === "object"
      ? rawMatchRules.phase_exceptions
      : {}),
    ...(tournament?.phase_exceptions &&
    typeof tournament.phase_exceptions === "object"
      ? tournament.phase_exceptions
      : {}),
  };

  const canonicalPhase = normalizePhaseKey(matchPhase);
  const rawPhaseTrimmed = matchPhase ? String(matchPhase).trim() : "";
  const rawPhaseLower = rawPhaseTrimmed.toLowerCase();

  let phaseOverride: PhaseRuleOverride | undefined =
    rawPhaseExceptions[canonicalPhase] ||
    (rawPhaseTrimmed ? rawPhaseExceptions[rawPhaseTrimmed] : undefined) ||
    (rawPhaseLower ? rawPhaseExceptions[rawPhaseLower] : undefined);

  if (!phaseOverride && Object.keys(rawPhaseExceptions).length > 0) {
    for (const [key, val] of Object.entries(rawPhaseExceptions)) {
      if (normalizePhaseKey(key) === canonicalPhase && val && typeof val === "object") {
        phaseOverride = val;
        break;
      }
    }
  }

  const isPhaseException = Boolean(
    phaseOverride && Object.keys(phaseOverride).length > 0
  );

  // Defaults baseados na modalidade
  const defaultBestOf =
    sportType === "PING_PONG" || sportType === "VOLEI"
      ? 3
      : canonicalPhase === "semi_finals" && sportType === "DOMINO"
      ? 3
      : 1;
  const defaultPointsPerSet =
    sportType === "VOLEI" ? 25 : sportType === "PING_PONG" ? 11 : 4;
  const defaultTieBreakPoints =
    sportType === "VOLEI" ? 15 : sportType === "PING_PONG" ? 11 : 4;
  const defaultTwoPointAdv =
    sportType === "PING_PONG" || sportType === "VOLEI";
  const defaultTargetScore = sportType === "DOMINO" ? 4 : 200;
  const defaultMaxRounds = 10;
  const defaultHalvesCount = 2;
  const defaultHalfDuration = 20;
  const defaultHasExtraTime = false;
  const defaultExtraTimeDuration = 5;
  const defaultHasPenalties = true;

  // Regras globais mescladas com defaults
  const baseBestOf = parseRuleNumber(
    rawMatchRules.bestOf ?? rawMatchRules.best_of_sets,
    defaultBestOf
  );
  const basePointsPerSet = parseRuleNumber(
    rawMatchRules.pointsPerSet ?? rawMatchRules.points_per_set,
    defaultPointsPerSet
  );
  const baseTieBreakPoints = parseRuleNumber(
    rawMatchRules.tieBreakPoints ?? rawMatchRules.tie_break_points,
    defaultTieBreakPoints
  );
  const baseTwoPointAdv = parseRuleBoolean(
    rawMatchRules.requiresTwoPointAdvantage ??
      rawMatchRules.requires_two_point_advantage,
    defaultTwoPointAdv
  );
  const baseTargetScore = parseRuleNumber(
    rawMatchRules.targetScore ?? rawMatchRules.target_score,
    defaultTargetScore
  );
  const baseMaxRounds = parseRuleNumber(
    rawMatchRules.maxRounds ?? rawMatchRules.max_rounds,
    defaultMaxRounds
  );
  const baseHalvesCount = parseRuleNumber(
    rawMatchRules.halvesCount ?? rawMatchRules.halves_count,
    defaultHalvesCount
  );
  const baseHalfDuration = parseRuleNumber(
    rawMatchRules.halfDurationMinutes ?? rawMatchRules.half_duration_minutes,
    defaultHalfDuration
  );
  const baseHasExtraTime = parseRuleBoolean(
    rawMatchRules.hasExtraTime ?? rawMatchRules.has_extra_time,
    defaultHasExtraTime
  );
  const baseExtraTimeDuration = parseRuleNumber(
    rawMatchRules.extraTimeDuration ?? rawMatchRules.extra_time_duration,
    defaultExtraTimeDuration
  );
  const baseHasPenalties = parseRuleBoolean(
    rawMatchRules.hasPenalties ?? rawMatchRules.has_penalties,
    defaultHasPenalties
  );

  // Sobrescrita pela Exceção de Fase (quando houver)
  const bestOf = isPhaseException
    ? parseRuleNumber(
        phaseOverride?.bestOf ?? phaseOverride?.best_of_sets,
        baseBestOf
      )
    : baseBestOf;
  const pointsPerSet = isPhaseException
    ? parseRuleNumber(
        phaseOverride?.pointsPerSet ?? phaseOverride?.points_per_set,
        basePointsPerSet
      )
    : basePointsPerSet;
  const tieBreakPoints = isPhaseException
    ? parseRuleNumber(
        phaseOverride?.tieBreakPoints ?? phaseOverride?.tie_break_points,
        baseTieBreakPoints
      )
    : baseTieBreakPoints;
  const requiresTwoPointAdvantage = isPhaseException
    ? parseRuleBoolean(
        phaseOverride?.requiresTwoPointAdvantage ??
          phaseOverride?.requires_two_point_advantage,
        baseTwoPointAdv
      )
    : baseTwoPointAdv;
  const targetScore = isPhaseException
    ? parseRuleNumber(
        phaseOverride?.targetScore ?? phaseOverride?.target_score,
        baseTargetScore
      )
    : baseTargetScore;
  const maxRounds = isPhaseException
    ? parseRuleNumber(
        phaseOverride?.maxRounds ?? phaseOverride?.max_rounds,
        baseMaxRounds
      )
    : baseMaxRounds;
  const halvesCount = isPhaseException
    ? parseRuleNumber(
        phaseOverride?.halvesCount ?? phaseOverride?.halves_count,
        baseHalvesCount
      )
    : baseHalvesCount;
  const halfDurationMinutes = isPhaseException
    ? parseRuleNumber(
        phaseOverride?.halfDurationMinutes ??
          phaseOverride?.half_duration_minutes,
        baseHalfDuration
      )
    : baseHalfDuration;
  const hasExtraTime = isPhaseException
    ? parseRuleBoolean(
        phaseOverride?.hasExtraTime ?? phaseOverride?.has_extra_time,
        baseHasExtraTime
      )
    : baseHasExtraTime;
  const extraTimeDuration = isPhaseException
    ? parseRuleNumber(
        phaseOverride?.extraTimeDuration ?? phaseOverride?.extra_time_duration,
        baseExtraTimeDuration
      )
    : baseExtraTimeDuration;
  const hasPenalties = isPhaseException
    ? parseRuleBoolean(
        phaseOverride?.hasPenalties ?? phaseOverride?.has_penalties,
        baseHasPenalties
      )
    : baseHasPenalties;

  const requiredSets = Math.max(1, Math.ceil(bestOf / 2));

  // Gera texto amigável para exibição no cabeçalho da Súmula Digital
  let ruleText = "";
  if (sportType === "PING_PONG" || sportType === "VOLEI") {
    const icon = sportType === "VOLEI" ? "🏐" : "🏓";
    const diffLabel = requiresTwoPointAdvantage ? " (dif. mín. 2)" : "";
    const tieBreakLabel =
      bestOf > 1 ? ` • Tie-break: ${tieBreakPoints} pts` : "";
    ruleText = `${icon} Regra: Melhor de ${bestOf} (vence ${requiredSets} ${
      requiredSets === 1 ? "set" : "sets"
    }) • Sets até ${pointsPerSet} pts${diffLabel}${tieBreakLabel}`;
  } else if (sportType === "FUTSAL") {
    const extraLabel = hasExtraTime
      ? ` • Prorrogação: ${extraTimeDuration} min`
      : "";
    const penLabel = hasPenalties ? " • Pênaltis em empate" : "";
    ruleText = `⚽ Regra: ${halvesCount} tempos de ${halfDurationMinutes} min${extraLabel}${penLabel}`;
  } else {
    // DOMINO
    if (bestOf > 1) {
      ruleText = `🁣 Regra: Melhor de ${bestOf} (${requiredSets} sets de ${pointsPerSet} pts)`;
    } else {
      ruleText = `🁣 Regra: Corrida até ${targetScore} pontos (máx. ${maxRounds} mãos)`;
    }
  }

  return {
    sportType,
    canonicalPhase,
    isPhaseException,
    bestOf,
    best_of_sets: bestOf,
    requiredSets,
    pointsPerSet,
    points_per_set: pointsPerSet,
    tieBreakPoints,
    tie_break_points: tieBreakPoints,
    requiresTwoPointAdvantage,
    requires_two_point_advantage: requiresTwoPointAdvantage,
    targetScore,
    target_score: targetScore,
    maxRounds,
    max_rounds: maxRounds,
    halvesCount,
    halves_count: halvesCount,
    halfDurationMinutes,
    half_duration_minutes: halfDurationMinutes,
    hasExtraTime,
    has_extra_time: hasExtraTime,
    extraTimeDuration,
    extra_time_duration: extraTimeDuration,
    hasPenalties,
    has_penalties: hasPenalties,
    ruleText,
  };
}

const PT_BR_SHORT_MONTHS = [
  "jan.",
  "fev.",
  "mar.",
  "abr.",
  "mai.",
  "jun.",
  "jul.",
  "ago.",
  "set.",
  "out.",
  "nov.",
  "dez.",
];

function parseDateParts(rawDate?: string | null): { day: number; month: number; year: number } | null {
  if (!rawDate) return null;
  const trimmed = String(rawDate).trim();
  if (!trimmed) return null;

  // Prioriza formato ISO YYYY-MM-DD para evitar deslocamento de fuso horário
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    if (year && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return { day, month, year };
    }
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    day: parsed.getUTCDate(),
    month: parsed.getUTCMonth(),
    year: parsed.getUTCFullYear(),
  };
}

/**
 * Formata datas de torneios com suporte a eventos de 1 dia ou múltiplos dias:
 * - Mesmo dia ou sem end_date: "25 de nov. de 2026"
 * - Mesmo mês e ano: "25 a 26 de nov. de 2026"
 * - Meses diferentes (mesmo ano): "30 de nov. a 02 de dez. de 2026"
 * - Anos diferentes: "30 de dez. de 2026 a 02 de jan. de 2027"
 */
export function formatTournamentDate(
  startDate?: string | null,
  endDate?: string | null,
  startTime?: string | null
): string {
  const start = parseDateParts(startDate);
  if (!start) return "Data a definir";

  const end = parseDateParts(endDate);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const sMonth = PT_BR_SHORT_MONTHS[start.month] || "";

  let formatted = "";

  if (
    !end ||
    (start.year === end.year && start.month === end.month && start.day === end.day)
  ) {
    formatted = `${pad2(start.day)} de ${sMonth} de ${start.year}`;
  } else if (start.year === end.year && start.month === end.month) {
    formatted = `${pad2(start.day)} a ${pad2(end.day)} de ${sMonth} de ${start.year}`;
  } else if (start.year === end.year) {
    const eMonth = PT_BR_SHORT_MONTHS[end.month] || "";
    formatted = `${pad2(start.day)} de ${sMonth} a ${pad2(end.day)} de ${eMonth} de ${start.year}`;
  } else {
    const eMonth = PT_BR_SHORT_MONTHS[end.month] || "";
    formatted = `${pad2(start.day)} de ${sMonth} de ${start.year} a ${pad2(end.day)} de ${eMonth} de ${end.year}`;
  }

  if (startTime && startTime.trim()) {
    return `${formatted} às ${startTime.trim()}`;
  }

  return formatted;
}




