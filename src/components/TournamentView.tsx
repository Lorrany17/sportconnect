"use client";

import React, { useMemo, useState } from "react";
import {
  Trophy,
  Network,
  CheckCircle2,
  BarChart2,
  Layers,
  Sparkles,
  Calendar,
  ArrowUpDown,
  Loader2,
} from "lucide-react";
import { Tournament, Team, Match } from "@/types";
import { calculateGroupStandings, extractMatchGroupName, normalizeGroupLetter } from "@/utils/groupStandings";
import { getLiveMatchScore } from "@/utils/liveMatchScore";
import { generateKnockoutStage } from "@/app/actions/bracket";
import { organizeBracketRounds, getThirdPlaceMatch } from "@/utils/bracketTree";
import { useAuth } from "@/context/AuthProvider";
import { useTournamentPermissions } from "@/hooks/useTournamentPermissions";
import { supabase } from "@/lib/supabase";
import LeagueTableComponent from "@/components/LeagueTable";

export { calculateGroupStandings };
export const LeagueTable = LeagueTableComponent;

export type StandardizedTournamentFormat = "KNOCKOUT" | "LEAGUE" | "GROUPS";

export function normalizeTournamentFormat(
  input?: string | Tournament | null
): StandardizedTournamentFormat {
  if (!input) return "KNOCKOUT";

  let raw = "";
  if (typeof input === "string") {
    raw = input;
  } else {
    // Dá prioridade absoluta ao tournament_format explícito
    const explicitTFormat = String(
      input.tournament_format ||
      (input.match_rules as Record<string, unknown> | undefined)?.tournament_format ||
      ""
    ).toUpperCase().trim();

    if (
      explicitTFormat === "LEAGUE" ||
      explicitTFormat === "ROUND_ROBIN" ||
      explicitTFormat === "PONTOS_CORRIDOS"
    ) {
      return "LEAGUE";
    }
    if (
      explicitTFormat === "GROUPS" ||
      explicitTFormat === "GROUPS_KNOCKOUT" ||
      explicitTFormat === "FASE_DE_GRUPOS"
    ) {
      return "GROUPS";
    }
    if (
      explicitTFormat === "KNOCKOUT" ||
      explicitTFormat === "SINGLE_ELIMINATION" ||
      explicitTFormat.includes("MATA")
    ) {
      return "KNOCKOUT";
    }

    // Se tournament_format não estiver definido, verifica input.format com rigor (sem falsos positivos)
    raw = String(input.format || "KNOCKOUT");
  }

  const upper = raw.toUpperCase().trim();
  if (
    upper === "LEAGUE" ||
    upper === "ROUND_ROBIN" ||
    upper === "PONTOS_CORRIDOS" ||
    upper === "PONTOS CORRIDOS"
  ) {
    return "LEAGUE";
  }
  if (
    upper === "GROUPS" ||
    upper === "GROUPS_KNOCKOUT" ||
    upper === "FASE_DE_GRUPOS"
  ) {
    return "GROUPS";
  }
  return "KNOCKOUT";
}

export interface GroupStageItem {
  id: string;
  name: string;
  teams: Team[];
  matches: Match[];
}

export interface KnockoutTreeProps {
  matches: Match[];
  teams?: Team[];
  teamsMap?: Map<string, Team>;
  tournament?: Tournament | null;
  onSelectMatch?: (match: Match) => void;
  isEditMode?: boolean;
  onSwapTeams?: (
    srcMatchId: string,
    srcSlot: "team1" | "team2" | "A" | "B",
    destMatchId: string,
    destSlot: "team1" | "team2" | "A" | "B"
  ) => void;
  onReplaceTeam?: (
    matchId: string,
    slot: "team1" | "team2" | "A" | "B",
    newTeamId: string | null
  ) => void;
}

export interface LeagueTableProps {
  teams: Team[];
  matches: Match[];
  tournament?: Tournament | null;
  onSelectMatch?: (match: Match) => void;
}

export interface GroupStagesProps {
  groups?: GroupStageItem[];
  teams?: Team[];
  matches?: Match[];
  tournament?: Tournament | null;
  onSelectMatch?: (match: Match) => void;
  isEditMode?: boolean;
  isAdmin?: boolean;
  isOrganizer?: boolean;
  canManage?: boolean;
  onSwapTeams?: (
    srcMatchId: string,
    srcSlot: "team1" | "team2" | "A" | "B",
    destMatchId: string,
    destSlot: "team1" | "team2" | "A" | "B"
  ) => void;
  onReplaceTeam?: (
    matchId: string,
    slot: "team1" | "team2" | "A" | "B",
    newTeamId: string | null
  ) => void;
  onGenerateKnockout?: () => void;
}

export interface TournamentViewProps {
  format?: StandardizedTournamentFormat | string;
  tournament?: Tournament | null;
  teams: Team[];
  matches: Match[];
  groups?: GroupStageItem[];
  onSelectMatch?: (match: Match) => void;
  isEditMode?: boolean;
  isAdmin?: boolean;
  isOrganizer?: boolean;
  canManage?: boolean;
  onSwapTeams?: (
    srcMatchId: string,
    srcSlot: "team1" | "team2" | "A" | "B",
    destMatchId: string,
    destSlot: "team1" | "team2" | "A" | "B"
  ) => void;
  onReplaceTeam?: (
    matchId: string,
    slot: "team1" | "team2" | "A" | "B",
    newTeamId: string | null
  ) => void;
  onGenerateKnockout?: () => void;
}

interface StandingsRow {
  team: Team;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
}

export function computeStandings(
  teams: Team[],
  matches: Match[],
  tournament?: Tournament | null
): StandingsRow[] {
  const activeTeams = teams.filter(
    (t) =>
      t.id !== "bye" &&
      t.cancellation_status !== "REFUNDED" &&
      t.status !== "CANCELLED" &&
      t.status !== "CANCELED" &&
      t.payment_status !== "CANCELED" &&
      t.payment_status !== "CANCELLED"
  );

  // Se houver equipes com pagamento aprovado/confirmado, prioriza-as
  const confirmedOnly = activeTeams.filter(
    (t) =>
      t.payment_status === "PAID" ||
      t.payment_status === "APPROVED" ||
      t.status === "CONFIRMED" ||
      t.status === "PAID" ||
      t.status === "APPROVED"
  );
  const baseTeams = confirmedOnly.length > 0 ? confirmedOnly : activeTeams;

  const statsMap = new Map<string, StandingsRow>();
  baseTeams.forEach((team) => {
    statsMap.set(team.id, {
      team,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
    });
  });

  const isSetsSport =
    tournament?.sport_type === "PING_PONG" || tournament?.sport_type === "VOLEI";

  matches.forEach((m) => {
    const statusUpper = String(m.status || "").toUpperCase();
    const isFinished =
      statusUpper === "COMPLETED" ||
      statusUpper === "FINISHED" ||
      statusUpper === "FINALIZADO" ||
      statusUpper === "ENCERRADA";

    if (!isFinished) return;

    const team1Id = m.team1_id || m.team_a_id || m.teamA?.id;
    const team2Id = m.team2_id || m.team_b_id || m.teamB?.id;
    if (!team1Id || !team2Id || team1Id === "bye" || team2Id === "bye") return;

    const row1 = statsMap.get(team1Id);
    const row2 = statsMap.get(team2Id);
    if (!row1 && !row2) return;

    const sets1 = Number(m.sets_a ?? m.setsA ?? 0);
    const sets2 = Number(m.sets_b ?? m.setsB ?? 0);
    const rawScore1 = Number(m.score_a ?? m.scoreA ?? 0);
    const rawScore2 = Number(m.score_b ?? m.scoreB ?? 0);

    const score1 = isSetsSport && (sets1 > 0 || sets2 > 0) ? sets1 : rawScore1;
    const score2 = isSetsSport && (sets1 > 0 || sets2 > 0) ? sets2 : rawScore2;

    const winnerId = m.winner_id || m.winnerId;

    let result1: "W" | "D" | "L" = "D";
    if (winnerId === team1Id || score1 > score2) {
      result1 = "W";
    } else if (winnerId === team2Id || score2 > score1) {
      result1 = "L";
    } else {
      result1 = "D";
    }

    if (row1) {
      row1.played += 1;
      row1.goalsFor += score1;
      row1.goalsAgainst += score2;
      row1.goalDiff = row1.goalsFor - row1.goalsAgainst;
      if (result1 === "W") {
        row1.wins += 1;
        row1.points += 3;
      } else if (result1 === "D") {
        row1.draws += 1;
        row1.points += 1;
      } else {
        row1.losses += 1;
      }
    }

    if (row2) {
      row2.played += 1;
      row2.goalsFor += score2;
      row2.goalsAgainst += score1;
      row2.goalDiff = row2.goalsFor - row2.goalsAgainst;
      if (result1 === "L") {
        row2.wins += 1;
        row2.points += 3;
      } else if (result1 === "D") {
        row2.draws += 1;
        row2.points += 1;
      } else {
        row2.losses += 1;
      }
    }
  });

  return Array.from(statsMap.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.team.name.localeCompare(b.team.name);
  });
}

