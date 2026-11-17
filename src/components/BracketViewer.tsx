"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Trophy,
  MapPin,
  Loader2,
  RefreshCw,
  ExternalLink,
  Network,
  Settings,
  Printer,
  CheckCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Tournament, Team, SportType, Match } from "@/types";
import { useTournament, deduplicateMatches, getFriendlyIdFromUuid } from "@/context/TournamentContext";
import PublicHeader from "@/components/PublicHeader";
import MatchDetailsModal from "@/components/MatchDetailsModal";
import TournamentView, {
  normalizeTournamentFormat,
  buildBlankKnockoutMatches,
} from "@/components/TournamentView";
import { swapTeams, updateMatchParticipants } from "@/app/actions/bracket";
import { isThirdPlaceMatch } from "@/utils/bracketTree";

interface BracketViewerProps {
  tournamentId?: string;
  showPublicHeader?: boolean;
  onBack?: () => void;
  canManage?: boolean;
  onRegenerateBracket?: () => void;
  isRegenerating?: boolean;
}

const SPORT_LABELS: Record<SportType, string> = {
  DOMINO: "Dominó em Duplas",
  PING_PONG: "Ping Pong",
  FUTSAL: "Futsal",
  VOLEI: "Vôlei",
};

export type DbMatchRow = Match;

/**
 * Função utilitária que realiza o fetch das partidas do torneio garantindo
 * que todas as colunas JSONB de histórico de sets (sets_history, set_history, history, details)
 * sejam incluídas e devidamente processadas.
 */
export async function getTournamentMatches(tournamentId: string): Promise<Match[]> {
  const { data, error } = await supabase
    .from("matches")
    .select("*, detailed_score, details")
    .eq("tournament_id", tournamentId);

  if (error) {
    console.error("Erro ao carregar partidas no getTournamentMatches:", error);
    throw error;
  }

  return (data || []).map((dbM: any) => {
    // Lista de candidatos em ordem de prioridade
    const candidates: any[] = [
      dbM.detailed_score?.sets,
      dbM.detailed_score?.historicoSets,
      dbM.detailed_score?.rounds,
      dbM.detailed_score,
      dbM.details?.sets,
      dbM.details?.historicoSets,
      dbM.details?.rounds,
      dbM.historicoSets,
      dbM.historico_sets,
      dbM.sets_history,
      dbM.set_history,
      dbM.history,
      dbM.details?.set_history,
      dbM.details?.sets_history,
    ];

    // Se details for string JSON, tenta extrair os sets/rounds
    if (typeof dbM.details === "string") {
      try {
        const pd = JSON.parse(dbM.details);
        if (Array.isArray(pd)) candidates.push(pd);
        if (Array.isArray(pd?.rounds)) candidates.push(pd.rounds);
        if (Array.isArray(pd?.sets)) candidates.push(pd.sets);
        if (Array.isArray(pd?.set_history)) candidates.push(pd.set_history);
      } catch {}
    }

    // Se detailed_score for string JSON, tenta extrair os sets/rounds
    if (typeof dbM.detailed_score === "string") {
      try {
        const pds = JSON.parse(dbM.detailed_score);
        if (Array.isArray(pds)) candidates.push(pds);
        if (Array.isArray(pds?.rounds)) candidates.push(pds.rounds);
        if (Array.isArray(pds?.sets)) candidates.push(pds.sets);
      } catch {}
    }

    // Procura o primeiro candidato que seja um array com dados reais (length > 0)
    let foundSets: any[] | null = null;
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
        foundSets = val;
        break;
      }
    }

    // Preserva o objeto completo vindo do Supabase sem filtrar props
    return {
      ...dbM,
      detailed_score: dbM.detailed_score,
      detailedScore: dbM.detailed_score || dbM.detailedScore || { rounds: [] },
      // Se encontrou sets não-vazios, replica nas propriedades para máxima compatibilidade
      ...(foundSets && foundSets.length > 0
        ? {
            sets_history: foundSets,
            set_history: foundSets,
            history: foundSets,
            historicoSets: foundSets,
          }
        : {}),
    } as Match;
  });
}

