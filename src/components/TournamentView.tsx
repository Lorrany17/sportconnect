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
} from "lucide-react";
import { Tournament, Team, Match } from "@/types";
import { calculateGroupStandings } from "@/utils/groupStandings";
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

export interface TournamentViewProps {
  format?: StandardizedTournamentFormat | string;
  tournament?: Tournament | null;
  teams: Team[];
  matches: Match[];
  groups?: GroupStageItem[];
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

  const roundsMap = useMemo(() => {
    const map = new Map<number, Match[]>();

    matches.forEach((m) => {
      let roundNum = Number(m.round);
      if (!roundNum || isNaN(roundNum)) {
        const detailsObj = m.details as Record<string, unknown> | undefined;
        const ph = `${m.round || ""} ${m.phase || ""} ${detailsObj?.round_label || ""}`.toLowerCase();
        if (
          ph.includes("final") &&
          !ph.includes("semi") &&
          !ph.includes("quarta") &&
          !ph.includes("oitava")
        ) {
          roundNum = 4;
        } else if (ph.includes("semi")) {
          roundNum = 3;
        } else if (ph.includes("quarta")) {
          roundNum = 2;
        } else {
          roundNum = 1;
        }
      }

      if (!map.has(roundNum)) {
        map.set(roundNum, []);
      }
      map.get(roundNum)!.push(m);
    });

    map.forEach((list) => {
      list.sort((a, b) => (a.match_order || 0) - (b.match_order || 0));
    });

    return map;
  }, [matches]);

