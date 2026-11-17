"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  X,
  Trophy,
  CheckCircle2,
  Clock,
  Layers,
  BarChart2,
  Award,
  Sparkles,
} from "lucide-react";
import { Tournament, Team, SportType, Match, SetScore } from "@/types";
import { useTournament, getFriendlyIdFromUuid } from "@/context/TournamentContext";
import { supabase } from "@/lib/supabase";

export type DbMatchRow = Match;

export interface MatchDetailsModalProps {
  match?: Match | null;
  matchId?: string | null;
  matches?: Match[];
  tournament: Tournament | null;
  teamsMap: Map<string, Team>;
  onClose: () => void;
  getMatchDetailData?: (match: Match) => {
    setHistory?: any;
    rounds?: any;
    penA?: number | null;
    penB?: number | null;
  } | null;
}

export interface NormalizedSet {
  setNumber: number;
  scoreA: number;
  scoreB: number;
  wonA: boolean;
  wonB: boolean;
}

/**
 * Função utilitária para extrair e normalizar o histórico de sets em JSONB
 * com suporte resiliente a colunas: sets_history, set_history, history, details, detailed_score
 */
export function extractNormalizedSets(
  match: Match,
  externalSetHistory?: any
): NormalizedSet[] {
  const parseJsonSafe = (val: any) => {
    if (!val) return null;
    if (typeof val === "object") return val;
    if (typeof val === "string") {
      try {
        return JSON.parse(val);
      } catch {
        return null;
      }
    }
    return val;
  };

  const isMatchScheduled =
    !match ||
    match.status === "SCHEDULED" ||
    (match.status as string) === "AGENDADA" ||
    (match.status as string) === "PROGRAMADA";

  if (isMatchScheduled) return [];

  const parsedScore =
    typeof match?.detailed_score === "string"
      ? parseJsonSafe(match.detailed_score)
      : match?.detailed_score;
  const parsedDetailedScore =
    typeof (match as any)?.detailedScore === "string"
      ? parseJsonSafe((match as any)?.detailedScore)
      : (match as any)?.detailedScore;
  const ds = parsedScore ?? parsedDetailedScore;
  const dt =
    typeof match?.details === "string"
      ? parseJsonSafe(match?.details)
      : match?.details;

  let rawList: any = null;

  // 1. Prioridade máxima: clonagem exata da hierarquia da Súmula (RefereePanel)
  if (Array.isArray(ds?.sets) && ds.sets.length > 0) {
    rawList = ds.sets;
  } else if (Array.isArray(ds?.historicoSets) && ds.historicoSets.length > 0) {
    rawList = ds.historicoSets;
  } else if (Array.isArray(ds?.rounds) && ds.rounds.length > 0) {
    rawList = ds.rounds;
  } else if (Array.isArray(ds) && ds.length > 0) {
    rawList = ds;
  } else if (Array.isArray(match.historicoSets) && match.historicoSets.length > 0) {
    rawList = match.historicoSets;
  } else if (Array.isArray(dt?.sets) && dt.sets.length > 0) {
    rawList = dt.sets;
  } else if (Array.isArray(dt?.historicoSets) && dt.historicoSets.length > 0) {
    rawList = dt.historicoSets;
  } else if (Array.isArray(dt?.rounds) && dt.rounds.length > 0) {
    rawList = dt.rounds;
  } else if (Array.isArray(match.sets_history) && match.sets_history.length > 0) {
    rawList = match.sets_history;
  } else if (typeof match.sets_history === "string") {
    const p = parseJsonSafe(match.sets_history);
    if (Array.isArray(p) && p.length > 0) rawList = p;
  } else if (Array.isArray(match.set_history) && match.set_history.length > 0) {
    rawList = match.set_history;
  } else if (typeof match.set_history === "string") {
    const p = parseJsonSafe(match.set_history);
    if (Array.isArray(p) && p.length > 0) rawList = p;
  }

  // 2. Fallbacks reais
  if (!rawList && externalSetHistory) {
    const parsedExt = parseJsonSafe(externalSetHistory);
    if (Array.isArray(parsedExt) && parsedExt.length > 0) rawList = parsedExt;
  }

  // 3. Fallback para localStorage
  if ((!rawList || rawList.length === 0) && typeof window !== "undefined") {
    try {
      const localStr = localStorage.getItem("sc_matches");
      if (localStr) {
        const parsed = JSON.parse(localStr);
        const team1Id = match.team1_id || match.team_a_id || match.teamA?.id;
        const team2Id = match.team2_id || match.team_b_id || match.teamB?.id;
        const found = parsed.find(
          (m: any) =>
            m.id === match.id ||
            ((match as any).uuid && m.id === (match as any).uuid) ||
            (team1Id &&
              team2Id &&
              ((m.teamA?.id === team1Id && m.teamB?.id === team2Id) ||
                (m.teamA?.id === team2Id && m.teamB?.id === team1Id) ||
                (m.team1_id === team1Id && m.team2_id === team2Id)))
        );
        if (found) {
          const localCandidates = [
            parseJsonSafe(found.detailed_score?.sets),
            parseJsonSafe(found.detailed_score?.historicoSets),
            parseJsonSafe(found.detailed_score?.rounds),
            parseJsonSafe(found.detailedScore?.sets),
            parseJsonSafe(found.detailedScore?.historicoSets),
            parseJsonSafe(found.detailedScore?.rounds),
            parseJsonSafe(found.historicoSets),
            parseJsonSafe(found.details?.sets),
            parseJsonSafe(found.details?.rounds),
          ];
          for (const lc of localCandidates) {
            if (Array.isArray(lc) && lc.length > 0) {
              rawList = lc;
              break;
            }
          }
        }
      }
    } catch {}
  }

  if (!rawList || !Array.isArray(rawList)) return [];

  return rawList.map((item: any, idx: number) => {
    let setNumber = idx + 1;
    let scoreA = 0;
    let scoreB = 0;

    if (Array.isArray(item)) {
      scoreA = Number(item[0]) || 0;
      scoreB = Number(item[1]) || 0;
    } else if (item && typeof item === "object") {
      setNumber =
        Number(
          item.setNumber ??
          item.set_number ??
          item.roundNumber ??
          item.round_number ??
          item.set ??
          item.numero ??
          item.round ??
          idx + 1
        ) || idx + 1;
      scoreA =
        Number(
          item.scoreA ??
          item.score_a ??
          item.teamA_score ??
          item.team_a_score ??
          item.score1 ??
          item.team_a ??
          item.teamA ??
          item.team1 ??
          item.a ??
          item.pontosA ??
          item.pontos_a ??
          0
        ) || 0;
      scoreB =
        Number(
          item.scoreB ??
          item.score_b ??
          item.teamB_score ??
          item.team_b_score ??
          item.score2 ??
          item.team_b ??
          item.teamB ??
          item.team2 ??
          item.b ??
          item.pontosB ??
          item.pontos_b ??
          0
        ) || 0;
    }

    return {
      setNumber,
      scoreA,
      scoreB,
      wonA: scoreA > scoreB,
      wonB: scoreB > scoreA,
    };
  });
}