export function buildBlankKnockoutMatches(qualifierCount: number = 4): Match[] {
  const safeCount = Math.max(4, qualifierCount);
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(safeCount)));
  const totalRounds = Math.max(2, Math.round(Math.log2(bracketSize)));

  const generated: Match[] = [];
  let globalMatchOrder = 1;

  const getPhaseSlug = (matchesInRound: number): string => {
    if (matchesInRound === 1) return "final";
    if (matchesInRound === 2) return "semi_finals";
    if (matchesInRound === 4) return "quarter_finals";
    if (matchesInRound === 8) return "round_of_16";
    return `round_${matchesInRound * 2}`;
  };

  for (let r = 1; r <= totalRounds; r++) {
    const matchesInRound = bracketSize / Math.pow(2, r);
    const phaseSlug = getPhaseSlug(matchesInRound);

    for (let m = 0; m < matchesInRound; m++) {
      const id = `blank-r${r}-m${m}`;
      const nextMatchId =
        r < totalRounds ? `blank-r${r + 1}-m${Math.floor(m / 2)}` : null;

      generated.push({
        id,
        round: r,
        match_order: globalMatchOrder,
        tableNumber: globalMatchOrder,
        phase: phaseSlug,
        status: "SCHEDULED",
        scoreA: 0,
        scoreB: 0,
        score_a: 0,
        score_b: 0,
        next_match_id: nextMatchId,
        teamA: { id: `placeholder-${id}-a`, name: "A definir", players: ["", ""], createdAt: "" },
        teamB: { id: `placeholder-${id}-b`, name: "A definir", players: ["", ""], createdAt: "" },
        detailedScore: { rounds: [] },
      });
      globalMatchOrder++;
    }
  }

  return generated;
}

/**
 * 1. COMPONENTE KNOCKOUT TREE (Mata-Mata Tradicional)
 */