  const sortedRounds = useMemo(() => {
    return Array.from(roundsMap.keys()).sort((a, b) => a - b);
  }, [roundsMap]);

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
    const firstRoundNum = sortedRounds[0] || 1;
    const round1Matches = roundsMap.get(firstRoundNum) || [];
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
  }, [roundsMap, sortedRounds]);

  const getRoundLabel = (matchesCount: number, roundNum: number) => {
    if (matchesCount === 1) return "Grande Final";
    if (matchesCount === 2) return "Semifinal";
    if (matchesCount === 4) return "Quartas de Final";
    if (matchesCount === 8) return "Oitavas de Final";
    if (matchesCount === 16) return "16 avos de Final";
    return `Rodada ${roundNum}`;
  };

  return (
    <div className="w-full bg-[#141416]/70 border border-[#27272a] rounded-3xl p-4 sm:p-6 shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800/80 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-[#00a2ff]" />
          <span className="font-bold text-zinc-300">
            Árvore Eliminatória ({sortedRounds.length} Fases • {matches.length} Partidas)
          </span>
        </div>
        <span className="text-[11px] text-zinc-500 hidden sm:inline">
          Deslize para os lados para visualizar da 1ª Fase até a Final
        </span>
      </div>

      {isEditMode && (
        <div className="mb-4 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2.5 text-xs text-amber-300 animate-fadeIn">
          <Sparkles className="h-4 w-4 text-amber-400 shrink-0" />
          <span>
            <strong>Modo de Edição Manual Ativo:</strong> Arraste e solte uma equipe sobre outra vaga para trocar as posições, ou selecione a equipe no menu suspenso de cada confronto da 1ª rodada.
          </span>
        </div>
      )}

      <div className="flex flex-row items-stretch gap-6 sm:gap-10 overflow-x-auto py-4 px-2 min-h-[520px] scrollbar-thin">
        {sortedRounds.map((roundNum) => {
          const roundMatches = roundsMap.get(roundNum) || [];
          const roundTitle = getRoundLabel(roundMatches.length, roundNum);
          const isFinal = roundMatches.length === 1 || roundNum === sortedRounds[sortedRounds.length - 1];
          const isFirstRound = roundNum === sortedRounds[0];
          const canEditRound = isEditMode && isFirstRound;

          return (
            <div
              key={roundNum}
              className="flex flex-col min-w-[260px] max-w-[300px] shrink-0"
            >
              <div className="text-center pb-3.5 mb-2 border-b border-zinc-800">
                <span
                  className={`text-xs font-black uppercase tracking-wider block ${
                    isFinal ? "text-amber-400" : "text-[#00a2ff]"
                  }`}
                >
                  {roundTitle}
                </span>
                <span className="text-[11px] text-zinc-500 font-medium">
                  {roundMatches.length}{" "}
                  {roundMatches.length === 1 ? "confronto" : "confrontos"}
                </span>
              </div>

              <div className="flex flex-col justify-around flex-1 gap-6 py-2">
                {roundMatches.map((match, idx) => {
                  const team1Id = match.team1_id || match.team_a_id || match.teamA?.id;
                  const team2Id = match.team2_id || match.team_b_id || match.teamB?.id;

                  const team1 = team1Id ? teamsMap.get(team1Id) : null;
                  const team2 = team2Id ? teamsMap.get(team2Id) : null;

                  const isLive = match.status === "LIVE";
                  const isCompleted = match.status === "COMPLETED";

                  const isBye =
                    isFirstRound &&
                    ((Boolean(team1Id) && !team2Id) || (!team1Id && Boolean(team2Id)));

                  const feeders = feedersMap.get(match.id) || [];
                  const feeder1 = feeders[0];
                  const feeder2 = feeders[1];

                  const defaultTeam1Label = isFirstRound
                    ? isBye
                      ? "BYE (Avanço Automático)"
                      : "A definir"
                    : feeder1
                    ? `Vencedor do Jogo #${feeder1.match_order || 1}`
                    : "A definir";

                  const defaultTeam2Label = isFirstRound
                    ? isBye
                      ? "BYE (Avanço Automático)"
                      : "A definir"
                    : feeder2
                    ? `Vencedor do Jogo #${feeder2.match_order || 2}`
                    : "A definir";

                  const team1Name = team1 ? team1.name : defaultTeam1Label;
                  const team2Name = team2 ? team2.name : defaultTeam2Label;

                  const score1 = match.score_a ?? match.scoreA ?? 0;
                  const score2 = match.score_b ?? match.scoreB ?? 0;
                  const sets1 = match.sets_a ?? match.setsA ?? 0;
                  const sets2 = match.sets_b ?? match.setsB ?? 0;
                  const isSetsSport =
                    sets1 > 0 ||
                    sets2 > 0 ||
                    tournament?.sport_type === "PING_PONG" ||
                    tournament?.sport_type === "VOLEI";

                  const displayScore1 =
                    isSetsSport && (sets1 > 0 || sets2 > 0) ? sets1 : score1;
                  const displayScore2 =
                    isSetsSport && (sets1 > 0 || sets2 > 0) ? sets2 : score2;

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
                      key={match.id}
                      className={`bg-[#18181b] border rounded-2xl p-3.5 sm:p-4 shadow-xl transition-all duration-300 relative group ${
                        isLive
                          ? "border-amber-500/60 ring-1 ring-amber-500/30"
                          : isFinal
                          ? "border-amber-500/30 hover:border-amber-500/60"
                          : "border-zinc-800 hover:border-[#00a2ff]/50"
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-bold pb-2 mb-2 border-b border-zinc-800/80">
                        <span className="text-zinc-500 uppercase tracking-wider">
                          Jogo #{match.match_order || idx + 1}
                        </span>

                        <div className="flex items-center gap-1.5">
                          {isLive ? (
                            <span className="flex items-center gap-1 text-amber-400 font-black animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                              <span>AO VIVO</span>
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
                          className={`flex items-center justify-between py-1.5 px-2 rounded-xl transition-colors ${
                            isWinner1
                              ? "bg-emerald-500/10 text-emerald-300 font-black"
                              : "text-zinc-200"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 pr-2">
                            <div
                              className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 ${
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
                              className={`text-xs truncate ${
                                !team1
                                  ? canEditRound
                                    ? "text-amber-400/90 font-medium italic"
                                    : "text-zinc-500 italic font-normal"
                                  : "font-semibold"
                              }`}
                              title={team1Name}
                            >
                              {!team1 && canEditRound
                                ? "Slot Vazio (Solte aqui)"
                                : team1Name}
                            </span>
                          </div>

                          <div className="shrink-0 font-mono text-xs font-black min-w-[20px] text-right">
                            {isCompleted || isLive ? displayScore1 : "-"}
                          </div>
                        </div>

                        {/* Dropdown de Seleção Manual da Equipe 1 (Apenas 1ª Rodada no Modo Edição) */}
                        {canEditRound && (
                          <div className="mt-1.5 pt-1.5 border-t border-zinc-800">
                            <select
                              value={team1Id || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (!val) {
                                  onReplaceTeam?.(match.id, "team1", null);
                                } else if (val.startsWith("EMPTY:")) {
                                  const [, destMatchId, destSlot] = val.split(":");
                                  onSwapTeams?.(match.id, "team1", destMatchId, destSlot as "team1" | "team2");
                                } else {
                                  onReplaceTeam?.(match.id, "team1", val);
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full bg-[#121214] border border-amber-500/40 hover:border-amber-400 rounded-lg text-[11px] py-1 px-1.5 text-zinc-200 focus:outline-none focus:border-[#00a2ff] cursor-pointer"
                              title="Selecione a equipe ou troque com um slot vazio"
                            >
                              <option value="">-- BYE (Deixar Vaga Vazia) --</option>
                              <optgroup label="Equipes Participantes">
                                {selectableTeams.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </optgroup>
                              {emptySlotsInRound1.filter((es) => !(es.matchId === match.id && es.slot === "team1")).length > 0 && (
                                <optgroup label="Trocar com Vaga Vazia / BYE">
                                  {emptySlotsInRound1
                                    .filter((es) => !(es.matchId === match.id && es.slot === "team1"))
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

                      {/* Divisor VS com Botão de Inversão no Modo de Edição (Apenas 1ª Rodada) */}
                      <div className="relative my-1 flex items-center justify-center">
                        <div className="w-full border-t border-zinc-800/80" />
                        {canEditRound ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSwapTeams?.(match.id, "team1", match.id, "team2");
                            }}
                            title="Inverter Equipe 1 e Equipe 2 neste confronto"
                            className="absolute z-10 bg-zinc-800 hover:bg-zinc-700 text-amber-300 hover:text-white px-2 py-0.5 rounded-md text-[9px] font-bold border border-amber-500/40 flex items-center gap-1 cursor-pointer shadow-md transition-all active:scale-95"
                          >
                            <ArrowUpDown className="h-2.5 w-2.5" />
                            <span>Inverter</span>
                          </button>
                        ) : (
                          <span className="absolute bg-[#18181b] px-1.5 text-[9px] font-black uppercase text-zinc-600 tracking-wider">
                            VS
                          </span>
                        )}
                      </div>

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
                          className={`flex items-center justify-between py-1.5 px-2 rounded-xl transition-colors ${
                            isWinner2
                              ? "bg-emerald-500/10 text-emerald-300 font-black"
                              : "text-zinc-200"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 pr-2">
                            <div
                              className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 ${
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
                              className={`text-xs truncate ${
                                !team2
                                  ? canEditRound
                                    ? "text-amber-400/90 font-medium italic"
                                    : "text-zinc-500 italic font-normal"
                                  : "font-semibold"
                              }`}
                              title={team2Name}
                            >
                              {!team2 && canEditRound
                                ? "Slot Vazio (Solte aqui)"
                                : team2Name}
                            </span>
                          </div>

                          <div className="shrink-0 font-mono text-xs font-black min-w-[20px] text-right">
                            {isCompleted || isLive ? displayScore2 : "-"}
                          </div>
                        </div>

                        {/* Dropdown de Seleção Manual da Equipe 2 (Apenas 1ª Rodada no Modo Edição) */}
                        {canEditRound && (
                          <div className="mt-1.5 pt-1.5 border-t border-zinc-800">
                            <select
                              value={team2Id || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (!val) {
                                  onReplaceTeam?.(match.id, "team2", null);
                                } else if (val.startsWith("EMPTY:")) {
                                  const [, destMatchId, destSlot] = val.split(":");
                                  onSwapTeams?.(match.id, "team2", destMatchId, destSlot as "team1" | "team2");
                                } else {
                                  onReplaceTeam?.(match.id, "team2", val);
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full bg-[#121214] border border-amber-500/40 hover:border-amber-400 rounded-lg text-[11px] py-1 px-1.5 text-zinc-200 focus:outline-none focus:border-[#00a2ff] cursor-pointer"
                              title="Selecione a equipe ou troque com um slot vazio"
                            >
                              <option value="">-- BYE (Deixar Vaga Vazia) --</option>
                              <optgroup label="Equipes Participantes">
                                {selectableTeams.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </optgroup>
                              {emptySlotsInRound1.filter((es) => !(es.matchId === match.id && es.slot === "team2")).length > 0 && (
                                <optgroup label="Trocar com Vaga Vazia / BYE">
                                  {emptySlotsInRound1
                                    .filter((es) => !(es.matchId === match.id && es.slot === "team2"))
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
                          className="w-full mt-2.5 pt-2 border-t border-zinc-800/70 flex items-center justify-center gap-1.5 text-[10px] font-bold text-zinc-400 hover:text-[#00a2ff] transition-all cursor-pointer group/det"
                        >
                          <BarChart2 className="h-3 w-3 text-zinc-500 group-hover/det:text-[#00a2ff] transition-colors" />
                          <span>Ver Detalhes</span>
                        </button>
                      )}
                    </div>
                  );
                })}
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
  onSwapTeams,
  onReplaceTeam,
}: GroupStagesProps) {
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

    // Mapeia o grupo de cada equipe a partir de team.group_name ou de match.details.group_name
    const teamGroupMap = new Map<string, string>();
    activeTeams.forEach((t) => {
      if (t.group_name) {
        const rawG = String(t.group_name).toUpperCase().replace(/^GRUPO\s+/i, "").trim();
        if (rawG) teamGroupMap.set(t.id, rawG);
      }
    });

    grpMatches.forEach((m) => {
      let detGroup: string | null = null;
      if (typeof m.details === "object" && m.details?.group_name) {
        detGroup = String(m.details.group_name);
      } else if (typeof m.details === "string") {
        try {
          const parsed = JSON.parse(m.details);
          if (parsed?.group_name) detGroup = String(parsed.group_name);
        } catch {}
      } else if ((m.phase || "").toLowerCase().includes("grupo")) {
        detGroup = String(m.phase).replace(/^grupo\s+/i, "").trim();
      }

      if (detGroup) {
        const cleanG = detGroup.toUpperCase().replace(/^GRUPO\s+/i, "").trim();
        const t1 = m.team1_id || m.team_a_id || m.teamA?.id;
        const t2 = m.team2_id || m.team_b_id || m.teamB?.id;
        if (t1 && !teamGroupMap.has(t1)) teamGroupMap.set(t1, cleanG);
        if (t2 && !teamGroupMap.has(t2)) teamGroupMap.set(t2, cleanG);
      }
    });

    if (teamGroupMap.size > 0 || grpMatches.length > 0) {
      const groupsBucket = new Map<string, { teams: Map<string, Team>; matches: Match[] }>();

      const ensureBucket = (letter: string) => {
        const key = letter.toUpperCase().replace(/^GRUPO\s+/i, "").trim() || "A";
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
          (t1Id && teamGroupMap.get(t1Id)) ||
          (t2Id && teamGroupMap.get(t2Id)) ||
          (typeof m.details === "object" && m.details?.group_name) ||
          "A";
        gLetter = String(gLetter).toUpperCase().replace(/^GRUPO\s+/i, "").trim() || "A";

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

  return (
    <div className="space-y-8">
      {/* 1. Secção Superior: Tabelas de Classificação da Fase de Grupos */}
      <div className="space-y-4">
        <div className="bg-[#141416]/90 border border-[#27272a] rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#00a2ff]/10 border border-[#00a2ff]/20 text-[#00a2ff]">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black uppercase tracking-wider text-white font-display">
                Tabelas de Classificação • Fase de Grupos ({computedGroups.length} Grupos)
              </h2>
              <p className="text-xs text-zinc-400">
                Vitória = 3 pts • Empate = 1 pt • Os 2 primeiros de cada grupo classificam-se para o Mata-Mata
              </p>
            </div>
          </div>

          {groupMatchesTotal > 0 && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-bold text-zinc-300 self-start sm:self-center">
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
                className="bg-[#141416]/90 border border-[#27272a] rounded-3xl p-4 sm:p-6 shadow-2xl space-y-5 flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-[#00a2ff]/15 border border-[#00a2ff]/30 text-xs font-black uppercase tracking-wider text-[#00a2ff]">
                        {group.name}
                      </span>
                      <span className="text-[11px] font-bold text-zinc-400">
                        Classificação
                      </span>
                    </div>
                    <span className="text-[11px] font-bold text-zinc-500">
                      {rows.length} {rows.length === 1 ? "equipe" : "equipes"}
                    </span>
                  </div>

                  {/* Mini-Tabela de Classificação do Grupo: Posição | Equipe | Pts | J | V | E | D | SG */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-zinc-800 text-[10px] font-black uppercase text-zinc-500">
                          <th className="py-2 px-2 w-12 text-center">Posição</th>
                          <th className="py-2 px-2">Equipe</th>
                          <th className="py-2 px-2 text-center text-white" title="Pontos">
                            Pts
                          </th>
                          <th className="py-2 px-2 text-center" title="Jogos">
                            J
                          </th>
                          <th className="py-2 px-2 text-center text-emerald-400" title="Vitórias">
                            V
                          </th>
                          <th className="py-2 px-2 text-center text-amber-400" title="Empates">
                            E
                          </th>
                          <th className="py-2 px-2 text-center text-red-400" title="Derrotas">
                            D
                          </th>
                          <th className="py-2 px-2 text-center" title={isSetsSport ? "Saldo de Sets" : "Saldo"}>
                            SG
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/50 text-xs">
                        {rows.map((row, idx) => {
                          const qualified = idx < 2;
                          return (
                            <tr
                              key={row.teamId}
                              className={
                                qualified
                                  ? "bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors"
                                  : "hover:bg-zinc-900/50 transition-colors"
                              }
                            >
                              <td className="py-2.5 px-2 text-center font-black">
                                <span
                                  className={`inline-flex items-center justify-center w-6 h-5 rounded text-[10px] ${
                                    qualified
                                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                      : "text-zinc-500"
                                  }`}
                                >
                                  {row.position}º
                                </span>
                              </td>
                              <td className="py-2.5 px-2 font-bold text-white truncate max-w-[150px]">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate" title={row.teamName}>
                                    {row.teamName}
                                  </span>
                                  {qualified && (
                                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shrink-0">
                                      Classif.
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2.5 px-2 text-center font-black text-[#00a2ff]">
                                {row.pts}
                              </td>
                              <td className="py-2.5 px-2 text-center text-zinc-400 font-mono">
                                {row.j}
                              </td>
                              <td className="py-2.5 px-2 text-center text-emerald-400 font-bold font-mono">
                                {row.v}
                              </td>
                              <td className="py-2.5 px-2 text-center text-amber-400 font-bold font-mono">
                                {row.e}
                              </td>
                              <td className="py-2.5 px-2 text-center text-red-400 font-bold font-mono">
                                {row.d}
                              </td>
                              <td className="py-2.5 px-2 text-center font-mono font-bold">
                                <span
                                  className={
                                    row.sg > 0
                                      ? "text-emerald-400"
                                      : row.sg < 0
                                      ? "text-red-400"
                                      : "text-zinc-400"
                                  }
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
                  <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-zinc-400">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-[#00a2ff]" />
                        <span>Confrontos do {group.name}</span>
                      </span>
                      <span className="text-zinc-500">
                        {group.matches.length} {group.matches.length === 1 ? "jogo" : "jogos"}
                      </span>
                    </div>

                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1 scrollbar-thin">
                      {group.matches.map((match) => {
                        const t1Id = match.team1_id || match.team_a_id || match.teamA?.id;
                        const t2Id = match.team2_id || match.team_b_id || match.teamB?.id;
                        const t1 = t1Id ? teamsMap.get(t1Id) : match.teamA;
                        const t2 = t2Id ? teamsMap.get(t2Id) : match.teamB;

                        const isLive = match.status === "LIVE";
                        const isCompleted =
                          match.status === "COMPLETED" || match.status === "FINISHED";

                        const sets1 = match.sets_a ?? match.setsA ?? 0;
                        const sets2 = match.sets_b ?? match.setsB ?? 0;
                        const score1 = match.score_a ?? match.scoreA ?? 0;
                        const score2 = match.score_b ?? match.scoreB ?? 0;
                        const useSets = isSetsSport && (sets1 > 0 || sets2 > 0);
                        const s1 = useSets ? sets1 : score1;
                        const s2 = useSets ? sets2 : score2;

                        return (
                          <div
                            key={match.id}
                            onClick={() => {
                              if ((isCompleted || isLive) && onSelectMatch) {
                                onSelectMatch(match);
                              }
                            }}
                            className={`px-3 py-2 rounded-xl bg-[#18181b] border text-xs flex items-center justify-between gap-2 transition-all ${
                              isLive
                                ? "border-amber-500/50"
                                : isCompleted
                                ? "border-zinc-800 hover:border-[#00a2ff]/40 cursor-pointer"
                                : "border-zinc-800/60"
                            }`}
                          >
                            <span className="text-[10px] font-bold text-zinc-500 shrink-0 w-10">
                              R{match.round || 1}
                            </span>

                            <span className="flex-1 text-right font-semibold text-zinc-200 truncate">
                              {t1?.name || "Equipe 1"}
                            </span>

                            <div className="px-2.5 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 font-mono text-[11px] font-black text-white shrink-0">
                              {isCompleted || isLive ? (
                                <>
                                  <span className={s1 > s2 ? "text-emerald-400" : "text-white"}>
                                    {s1}
                                  </span>
                                  <span className="text-zinc-600 mx-1">x</span>
                                  <span className={s2 > s1 ? "text-emerald-400" : "text-white"}>
                                    {s2}
                                  </span>
                                </>
                              ) : (
                                <span className="text-zinc-500">- x -</span>
                              )}
                            </div>

                            <span className="flex-1 text-left font-semibold text-zinc-200 truncate">
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
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm sm:text-base font-black uppercase tracking-wider text-white font-display">
              Fase 2 • Chaveamento Eliminatório (Mata-Mata)
            </h3>
          </div>
          {knockoutMatches.length > 0 && (
            <span className="text-xs font-bold text-emerald-400">
              Cruzamento Olímpico Ativo (1º vs 2º)
            </span>
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
          <div className="border border-dashed border-zinc-800 bg-[#141416]/60 rounded-2xl p-8 text-center space-y-2">
            <Trophy className="h-7 w-7 text-amber-400/70 mx-auto" />
            <h4 className="text-sm font-bold text-zinc-200">
              Aguardando Encerramento da Fase de Grupos
            </h4>
            <p className="text-xs text-zinc-400 max-w-lg mx-auto">
              Assim que todas as partidas da Fase de Grupos forem finalizadas, o organizador encerrará a 1ª fase e a árvore de confrontos do Mata-Mata (1º do Grupo A vs 2º do Grupo B, etc.) aparecerá automaticamente aqui.
            </p>
          </div>
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
  onSwapTeams,
  onReplaceTeam,
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
          onSwapTeams={onSwapTeams}
          onReplaceTeam={onReplaceTeam}
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