export default function BracketViewer({
  tournamentId: propTournamentId,
  showPublicHeader = true,
  onBack,
  canManage = false,
  onRegenerateBracket,
  isRegenerating = false,
}: BracketViewerProps) {
  const router = useRouter();
  const context = useTournament();

  const effectiveTournamentId = propTournamentId || context.currentTournamentId || "";

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const teamsRef = useRef<Team[]>(teams);
  useEffect(() => {
    teamsRef.current = teams;
  }, [teams]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isBackgroundFetching, setIsBackgroundFetching] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedDetailMatch, setSelectedDetailMatch] = useState<Match | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const getMatchDetailData = useCallback(
    (match: Match) => {
      let setHistory: any =
        match.detailed_score?.sets ||
        match.detailed_score?.rounds ||
        (Array.isArray(match.detailed_score) ? match.detailed_score : null) ||
        match.sets_history ||
        match.set_history ||
        match.history ||
        match.details?.sets ||
        match.details?.rounds ||
        match.details?.set_history ||
        match.details?.sets_history ||
        match.historicoSets ||
        null;

      if (typeof setHistory === "string") {
        try {
          setHistory = JSON.parse(setHistory);
        } catch {
          setHistory = null;
        }
      }

      let rounds =
        match.detailed_score?.rounds ||
        (match.details as any)?.rounds ||
        (match as any).rounds ||
        match.detailedScore?.rounds ||
        null;
      let penA = match.penalties_a ?? match.penaltiesA ?? null;
      let penB = match.penalties_b ?? match.penaltiesB ?? null;

      const team1Id = match.team1_id || match.team_a_id || match.teamA?.id;
      const team2Id = match.team2_id || match.team_b_id || match.teamB?.id;

      const ctxMatch = context.matches.find(
        (cm) =>
          cm.id === match.id ||
          (team1Id &&
            team2Id &&
            ((cm.teamA?.id === team1Id && cm.teamB?.id === team2Id) ||
              (cm.teamA?.id === team2Id && cm.teamB?.id === team1Id) ||
              (cm.team1_id === team1Id && cm.team2_id === team2Id)))
      );

      if (ctxMatch) {
        const liveSets = ctxMatch.sets_history || ctxMatch.historicoSets;
        if ((!setHistory || setHistory.length === 0) && liveSets && liveSets.length > 0) {
          setHistory = liveSets;
        }
        if ((!rounds || rounds.length === 0) && ctxMatch.detailedScore?.rounds && ctxMatch.detailedScore.rounds.length > 0) {
          rounds = ctxMatch.detailedScore.rounds;
        }
        if (penA === null && ctxMatch.penaltiesA !== undefined) penA = ctxMatch.penaltiesA;
        if (penB === null && ctxMatch.penaltiesB !== undefined) penB = ctxMatch.penaltiesB;
      }

      if (typeof window !== "undefined" && (!setHistory || setHistory.length === 0)) {
        try {
          const localJson = localStorage.getItem("sc_matches");
          if (localJson) {
            const parsed = JSON.parse(localJson);
            const lm = parsed.find(
              (p: any) =>
                p.id === match.id ||
                (team1Id &&
                  team2Id &&
                  ((p.teamA?.id === team1Id && p.teamB?.id === team2Id) ||
                    (p.teamA?.id === team2Id && p.teamB?.id === team1Id) ||
                    (p.team1_id === team1Id && p.team2_id === team2Id)))
            );
            if (lm) {
              const localSets = lm.sets_history || lm.historicoSets || lm.set_history;
              if (localSets && (!setHistory || setHistory.length === 0)) setHistory = localSets;
              if ((!rounds || rounds.length === 0) && lm.detailedScore?.rounds) rounds = lm.detailedScore.rounds;
              if (penA === null && lm.penaltiesA !== undefined) penA = lm.penaltiesA;
              if (penB === null && lm.penaltiesB !== undefined) penB = lm.penaltiesB;
            }
          }
        } catch {
          // ignore
        }
      }

      return { setHistory, rounds, penA, penB };
    },
    [context.matches]
  );

  const fetchData = useCallback(
    async (isSilent = false) => {
      if (!effectiveTournamentId) {
        setInitialLoading(false);
        return;
      }

      try {
        if (!isSilent) {
          setInitialLoading(true);
        } else {
          setIsBackgroundFetching(true);
        }
        setErrorMessage("");

        // 1. Torneio
        const { data: tourData, error: tourError } = await supabase
          .from("tournaments")
          .select("*")
          .eq("id", effectiveTournamentId)
          .maybeSingle();

        if (tourError) throw tourError;

        if (tourData) {
          setTournament({
            id: tourData.id,
            name: tourData.name,
            status: tourData.status as "ATIVO" | "FINALIZADO",
            createdAt: tourData.created_at,
            sport_type: (tourData.sport_type as SportType) || "DOMINO",
            owner_id: tourData.owner_id,
            max_teams: tourData.max_teams ? Number(tourData.max_teams) : undefined,
            entry_fee: tourData.entry_fee ? Number(tourData.entry_fee) : undefined,
            location: tourData.location,
            start_date: tourData.start_date,
            start_time: tourData.start_time,
            end_date: tourData.end_date,
            rules: tourData.rules,
            format: tourData.format,
            tournament_format: tourData.tournament_format,
            match_rules: tourData.match_rules,
            cover_url: tourData.cover_url,
            sponsors: tourData.sponsors || [],
          });
        }

        // 2. Equipes inscritas
        const { data: teamsData, error: teamsError } = await supabase
          .from("teams")
          .select("*")
          .eq("tournament_id", effectiveTournamentId);

        if (teamsError) throw teamsError;

        const mappedTeams: Team[] = (teamsData || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          players: [t.player1 || "Jogador 1", t.player2 || "Jogador 2"],
          createdAt: t.created_at || new Date().toISOString(),
          status: t.status,
          tournamentId: t.tournament_id,
          payment_status: t.payment_status,
          cancellation_status: t.cancellation_status,
          group_name: t.group_name,
          declared_skill_level: t.declared_skill_level,
          user_id: t.user_id,
        }));
        setTeams(mappedTeams);

        // 3. Partidas do torneio via getTournamentMatches com processamento de sets_history
        const dbMatches = await getTournamentMatches(effectiveTournamentId);

        // Mescla com context.matches para garantir que qualquer set atualizado na Súmula Digital
        // seja exibido no chaveamento imediatamente e que os times sejam devidamente associados
        const enrichedMatches = dbMatches.map((m) => {
          const team1Id = m.team1_id || m.team_a_id || m.teamA?.id;
          const team2Id = m.team2_id || m.team_b_id || m.teamB?.id;

          const resolvedTeamA =
            mappedTeams.find((t) => t.id === team1Id) ||
            (team1Id === "bye" ? { id: "bye", name: "Avanço Direto", players: [], createdAt: "" } : m.teamA);
          const resolvedTeamB =
            mappedTeams.find((t) => t.id === team2Id) ||
            (team2Id === "bye" ? { id: "bye", name: "Avanço Direto", players: [], createdAt: "" } : m.teamB);

          const ctxMatch = context.matches.find(
            (cm) =>
              cm.id === m.id ||
              (team1Id &&
                team2Id &&
                ((cm.teamA?.id === team1Id && cm.teamB?.id === team2Id) ||
                  (cm.teamA?.id === team2Id && cm.teamB?.id === team1Id) ||
                  (cm.team1_id === team1Id && cm.team2_id === team2Id)))
          );

          let updatedMatch = {
            ...m,
            teamA: resolvedTeamA,
            teamB: resolvedTeamB,
            team1_id: team1Id,
            team2_id: team2Id,
            team_a_id: team1Id,
            team_b_id: team2Id,
          };

          if (ctxMatch) {
            const ctxSets = ctxMatch.sets_history || ctxMatch.historicoSets;
            if (
              ctxSets &&
              (!m.sets_history ||
                (Array.isArray(m.sets_history) && m.sets_history.length === 0))
            ) {
              let parsed = ctxSets;
              if (typeof parsed === "string") {
                try {
                  parsed = JSON.parse(parsed);
                } catch {}
              }
              updatedMatch = {
                ...updatedMatch,
                sets_history: parsed,
                set_history: parsed,
                history: parsed,
                historicoSets: Array.isArray(parsed) ? parsed : [],
              };
            }
          }
          return updatedMatch;
        });

        setMatches(enrichedMatches);
      } catch (err: any) {
        console.error("Erro ao carregar chaveamento no BracketViewer:", err);
        if (!isSilent) {
          setErrorMessage(err.message || "Erro ao carregar dados do chaveamento.");
        }
      } finally {
        setInitialLoading(false);
        setIsBackgroundFetching(false);
        setIsRefreshing(false);
      }
    },
    [effectiveTournamentId, context.matches]
  );

  // Initial Load (executa apenas uma vez por torneio)
  useEffect(() => {
    fetchData(false);
  }, [effectiveTournamentId]);

  // Listener em Tempo Real (Supabase Realtime): escuta alterações em matches
  // com mutação otimista de estado local sem recarregamento ou spinner de página inteira
  useEffect(() => {
    if (!effectiveTournamentId) return;

    const channel = supabase
      .channel(`bracket-viewer-matches-${effectiveTournamentId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matches",
          filter: `tournament_id=eq.${effectiveTournamentId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          if (!updated || !updated.id) return;

          // Mutação atômica no array local de partidas com fusão profunda e substituição por índice estrito
          setMatches((prevMatches) => {
            const index = prevMatches.findIndex((m) => {
              const matchUuid = (m as any).uuid || (m as any).db_id;
              return (
                m.id === updated.id ||
                matchUuid === updated.id
              );
            });

            if (index === -1) {
              return prevMatches;
            }

            const m = prevMatches[index];
            const incomingSets =
              updated.detailed_score?.sets ||
              updated.detailed_score?.historicoSets ||
              updated.detailed_score?.rounds ||
              (typeof updated.detailed_score === "string"
                ? (() => {
                    try {
                      const parsed = JSON.parse(updated.detailed_score);
                      return parsed?.sets || parsed?.historicoSets || parsed?.rounds || (Array.isArray(parsed) ? parsed : null);
                    } catch {
                      return null;
                    }
                  })()
                : null) ||
              updated.details?.sets ||
              (typeof updated.details === "string"
                ? (() => {
                    try {
                      return JSON.parse(updated.details)?.sets;
                    } catch {
                      return null;
                    }
                  })()
                : null) ||
              updated.sets_history ||
              updated.set_history ||
              updated.historicoSets ||
              m.sets_history;

            const newTeamAId = updated.team_a_id ?? updated.team1_id ?? m.team_a_id ?? m.team1_id;
            const newTeamBId = updated.team_b_id ?? updated.team2_id ?? m.team_b_id ?? m.team2_id;

            const currentTeams = teamsRef.current || [];
            const resolvedTeamA =
              currentTeams.find((t) => t.id === newTeamAId) ||
              (newTeamAId === "bye" ? { id: "bye", name: "Avanço Direto", players: [], createdAt: "" } : m.teamA);
            const resolvedTeamB =
              currentTeams.find((t) => t.id === newTeamBId) ||
              (newTeamBId === "bye" ? { id: "bye", name: "Avanço Direto", players: [], createdAt: "" } : m.teamB);

            const newStatus = updated.status ? String(updated.status).toUpperCase().trim() : m.status;
            const newScoreA = updated.score_a !== undefined && updated.score_a !== null ? Number(updated.score_a) : (updated.scoreA !== undefined ? Number(updated.scoreA) : m.score_a);
            const newScoreB = updated.score_b !== undefined && updated.score_b !== null ? Number(updated.score_b) : (updated.scoreB !== undefined ? Number(updated.scoreB) : m.score_b);
            const newSetsA = updated.sets_a !== undefined && updated.sets_a !== null ? Number(updated.sets_a) : (updated.setsA !== undefined ? Number(updated.setsA) : m.sets_a);
            const newSetsB = updated.sets_b !== undefined && updated.sets_b !== null ? Number(updated.sets_b) : (updated.setsB !== undefined ? Number(updated.setsB) : m.sets_b);

            const updatedMatch: Match = {
              ...m,
              ...updated,
              id: m.id,
              uuid: updated.id || (m as any).uuid,
              db_id: updated.id || (m as any).db_id,
              teamA: resolvedTeamA,
              teamB: resolvedTeamB,
              score_a: newScoreA,
              score_b: newScoreB,
              scoreA: newScoreA,
              scoreB: newScoreB,
              sets_a: newSetsA,
              sets_b: newSetsB,
              setsA: newSetsA,
              setsB: newSetsB,
              penalties_a: updated.penalties_a ?? m.penalties_a,
              penalties_b: updated.penalties_b ?? m.penalties_b,
              status: newStatus,
              winner_id: updated.winner_id ?? updated.winnerId ?? m.winner_id,
              winnerId: updated.winner_id ?? updated.winnerId ?? m.winnerId,
              details: updated.details ?? m.details,
              detailed_score: updated.detailed_score !== undefined ? updated.detailed_score : m.detailed_score,
              detailedScore: updated.detailed_score !== undefined ? updated.detailed_score : (m.detailedScore ?? m.detailed_score),
              sets_history: incomingSets,
              set_history: incomingSets,
              history: incomingSets,
              historicoSets: Array.isArray(incomingSets) ? incomingSets : m.historicoSets,
              team1_id: newTeamAId,
              team2_id: newTeamBId,
              team_a_id: newTeamAId,
              team_b_id: newTeamBId,
            };

            const copy = [...prevMatches];
            copy[index] = updatedMatch;
            return deduplicateMatches(copy);
          });

          // Silent background refetch para conciliar dados relacionais sem travar a interface
          fetchData(true);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "matches",
          filter: `tournament_id=eq.${effectiveTournamentId}`,
        },
        () => {
          fetchData(true);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "matches",
          filter: `tournament_id=eq.${effectiveTournamentId}`,
        },
        (payload) => {
          const deletedId = (payload.old as any)?.id;
          if (deletedId) {
            setMatches((prev) => prev.filter((m) => m.id !== deletedId));
          }
          fetchData(true);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tournaments",
          filter: `id=eq.${effectiveTournamentId}`,
        },
        (payload) => {
          const updatedTour = payload.new as any;
          if (updatedTour) {
            setTournament((prev) =>
              prev
                ? {
                    ...prev,
                    status: updatedTour.status as "ATIVO" | "FINALIZADO",
                    end_date: updatedTour.end_date,
                  }
                : null
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [effectiveTournamentId, fetchData]);

  // Sincronização Otimista com context.matches (sem disparar recarregamento ou spinner)
  useEffect(() => {
    if (!context.matches || context.matches.length === 0) return;
    setMatches((prevMatches) => {
      if (!prevMatches || prevMatches.length === 0) return prevMatches;
      let hasChanges = false;
      const updatedList = prevMatches.map((m) => {
        const team1Id = m.team1_id || m.team_a_id || m.teamA?.id;
        const team2Id = m.team2_id || m.team_b_id || m.teamB?.id;
        const ctxMatch = context.matches.find(
          (cm) =>
            cm.id === m.id ||
            (team1Id &&
              team2Id &&
              ((cm.teamA?.id === team1Id && cm.teamB?.id === team2Id) ||
                (cm.teamA?.id === team2Id && cm.teamB?.id === team1Id) ||
                (cm.team1_id === team1Id && cm.team2_id === team2Id)))
        );
        if (!ctxMatch) return m;

        const newScoreA = ctxMatch.scoreA ?? ctxMatch.score_a ?? m.score_a;
        const newScoreB = ctxMatch.scoreB ?? ctxMatch.score_b ?? m.score_b;
        const newSetsA = ctxMatch.setsA ?? ctxMatch.sets_a ?? m.sets_a;
        const newSetsB = ctxMatch.setsB ?? ctxMatch.sets_b ?? m.sets_b;
        const newStatus = ctxMatch.status ?? m.status;
        const newSetsHist =
          ctxMatch.sets_history ||
          ctxMatch.historicoSets ||
          ctxMatch.set_history ||
          m.sets_history;

        const newTeamAId = ctxMatch.team_a_id ?? ctxMatch.team1_id ?? ctxMatch.teamA?.id ?? m.team_a_id;
        const newTeamBId = ctxMatch.team_b_id ?? ctxMatch.team2_id ?? ctxMatch.teamB?.id ?? m.team_b_id;
        const newTeamA = ctxMatch.teamA || (newTeamAId ? teamsRef.current?.find((t) => t.id === newTeamAId) : null) || m.teamA;
        const newTeamB = ctxMatch.teamB || (newTeamBId ? teamsRef.current?.find((t) => t.id === newTeamBId) : null) || m.teamB;

        if (
          m.score_a !== newScoreA ||
          m.score_b !== newScoreB ||
          m.sets_a !== newSetsA ||
          m.sets_b !== newSetsB ||
          m.status !== newStatus ||
          m.sets_history !== newSetsHist ||
          m.team_a_id !== newTeamAId ||
          m.team_b_id !== newTeamBId ||
          m.teamA?.name !== newTeamA?.name ||
          m.teamB?.name !== newTeamB?.name
        ) {
          hasChanges = true;
          return {
            ...m,
            teamA: newTeamA,
            teamB: newTeamB,
            team_a_id: newTeamAId,
            team_b_id: newTeamBId,
            team1_id: newTeamAId,
            team2_id: newTeamBId,
            score_a: newScoreA,
            score_b: newScoreB,
            scoreA: newScoreA,
            scoreB: newScoreB,
            sets_a: newSetsA,
            sets_b: newSetsB,
            setsA: newSetsA,
            setsB: newSetsB,
            status: newStatus,
            sets_history: newSetsHist,
            set_history: newSetsHist,
            history: newSetsHist,
            historicoSets: Array.isArray(newSetsHist) ? newSetsHist : m.historicoSets,
          };
        }
        return m;
      });
      return hasChanges ? updatedList : prevMatches;
    });
  }, [context.matches]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchData(true);
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (effectiveTournamentId) {
      router.push(`/torneio/${effectiveTournamentId}`);
    } else {
      router.push("/explorar");
    }
  };

  // Verifica se alguma partida do torneio foi iniciada ou disputada
  const hasStartedMatches = useMemo(() => {
    if (!matches || matches.length === 0) return false;
    return matches.some((m: any) => {
      const status = String(m.status || "").toUpperCase();
      const isLive = status === "LIVE" || status === "IN_PROGRESS" || status === "PLAYING";
      const hasBothTeams =
        Boolean(m.team1_id || m.team_a_id || m.teamA?.id) &&
        Boolean(m.team2_id || m.team_b_id || m.teamB?.id);
      const isCompleted = (status === "COMPLETED" || status === "FINISHED" || status === "ENCERRADA" || status === "FINALIZADO") && hasBothTeams;
      return isLive || isCompleted;
    });
  }, [matches]);

  const canEditBracket = Boolean(canManage && !hasStartedMatches && matches.length > 0);
  const canRegenerate = Boolean(canManage && !hasStartedMatches && matches.length > 0 && onRegenerateBracket);

  const handleSwapTeams = async (
    srcMatchId: string,
    srcSlot: "team1" | "team2" | "A" | "B",
    destMatchId: string,
    destSlot: "team1" | "team2" | "A" | "B"
  ) => {
    if (!effectiveTournamentId || isSavingEdit) return;
    setIsSavingEdit(true);

    const isSlot1 = (s: string) => s === "team1" || s === "A";

    // Encontra as partidas e os IDs de equipe correspondentes (suportando null)
    const srcMatch = matches.find((m) => m.id === srcMatchId);
    const destMatch = matches.find((m) => m.id === destMatchId);

    const srcTeamId = srcMatch
      ? (isSlot1(srcSlot)
          ? (srcMatch.team1_id || srcMatch.team_a_id || srcMatch.teamA?.id || null)
          : (srcMatch.team2_id || srcMatch.team_b_id || srcMatch.teamB?.id || null))
      : null;

    const destTeamId = destMatch
      ? (isSlot1(destSlot)
          ? (destMatch.team1_id || destMatch.team_a_id || destMatch.teamA?.id || null)
          : (destMatch.team2_id || destMatch.team_b_id || destMatch.teamB?.id || null))
      : null;

    // 1. Atualização Otimista Imediata no Estado Local (UI responsiva com zero delay)
    setMatches((prev) =>
      prev.map((m) => {
        if (m.id === srcMatchId && m.id === destMatchId) {
          // Inversão na mesma partida
          const newT1 = isSlot1(srcSlot) ? destTeamId : srcTeamId;
          const newT2 = isSlot1(srcSlot) ? srcTeamId : destTeamId;
          return {
            ...m,
            team1_id: newT1,
            team_a_id: newT1,
            team2_id: newT2,
            team_b_id: newT2,
          };
        }
        if (m.id === srcMatchId) {
          const currentT1 = m.team1_id || m.team_a_id || null;
          const currentT2 = m.team2_id || m.team_b_id || null;
          return {
            ...m,
            team1_id: isSlot1(srcSlot) ? destTeamId : currentT1,
            team_a_id: isSlot1(srcSlot) ? destTeamId : currentT1,
            team2_id: !isSlot1(srcSlot) ? destTeamId : currentT2,
            team_b_id: !isSlot1(srcSlot) ? destTeamId : currentT2,
          };
        }
        if (m.id === destMatchId) {
          const currentT1 = m.team1_id || m.team_a_id || null;
          const currentT2 = m.team2_id || m.team_b_id || null;
          return {
            ...m,
            team1_id: isSlot1(destSlot) ? srcTeamId : currentT1,
            team_a_id: isSlot1(destSlot) ? srcTeamId : currentT1,
            team2_id: !isSlot1(destSlot) ? srcTeamId : currentT2,
            team_b_id: !isSlot1(destSlot) ? srcTeamId : currentT2,
          };
        }
        return m;
      })
    );

    try {
      const { data: authData } = await supabase.auth.getSession();
      const token = authData.session?.access_token;
      const res = await swapTeams({
        tournamentId: effectiveTournamentId,
        match1Id: srcMatchId,
        slot1: srcSlot,
        team1Id: srcTeamId,
        match2Id: destMatchId,
        slot2: destSlot,
        team2Id: destTeamId,
        targetTeamId: destTeamId,
        userAuthToken: token,
      });

      if (!res.success) {
        alert(res.error || "Erro ao trocar equipes de posição.");
        await fetchData();
        return;
      }

      await fetchData();
      try {
        router.refresh();
      } catch {}
    } catch (err: unknown) {
      console.error("Erro ao trocar equipes:", err);
      const msg = err instanceof Error ? err.message : "Erro ao trocar equipes de posição.";
      alert(msg);
      await fetchData();
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleReplaceTeam = async (
    matchId: string,
    slot: "team1" | "team2" | "A" | "B",
    newTeamId: string | null
  ) => {
    if (!effectiveTournamentId || isSavingEdit) return;

    setIsSavingEdit(true);
    try {
      const { data: authData } = await supabase.auth.getSession();
      const token = authData.session?.access_token;

      // Se a equipe selecionada já estiver alocada em outra partida da 1ª rodada, executa um SWAP
      if (newTeamId) {
        const otherMatch = matches.find(
          (m) =>
            m.id !== matchId &&
            (m.round === 1 || !m.round) &&
            ((m.team1_id === newTeamId || m.team_a_id === newTeamId || m.teamA?.id === newTeamId) ||
              (m.team2_id === newTeamId || m.team_b_id === newTeamId || m.teamB?.id === newTeamId))
        );

        if (otherMatch) {
          const otherSlot =
            (otherMatch.team1_id === newTeamId ||
              otherMatch.team_a_id === newTeamId ||
              otherMatch.teamA?.id === newTeamId)
              ? "team1"
              : "team2";

          const res = await swapTeams({
            tournamentId: effectiveTournamentId,
            match1Id: otherMatch.id,
            slot1: otherSlot,
            team1Id: newTeamId,
            match2Id: matchId,
            slot2: slot,
            userAuthToken: token,
          });

          if (!res.success) {
            alert(res.error || "Erro ao trocar equipes de posição.");
            return;
          }
          await fetchData();
          try {
            router.refresh();
          } catch {}
          return;
        }
      }

      // Caso contrário (equipe não alocada ou seleção de BYE / null), atualiza o confronto diretamente
      const match = matches.find((m) => m.id === matchId);
      if (!match) return;

      const currentT1 = match.team1_id || match.team_a_id || match.teamA?.id || null;
      const currentT2 = match.team2_id || match.team_b_id || match.teamB?.id || null;

      const updatedT1 = slot === "team1" || slot === "A" ? newTeamId : currentT1;
      const updatedT2 = slot === "team2" || slot === "B" ? newTeamId : currentT2;

      const res = await updateMatchParticipants({
        tournamentId: effectiveTournamentId,
        matchId,
        team1Id: updatedT1,
        team2Id: updatedT2,
        userAuthToken: token,
      });

      if (!res.success) {
        alert(res.error || "Erro ao atualizar confronto.");
        return;
      }
      await fetchData();
      try {
        router.refresh();
      } catch {}
    } catch (err: unknown) {
      console.error("Erro ao atualizar confronto:", err);
      const msg = err instanceof Error ? err.message : "Erro ao atualizar confronto.";
      alert(msg);
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Mapa de equipes para consulta O(1)
  const teamsMap = useMemo(() => {
    const map = new Map<string, Team>();
    teams.forEach((t) => map.set(t.id, t));
    return map;
  }, [teams]);

  const activeMatchesCount = matches.filter((m) => m.status === "LIVE").length;

  const sportLabel = tournament?.sport_type
    ? SPORT_LABELS[tournament.sport_type] || "Torneio Esportivo"
    : "Torneio Esportivo";

  const resolvedFormat = useMemo(() => {
    return normalizeTournamentFormat(tournament);
  }, [tournament]);

  const formatHeaderLabel = useMemo(() => {
    if (resolvedFormat === "LEAGUE") return "Tabela de Pontos Corridos";
    if (resolvedFormat === "GROUPS") return "Fase de Grupos + Eliminatórias";
    return "Chaveamento Oficial Mata-Mata";
  }, [resolvedFormat]);

  // Detecção de Conclusão e Pódio Oficial do Torneio
  const podiumData = useMemo(() => {
    // Busca a Grande Final
    const finalCandidate = matches.find((m) => {
      const ph = String(m.phase || "").toLowerCase().trim();
      let d: any = m.details;
      if (typeof d === "string") {
        try { d = JSON.parse(d); } catch (_) { d = {}; }
      }
      const rl = String(d?.round_label || "").toLowerCase().trim();
      const mt = String(d?.match_title || "").toLowerCase().trim();
      const full = `${ph} ${rl} ${mt}`;
      return (
        (full.includes("final") || !m.next_match_id) &&
        !full.includes("semi") &&
        !full.includes("quarta") &&
        !full.includes("oitava") &&
        !full.includes("third") &&
        !full.includes("terceiro") &&
        !full.includes("3")
      );
    });

    if (!finalCandidate) return null;

    const finalStatus = String(finalCandidate.status || "").toUpperCase().trim();
    const isFinalDone = finalStatus === "COMPLETED" || finalStatus === "FINISHED" || finalStatus === "FINALIZADO";
    const winnerId = finalCandidate.winnerId || (finalCandidate as any).winner_id;

    if (!isFinalDone || !winnerId) return null;

    const champ = winnerId === finalCandidate.teamA?.id ? finalCandidate.teamA : (winnerId === finalCandidate.teamB?.id ? finalCandidate.teamB : null);
    const runnerUp = winnerId === finalCandidate.teamA?.id ? finalCandidate.teamB : (winnerId === finalCandidate.teamB?.id ? finalCandidate.teamA : null);

    // 3º Lugar
    const thirdMatch = matches.find((m) => {
      const ph = String(m.phase || "").toLowerCase().trim();
      let d: any = m.details;
      if (typeof d === "string") {
        try { d = JSON.parse(d); } catch (_) { d = {}; }
      }
      const rl = String(d?.round_label || "").toLowerCase().trim();
      const mt = String(d?.match_title || "").toLowerCase().trim();
      const full = `${ph} ${rl} ${mt}`;
      return full.includes("third") || full.includes("terceiro") || full.includes("3º") || full.includes("3o");
    });

    let thirdPlaceTeam = null;
    if (thirdMatch) {
      const thirdStatus = String(thirdMatch.status || "").toUpperCase().trim();
      const isThirdDone = thirdStatus === "COMPLETED" || thirdStatus === "FINISHED" || thirdStatus === "FINALIZADO";
      const thirdWinnerId = thirdMatch.winnerId || (thirdMatch as any).winner_id;
      if (isThirdDone && thirdWinnerId) {
        thirdPlaceTeam = thirdWinnerId === thirdMatch.teamA?.id ? thirdMatch.teamA : (thirdWinnerId === thirdMatch.teamB?.id ? thirdMatch.teamB : null);
      }
    }

    const isTourneyDone =
      tournament?.status === "FINALIZADO" ||
      tournament?.status === "COMPLETED" ||
      tournament?.status === "FINISHED";

    return {
      champion: champ,
      runnerUp,
      thirdPlace: thirdPlaceTeam,
      isFinished: isTourneyDone,
    };
  }, [matches, tournament]);

  const isTournamentEnded = useMemo(() => {
    const st = String(tournament?.status || "").toUpperCase().trim();
    return st === "FINALIZADO" || st === "COMPLETED" || st === "FINISHED";
  }, [tournament?.status]);

  return (
    <div className="min-h-screen bg-canvas text-primary print:bg-white print:text-black print:min-h-0 flex flex-col justify-between selection:bg-[#00a2ff]/30 selection:text-white">
      <div>
        {showPublicHeader && (
          <div className="print:hidden">
            <PublicHeader activePage="chaveamento" />
          </div>
        )}

        <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 print:max-w-none print:w-full print:p-0 print:space-y-4">
          {/* 1. Barra de Navegação & Ações */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-subtle pb-4 print:hidden">
            <button
              onClick={handleBack}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface hover:bg-surface-elevated border border-subtle text-xs font-bold text-secondary hover:text-primary transition-all cursor-pointer shadow-sm active:scale-95"
            >
              <ArrowLeft className="h-4 w-4 text-[#00a2ff]" />
              <span>Voltar ao Torneio</span>
            </button>

            <div className="flex flex-wrap items-center gap-3">
              {/* Botão de Impressão / Exportação do Chaveamento */}
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-surface hover:bg-surface-elevated border border-subtle hover:border-[#00a2ff]/40 text-xs font-bold text-secondary hover:text-primary transition-all cursor-pointer shadow-sm active:scale-95"
                title="Imprimir ou baixar árvore do chaveamento em PDF"
              >
                <Printer className="h-3.5 w-3.5 text-[#00a2ff]" />
                <span>🖨️ Imprimir / Baixar Chaveamento</span>
              </button>

              {/* Botão de Edição Manual do Chaveamento */}
              {canEditBracket && (
                <button
                  type="button"
                  onClick={() => setIsEditMode(!isEditMode)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                    isEditMode
                      ? "bg-amber-500/20 border-amber-500/50 text-amber-500 dark:text-amber-300 shadow-lg shadow-amber-500/10"
                      : "bg-surface hover:bg-surface-elevated border-subtle text-secondary hover:text-primary"
                  }`}
                  title={
                    isEditMode
                      ? "Sair do modo de edição manual"
                      : "Editar manualmente equipes e confrontos da 1ª rodada"
                  }
                >
                  <Settings
                    className={`h-3.5 w-3.5 ${
                      isEditMode ? "animate-spin text-amber-500 dark:text-amber-400" : "text-zinc-400"
                    }`}
                  />
                  <span>{isEditMode ? "Concluir Edição" : "Editar Chaveamento"}</span>
                </button>
              )}

              {/* Botão de Regeneração Direta */}
              {canRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerateBracket}
                  disabled={isRegenerating}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-600 dark:text-blue-300 hover:text-blue-700 dark:hover:text-white text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                  title="Regenerar o chaveamento do zero com as equipes confirmadas"
                >
                  {isRegenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00a2ff]" />
                  ) : (
                    <Network className="h-3.5 w-3.5 text-[#00a2ff]" />
                  )}
                  <span className="hidden sm:inline">Regenerar Chave</span>
                </button>
              )}

              {isSavingEdit && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-300 text-xs font-medium">
                  <Loader2 className="h-3 w-3 animate-spin text-amber-500 dark:text-amber-400" />
                  <span>Salvando alteração...</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface hover:bg-surface-elevated border border-subtle text-xs font-bold text-secondary hover:text-primary transition-all cursor-pointer"
                title="Recarregar chaveamento e placares"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    isRefreshing ? "animate-spin text-[#00a2ff]" : "text-zinc-400"
                  }`}
                />
                <span className="hidden sm:inline">Atualizar Placares</span>
              </button>

              {activeMatchesCount > 0 && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 text-xs font-bold">
                  <span className="w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400 animate-pulse" />
                  <span>{activeMatchesCount} Partida(s) Ao Vivo</span>
                </div>
              )}

              {isBackgroundFetching && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/25 text-blue-600 dark:text-blue-400 text-xs font-medium animate-pulse print:hidden">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 animate-ping" />
                  <span className="hidden sm:inline">Sincronizando placar...</span>
                </div>
              )}
            </div>
          </div>

          {/* 2. Cabeçalho Informativo do Torneio */}
          {tournament && (
            <div className="bg-surface border border-subtle print:bg-white print:text-black print:border-neutral-300 print:shadow-none rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#00a2ff] via-indigo-500 to-purple-500 print:hidden" />
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md bg-[#00a2ff]/10 text-[#00a2ff] print:bg-transparent print:text-black print:border-neutral-400 text-[10px] font-black uppercase tracking-wider border border-[#00a2ff]/20">
                      {sportLabel}
                    </span>
                    <span className="text-muted text-xs">•</span>
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 print:text-black flex items-center gap-1">
                      <Trophy className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 print:text-black" />
                      <span>{formatHeaderLabel}</span>
                    </span>
                    <span className="text-muted text-xs">•</span>
                    {isTournamentEnded ? (
                      <span className="px-2.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[10px] font-black uppercase tracking-wider border border-zinc-300 dark:border-zinc-700 flex items-center gap-1.5 shadow-sm">
                        <CheckCircle className="h-3 w-3 text-emerald-500 dark:text-emerald-400" />
                        <span>Torneio Finalizado</span>
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-wider border border-emerald-500/20 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                        <span>Em Andamento</span>
                      </span>
                    )}
                  </div>

                  <h1 className="text-xl sm:text-3xl font-black text-primary print:text-black font-display tracking-tight">
                    {tournament.name}
                  </h1>

                  {tournament.location && (
                    <p className="text-xs text-secondary print:text-neutral-700 flex items-center gap-1.5 pt-0.5">
                      <MapPin className="h-3.5 w-3.5 text-[#00a2ff] print:text-black" />
                      <span>{tournament.location}</span>
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 self-start sm:self-center print:hidden">
                  <Link
                    href={`/torneio/${tournament.id}`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-300 dark:border-zinc-700/60 text-xs font-bold text-zinc-700 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white transition-all cursor-pointer shadow-sm"
                  >
                    <span>Ver Inscrições</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Pódio Oficial do Torneio Encerrado */}
          {isTournamentEnded && podiumData?.champion && (
            <div className="bg-gradient-to-r from-amber-500/10 via-yellow-500/15 to-amber-500/10 border-2 border-amber-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden backdrop-blur-md print:bg-white print:text-black print:border-neutral-400">
              <div className="absolute top-0 right-0 transform translate-x-8 -translate-y-8 w-40 h-40 bg-amber-400/10 rounded-full blur-2xl pointer-events-none print:hidden" />
              <div className="absolute bottom-0 left-0 transform -translate-x-8 translate-y-8 w-40 h-40 bg-yellow-400/10 rounded-full blur-2xl pointer-events-none print:hidden" />

              <div className="flex flex-col items-center text-center space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-600 dark:text-amber-300 text-xs font-black tracking-widest uppercase print:border-neutral-400 print:text-black">
                  <Trophy className="h-4 w-4 text-amber-500 dark:text-amber-400 print:text-black" />
                  <span>PÓDIO OFICIAL DO TORNEIO</span>
                </div>

                <h2 className="text-2xl sm:text-3xl font-black text-zinc-900 dark:text-white print:text-black tracking-tight font-display">
                  🏆 Campeões de {tournament?.name}
                </h2>

                {/* Grid com os 3 degraus do pódio */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-3xl pt-2 items-end">
                  {/* 2º Lugar - Prata */}
                  {podiumData.runnerUp ? (
                    <div className="order-2 sm:order-1 flex flex-col items-center p-4 rounded-2xl bg-white/80 dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-700/80 shadow-md print:bg-white print:text-black print:border-neutral-300">
                      <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 flex items-center justify-center text-lg mb-2 shadow-sm">
                        🥈
                      </div>
                      <span className="text-[10px] font-black tracking-widest text-zinc-500 dark:text-zinc-400 uppercase">2º LUGAR • VICE-CAMPEÃO</span>
                      <span className="text-sm sm:text-base font-bold text-zinc-900 dark:text-white print:text-black mt-1 text-center truncate w-full">
                        {podiumData.runnerUp.name}
                      </span>
                    </div>
                  ) : <div className="hidden sm:block order-1" />}

                  {/* 1º Lugar - Ouro (Grande Campeão) */}
                  <div className="order-1 sm:order-2 flex flex-col items-center p-6 rounded-2xl bg-gradient-to-b from-amber-500/20 to-white/95 dark:from-amber-500/25 dark:to-zinc-900/90 border-2 border-amber-400 shadow-xl shadow-amber-500/20 transform sm:-translate-y-2 print:bg-white print:text-black print:border-neutral-400 print:shadow-none">
                    <div className="w-14 h-14 rounded-full bg-amber-400/30 border border-amber-300 flex items-center justify-center text-2xl mb-2 shadow-inner animate-bounce">
                      🥇
                    </div>
                    <span className="text-[11px] font-black tracking-widest text-amber-700 dark:text-amber-300 print:text-black uppercase">1º LUGAR • GRANDE CAMPEÃO</span>
                    <span className="text-base sm:text-xl font-black text-amber-800 dark:text-amber-200 print:text-black mt-1 text-center truncate w-full">
                      {podiumData.champion.name}
                    </span>
                  </div>

                  {/* 3º Lugar - Bronze */}
                  {podiumData.thirdPlace ? (
                    <div className="order-3 sm:order-3 flex flex-col items-center p-4 rounded-2xl bg-white/80 dark:bg-zinc-900/80 border border-amber-300 dark:border-amber-700/50 shadow-md print:bg-white print:text-black print:border-neutral-300">
                      <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/50 flex items-center justify-center text-lg mb-2 shadow-sm">
                        🥉
                      </div>
                      <span className="text-[10px] font-black tracking-widest text-amber-600 dark:text-amber-500 uppercase">3º LUGAR • BRONZE</span>
                      <span className="text-sm sm:text-base font-bold text-zinc-900 dark:text-white print:text-black mt-1 text-center truncate w-full">
                        {podiumData.thirdPlace.name}
                      </span>
                    </div>
                  ) : <div className="hidden sm:block order-3" />}
                </div>
              </div>
            </div>
          )}

          {/* Mensagem de Erro */}
          {errorMessage && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 dark:text-red-300 text-xs font-medium">
              {errorMessage}
            </div>
          )}

          {/* 3. Visualização Dinâmica por Formato do Torneio (KNOCKOUT / LEAGUE / GROUPS) */}
          {initialLoading && !tournament && matches.length === 0 ? (
            <div className="py-24 text-center space-y-3">
              <Loader2 className="h-9 w-9 text-[#00a2ff] animate-spin mx-auto" />
              <p className="text-xs font-bold text-secondary">
                Carregando chaveamento e classificação da competição...
              </p>
            </div>
          ) : matches.length === 0 ? (
            <>
              <div className="print:hidden border-2 border-dashed border-subtle bg-surface/50 rounded-3xl p-12 text-center space-y-4 max-w-xl mx-auto my-12">
                <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-400 flex items-center justify-center mx-auto shadow-md">
                  <Network className="h-7 w-7 text-[#00a2ff]" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-primary">
                    {resolvedFormat === "LEAGUE"
                      ? "Tabela e Rodadas Ainda Não Geradas"
                      : "Chaveamento Ainda Não Gerado"}
                  </h3>
                  <p className="text-xs text-secondary leading-relaxed">
                    {resolvedFormat === "LEAGUE"
                      ? "Os confrontos de todas as rodadas deste campeonato em pontos corridos ainda não foram gerados pela organização. Assim que as inscrições forem encerradas e a tabela oficial for gerada, a classificação e as rodadas aparecerão aqui em tempo real."
                      : "As chaves e confrontos deste campeonato ainda não foram sorteados pela organização. Assim que as inscrições forem encerradas e o chaveamento oficial for gerado, a árvore de confrontos aparecerá aqui em tempo real."}
                  </p>
                </div>
                <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#00a2ff] hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-blue-500/20 active:scale-95 cursor-pointer"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Voltar aos Detalhes</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface hover:bg-surface-elevated border border-subtle text-secondary hover:text-primary font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
                  >
                    <Printer className="h-3.5 w-3.5 text-[#00a2ff]" />
                    <span>Imprimir Chave Vazia</span>
                  </button>
                </div>
              </div>

              {/* Árvore em branco para impressão antes do sorteio */}
              <div className="hidden print:block">
                <TournamentView
                  format={tournament?.tournament_format || tournament?.format}
                  tournament={tournament}
                  teams={teams}
                  matches={buildBlankKnockoutMatches(Math.max(4, teams.length || 8))}
                />
              </div>
            </>
          ) : (
            <TournamentView
              format={tournament?.tournament_format || tournament?.format}
              tournament={tournament}
              teams={teams}
              matches={matches}
              onSelectMatch={(clickedMatch) => {
                const matchId = clickedMatch.id || (clickedMatch as any).uuid;
                const fid = getFriendlyIdFromUuid(matchId);
                const fullMatch =
                  matches.find((m) => m.id === matchId || m.id === fid || (m as any).uuid === matchId) ||
                  context.matches.find((m) => m.id === matchId || m.id === fid || (m as any).uuid === matchId) ||
                  clickedMatch;

                const completeMatch: Match = {
                  ...clickedMatch,
                  ...fullMatch,
                  detailed_score: fullMatch.detailed_score ?? clickedMatch.detailed_score,
                  detailedScore:
                    (fullMatch as any).detailedScore ??
                    (clickedMatch as any).detailedScore ??
                    fullMatch.detailed_score ??
                    clickedMatch.detailed_score,
                  historicoSets:
                    Array.isArray(fullMatch.historicoSets) && fullMatch.historicoSets.length > 0
                      ? fullMatch.historicoSets
                      : clickedMatch.historicoSets,
                };
                setSelectedDetailMatch(completeMatch);
              }}
              isEditMode={isEditMode}
              canManage={canManage}
              isOrganizer={canManage}
              isAdmin={canManage}
              onSwapTeams={handleSwapTeams}
              onReplaceTeam={handleReplaceTeam}
              onGenerateKnockout={() => {
                fetchData(true);
              }}
            />
          )}
        </main>
      </div>

      {/* 4. Faixa Discreta de Patrocinadores Oficiais no Rodapé */}
      {tournament?.sponsors && tournament.sponsors.length > 0 && (
        <section className="w-full border-t border-subtle bg-surface/90 backdrop-blur-md py-3.5 px-4 sm:px-6 mt-8 print:hidden">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-3 sm:gap-6">
            <span className="text-[11px] font-black uppercase tracking-wider text-muted whitespace-nowrap">
              Patrocinadores Oficiais:
            </span>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 sm:gap-6">
              {tournament.sponsors.map((sponsor) => {
                const Item = (
                  <div
                    key={sponsor.id}
                    className="flex items-center gap-2 opacity-65 hover:opacity-100 transition-opacity group cursor-pointer"
                    title={sponsor.name}
                  >
                    {sponsor.logo_url ? (
                      <div className="h-6 max-w-[100px] flex items-center justify-center">
                        <img
                          src={sponsor.logo_url}
                          alt={sponsor.name}
                          className="max-h-6 max-w-full object-contain filter grayscale group-hover:grayscale-0 transition-all"
                        />
                      </div>
                    ) : (
                      <span className="text-xs font-bold text-secondary group-hover:text-amber-500 transition-colors">
                        {sponsor.name}
                      </span>
                    )}
                  </div>
                );

                if (sponsor.link) {
                  return (
                    <a
                      key={sponsor.id}
                      href={
                        sponsor.link.startsWith("http")
                          ? sponsor.link
                          : `https://${sponsor.link}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {Item}
                    </a>
                  );
                }

                return Item;
              })}
            </div>
          </div>
        </section>
      )}

      {/* Footer Limpo */}
      <footer className="border-t border-subtle py-6 text-center text-xs text-muted bg-surface/50 print:hidden">
        <div>SportConnect • Plataforma de Competições Esportivas</div>
      </footer>

      {/* 5. Modal de Detalhes do Confronto */}
      {selectedDetailMatch && (() => {
        const fid = getFriendlyIdFromUuid(selectedDetailMatch.id);
        const liveMatch =
          matches.find((m) => m.id === selectedDetailMatch.id || m.id === fid || (m as any).uuid === selectedDetailMatch.id) ||
          context.matches.find((m) => m.id === selectedDetailMatch.id || m.id === fid || (m as any).uuid === selectedDetailMatch.id) ||
          selectedDetailMatch;

        const mergedForModal: Match = {
          ...selectedDetailMatch,
          ...liveMatch,
          detailed_score: liveMatch.detailed_score ?? selectedDetailMatch.detailed_score,
          detailedScore:
            (liveMatch as any).detailedScore ??
            (selectedDetailMatch as any).detailedScore ??
            liveMatch.detailed_score ??
            selectedDetailMatch.detailed_score,
          historicoSets:
            Array.isArray(liveMatch.historicoSets) && liveMatch.historicoSets.length > 0
              ? liveMatch.historicoSets
              : selectedDetailMatch.historicoSets,
        };

        return (
          <MatchDetailsModal
            matchId={mergedForModal.id}
            match={mergedForModal}
            matches={matches}
            tournament={tournament}
            teamsMap={teamsMap}
            onClose={() => setSelectedDetailMatch(null)}
            getMatchDetailData={getMatchDetailData}
          />
        );
      })()}
    </div>
  );
}