export function KnockoutTree({
  matches,
  teams = [],
  teamsMap: propTeamsMap,
  tournament,
  onSelectMatch,
  isEditMode = false,
  onSwapTeams,
  onReplaceTeam,
}: KnockoutTreeProps) {
  const selectableTeams = useMemo(() => {
    return (teams || []).filter(
      (t) =>
        t.id !== "bye" &&
        t.status !== "CANCELLED" &&
        t.status !== "CANCELED" &&
        t.payment_status !== "CANCELLED" &&
        t.payment_status !== "CANCELED" &&
        t.cancellation_status !== "REFUNDED"
    );
  }, [teams]);

  const teamsMap = useMemo(() => {
    if (propTeamsMap) return propTeamsMap;
    const map = new Map<string, Team>();
    teams.forEach((t) => map.set(t.id, t));
    return map;
  }, [propTeamsMap, teams]);

  const roundGroups = useMemo(() => {
    return organizeBracketRounds(matches);
  }, [matches]);

  const thirdPlaceMatch = useMemo(() => {
    return getThirdPlaceMatch(matches);
  }, [matches]);

  // Mapeia para cada partida os confrontos da fase anterior que alimentam suas vagas
  const feedersMap = useMemo(() => {
    const map = new Map<string, Match[]>();
    matches.forEach((m) => {
      if (m.next_match_id) {
        if (!map.has(m.next_match_id)) {
          map.set(m.next_match_id, []);
        }
        map.get(m.next_match_id)!.push(m);
      }
    });
    map.forEach((list) => {
      list.sort((a, b) => (Number(a.match_order) || 0) - (Number(b.match_order) || 0));
    });
    return map;
  }, [matches]);

  const [dragOverCoord, setDragOverCoord] = useState<string | null>(null);

  const emptySlotsInRound1 = useMemo(() => {
    const round1Matches = roundGroups[0]?.matches || [];
    const list: Array<{ matchId: string; slot: "team1" | "team2"; label: string; value: string }> = [];
    round1Matches.forEach((m, idx) => {
      const t1 = m.team1_id || m.team_a_id || m.teamA?.id;
      const t2 = m.team2_id || m.team_b_id || m.teamB?.id;
      const matchNum = m.match_order || idx + 1;
      if (!t1) {
        list.push({
          matchId: m.id,
          slot: "team1",
          label: `Slot Vazio - Jogo ${matchNum} (Vaga 1)`,
          value: `EMPTY:${m.id}:team1`,
        });
      }
      if (!t2) {
        list.push({
          matchId: m.id,
          slot: "team2",
          label: `Slot Vazio - Jogo ${matchNum} (Vaga 2)`,
          value: `EMPTY:${m.id}:team2`,
        });
      }
    });
    return list;
  }, [roundGroups]);

  const renderKnockoutCard = (
    match: Match,
    idx: number,
    isFirstRound: boolean,
    isFinal: boolean,
    isThirdPlace = false
  ) => {
    const canEditRound = Boolean(isEditMode && isFirstRound && !isThirdPlace);
    const rawTeam1Id = match.team1_id || match.team_a_id || match.teamA?.id;
    const rawTeam2Id = match.team2_id || match.team_b_id || match.teamB?.id;
    const team1Id =
      rawTeam1Id && rawTeam1Id !== "bye" && !String(rawTeam1Id).startsWith("placeholder-")
        ? rawTeam1Id
        : null;
    const team2Id =
      rawTeam2Id && rawTeam2Id !== "bye" && !String(rawTeam2Id).startsWith("placeholder-")
        ? rawTeam2Id
        : null;

    const isValidTeamObj = (t?: Team | null) => {
      if (!t || !t.name) return false;
      const lower = t.name.toLowerCase().trim();
      return (
        t.id !== "bye" &&
        !String(t.id || "").startsWith("placeholder-") &&
        lower !== "a definir" &&
        !lower.includes("chapéu") &&
        !lower.includes("folga")
      );
    };

    const team1 = team1Id
      ? teamsMap.get(team1Id) ||
        (isValidTeamObj(match.teamA) ? match.teamA : null) || {
          id: team1Id,
          name: `Equipe #${team1Id.slice(0, 6)}`,
          players: [],
        }
      : null;
    const team2 = team2Id
      ? teamsMap.get(team2Id) ||
        (isValidTeamObj(match.teamB) ? match.teamB : null) || {
          id: team2Id,
          name: `Equipe #${team2Id.slice(0, 6)}`,
          players: [],
        }
      : null;

    const statusNorm = String(match.status || "").toUpperCase().trim();
    const isLive =
      statusNorm === "LIVE" ||
      statusNorm === "IN_PROGRESS" ||
      statusNorm === "PLAYING" ||
      statusNorm === "EM_ANDAMENTO";
    const isCompleted =
      statusNorm === "COMPLETED" ||
      statusNorm === "FINISHED" ||
      statusNorm === "FINALIZADO" ||
      statusNorm === "ENCERRADA";
    const isScheduled = !isLive && !isCompleted;

    const isBye =
      isFirstRound &&
      ((Boolean(team1) && !team2 && Boolean(team1Id) && !team2Id) ||
        (!team1 && Boolean(team2) && !team1Id && Boolean(team2Id)));

    const feeders = feedersMap.get(match.id) || [];
    const feeder1 = feeders[0];
    const feeder2 = feeders[1];

    const defaultTeam1Label = isThirdPlace
      ? "Perdedor Semifinal 1"
      : isFirstRound
      ? isBye
        ? "BYE (Avanço Automático)"
        : "A definir"
      : feeder1
      ? `Vencedor do Jogo #${feeder1.match_order || 1}`
      : "A definir";

    const defaultTeam2Label = isThirdPlace
      ? "Perdedor Semifinal 2"
      : isFirstRound
      ? isBye
        ? "BYE (Avanço Automático)"
        : "A definir"
      : feeder2
      ? `Vencedor do Jogo #${feeder2.match_order || 2}`
      : "A definir";

    const team1Name = team1 ? team1.name : defaultTeam1Label;
    const team2Name = team2 ? team2.name : defaultTeam2Label;

    const liveScore = getLiveMatchScore(match, tournament?.sport_type);
    const isSetsSport = liveScore.isSetsSport;

    // Prioridade estrita para as colunas raízes sincronizadas do Supabase
    const sets1 = match.sets_a !== undefined && match.sets_a !== null
      ? Number(match.sets_a)
      : (match.setsA !== undefined && match.setsA !== null
        ? Number(match.setsA)
        : liveScore.setsA);
    const sets2 = match.sets_b !== undefined && match.sets_b !== null
      ? Number(match.sets_b)
      : (match.setsB !== undefined && match.setsB !== null
        ? Number(match.setsB)
        : liveScore.setsB);
    const score1 = match.score_a !== undefined && match.score_a !== null
      ? Number(match.score_a)
      : (match.scoreA !== undefined && match.scoreA !== null
        ? Number(match.scoreA)
        : (isLive ? liveScore.activePointsA : liveScore.rawScoreA));
    const score2 = match.score_b !== undefined && match.score_b !== null
      ? Number(match.score_b)
      : (match.scoreB !== undefined && match.scoreB !== null
        ? Number(match.scoreB)
        : (isLive ? liveScore.activePointsB : liveScore.rawScoreB));

    const isWinner1 =
      isCompleted &&
      ((match.winner_id && match.winner_id === team1Id) ||
        (!isBye &&
          (isSetsSport && (sets1 > 0 || sets2 > 0)
            ? sets1 > sets2
            : score1 > score2)));
    const isWinner2 =
      isCompleted &&
      ((match.winner_id && match.winner_id === team2Id) ||
        (!isBye &&
          (isSetsSport && (sets1 > 0 || sets2 > 0)
            ? sets2 > sets1
            : score2 > score1)));

    const hasDetails =
      !isBye &&
      (isCompleted || isLive || match.status === "IN_PROGRESS") &&
      Boolean(team1Id || team2Id);

    const coord1 = `${match.id}-team1`;
    const isOver1 = canEditRound && dragOverCoord === coord1;
    const isEmpty1 = !team1Id;

    const coord2 = `${match.id}-team2`;
    const isOver2 = canEditRound && dragOverCoord === coord2;
    const isEmpty2 = !team2Id;

    return (
      <div
        key={(match as any).uuid || (match as any).db_id || match.id}
        className={`bg-[#18181b] border rounded-2xl p-3.5 sm:p-4 shadow-xl transition-all duration-300 relative group print:bg-white print:text-black print:border-neutral-400 print:shadow-none print:break-inside-avoid ${
          isThirdPlace
            ? "border-amber-500/40 ring-1 ring-amber-500/15"
            : isLive
            ? "border-amber-500/60 ring-1 ring-amber-500/30"
            : isFinal
            ? "border-amber-500/30 hover:border-amber-500/60"
            : "border-zinc-800 hover:border-[#00a2ff]/50"
        }`}
      >
        <div className="flex items-center justify-between text-[10px] font-bold pb-2 mb-2 border-b border-zinc-800/80 print:border-neutral-300">
          <span className="text-zinc-500 print:text-black uppercase tracking-wider">
            {isThirdPlace ? "Disputa de 3º Lugar" : `Jogo #${match.match_order || idx + 1}`}
          </span>

          <div className="flex items-center gap-1.5 print:hidden">
            {isLive ? (
              <span className="flex items-center gap-1 text-amber-400 font-black animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span>AO VIVO{isSetsSport && liveScore.currentSetNumber > 0 ? ` • SET ${liveScore.currentSetNumber}` : ""}</span>
              </span>
            ) : isCompleted ? (
              <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                <CheckCircle2 className="h-3 w-3" />
                <span>{isBye ? "Avanço por BYE" : "Encerrada"}</span>
              </span>
            ) : (
              <span className="text-zinc-500">Programada</span>
            )}
          </div>
        </div>

        {/* Equipe 1 */}
        <div
          draggable={canEditRound}
          onDragStart={
            canEditRound
              ? (e) => {
                  const payload = JSON.stringify({
                    matchId: match.id,
                    slot: "team1",
                    coord: coord1,
                    teamId: team1Id || null,
                  });
                  e.dataTransfer.setData("text/plain", payload);
                  e.dataTransfer.setData("application/x-slot-coord", coord1);
                  e.dataTransfer.effectAllowed = "move";
                }
              : undefined
          }
          onDragEnd={canEditRound ? () => setDragOverCoord(null) : undefined}
          onDragOver={
            canEditRound
              ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }
              : undefined
          }
          onDragEnter={
            canEditRound
              ? (e) => {
                  e.preventDefault();
                  setDragOverCoord(coord1);
                }
              : undefined
          }
          onDragLeave={
            canEditRound
              ? () => {
                  if (dragOverCoord === coord1) {
                    setDragOverCoord(null);
                  }
                }
              : undefined
          }
          onDrop={
            canEditRound
              ? (e) => {
                  if (!onSwapTeams) return;
                  e.preventDefault();
                  setDragOverCoord(null);
                  try {
                    const raw = e.dataTransfer.getData("text/plain");
                    if (!raw) return;
                    const src = JSON.parse(raw);
                    if (src.matchId && src.slot) {
                      if (src.matchId === match.id && src.slot === "team1") return;
                      onSwapTeams(src.matchId, src.slot, match.id, "team1");
                    }
                  } catch (err) {
                    console.error("Drop error:", err);
                  }
                }
              : undefined
          }
          className={`rounded-xl transition-all ${
            canEditRound
              ? `cursor-grab active:cursor-grabbing p-1.5 border border-dashed transition-all ${
                  isOver1
                    ? "border-amber-400 bg-amber-500/25 ring-2 ring-amber-400/60 scale-[1.01]"
                    : isEmpty1
                    ? "border-amber-500/50 bg-zinc-900/60 hover:border-amber-400 hover:bg-amber-500/10"
                    : "border-amber-500/30 hover:bg-amber-500/10"
                }`
              : ""
          }`}
        >
          <div
            className={`flex items-center justify-between py-1.5 px-2 rounded-xl transition-colors print:text-black ${
              isWinner1
                ? "bg-emerald-500/10 text-emerald-300 print:bg-neutral-100 font-black"
                : "text-zinc-200"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0 pr-2">
              <div
                className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 print:bg-neutral-100 print:text-black print:border-neutral-400 ${
                  !team1 ? "print:hidden" : ""
                } ${
                  team1
                    ? "bg-blue-600/20 text-[#00a2ff] border border-blue-500/30"
                    : canEditRound
                    ? "bg-zinc-800/80 text-amber-400/80 border border-dashed border-amber-500/40"
                    : "bg-zinc-800/60 text-zinc-500 border border-zinc-700/40"
                }`}
              >
                {team1 ? team1.name.slice(0, 1).toUpperCase() : canEditRound ? "∅" : "?"}
              </div>
              <span
                className={`text-xs truncate print:text-black ${
                  !team1
                    ? canEditRound
                      ? "text-amber-400/90 font-medium italic"
                      : "text-zinc-500 italic font-normal"
                    : "font-semibold"
                }`}
                title={team1Name}
              >
                {!team1 ? (
                  <>
                    <span className="print:hidden">
                      {canEditRound ? "Slot Vazio (Solte aqui)" : team1Name}
                    </span>
                    <span className="hidden print:inline font-normal not-italic text-black">
                      {feeder1
                        ? `Venc. #${feeder1.match_order || 1}: ____________`
                        : "____________________"}
                    </span>
                  </>
                ) : (
                  team1Name
                )}
              </span>
            </div>

            <div className="shrink-0 font-mono text-xs font-black min-w-[28px] text-right print:text-black">
              {isScheduled ? (
                <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded border border-zinc-700/80 text-zinc-500 text-[10px] font-mono print:border-black print:text-black print:font-bold">
                  [&nbsp;&nbsp;]
                </span>
              ) : isLive && isSetsSport ? (
                <div className="inline-flex items-center justify-end gap-1">
                  <span className="text-white print:text-black font-black">{sets1}</span>
                  <span className="text-[11px] font-bold text-[#00a2ff] bg-[#00a2ff]/10 px-1 py-0.5 rounded border border-[#00a2ff]/30 print:border-black print:text-black">
                    ({score1})
                  </span>
                </div>
              ) : isSetsSport ? (
                sets1
              ) : (
                score1
              )}
            </div>
          </div>

          {canEditRound && (
            <div
              className="mt-1 pt-1 border-t border-zinc-800/50 print:hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <select
                aria-label={`Selecionar equipe para a vaga 1 do confronto #${match.match_order || idx + 1}`}
                value={team1Id || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!onReplaceTeam) return;
                  if (val.startsWith("EMPTY:")) {
                    const [, targetMatchId, targetSlot] = val.split(":");
                    if (onSwapTeams && targetMatchId && targetSlot) {
                      onSwapTeams(match.id, "team1", targetMatchId, targetSlot as "team1" | "team2");
                    }
                    return;
                  }
                  onReplaceTeam(match.id, "team1", val);
                }}
                className="w-full text-[10px] bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-1 text-zinc-200 hover:border-amber-400 focus:border-amber-400 focus:outline-none cursor-pointer"
              >
                <option value="">{team1Id ? "Remover equipe da vaga" : "Definir equipe..."}</option>
                <optgroup label="Equipes disponíveis">
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
                {emptySlotsInRound1.length > 0 && (
                  <optgroup label="Mover para vaga vazia">
                    {emptySlotsInRound1
                      .filter((es) => es.matchId !== match.id || es.slot !== "team1")
                      .map((es) => (
                        <option key={es.value} value={es.value}>
                          {es.label}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}
        </div>

        {/* Divisor */}
        <div className="h-[1px] bg-zinc-800/80 print:bg-neutral-300 my-2" />

        {/* Equipe 2 */}
        <div
          draggable={canEditRound}
          onDragStart={
            canEditRound
              ? (e) => {
                  const payload = JSON.stringify({
                    matchId: match.id,
                    slot: "team2",
                    coord: coord2,
                    teamId: team2Id || null,
                  });
                  e.dataTransfer.setData("text/plain", payload);
                  e.dataTransfer.setData("application/x-slot-coord", coord2);
                  e.dataTransfer.effectAllowed = "move";
                }
              : undefined
          }
          onDragEnd={canEditRound ? () => setDragOverCoord(null) : undefined}
          onDragOver={
            canEditRound
              ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }
              : undefined
          }
          onDragEnter={
            canEditRound
              ? (e) => {
                  e.preventDefault();
                  setDragOverCoord(coord2);
                }
              : undefined
          }
          onDragLeave={
            canEditRound
              ? () => {
                  if (dragOverCoord === coord2) {
                    setDragOverCoord(null);
                  }
                }
              : undefined
          }
          onDrop={
            canEditRound
              ? (e) => {
                  if (!onSwapTeams) return;
                  e.preventDefault();
                  setDragOverCoord(null);
                  try {
                    const raw = e.dataTransfer.getData("text/plain");
                    if (!raw) return;
                    const src = JSON.parse(raw);
                    if (src.matchId && src.slot) {
                      if (src.matchId === match.id && src.slot === "team2") return;
                      onSwapTeams(src.matchId, src.slot, match.id, "team2");
                    }
                  } catch (err) {
                    console.error("Drop error:", err);
                  }
                }
              : undefined
          }
          className={`rounded-xl transition-all ${
            canEditRound
              ? `cursor-grab active:cursor-grabbing p-1.5 border border-dashed transition-all ${
                  isOver2
                    ? "border-amber-400 bg-amber-500/25 ring-2 ring-amber-400/60 scale-[1.01]"
                    : isEmpty2
                    ? "border-amber-500/50 bg-zinc-900/60 hover:border-amber-400 hover:bg-amber-500/10"
                    : "border-amber-500/30 hover:bg-amber-500/10"
                }`
              : ""
          }`}
        >
          <div
            className={`flex items-center justify-between py-1.5 px-2 rounded-xl transition-colors print:text-black ${
              isWinner2
                ? "bg-emerald-500/10 text-emerald-300 print:bg-neutral-100 font-black"
                : "text-zinc-200"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0 pr-2">
              <div
                className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 print:bg-neutral-100 print:text-black print:border-neutral-400 ${
                  !team2 ? "print:hidden" : ""
                } ${
                  team2
                    ? "bg-blue-600/20 text-[#00a2ff] border border-blue-500/30"
                    : canEditRound
                    ? "bg-zinc-800/80 text-amber-400/80 border border-dashed border-amber-500/40"
                    : "bg-zinc-800/60 text-zinc-500 border border-zinc-700/40"
                }`}
              >
                {team2 ? team2.name.slice(0, 1).toUpperCase() : canEditRound ? "∅" : "?"}
              </div>
              <span
                className={`text-xs truncate print:text-black ${
                  !team2
                    ? canEditRound
                      ? "text-amber-400/90 font-medium italic"
                      : "text-zinc-500 italic font-normal"
                    : "font-semibold"
                }`}
                title={team2Name}
              >
                {!team2 ? (
                  <>
                    <span className="print:hidden">
                      {canEditRound ? "Slot Vazio (Solte aqui)" : team2Name}
                    </span>
                    <span className="hidden print:inline font-normal not-italic text-black">
                      {feeder2
                        ? `Venc. #${feeder2.match_order || 2}: ____________`
                        : "____________________"}
                    </span>
                  </>
                ) : (
                  team2Name
                )}
              </span>
            </div>

            <div className="shrink-0 font-mono text-xs font-black min-w-[28px] text-right print:text-black">
              {isScheduled ? (
                <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded border border-zinc-700/80 text-zinc-500 text-[10px] font-mono print:border-black print:text-black print:font-bold">
                  [&nbsp;&nbsp;]
                </span>
              ) : isLive && isSetsSport ? (
                <div className="inline-flex items-center justify-end gap-1">
                  <span className="text-white print:text-black font-black">{sets2}</span>
                  <span className="text-[11px] font-bold text-[#00a2ff] bg-[#00a2ff]/10 px-1 py-0.5 rounded border border-[#00a2ff]/30 print:border-black print:text-black">
                    ({score2})
                  </span>
                </div>
              ) : isSetsSport ? (
                sets2
              ) : (
                score2
              )}
            </div>
          </div>

          {canEditRound && (
            <div
              className="mt-1 pt-1 border-t border-zinc-800/50 print:hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <select
                aria-label={`Selecionar equipe para a vaga 2 do confronto #${match.match_order || idx + 1}`}
                value={team2Id || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!onReplaceTeam) return;
                  if (val.startsWith("EMPTY:")) {
                    const [, targetMatchId, targetSlot] = val.split(":");
                    if (onSwapTeams && targetMatchId && targetSlot) {
                      onSwapTeams(match.id, "team2", targetMatchId, targetSlot as "team1" | "team2");
                    }
                    return;
                  }
                  onReplaceTeam(match.id, "team2", val);
                }}
                className="w-full text-[10px] bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-1 text-zinc-200 hover:border-amber-400 focus:border-amber-400 focus:outline-none cursor-pointer"
              >
                <option value="">{team2Id ? "Remover equipe da vaga" : "Definir equipe..."}</option>
                <optgroup label="Equipes disponíveis">
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
                {emptySlotsInRound1.length > 0 && (
                  <optgroup label="Mover para vaga vazia">
                    {emptySlotsInRound1
                      .filter((es) => es.matchId !== match.id || es.slot !== "team2")
                      .map((es) => (
                        <option key={es.value} value={es.value}>
                          {es.label}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}
        </div>

        {hasDetails && onSelectMatch && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectMatch(match);
            }}
            className="w-full mt-2.5 pt-2 border-t border-zinc-800/70 flex items-center justify-center gap-1.5 text-[10px] font-bold text-zinc-400 hover:text-[#00a2ff] transition-all cursor-pointer group/det print:hidden"
          >
            <BarChart2 className="h-3 w-3 text-zinc-500 group-hover/det:text-[#00a2ff] transition-colors" />
            <span>Ver Detalhes</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="w-full bg-[#141416]/70 border border-[#27272a] print:w-full print:bg-white print:text-black print:border-neutral-300 print:shadow-none print:overflow-visible rounded-3xl p-4 sm:p-6 shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800/80 print:border-neutral-300 text-xs text-zinc-400 print:text-black">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-[#00a2ff] print:text-black" />
          <span className="font-bold text-zinc-300 print:text-black">
            Árvore Eliminatória ({roundGroups.length} Fases • {matches.length} Partidas)
          </span>
        </div>
        <span className="text-[11px] text-zinc-500 hidden sm:inline print:hidden">
          Deslize para os lados para visualizar da 1ª Fase até a Final
        </span>
      </div>

      {isEditMode && (
        <div className="mb-4 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2.5 text-xs text-amber-300 animate-fadeIn print:hidden">
          <Sparkles className="h-4 w-4 text-amber-400 shrink-0" />
          <span>
            <strong>Modo de Edição Manual Ativo:</strong> Arraste e solte uma equipe sobre outra vaga para trocar as posições, ou selecione a equipe no menu suspenso de cada confronto da 1ª rodada.
          </span>
        </div>
      )}

      <div className="flex flex-row items-stretch gap-8 sm:gap-14 overflow-x-auto py-6 px-3 min-h-[520px] scrollbar-thin print:w-full print:overflow-visible print:gap-4 print:min-h-0 print:px-0">
        {roundGroups.map((group, groupIdx) => {
          const roundMatches = group.matches;
          const roundTitle = group.title;
          const isFinal = groupIdx === roundGroups.length - 1;
          const isFirstRound = groupIdx === 0;
          const canEditRound = isEditMode && isFirstRound;

          return (
            <div
              key={group.key}
              className={`flex flex-col min-w-[280px] max-w-[320px] shrink-0 print:min-w-0 print:max-w-none print:flex-1 print:shrink ${
                isFinal ? "justify-center" : "justify-around"
              }`}
            >
              <div className="text-center pb-3.5 mb-2 border-b border-zinc-800 print:border-neutral-300">
                <span
                  className={`text-xs font-black uppercase tracking-wider block print:text-black ${
                    isFinal ? "text-amber-400" : "text-[#00a2ff]"
                  }`}
                >
                  {roundTitle}
                </span>
                <span className="text-[11px] text-zinc-500 print:text-neutral-700 font-medium">
                  {roundMatches.length}{" "}
                  {roundMatches.length === 1 ? "confronto" : "confrontos"}
                </span>
              </div>

              <div
                className={`flex flex-col flex-1 h-full relative py-2 ${
                  isFinal ? "justify-center my-auto gap-0" : "justify-around gap-6"
                }`}
              >
                {Array.from({ length: Math.ceil(roundMatches.length / 2) }).map((_, pairIdx) => {
                  const pairMatches = roundMatches.slice(pairIdx * 2, pairIdx * 2 + 2);
                  const isSingle = pairMatches.length === 1;

                  return (
                    <div
                      key={pairIdx}
                      className={`relative flex flex-col flex-1 ${
                        isSingle ? "justify-center" : "justify-around gap-6"
                      }`}
                    >
                      {pairMatches.map((match, idx) =>
                        renderKnockoutCard(match, idx, isFirstRound, isFinal, false)
                      )}

                {/* Conector exclusivo no agrupamento (Round Wrapper / Pair) */}
                {!isFinal && !isSingle && (
                  <div className="hidden sm:block absolute inset-y-0 left-full w-6 sm:w-10 pointer-events-none text-zinc-700/80 dark:text-zinc-600">
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
                      <path
                        d="M 0 25 H 50 V 75 H 0 M 50 50 H 100"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  </div>
                )}

                {!isFinal && isSingle && (
                  <div className="hidden sm:block absolute inset-y-0 left-full w-6 sm:w-10 pointer-events-none text-zinc-700/80 dark:text-zinc-600">
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
                      <path
                        d="M 0 50 H 100"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}

          {/* Disputa de 3º Lugar renderizada logo abaixo da Grande Final */}
          {isFinal && thirdPlaceMatch && (
            <div className="mt-6 pt-4 border-t border-dashed border-zinc-800 space-y-2">
              <div className="flex items-center gap-1.5 px-0.5">
                <span className="text-[11px] font-black uppercase tracking-wider text-amber-500/90 flex items-center gap-1">
                  🥉 Disputa de 3º Lugar
                </span>
              </div>
              {renderKnockoutCard(thirdPlaceMatch, 99, false, false, true)}
            </div>
          )}
        </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 2. COMPONENTE LEAGUE TABLE: importado de @/components/LeagueTable
 */

/**
 * 3. COMPONENTE GROUP STAGES (Fase de Grupos + Mata-Mata)
 */
export function GroupStages({
  groups: propGroups,
  teams = [],
  matches = [],
  tournament,
  onSelectMatch,
  isEditMode,
  isAdmin: propIsAdmin,
  isOrganizer: propIsOrganizer,
  canManage: propCanManage,
  onSwapTeams,
  onReplaceTeam,
  onGenerateKnockout,
}: GroupStagesProps) {
  const { user, isAdmin: isAuthAdmin } = useAuth();
  const permissions = useTournamentPermissions(tournament?.id);

  const isOrganizerUser = Boolean(
    propIsOrganizer ||
    propIsAdmin ||
    propCanManage ||
    isEditMode ||
    isAuthAdmin ||
    permissions.isOwner ||
    permissions.isAdmin ||
    permissions.canEditSettings ||
    (user?.id && tournament?.owner_id && user.id === tournament.owner_id)
  );

  const teamsMap = useMemo(() => {
    const map = new Map<string, Team>();
    teams.forEach((t) => map.set(t.id, t));
    return map;
  }, [teams]);

  const { computedGroups, knockoutMatches, groupMatchesTotal, groupMatchesCompleted } = useMemo(() => {
    const isKnockoutMatch = (m: Match) => {
      const ph = String(m.phase || "").toUpperCase().trim();
      return (
        ph === "KNOCKOUT" ||
        Boolean(m.next_match_id) ||
        ph.includes("QUARTA") ||
        ph.includes("SEMI") ||
        ph.includes("FINAL") ||
        ph.includes("OITAVA")
      );
    };

    const koMatches = matches.filter((m) => isKnockoutMatch(m));
    const grpMatches = matches.filter((m) => !isKnockoutMatch(m));

    const completedCount = grpMatches.filter(
      (m) => m.status === "COMPLETED" || m.status === "FINISHED"
    ).length;

    if (propGroups && propGroups.length > 0) {
      return {
        computedGroups: propGroups,
        knockoutMatches: koMatches,
        groupMatchesTotal: grpMatches.length,
        groupMatchesCompleted: completedCount,
      };
    }

    const activeTeams = teams.filter(
      (t) =>
        t.id !== "bye" &&
        t.cancellation_status !== "REFUNDED" &&
        t.status !== "CANCELLED" &&
        t.status !== "CANCELED" &&
        t.payment_status !== "CANCELED" &&
        t.payment_status !== "CANCELLED"
    );

    // Mapeia o grupo de cada equipe a partir de match_rules.group_assignments, team.group_name ou de match.details.group_name
    const teamGroupMap = new Map<string, string>();

    const savedAssignments =
      (tournament?.match_rules as any)?.group_assignments ||
      (tournament?.match_rules as any)?.group_stage?.group_assignments;
    if (savedAssignments && typeof savedAssignments === "object") {
      Object.entries(savedAssignments).forEach(([tId, g]) => {
        if (g) teamGroupMap.set(tId, normalizeGroupLetter(String(g)));
      });
    }

    activeTeams.forEach((t) => {
      if (t.group_name && !teamGroupMap.has(t.id)) {
        const rawG = normalizeGroupLetter(t.group_name);
        if (rawG) teamGroupMap.set(t.id, rawG);
      }
    });

    grpMatches.forEach((m) => {
      const cleanG = extractMatchGroupName(m, teamGroupMap);
      if (cleanG) {
        const t1 = m.team1_id || m.team_a_id || m.teamA?.id;
        const t2 = m.team2_id || m.team_b_id || m.teamB?.id;
        if (t1 && !teamGroupMap.has(t1)) teamGroupMap.set(t1, cleanG);
        if (t2 && !teamGroupMap.has(t2)) teamGroupMap.set(t2, cleanG);
      }
    });

    if (teamGroupMap.size > 0 || grpMatches.length > 0) {
      const groupsBucket = new Map<string, { teams: Map<string, Team>; matches: Match[] }>();

      const ensureBucket = (letter: string) => {
        const key = normalizeGroupLetter(letter) || "A";
        if (!groupsBucket.has(key)) {
          groupsBucket.set(key, { teams: new Map(), matches: [] });
        }
        return groupsBucket.get(key)!;
      };

      activeTeams.forEach((t) => {
        const gLetter = teamGroupMap.get(t.id);
        if (gLetter) {
          ensureBucket(gLetter).teams.set(t.id, t);
        }
      });

      grpMatches.forEach((m) => {
        const t1Id = m.team1_id || m.team_a_id || m.teamA?.id;
        const t2Id = m.team2_id || m.team_b_id || m.teamB?.id;
        let gLetter =
          extractMatchGroupName(m, teamGroupMap) ||
          (t1Id && teamGroupMap.get(t1Id)) ||
          (t2Id && teamGroupMap.get(t2Id)) ||
          "A";
        gLetter = normalizeGroupLetter(gLetter) || "A";

        const bucket = ensureBucket(gLetter);
        bucket.matches.push(m);

        if (t1Id && teamsMap.has(t1Id)) bucket.teams.set(t1Id, teamsMap.get(t1Id)!);
        if (t2Id && teamsMap.has(t2Id)) bucket.teams.set(t2Id, teamsMap.get(t2Id)!);
      });

      const sortedKeys = Array.from(groupsBucket.keys()).sort((a, b) => a.localeCompare(b));
      const built: GroupStageItem[] = sortedKeys.map((letter) => {
        const data = groupsBucket.get(letter)!;
        return {
          id: `group-${letter}`,
          name: `Grupo ${letter}`,
          teams: Array.from(data.teams.values()),
          matches: data.matches.sort((a, b) => (Number(a.round) || 1) - (Number(b.round) || 1) || (Number(a.match_order) || 0) - (Number(b.match_order) || 0)),
        };
      });

      return {
        computedGroups: built,
        knockoutMatches: koMatches,
        groupMatchesTotal: grpMatches.length,
        groupMatchesCompleted: completedCount,
      };
    }

    // Fallback: pré-visualização antes do sorteio dos grupos
    const groupSize = 4;
    const numGroups = Math.max(2, Math.ceil(activeTeams.length / groupSize));
    const letters = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const fallbackGroups: GroupStageItem[] = [];

    for (let g = 0; g < numGroups; g++) {
      const slice = activeTeams.filter((_, idx) => idx % numGroups === g);
      if (slice.length > 0) {
        fallbackGroups.push({
          id: `group-${letters[g] || g + 1}`,
          name: `Grupo ${letters[g] || g + 1}`,
          teams: slice,
          matches: [],
        });
      }
    }

    return {
      computedGroups: fallbackGroups,
      knockoutMatches: koMatches,
      groupMatchesTotal: grpMatches.length,
      groupMatchesCompleted: completedCount,
    };
  }, [propGroups, teams, matches, teamsMap]);

  const isSetsSport =
    tournament?.sport_type === "PING_PONG" || tournament?.sport_type === "VOLEI";

  const allGroupsFinished =
    groupMatchesTotal > 0 && groupMatchesCompleted === groupMatchesTotal;

  const [isGeneratingKnockout, setIsGeneratingKnockout] = useState(false);
  const [generateKnockoutError, setGenerateKnockoutError] = useState<string | null>(null);
  const [generateKnockoutSuccess, setGenerateKnockoutSuccess] = useState<string | null>(null);

  const handleGenerateKnockoutClick = async () => {
    if (!tournament?.id || isGeneratingKnockout) return;
    setIsGeneratingKnockout(true);
    setGenerateKnockoutError(null);
    setGenerateKnockoutSuccess(null);

    try {
      const { data: authData } = await supabase.auth.getSession();
      const token = authData.session?.access_token;

      const res = await generateKnockoutStage(tournament.id, token);
      if (res.success) {
        setGenerateKnockoutSuccess(res.message || "Fase Eliminatória gerada com sucesso!");
        if (onGenerateKnockout) {
          onGenerateKnockout();
        }
      } else {
        setGenerateKnockoutError(res.error || "Não foi possível gerar a fase eliminatória.");
      }
    } catch (err: any) {
      setGenerateKnockoutError(err.message || "Erro inesperado ao gerar a fase eliminatória.");
    } finally {
      setIsGeneratingKnockout(false);
    }
  };

  const [showBlankBracketPreview, setShowBlankBracketPreview] = useState(false);

  const blankKnockoutMatches = useMemo(() => {
    const qualifiersCount = Math.max(4, computedGroups.length * 2);
    return buildBlankKnockoutMatches(qualifiersCount);
  }, [computedGroups.length]);

  return (
    <div className="space-y-8 print:w-full print:bg-white print:text-black">
      {/* 1. Secção Superior: Tabelas de Classificação da Fase de Grupos */}
      <div className="space-y-4">
        <div className="bg-[#141416]/90 border border-[#27272a] print:bg-white print:text-black print:border-neutral-300 print:shadow-none rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#00a2ff]/10 border border-[#00a2ff]/20 text-[#00a2ff] print:bg-transparent print:text-black print:border-neutral-400">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black uppercase tracking-wider text-white print:text-black font-display">
                Tabelas de Classificação • Fase de Grupos ({computedGroups.length} Grupos)
              </h2>
              <p className="text-xs text-zinc-400 print:text-neutral-700">
                Vitória = 3 pts • Empate = 1 pt • Os 2 primeiros de cada grupo classificam-se para o Mata-Mata
              </p>
            </div>
          </div>

          {groupMatchesTotal > 0 && (
            <div className="print:hidden inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-bold text-zinc-300 self-start sm:self-center">
              <CheckCircle2
                className={`h-4 w-4 ${
                  groupMatchesCompleted === groupMatchesTotal
                    ? "text-emerald-400"
                    : "text-[#00a2ff]"
                }`}
              />
              <span>
                {groupMatchesCompleted}/{groupMatchesTotal} Jogos dos Grupos Finalizados
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {computedGroups.map((group) => {
            const rows = calculateGroupStandings(
              group.teams,
              group.matches,
              undefined,
              tournament
            );

            return (
              <div
                key={group.id}
                className="bg-[#141416]/90 border border-[#27272a] print:bg-white print:text-black print:border-neutral-400 print:shadow-none print:break-inside-avoid rounded-3xl p-4 sm:p-6 shadow-2xl space-y-5 flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-800 print:border-neutral-300">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-[#00a2ff]/15 border border-[#00a2ff]/30 print:bg-transparent print:border-neutral-400 print:text-black text-xs font-black uppercase tracking-wider text-[#00a2ff]">
                        {group.name}
                      </span>
                      <span className="text-[11px] font-bold text-zinc-400 print:text-neutral-700">
                        Classificação
                      </span>
                    </div>
                    <span className="text-[11px] font-bold text-zinc-500 print:text-neutral-700">
                      {rows.length} {rows.length === 1 ? "equipe" : "equipes"}
                    </span>
                  </div>

                  {/* Mini-Tabela de Classificação do Grupo: Posição | Equipe | Pts | J | V | E | D | SG */}
                  <div className="overflow-x-auto print:overflow-visible">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-zinc-800 print:border-neutral-300 text-[10px] font-black uppercase text-zinc-500 print:text-black">
                          <th className="py-2 px-2 w-12 text-center">Posição</th>
                          <th className="py-2 px-2">Equipe</th>
                          <th className="py-2 px-2 text-center text-white print:text-black" title="Pontos">
                            Pts
                          </th>
                          <th className="py-2 px-2 text-center" title="Jogos">
                            J
                          </th>
                          <th className="py-2 px-2 text-center text-emerald-400 print:text-black" title="Vitórias">
                            V
                          </th>
                          <th className="py-2 px-2 text-center text-amber-400 print:text-black" title="Empates">
                            E
                          </th>
                          <th className="py-2 px-2 text-center text-red-400 print:text-black" title="Derrotas">
                            D
                          </th>
                          <th className="py-2 px-2 text-center" title={isSetsSport ? "Saldo de Sets" : "Saldo"}>
                            SG
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/50 print:divide-neutral-300 text-xs">
                        {rows.map((row, idx) => {
                          const qualified = groupMatchesCompleted > 0 && idx < 2;
                          return (
                            <tr
                              key={row.teamId}
                              className={
                                qualified
                                  ? "bg-emerald-500/5 hover:bg-emerald-500/10 print:bg-transparent transition-colors"
                                  : "hover:bg-zinc-900/50 transition-colors"
                              }
                            >
                              <td className="py-2.5 px-2 text-center font-black">
                                <span
                                  className={`inline-flex items-center justify-center w-6 h-5 rounded text-[10px] print:text-black ${
                                    qualified
                                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 print:bg-transparent print:border-none"
                                      : "text-zinc-500"
                                  }`}
                                >
                                  {row.position}º
                                </span>
                              </td>
                              <td className="py-2.5 px-2 font-bold text-white print:text-black truncate max-w-[150px]">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate" title={row.teamName}>
                                    {row.teamName}
                                  </span>
                                  {qualified && (
                                    <span className="print:hidden text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shrink-0">
                                      Classif.
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2.5 px-2 text-center font-black text-[#00a2ff] print:text-black">
                                {row.pts}
                              </td>
                              <td className="py-2.5 px-2 text-center text-zinc-400 print:text-black font-mono">
                                {row.j}
                              </td>
                              <td className="py-2.5 px-2 text-center text-emerald-400 print:text-black font-bold font-mono">
                                {row.v}
                              </td>
                              <td className="py-2.5 px-2 text-center text-amber-400 print:text-black font-bold font-mono">
                                {row.e}
                              </td>
                              <td className="py-2.5 px-2 text-center text-red-400 print:text-black font-bold font-mono">
                                {row.d}
                              </td>
                              <td className="py-2.5 px-2 text-center font-mono font-bold">
                                <span
                                  className={`print:text-black ${
                                    row.sg > 0
                                      ? "text-emerald-400"
                                      : row.sg < 0
                                      ? "text-red-400"
                                      : "text-zinc-400"
                                  }`}
                                >
                                  {row.sg > 0 ? `+${row.sg}` : row.sg}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Partidas do Grupo (Round-Robin) */}
                {group.matches.length > 0 && (
                  <div className="pt-3 border-t border-zinc-800/80 print:border-neutral-300 space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-zinc-400 print:text-black">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-[#00a2ff] print:text-black" />
                        <span>Confrontos do {group.name}</span>
                      </span>
                      <span className="text-zinc-500 print:text-neutral-700">
                        {group.matches.length} {group.matches.length === 1 ? "jogo" : "jogos"}
                      </span>
                    </div>

                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1 scrollbar-thin print:max-h-none print:overflow-visible">
                      {group.matches.map((match) => {
                        const t1Id = match.team1_id || match.team_a_id || match.teamA?.id;
                        const t2Id = match.team2_id || match.team_b_id || match.teamB?.id;
                        const t1 = t1Id ? teamsMap.get(t1Id) : match.teamA;
                        const t2 = t2Id ? teamsMap.get(t2Id) : match.teamB;

                        const isLive = match.status === "LIVE" || match.status === "IN_PROGRESS";
                        const isCompleted =
                          match.status === "COMPLETED" || match.status === "FINISHED";

                        const groupLiveScore = getLiveMatchScore(match, tournament?.sport_type);
                        const matchIsSets = groupLiveScore.isSetsSport;
                        const sets1 = groupLiveScore.setsA;
                        const sets2 = groupLiveScore.setsB;
                        const score1 = groupLiveScore.rawScoreA;
                        const score2 = groupLiveScore.rawScoreB;
                        const activePts1 = groupLiveScore.activePointsA;
                        const activePts2 = groupLiveScore.activePointsB;

                        return (
                          <div
                            key={match.id}
                            onClick={() => {
                              if ((isCompleted || isLive) && onSelectMatch) {
                                onSelectMatch(match);
                              }
                            }}
                            className={`px-3 py-2 rounded-xl bg-[#18181b] print:bg-white print:text-black print:border-neutral-300 border text-xs flex items-center justify-between gap-2 transition-all ${
                              isLive
                                ? "border-amber-500/50 ring-1 ring-amber-500/20"
                                : isCompleted
                                ? "border-zinc-800 hover:border-[#00a2ff]/40 cursor-pointer"
                                : "border-zinc-800/60"
                            }`}
                          >
                            <span className="text-[10px] font-bold text-zinc-500 print:text-neutral-700 shrink-0 w-10">
                              R{match.round || 1}
                            </span>

                            <span className="flex-1 text-right font-semibold text-zinc-200 print:text-black truncate">
                              {t1?.name || "Equipe 1"}
                            </span>

                            <div className="px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 print:bg-white print:border-neutral-400 print:text-black font-mono text-[11px] font-black text-white shrink-0">
                              {isCompleted ? (
                                matchIsSets ? (
                                  <>
                                    <span className={sets1 > sets2 ? "text-emerald-400 print:text-black" : "text-white print:text-black"}>
                                      {sets1}
                                    </span>
                                    <span className="text-zinc-600 print:text-neutral-700 mx-1">x</span>
                                    <span className={sets2 > sets1 ? "text-emerald-400 print:text-black" : "text-white print:text-black"}>
                                      {sets2}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className={score1 > score2 ? "text-emerald-400 print:text-black" : "text-white print:text-black"}>
                                      {score1}
                                    </span>
                                    <span className="text-zinc-600 print:text-neutral-700 mx-1">x</span>
                                    <span className={score2 > score1 ? "text-emerald-400 print:text-black" : "text-white print:text-black"}>
                                      {score2}
                                    </span>
                                  </>
                                )
                              ) : isLive ? (
                                matchIsSets ? (
                                  <div className="flex items-center gap-1 font-mono text-xs">
                                    <span className="text-white print:text-black font-black">{sets1}</span>
                                    <span className="text-[10px] font-bold text-[#00a2ff] bg-[#00a2ff]/10 px-1 py-0.5 rounded border border-[#00a2ff]/30 print:border-black print:text-black">
                                      ({activePts1})
                                    </span>
                                    <span className="text-zinc-500 print:text-neutral-700 mx-0.5">x</span>
                                    <span className="text-[10px] font-bold text-[#00a2ff] bg-[#00a2ff]/10 px-1 py-0.5 rounded border border-[#00a2ff]/30 print:border-black print:text-black">
                                      ({activePts2})
                                    </span>
                                    <span className="text-white print:text-black font-black">{sets2}</span>
                                  </div>
                                ) : (
                                  <>
                                    <span className="text-white print:text-black">{score1}</span>
                                    <span className="text-zinc-600 print:text-neutral-700 mx-1">x</span>
                                    <span className="text-white print:text-black">{score2}</span>
                                  </>
                                )
                              ) : (
                                <span className="text-zinc-500 print:text-black font-mono">[&nbsp;&nbsp;] x [&nbsp;&nbsp;]</span>
                              )}
                            </div>

                            <span className="flex-1 text-left font-semibold text-zinc-200 print:text-black truncate">
                              {t2?.name || "Equipe 2"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Fase Eliminatória (Mata-Mata) abaixo das Tabelas de Grupos */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-amber-400 print:text-black" />
            <h3 className="text-sm sm:text-base font-black uppercase tracking-wider text-white print:text-black font-display">
              Fase 2 • Chaveamento Eliminatório (Mata-Mata)
            </h3>
          </div>
          {knockoutMatches.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <span className="text-xs font-bold text-emerald-400">
                Cruzamento Olímpico Ativo (1º vs 2º)
              </span>
              {isOrganizerUser && (
                <button
                  type="button"
                  disabled={isGeneratingKnockout}
                  onClick={handleGenerateKnockoutClick}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 hover:text-amber-200 text-xs font-bold transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                  title="Regerar apenas as partidas eliminatórias preservando intacta a Fase de Grupos"
                >
                  {isGeneratingKnockout ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Regerando...</span>
                    </>
                  ) : (
                    <>
                      <Trophy className="h-3.5 w-3.5 text-amber-400" />
                      <span>Regerar Eliminatórias</span>
                    </>
                  )}
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowBlankBracketPreview((prev) => !prev)}
              className="print:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-bold text-zinc-200 hover:text-white transition-all cursor-pointer"
            >
              <Network className="h-3.5 w-3.5 text-[#00a2ff]" />
              <span>
                {showBlankBracketPreview
                  ? "Ocultar Prévia da Chave Vazia"
                  : "Visualizar Chave Vazia (Para Impressão)"}
              </span>
            </button>
          )}
        </div>

        {knockoutMatches.length > 0 ? (
          <KnockoutTree
            matches={knockoutMatches}
            teams={teams}
            tournament={tournament}
            onSelectMatch={onSelectMatch}
            isEditMode={isEditMode}
            onSwapTeams={onSwapTeams}
            onReplaceTeam={onReplaceTeam}
          />
        ) : (
          <>
            {!showBlankBracketPreview && (
              allGroupsFinished ? (
                isOrganizerUser ? (
                  <div className="print:hidden border-2 border-dashed border-emerald-500/40 bg-gradient-to-b from-emerald-950/30 to-[#141416]/90 rounded-2xl p-6 sm:p-8 text-center space-y-4 shadow-xl shadow-emerald-950/20 animate-fadeIn">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-inner">
                      <Trophy className="h-6 w-6 text-emerald-400" />
                    </div>

                    <div className="space-y-1.5 max-w-lg mx-auto">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-[11px] font-black uppercase tracking-wider text-emerald-300">
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        <span>Fase de Grupos 100% Concluída</span>
                      </div>
                      <h4 className="text-base font-bold text-white">
                        Todos os jogos dos grupos foram finalizados!
                      </h4>
                      <p className="text-xs text-zinc-300 leading-relaxed">
                        As classificações dos grupos estão consolidadas. Como organizador, clique no botão abaixo para encerrar a 1ª fase e gerar os confrontos das Semifinais com cruzamento oficial (1º A vs 2º B e 1º B vs 2º A).
                      </p>
                    </div>

                    <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                      <button
                        type="button"
                        disabled={isGeneratingKnockout}
                        onClick={handleGenerateKnockoutClick}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-amber-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {isGeneratingKnockout ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin text-black" />
                            <span>Gerando Semifinais...</span>
                          </>
                        ) : (
                          <>
                            <Trophy className="h-4 w-4 text-black" />
                            <span>🏆 Encerrar Fase de Grupos e Gerar Semifinais</span>
                          </>
                        )}
                      </button>
                    </div>

                    {generateKnockoutError && (
                      <p className="text-xs text-red-400 font-semibold mt-2">
                        {generateKnockoutError}
                      </p>
                    )}

                    {generateKnockoutSuccess && (
                      <p className="text-xs text-emerald-400 font-semibold mt-2">
                        {generateKnockoutSuccess}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="print:hidden border border-dashed border-zinc-800 bg-[#141416]/60 rounded-2xl p-6 sm:p-8 text-center space-y-3 animate-fadeIn">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
                      <Trophy className="h-5 w-5 text-amber-400" />
                    </div>
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-bold text-emerald-400">
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        <span>Fase de Grupos Concluída</span>
                      </div>
                      <h4 className="text-sm font-bold text-zinc-200">
                        Classificação Definida
                      </h4>
                      <p className="text-xs text-zinc-400 max-w-md mx-auto italic">
                        Aguardando a organização oficializar os resultados e gerar as semifinais.
                      </p>
                    </div>
                  </div>
                )
              ) : (
                <div className="print:hidden border border-dashed border-zinc-800 bg-[#141416]/60 rounded-2xl p-8 text-center space-y-2">
                  <Trophy className="h-7 w-7 text-amber-400/70 mx-auto" />
                  <h4 className="text-sm font-bold text-zinc-200">
                    Aguardando Encerramento da Fase de Grupos
                  </h4>
                  <p className="text-xs text-zinc-400 max-w-lg mx-auto">
                    {groupMatchesTotal > 0
                      ? `Partidas finalizadas: ${groupMatchesCompleted} de ${groupMatchesTotal}. Assim que todos os jogos da Fase de Grupos forem finalizados, o botão para gerar o Mata-Mata será liberado aqui.`
                      : "Assim que todas as partidas da Fase de Grupos forem finalizadas, o organizador encerrará a 1ª fase e a árvore de confrontos do Mata-Mata (1º do Grupo A vs 2º do Grupo B, etc.) aparecerá automaticamente aqui. Na versão impressa, a árvore em branco já é gerada automaticamente para preenchimento manual."}
                  </p>
                </div>
              )
            )}

            <div className={showBlankBracketPreview ? "block" : "hidden print:block"}>
              <KnockoutTree
                matches={blankKnockoutMatches}
                teams={teams}
                tournament={tournament}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * COMPONENTE PAI: TournamentView (Roteador Visual por Formato do Torneio)
 */
export default function TournamentView({
  format,
  tournament,
  teams,
  matches,
  groups,
  onSelectMatch,
  isEditMode,
  isAdmin,
  isOrganizer,
  canManage,
  onSwapTeams,
  onReplaceTeam,
  onGenerateKnockout,
}: TournamentViewProps) {
  const resolvedFormat = normalizeTournamentFormat(format || tournament);

  switch (resolvedFormat) {
    case "LEAGUE":
      return (
        <LeagueTable
          teams={teams}
          matches={matches}
          tournament={tournament}
          onSelectMatch={onSelectMatch}
        />
      );
    case "GROUPS":
      return (
        <GroupStages
          groups={groups}
          teams={teams}
          matches={matches}
          tournament={tournament}
          onSelectMatch={onSelectMatch}
          isEditMode={isEditMode}
          isAdmin={isAdmin}
          isOrganizer={isOrganizer}
          canManage={canManage}
          onSwapTeams={onSwapTeams}
          onReplaceTeam={onReplaceTeam}
          onGenerateKnockout={onGenerateKnockout}
        />
      );
    case "KNOCKOUT":
    default:
      return (
        <KnockoutTree
          matches={matches}
          teams={teams}
          tournament={tournament}
          onSelectMatch={onSelectMatch}
          isEditMode={isEditMode}
          onSwapTeams={onSwapTeams}
          onReplaceTeam={onReplaceTeam}
        />
      );
  }
}

