"use client";

import React, { useMemo } from "react";
import {
  Trophy,
  Calendar,
  CheckCircle2,
  BarChart2,
  Clock,
} from "lucide-react";
import { Tournament, Team, Match } from "@/types";
import { calculateGroupStandings } from "@/utils/groupStandings";
import { getLiveMatchScore } from "@/utils/liveMatchScore";

export interface LeagueTableProps {
  teams: Team[];
  matches: Match[];
  tournament?: Tournament | null;
  onSelectMatch?: (match: Match) => void;
}

export default function LeagueTable({
  teams,
  matches,
  tournament,
  onSelectMatch,
}: LeagueTableProps) {
  const activeTeams = useMemo(() => {
    const valid = (teams || []).filter(
      (t) =>
        t.id !== "bye" &&
        t.cancellation_status !== "REFUNDED" &&
        t.status !== "CANCELLED" &&
        t.status !== "CANCELED" &&
        t.payment_status !== "CANCELED" &&
        t.payment_status !== "CANCELLED"
    );
    const confirmed = valid.filter(
      (t) =>
        t.payment_status === "PAID" ||
        t.payment_status === "APPROVED" ||
        t.status === "CONFIRMED" ||
        t.status === "PAID" ||
        t.status === "APPROVED"
    );
    return confirmed.length > 0 ? confirmed : valid;
  }, [teams]);

  const standings = useMemo(
    () => calculateGroupStandings(activeTeams, matches, undefined, tournament),
    [activeTeams, matches, tournament]
  );

  const teamsMap = useMemo(() => {
    const map = new Map<string, Team>();
    teams.forEach((t) => map.set(t.id, t));
    return map;
  }, [teams]);

  const roundsMap = useMemo(() => {
    const map = new Map<number, Match[]>();
    matches.forEach((m) => {
      let r = Number(m.round);
      if (!r || isNaN(r)) {
        const detRound =
          typeof m.details === "object" && m.details?.round_number
            ? Number(m.details.round_number)
            : 0;
        if (detRound > 0) {
          r = detRound;
        } else {
          const phMatch = (m.phase || "").match(/\d+/);
          r = phMatch ? parseInt(phMatch[0], 10) : 1;
        }
      }
      if (!map.has(r)) map.set(r, []);
      map.get(r)!.push(m);
    });
    map.forEach((list) => {
      list.sort((a, b) => (a.match_order || 0) - (b.match_order || 0));
    });
    return map;
  }, [matches]);

  const sortedRounds = useMemo(
    () => Array.from(roundsMap.keys()).sort((a, b) => a - b),
    [roundsMap]
  );

  const isSetsSport =
    tournament?.sport_type === "PING_PONG" || tournament?.sport_type === "VOLEI";

  return (
    <div className="space-y-8">
      {/* 1. Tabela de Classificação Master (Pontos Corridos) */}
      <div className="bg-surface/90 border border-subtle rounded-3xl p-4 sm:p-6 shadow-2xl overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 mb-4 border-b border-subtle">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-500 dark:text-amber-400">
              <Trophy className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black uppercase tracking-wider text-primary font-display">
                Tabela de Classificação • Pontos Corridos
              </h2>
              <p className="text-[11px] text-secondary">
                Vitória = 3 pts • Empate = 1 pt • Derrota = 0 pts • Desempate: Pontos e Saldo (SG)
              </p>
            </div>
          </div>

          <span className="text-xs font-bold text-[#00a2ff] bg-[#00a2ff]/10 border border-[#00a2ff]/20 px-3 py-1 rounded-full self-start sm:self-center">
            {standings.length} Participantes
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-subtle text-[11px] font-black uppercase tracking-wider text-muted">
                <th className="py-3 px-3 w-14 text-center">Posição</th>
                <th className="py-3 px-3">Equipe / Atleta</th>
                <th className="py-3 px-3 text-center text-primary" title="Pontos">
                  Pts
                </th>
                <th className="py-3 px-3 text-center" title="Jogos Disputados">
                  J
                </th>
                <th className="py-3 px-3 text-center text-emerald-600 dark:text-emerald-400" title="Vitórias">
                  V
                </th>
                <th className="py-3 px-3 text-center text-amber-600 dark:text-amber-400" title="Empates">
                  E
                </th>
                <th className="py-3 px-3 text-center text-red-600 dark:text-red-400" title="Derrotas">
                  D
                </th>
                <th
                  className="py-3 px-3 text-center"
                  title={isSetsSport ? "Sets Pró" : "Gols / Pontos Pró"}
                >
                  Pró
                </th>
                <th
                  className="py-3 px-3 text-center"
                  title={isSetsSport ? "Sets Contra" : "Gols / Pontos Contra"}
                >
                  Contra
                </th>
                <th
                  className="py-3 px-3 text-center"
                  title={isSetsSport ? "Saldo de Sets" : "Saldo de Gols / Pontos"}
                >
                  SG
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle text-xs sm:text-sm">
              {standings.map((row, index) => {
                const isFirst = index === 0;
                const isTop3 = index < 3;

                return (
                  <tr
                    key={row.teamId}
                    className={`transition-colors ${
                      isFirst
                        ? "bg-amber-500/5 hover:bg-amber-500/10"
                        : "hover:bg-zinc-100/60 dark:hover:bg-zinc-900/60"
                    }`}
                  >
                    <td className="py-3.5 px-3 text-center font-black">
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-xs font-black ${
                          index === 0
                            ? "bg-amber-500 text-black shadow-md shadow-amber-500/20"
                            : index === 1
                            ? "bg-zinc-300 text-black"
                            : index === 2
                            ? "bg-amber-700 text-white"
                            : "bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400"
                        }`}
                      >
                        {row.position}º
                      </span>
                    </td>
                    <td className="py-3.5 px-3 font-bold text-primary">
                      <div className="flex items-center gap-2.5">
                        <span className="truncate max-w-[200px] sm:max-w-xs">
                          {row.teamName}
                        </span>
                        {isFirst && row.played > 0 && (
                          <span className="print:hidden text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 dark:text-amber-400 border border-amber-500/30">
                            Líder
                          </span>
                        )}
                        {!isFirst && isTop3 && row.played > 0 && (
                          <span className="print:hidden text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#00a2ff]/10 text-[#00a2ff] border border-[#00a2ff]/20">
                            G3
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-center font-black text-base text-[#00a2ff]">
                      {row.pts}
                    </td>
                    <td className="py-3.5 px-3 text-center text-secondary font-semibold font-mono">
                      {row.j}
                    </td>
                    <td className="py-3.5 px-3 text-center text-emerald-600 dark:text-emerald-400 font-bold font-mono">
                      {row.v}
                    </td>
                    <td className="py-3.5 px-3 text-center text-amber-600 dark:text-amber-400 font-bold font-mono">
                      {row.e}
                    </td>
                    <td className="py-3.5 px-3 text-center text-red-600 dark:text-red-400 font-bold font-mono">
                      {row.d}
                    </td>
                    <td className="py-3.5 px-3 text-center text-secondary font-mono">
                      {row.pro}
                    </td>
                    <td className="py-3.5 px-3 text-center text-secondary font-mono">
                      {row.contra}
                    </td>
                    <td className="py-3.5 px-3 text-center font-mono font-bold">
                      <span
                        className={
                          row.sg > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : row.sg < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-secondary"
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

      {/* 2. Lista de Confrontos Organizados por Rodada (Rodada 1, Rodada 2...) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm sm:text-base font-black uppercase tracking-wider text-primary flex items-center gap-2 font-display">
            <Calendar className="h-4 w-4 text-[#00a2ff]" />
            <span>Confrontos por Rodada ({sortedRounds.length} Rodadas)</span>
          </h3>
          <span className="text-xs text-secondary hidden sm:inline">
            Todos contra todos • Turno Único
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {sortedRounds.map((roundNum) => {
            const roundMatches = roundsMap.get(roundNum) || [];

            // Identifica se alguma equipe ficou de folga (BYE) nesta rodada (quando nº de equipes é ímpar)
            const playingTeamIds = new Set<string>();
            let explicitByeTeamName: string | null = null;

            roundMatches.forEach((m) => {
              const t1 = m.team1_id || m.team_a_id || m.teamA?.id;
              const t2 = m.team2_id || m.team_b_id || m.teamB?.id;
              if (t1) playingTeamIds.add(t1);
              if (t2) playingTeamIds.add(t2);
              if (
                !explicitByeTeamName &&
                typeof m.details === "object" &&
                m.details?.bye_team_name
              ) {
                explicitByeTeamName = String(m.details.bye_team_name);
              }
            });

            if (!explicitByeTeamName && activeTeams.length % 2 !== 0) {
              const restingTeam = activeTeams.find((t) => !playingTeamIds.has(t.id));
              if (restingTeam) {
                explicitByeTeamName = restingTeam.name;
              }
            }

            const completedInRound = roundMatches.filter((m) => {
              const st = String(m.status || "").toUpperCase();
              return st === "COMPLETED" || st === "FINISHED";
            }).length;

            return (
              <div
                key={roundNum}
                className="bg-surface border border-subtle rounded-2xl p-4 sm:p-5 shadow-xl space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2.5 border-b border-subtle">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-[#00a2ff]/15 border border-[#00a2ff]/30 text-xs font-black uppercase tracking-wider text-[#00a2ff]">
                        Rodada {roundNum}
                      </span>
                      {completedInRound === roundMatches.length && roundMatches.length > 0 && (
                        <span className="print:hidden inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Concluída</span>
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-muted font-semibold">
                      {roundMatches.length} {roundMatches.length === 1 ? "jogo" : "jogos"}
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {roundMatches.map((match, idx) => {
                      const team1Id = match.team1_id || match.team_a_id || match.teamA?.id;
                      const team2Id = match.team2_id || match.team_b_id || match.teamB?.id;
                      const team1 = team1Id ? teamsMap.get(team1Id) : match.teamA;
                      const team2 = team2Id ? teamsMap.get(team2Id) : match.teamB;

                      const statusUpper = String(match.status || "").toUpperCase();
                      const isLive = statusUpper === "LIVE" || statusUpper === "IN_PROGRESS";
                      const isCompleted =
                        statusUpper === "COMPLETED" || statusUpper === "FINISHED";

                      const leagueLiveScore = getLiveMatchScore(match, tournament?.sport_type);
                      const matchIsSets = leagueLiveScore.isSetsSport;
                      const sets1 = leagueLiveScore.setsA;
                      const sets2 = leagueLiveScore.setsB;
                      const score1 = leagueLiveScore.rawScoreA;
                      const score2 = leagueLiveScore.rawScoreB;
                      const activePts1 = leagueLiveScore.activePointsA;
                      const activePts2 = leagueLiveScore.activePointsB;

                      return (
                        <div
                          key={match.id}
                          onClick={() => {
                            if ((isCompleted || isLive) && onSelectMatch) {
                              onSelectMatch(match);
                            }
                          }}
                          className={`p-3 rounded-xl bg-zinc-50 dark:bg-[#121214] border transition-all flex items-center justify-between gap-2 ${
                            isLive
                              ? "border-amber-500/50 ring-1 ring-amber-500/20"
                              : isCompleted
                              ? "border-subtle hover:border-[#00a2ff]/40 cursor-pointer"
                              : "border-subtle/70"
                          }`}
                        >
                          <span className="text-[10px] font-bold text-muted shrink-0 w-8">
                            #{match.match_order || idx + 1}
                          </span>

                          <div className="flex-1 min-w-0 text-right pr-2">
                            <span
                              className={`text-xs font-bold truncate block ${
                                isCompleted && (matchIsSets ? sets1 > sets2 : score1 > score2)
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-primary"
                              }`}
                              title={team1?.name || "Equipe 1"}
                            >
                              {team1?.name || "Equipe 1"}
                            </span>
                          </div>

                          <div className="px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 print:bg-white print:border-neutral-400 print:text-black font-mono text-[11px] font-black text-zinc-900 dark:text-white shrink-0">
                            {isCompleted ? (
                              matchIsSets ? (
                                <>
                                  <span className={sets1 > sets2 ? "text-emerald-600 dark:text-emerald-400 print:text-black" : "text-primary print:text-black"}>
                                    {sets1}
                                  </span>
                                  <span className="text-muted print:text-neutral-700 mx-1">x</span>
                                  <span className={sets2 > sets1 ? "text-emerald-600 dark:text-emerald-400 print:text-black" : "text-primary print:text-black"}>
                                    {sets2}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className={score1 > score2 ? "text-emerald-600 dark:text-emerald-400 print:text-black" : "text-primary print:text-black"}>
                                    {score1}
                                  </span>
                                  <span className="text-muted print:text-neutral-700 mx-1">x</span>
                                  <span className={score2 > score1 ? "text-emerald-600 dark:text-emerald-400 print:text-black" : "text-primary print:text-black"}>
                                    {score2}
                                  </span>
                                </>
                              )
                            ) : isLive ? (
                              matchIsSets ? (
                                <div className="flex items-center gap-1 font-mono text-xs">
                                  <span className="text-primary print:text-black font-black">{sets1}</span>
                                  <span className="text-[10px] font-bold text-[#00a2ff] bg-[#00a2ff]/10 px-1 py-0.5 rounded border border-[#00a2ff]/30 print:border-black print:text-black">
                                    ({activePts1})
                                  </span>
                                  <span className="text-muted print:text-neutral-700 mx-0.5">x</span>
                                  <span className="text-[10px] font-bold text-[#00a2ff] bg-[#00a2ff]/10 px-1 py-0.5 rounded border border-[#00a2ff]/30 print:border-black print:text-black">
                                    ({activePts2})
                                  </span>
                                  <span className="text-primary print:text-black font-black">{sets2}</span>
                                </div>
                              ) : (
                                <>
                                  <span className="text-primary print:text-black">{score1}</span>
                                  <span className="text-muted print:text-neutral-700 mx-1">x</span>
                                  <span className="text-primary print:text-black">{score2}</span>
                                </>
                              )
                            ) : (
                              <span className="text-muted print:text-black font-mono">[&nbsp;&nbsp;] x [&nbsp;&nbsp;]</span>
                            )}
                          </div>

                          <div className="flex-1 min-w-0 text-left pl-2">
                            <span
                              className={`text-xs font-bold truncate block ${
                                isCompleted && (matchIsSets ? sets2 > sets1 : score2 > score1)
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-primary"
                              }`}
                              title={team2?.name || "Equipe 2"}
                            >
                              {team2?.name || "Equipe 2"}
                            </span>
                          </div>

                          {(isCompleted || isLive) && onSelectMatch && (
                            <BarChart2 className="h-3.5 w-3.5 text-zinc-400 hover:text-[#00a2ff] shrink-0" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {explicitByeTeamName && (
                  <div className="pt-2.5 border-t border-subtle flex items-center justify-between text-[11px] text-secondary">
                    <span className="flex items-center gap-1.5 font-semibold text-amber-500 dark:text-amber-400/90">
                      <Clock className="h-3.5 w-3.5" />
                      <span>Folga na Rodada (BYE):</span>
                    </span>
                    <span className="font-bold text-primary truncate max-w-[180px]">
                      {explicitByeTeamName}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