export default function MatchDetailsModal({
  match,
  matchId,
  matches: propMatches,
  tournament,
  teamsMap,
  onClose,
  getMatchDetailData,
}: MatchDetailsModalProps) {
  const context = useTournament();
  const contextMatches = context?.matches || [];

  // 1. Identificação Estrita da Origem e Referência Viva pelo ID
  const rawId = matchId || match?.id || (match as any)?.uuid || (match as any)?.db_id || "";
  const friendlyId = rawId ? getFriendlyIdFromUuid(rawId) : "";

  const liveMatch: Match = useMemo(() => {
    const pool: Match[] = [];
    if (propMatches && Array.isArray(propMatches)) pool.push(...propMatches);
    if (contextMatches && Array.isArray(contextMatches)) pool.push(...contextMatches);

    const found = pool.find((m) => {
      if (!m) return false;
      return (
        m.id === rawId ||
        m.id === friendlyId ||
        (m as any).uuid === rawId ||
        (m as any).db_id === rawId ||
        ((match as any)?.uuid && ((m as any).uuid === (match as any).uuid || m.id === (match as any).uuid)) ||
        (rawId && (m as any).id === rawId)
      );
    });

    if (found) {
      return { ...(match || {}), ...found };
    }
    return match || ({} as Match);
  }, [propMatches, contextMatches, rawId, friendlyId, match]);

  // Se o detailed_score ainda não foi carregado em memória, busca direto do Supabase por garantia
  const [asyncDetailedScore, setAsyncDetailedScore] = useState<any>(null);

  useEffect(() => {
    const dbUuid =
      (liveMatch as any)?.uuid ||
      (liveMatch as any)?.db_id ||
      (match as any)?.uuid ||
      (rawId.includes("-") && rawId.length === 36 ? rawId : null);

    const hasSets =
      (Array.isArray(liveMatch?.historicoSets) && liveMatch.historicoSets.length > 0) ||
      (Array.isArray((liveMatch?.detailed_score as any)?.sets) && (liveMatch.detailed_score as any).sets.length > 0) ||
      (Array.isArray((liveMatch?.detailed_score as any)?.historicoSets) && (liveMatch.detailed_score as any).historicoSets.length > 0);

    if (dbUuid && !hasSets) {
      supabase
        .from("matches")
        .select("*, detailed_score, details")
        .eq("id", dbUuid)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!error && data) {
            if (data.detailed_score) {
              setAsyncDetailedScore(data.detailed_score);
            } else if (data.details) {
              setAsyncDetailedScore(data.details);
            }
          }
        });
    }
  }, [liveMatch, rawId, match]);

  // 2. Bypass de CamelCase: detecta tanto snake_case (detailed_score) quanto camelCase (detailedScore)
  const resolvedDetailedScore =
    asyncDetailedScore ??
    (liveMatch?.detailed_score !== undefined
      ? liveMatch.detailed_score
      : (liveMatch as any)?.detailedScore !== undefined
      ? (liveMatch as any).detailedScore
      : match?.detailed_score !== undefined
      ? match.detailed_score
      : (match as any)?.detailedScore);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const team1Id = liveMatch.team1_id || liveMatch.team_a_id || liveMatch.teamA?.id;
  const team2Id = liveMatch.team2_id || liveMatch.team_b_id || liveMatch.teamB?.id;
  const team1 = team1Id ? teamsMap.get(team1Id) : liveMatch.teamA || null;
  const team2 = team2Id ? teamsMap.get(team2Id) : liveMatch.teamB || null;
  const team1Name = team1 ? team1.name : "Equipe 1";
  const team2Name = team2 ? team2.name : "Equipe 2";

  const score1 = liveMatch.score_a ?? liveMatch.scoreA ?? 0;
  const score2 = liveMatch.score_b ?? liveMatch.scoreB ?? 0;
  const sets1 = liveMatch.sets_a ?? liveMatch.setsA ?? liveMatch.setsVencidosTimeA ?? 0;
  const sets2 = liveMatch.sets_b ?? liveMatch.setsB ?? liveMatch.setsVencidosTimeB ?? 0;

  const isCompleted = liveMatch.status === "COMPLETED";
  const isLive = liveMatch.status === "LIVE" || liveMatch.status === "IN_PROGRESS";

  // Obtém dados extras via helper se fornecido
  const externalData = getMatchDetailData ? getMatchDetailData(liveMatch) : null;

  // Leitura estrita e direta de detailed_score e sets_history reais (sem dados mockados)
  const safeHistory = useMemo(() => {
    const parseJsonSafe = (val: any) => {
      if (!val) return null;
      if (typeof val === "object") return val;
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch {
          return null;
        }
      }
      return val;
    };

    const isMatchScheduled =
      !liveMatch ||
      liveMatch.status === "SCHEDULED" ||
      (liveMatch.status as string) === "AGENDADA" ||
      (liveMatch.status as string) === "PROGRAMADA";

    if (isMatchScheduled) return [];

    // Parse defensivo idêntico à Súmula (RefereePanel) com bypass de CamelCase
    const parsedScore =
      typeof resolvedDetailedScore === "string"
        ? parseJsonSafe(resolvedDetailedScore)
        : resolvedDetailedScore;
    const parsedDetailedScore =
      typeof (liveMatch as any)?.detailedScore === "string"
        ? parseJsonSafe((liveMatch as any)?.detailedScore)
        : (liveMatch as any)?.detailedScore;
    const ds = parsedScore ?? parsedDetailedScore;
    const dt =
      typeof liveMatch?.details === "string"
        ? parseJsonSafe(liveMatch?.details)
        : liveMatch?.details;

    let rawList: any[] = [];

    // 1. Prioridade máxima: clonagem exata da hierarquia da Súmula (RefereePanel)
    if (Array.isArray(ds?.sets) && ds.sets.length > 0) {
      rawList = ds.sets;
    } else if (Array.isArray(ds?.historicoSets) && ds.historicoSets.length > 0) {
      rawList = ds.historicoSets;
    } else if (Array.isArray(ds?.rounds) && ds.rounds.length > 0) {
      rawList = ds.rounds;
    } else if (Array.isArray(ds) && ds.length > 0) {
      rawList = ds;
    } else if (Array.isArray(liveMatch.historicoSets) && liveMatch.historicoSets.length > 0) {
      rawList = liveMatch.historicoSets;
    } else if (Array.isArray(dt?.sets) && dt.sets.length > 0) {
      rawList = dt.sets;
    } else if (Array.isArray(dt?.historicoSets) && dt.historicoSets.length > 0) {
      rawList = dt.historicoSets;
    } else if (Array.isArray(dt?.rounds) && dt.rounds.length > 0) {
      rawList = dt.rounds;
    } else if (Array.isArray(liveMatch.sets_history) && liveMatch.sets_history.length > 0) {
      rawList = liveMatch.sets_history;
    } else if (typeof liveMatch.sets_history === "string") {
      const p = parseJsonSafe(liveMatch.sets_history);
      if (Array.isArray(p) && p.length > 0) rawList = p;
    } else if (Array.isArray(liveMatch.set_history) && liveMatch.set_history.length > 0) {
      rawList = liveMatch.set_history;
    } else if (typeof liveMatch.set_history === "string") {
      const p = parseJsonSafe(liveMatch.set_history);
      if (Array.isArray(p) && p.length > 0) rawList = p;
    }

    // 2. Fallbacks de dados extras
    if (rawList.length === 0) {
      const fallbackCandidates: any[] = [
        externalData?.setHistory,
        externalData?.rounds,
      ];
      for (const cand of fallbackCandidates) {
        const parsed = parseJsonSafe(cand);
        if (Array.isArray(parsed) && parsed.length > 0) {
          rawList = parsed;
          break;
        }
      }
    }

    // 3. Verificação no localStorage caso haja dados locais salvos pelo árbitro
    if (rawList.length === 0 && typeof window !== "undefined") {
      try {
        const localStr = localStorage.getItem("sc_matches");
        if (localStr) {
          const parsed = JSON.parse(localStr);
          const found = parsed.find(
            (m: any) =>
              m.id === liveMatch.id ||
              ((liveMatch as any).uuid && m.id === (liveMatch as any).uuid) ||
              (team1Id &&
                team2Id &&
                ((m.teamA?.id === team1Id && m.teamB?.id === team2Id) ||
                  (m.teamA?.id === team2Id && m.teamB?.id === team1Id) ||
                  (m.team1_id === team1Id && m.team2_id === team2Id)))
          );
          if (found) {
            const fds = typeof found.detailed_score === "string" ? parseJsonSafe(found.detailed_score) : found.detailed_score;
            const fdsCamel = typeof found.detailedScore === "string" ? parseJsonSafe(found.detailedScore) : found.detailedScore;
            const fdt = typeof found.details === "string" ? parseJsonSafe(found.details) : found.details;
            const targetDs = fds || fdsCamel;
            if (Array.isArray(targetDs?.sets) && targetDs.sets.length > 0) rawList = targetDs.sets;
            else if (Array.isArray(targetDs?.historicoSets) && targetDs.historicoSets.length > 0) rawList = targetDs.historicoSets;
            else if (Array.isArray(targetDs?.rounds) && targetDs.rounds.length > 0) rawList = targetDs.rounds;
            else if (Array.isArray(found.historicoSets) && found.historicoSets.length > 0) rawList = found.historicoSets;
            else if (Array.isArray(fdt?.sets) && fdt.sets.length > 0) rawList = fdt.sets;
          }
        }
      } catch {}
    }

    if (!Array.isArray(rawList) || rawList.length === 0) return [];

    return rawList.map((s: any, idx: number) => {
      const setNum =
        Number(
          s?.setNumber ??
          s?.set_number ??
          s?.roundNumber ??
          s?.round_number ??
          s?.set ??
          s?.numero ??
          s?.round ??
          idx + 1
        ) || (idx + 1);

      let scA = 0;
      let scB = 0;

      if (Array.isArray(s)) {
        scA = Number(s[0]) || 0;
        scB = Number(s[1]) || 0;
      } else if (s && typeof s === "object") {
        scA = Number(
          s.scoreA ??
          s.score_a ??
          s.teamA_score ??
          s.team_a_score ??
          s.score1 ??
          s.teamA ??
          s.team_a ??
          s.team1 ??
          s.a ??
          s.pontosA ??
          s.pontos_a ??
          0
        ) || 0;

        scB = Number(
          s.scoreB ??
          s.score_b ??
          s.teamB_score ??
          s.team_b_score ??
          s.score2 ??
          s.teamB ??
          s.team_b ??
          s.team2 ??
          s.b ??
          s.pontosB ??
          s.pontos_b ??
          0
        ) || 0;

        // Se for um round com winnerTeamId e pointsGenerated
        if (s.winnerTeamId && scA === 0 && scB === 0 && s.pointsGenerated) {
          if (s.winnerTeamId === team1Id) {
            scA = Number(s.pointsGenerated) || 0;
          } else if (s.winnerTeamId === team2Id) {
            scB = Number(s.pointsGenerated) || 0;
          }
        }
      }

      // Matemática idêntica à Súmula (RefereePanel: const isWinnerA = s.scoreA > s.scoreB)
      const wonA = scA > scB;
      const wonB = scB > scA;
      const isWinnerA = wonA;
      const isWinnerB = wonB;
      const setWinnerName = wonA ? team1Name : wonB ? team2Name : "Em disputa";

      return {
        setNumber: setNum,
        scoreA: scA,
        scoreB: scB,
        wonA,
        wonB,
        isWinnerA,
        isWinnerB,
        winnerName: setWinnerName,
      };
    });
  }, [liveMatch, resolvedDetailedScore, externalData, team1Id, team2Id, team1Name, team2Name]);

  const sportType: SportType =
    (liveMatch as any)?.sport_type ||
    (liveMatch as any)?.sportType ||
    tournament?.sport_type ||
    (tournament as any)?.sport ||
    "DOMINO";
  const isPingPong = sportType === "PING_PONG";
  const isVolei = sportType === "VOLEI";
  const isFutsal = sportType === "FUTSAL";
  const isDomino = sportType === "DOMINO";
  const isSetsSport =
    isPingPong ||
    isVolei ||
    safeHistory.length > 0 ||
    sets1 > 0 ||
    sets2 > 0 ||
    Boolean(liveMatch.sets_a && liveMatch.sets_a > 0) ||
    Boolean(liveMatch.sets_b && liveMatch.sets_b > 0);

  const isWinner1 =
    isCompleted &&
    ((liveMatch.winner_id && liveMatch.winner_id === team1Id) ||
      (isSetsSport && (sets1 > 0 || sets2 > 0) ? sets1 > sets2 : score1 > score2));
  const isWinner2 =
    isCompleted &&
    ((liveMatch.winner_id && liveMatch.winner_id === team2Id) ||
      (isSetsSport && (sets1 > 0 || sets2 > 0) ? sets2 > sets1 : score2 > score1));

  // Extração de rounds para Dominó
  const roundsList = useMemo(() => {
    const candidates = [
      externalData?.rounds,
      liveMatch.detailed_score?.rounds,
      (liveMatch as any).rounds,
      (liveMatch as any).detailedScore?.rounds,
      liveMatch.details?.rounds,
    ];
    for (const cand of candidates) {
      if (Array.isArray(cand) && cand.length > 0) return cand;
    }
    return [];
  }, [liveMatch, externalData]);

  // Pênaltis para Futsal
  const penA =
    externalData?.penA ?? liveMatch.penalties_a ?? (liveMatch as any).penaltiesA ?? null;
  const penB =
    externalData?.penB ?? liveMatch.penalties_b ?? (liveMatch as any).penaltiesB ?? null;

  const sportTitle =
    sportType === "PING_PONG"
      ? "Ping Pong"
      : sportType === "VOLEI"
      ? "Vôlei"
      : sportType === "FUTSAL"
      ? "Futsal"
      : "Dominó";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="relative bg-[#141417] border border-zinc-700/70 rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-[#e4e4e7]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow Superior */}
        <div className="h-1.5 w-full bg-gradient-to-r from-[#00a2ff] via-amber-400 to-[#00a2ff]" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-[#18181c]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#00a2ff]/10 border border-[#00a2ff]/30 flex items-center justify-center text-[#00a2ff]">
              <BarChart2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <span>Detalhes do Confronto</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 font-bold border border-zinc-700">
                  {sportTitle}
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400 font-medium">
                {liveMatch.phase || "Fase Eliminatória"} • Jogo #{liveMatch.match_order || 1}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-zinc-800/70 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all flex items-center justify-center cursor-pointer"
            title="Fechar (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* 1. Card Resumo do Placar Geral */}
          <div className="bg-[#1c1c21] border border-zinc-800 rounded-2xl p-4 shadow-inner">
            <div className="flex items-center justify-between text-[11px] font-bold text-zinc-400 uppercase tracking-wider pb-3 border-b border-zinc-800/80 mb-3">
              <span>Placar Geral</span>
              {isLive ? (
                <span className="flex items-center gap-1.5 text-amber-400 font-black animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  EM ANDAMENTO
                </span>
              ) : isCompleted ? (
                <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  CONFRONTO ENCERRADO
                </span>
              ) : (
                <span className="text-zinc-500">PROGRAMADO</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 items-center">
              {/* Equipe 1 */}
              <div
                className={`p-3.5 rounded-xl border transition-all ${
                  isWinner1
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-zinc-900/60 border-zinc-800 text-zinc-200"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
                      isWinner1
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {team1 ? team1.name.slice(0, 1).toUpperCase() : "1"}
                  </div>
                  <span className="text-xs font-bold truncate" title={team1Name}>
                    {team1Name}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold">
                    {isSetsSport ? "Sets Vencidos" : isFutsal ? "Gols" : "Pontos"}
                  </span>
                  <span className="text-2xl font-black font-mono">
                    {isSetsSport && (sets1 > 0 || sets2 > 0) ? sets1 : score1}
                  </span>
                </div>
                {isWinner1 && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                    <Trophy className="w-3 h-3" />
                    <span>Vencedor</span>
                  </div>
                )}
              </div>

              {/* Equipe 2 */}
              <div
                className={`p-3.5 rounded-xl border transition-all ${
                  isWinner2
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-zinc-900/60 border-zinc-800 text-zinc-200"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
                      isWinner2
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {team2 ? team2.name.slice(0, 1).toUpperCase() : "2"}
                  </div>
                  <span className="text-xs font-bold truncate" title={team2Name}>
                    {team2Name}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold">
                    {isSetsSport ? "Sets Vencidos" : isFutsal ? "Gols" : "Pontos"}
                  </span>
                  <span className="text-2xl font-black font-mono">
                    {isSetsSport && (sets1 > 0 || sets2 > 0) ? sets2 : score2}
                  </span>
                </div>
                {isWinner2 && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                    <Trophy className="w-3 h-3" />
                    <span>Vencedor</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 2. Secção Histórico Detalhado (Sets / Tempos / Quedas) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#00a2ff]" />
                <span>
                  {isSetsSport
                    ? "Histórico Detalhado (Sets)"
                    : isFutsal
                    ? "Histórico Detalhado (Tempos)"
                    : "Histórico Detalhado (Quedas)"}
                </span>
              </h4>
              {isSetsSport && safeHistory.length > 0 && (
                <span className="text-[11px] text-[#00a2ff] font-bold">
                  {safeHistory.length} {safeHistory.length === 1 ? "set jogado" : "sets jogados"}
                </span>
              )}
            </div>

            {/* Mapeamento Visual dos Sets (Ping Pong & Vôlei) */}
            {isSetsSport && (
              <>
                {safeHistory.length > 0 ? (
                  <div className="space-y-2.5">
                    {/* Barra de resumo horizontal rápida */}
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
                      {safeHistory.map((s: any, idx: number) => (
                        <div
                          key={`pill-${s.setNumber}-${idx}`}
                          className="shrink-0 px-2.5 py-1 rounded-lg bg-zinc-800/80 border border-zinc-700/80 text-[10px] font-mono flex items-center gap-1.5 shadow-sm"
                        >
                          <span className="font-bold text-zinc-400">Set {s.setNumber}:</span>
                          <span className={s.wonA ? "text-emerald-400 font-bold" : "text-zinc-200"}>
                            {s.scoreA}
                          </span>
                          <span className="text-zinc-500">x</span>
                          <span className={s.wonB ? "text-emerald-400 font-bold" : "text-zinc-200"}>
                            {s.scoreB}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Lista detalhada dos sets com mapeamento dinâmico .map() */}
                    <div className="space-y-2">
                      {safeHistory.map((s: any, idx: number) => {
                        const isTieBreak = isVolei && s.setNumber === 5;

                        return (
                          <div
                            key={`set-${s.setNumber}-${idx}`}
                            className="bg-[#18181c] border border-zinc-800 hover:border-zinc-700 rounded-xl p-3.5 flex items-center justify-between transition-all"
                          >
                            <div className="flex items-center gap-3">
                              <span className="px-2 py-1 rounded-lg bg-zinc-800 text-[#00a2ff] font-mono text-xs font-black border border-zinc-700/80 shadow-inner">
                                Set {s.setNumber}
                              </span>
                              <div>
                                <span className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                                  <span>Set {s.setNumber}</span>
                                  {isTieBreak && (
                                    <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/30">
                                      Tie-break
                                    </span>
                                  )}
                                </span>
                                <span className="text-[11px] text-zinc-400 block mt-0.5">
                                  Vencedor:{" "}
                                  <strong className={s.wonA || s.wonB ? "text-emerald-400" : "text-zinc-400"}>
                                    {s.winnerName}
                                  </strong>
                                </span>
                              </div>
                            </div>

                            {/* Placar exato dinâmico no formato "${set.scoreA} - ${set.scoreB}" */}
                            <div className="flex items-center gap-2 font-mono text-sm font-black px-3 py-1 rounded-lg bg-zinc-900 border border-zinc-800">
                              <span className={s.wonA ? "text-emerald-400" : "text-zinc-300"}>
                                {s.scoreA}
                              </span>
                              <span className="text-zinc-600">-</span>
                              <span className={s.wonB ? "text-emerald-400" : "text-zinc-300"}>
                                {s.scoreB}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* Fallback seguro: "Histórico de sets indisponível" */
                  <div className="bg-[#18181c] border border-dashed border-zinc-800 rounded-2xl p-6 text-center text-xs text-zinc-500 flex flex-col items-center justify-center gap-2">
                    <Clock className="w-6 h-6 text-zinc-600" />
                    <p className="font-semibold text-zinc-400">
                      Histórico de sets indisponível
                    </p>
                    <p className="text-[11px] text-zinc-600">
                      Nenhum detalhe de sets ou parciais foi registrado para este confronto.
                    </p>
                  </div>
                )}
              </>
            )}

            {/* Futsal */}
            {isFutsal && (
              <div className="space-y-2">
                <div className="bg-[#18181c] border border-zinc-800 rounded-xl p-3.5 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-zinc-200 block">Tempo Regulamentar</span>
                    <span className="text-[11px] text-zinc-400">Gols de jogo</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-sm font-black px-3 py-1 rounded-lg bg-zinc-900 border border-zinc-800">
                    <span className={score1 > score2 ? "text-emerald-400" : "text-zinc-300"}>
                      {score1}
                    </span>
                    <span className="text-zinc-600">-</span>
                    <span className={score2 > score1 ? "text-emerald-400" : "text-zinc-300"}>
                      {score2}
                    </span>
                  </div>
                </div>

                {penA !== null && penB !== null && (penA > 0 || penB > 0) && (
                  <div className="bg-[#18181c] border border-amber-500/30 bg-amber-500/5 rounded-xl p-3.5 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-amber-300 block">Disputa de Pênaltis</span>
                      <span className="text-[11px] text-zinc-400">
                        Vencedor nos pênaltis: {penA > penB ? team1Name : team2Name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-sm font-black px-3 py-1 rounded-lg bg-zinc-900 border border-zinc-800">
                      <span className={penA > penB ? "text-emerald-400" : "text-zinc-300"}>
                        {penA}
                      </span>
                      <span className="text-zinc-600">-</span>
                      <span className={penB > penA ? "text-emerald-400" : "text-zinc-300"}>
                        {penB}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Dominó */}
            {isDomino && safeHistory.length === 0 && (
              <div className="space-y-2">
                {roundsList.length > 0 ? (
                  roundsList.map((r: any) => {
                    const winnerT =
                      r.winnerTeamId === team1Id
                        ? team1
                        : r.winnerTeamId === team2Id
                        ? team2
                        : null;
                    const isT1 = r.winnerTeamId === team1Id;

                    return (
                      <div
                        key={r.roundNumber}
                        className="bg-[#18181c] border border-zinc-800 rounded-xl p-3 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="w-6 h-6 rounded-lg bg-zinc-800 text-[#00a2ff] font-mono text-xs font-black flex items-center justify-center">
                            {r.roundNumber}
                          </span>
                          <div>
                            <span className="text-xs font-bold text-zinc-200 block">
                              Queda #{r.roundNumber} {r.note ? `• ${r.note}` : ""}
                            </span>
                            <span className="text-[11px] text-zinc-400">
                              Vencedor:{" "}
                              <strong className={isT1 ? "text-[#00a2ff]" : "text-amber-400"}>
                                {winnerT ? winnerT.name : "Anulada"}
                              </strong>
                            </span>
                          </div>
                        </div>

                        <div className="font-mono text-xs font-black text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                          +{r.pointsGenerated} pts
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="bg-[#18181c] border border-dashed border-zinc-800 rounded-2xl p-6 text-center text-xs text-zinc-500 flex flex-col items-center justify-center gap-2">
                    <Clock className="w-6 h-6 text-zinc-600" />
                    <p className="font-semibold text-zinc-400">
                      Nenhum histórico de pontos registado ainda.
                    </p>
                    <p className="text-[11px] text-zinc-600">
                      As quedas e pontuações serão exibidas aqui à medida que forem registradas na mesa.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 bg-[#18181c] flex items-center justify-between">
          <span className="text-[11px] text-zinc-500 font-medium">
            Pressione{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px]">
              Esc
            </kbd>{" "}
            para fechar
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95"
          >
            Fechar Detalhes
          </button>
        </div>
      </div>
    </div>
  );
}
