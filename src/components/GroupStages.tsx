"use client";

import React, { useMemo } from "react";
import {
  Layers,
  CheckCircle2,
  Calendar,
  Network,
  Trophy,
} from "lucide-react";
import { Tournament, Team, Match } from "@/types";
import {
  calculateGroupStandings,
  normalizeGroupLetter,
  extractMatchGroupName,
} from "@/utils/groupStandings";
import { KnockoutTree } from "@/components/TournamentView";

export interface GroupStageItem {
  id: string;
  name: string;
  groupLetter: string;
  teams: Team[];
  matches: Match[];
}

export interface GroupStagesProps {
  groups?: GroupStageItem[];
  teams?: Team[];
  matches?: Match[];
  tournament?: Tournament | null;
  onSelectMatch?: (match: Match) => void;
}

export default function GroupStages({
  groups: propGroups,
  teams = [],
  matches = [],
  tournament,
  onSelectMatch,
}: GroupStagesProps) {
  const teamsMap = useMemo(() => {
    const map = new Map<string, Team>();
    teams.forEach((t) => map.set(t.id, t));
    return map;
  }, [teams]);

  const { computedGroups, knockoutMatches, groupMatchesTotal, groupMatchesCompleted } =
    useMemo(() => {
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

      const completedCount = grpMatches.filter((m) => {
        const st = String(m.status || "").toUpperCase();
        return st === "COMPLETED" || st === "FINISHED";
      }).length;

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

      const teamGroupMap = new Map<string, string>();
      activeTeams.forEach((t) => {
        const g = normalizeGroupLetter(t.group_name);
        if (g) teamGroupMap.set(t.id, g);
      });

      grpMatches.forEach((m) => {
        const mGroup = extractMatchGroupName(m, teamGroupMap);
        if (mGroup) {
          const t1 = m.team1_id || m.team_a_id || m.teamA?.id;
          const t2 = m.team2_id || m.team_b_id || m.teamB?.id;
          if (t1 && !teamGroupMap.has(t1)) teamGroupMap.set(t1, mGroup);
          if (t2 && !teamGroupMap.has(t2)) teamGroupMap.set(t2, mGroup);
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
          const gLetter =
            extractMatchGroupName(m, teamGroupMap) ||
            (t1Id && teamGroupMap.get(t1Id)) ||
            (t2Id && teamGroupMap.get(t2Id)) ||
            "A";

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
            groupLetter: letter,
            teams: Array.from(data.teams.values()),
            matches: data.matches.sort(
              (a, b) =>
                Number(a.round || 1) - Number(b.round || 1) ||
                (a.match_order || 0) - (b.match_order || 0)
            ),
          };
        });

        return {
          computedGroups: built,
          knockoutMatches: koMatches,
          groupMatchesTotal: grpMatches.length,
          groupMatchesCompleted: completedCount,
        };
      }

      // Fallback de pré-visualização antes do sorteio
      const groupSize = 4;
      const numGroups = Math.max(2, Math.ceil(activeTeams.length / groupSize));
      const letters = ["A", "B", "C", "D", "E", "F", "G", "H"];
      const fallbackGroups: GroupStageItem[] = [];

      for (let g = 0; g < numGroups; g++) {
        const letter = letters[g] || String(g + 1);
        const slice = activeTeams.filter((_, idx) => idx % numGroups === g);
        if (slice.length > 0) {
          fallbackGroups.push({
            id: `group-${letter}`,
            name: `Grupo ${letter}`,
            groupLetter: letter,
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
                Vitória = 3 pts • Empate = 1 pt • Derrota = 0 pts • Os 2 melhores de cada grupo avançam ao Mata-Mata
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
              group.groupLetter,
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

                  {/* Tabela HTML: Posição | Equipe | Pts | J | V | E | D | SG */}
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
                          <th
                            className="py-2 px-2 text-center"
                            title={isSetsSport ? "Saldo de Sets" : "Saldo de Pontos/Gols"}
                          >
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
                              <td className="py-2.5 px-2 font-bold text-white truncate max-w-[160px]">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate" title={row.teamName}>
                                    {row.teamName}
                                  </span>
                                  {qualified && (
                                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shrink-0">
                                      Top 2
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

                {/* Cards das Partidas daquele Grupo Específico */}
                {group.matches.length > 0 && (
                  <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-zinc-400">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-[#00a2ff]" />
                        <span>Partidas do {group.name}</span>
                      </span>
                      <span className="text-zinc-500">
                        {group.matches.length}{" "}
                        {group.matches.length === 1 ? "confronto" : "confrontos"}
                      </span>
                    </div>

                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
                      {group.matches.map((match) => {
                        const t1Id = match.team1_id || match.team_a_id || match.teamA?.id;
                        const t2Id = match.team2_id || match.team_b_id || match.teamB?.id;
                        const t1 = t1Id ? teamsMap.get(t1Id) : match.teamA;
                        const t2 = t2Id ? teamsMap.get(t2Id) : match.teamB;

                        const statusUpper = String(match.status || "").toUpperCase();
                        const isLive = statusUpper === "LIVE" || statusUpper === "IN_PROGRESS";
                        const isCompleted =
                          statusUpper === "COMPLETED" || statusUpper === "FINISHED";

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
                            className={`px-3 py-2.5 rounded-xl bg-[#18181b] border text-xs flex items-center justify-between gap-2 transition-all ${
                              isLive
                                ? "border-amber-500/50"
                                : isCompleted
                                ? "border-zinc-800 hover:border-[#00a2ff]/40 cursor-pointer"
                                : "border-zinc-800/60"
                            }`}
                          >
                            <span className="text-[10px] font-bold text-zinc-500 shrink-0 w-12">
                              Rod. {match.round || 1}
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
      {knockoutMatches.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm sm:text-base font-black uppercase tracking-wider text-white font-display">
                Fase Eliminatória • Mata-Mata
              </h3>
            </div>
            <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
              <Trophy className="h-3.5 w-3.5 text-amber-400" />
              <span>Cruzamento Oficial (1º vs 2º)</span>
            </span>
          </div>

          <KnockoutTree
            matches={knockoutMatches}
            teams={teams}
            tournament={tournament}
            onSelectMatch={onSelectMatch}
          />
        </div>
      )}
    </div>
  );
}

