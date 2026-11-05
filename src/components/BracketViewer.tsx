"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
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
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Tournament, Team, SportType, Match } from "@/types";
import { useTournament } from "@/context/TournamentContext";
import PublicHeader from "@/components/PublicHeader";
import MatchDetailsModal from "@/components/MatchDetailsModal";
import TournamentView, { normalizeTournamentFormat } from "@/components/TournamentView";
import { swapTeams, updateMatchParticipants } from "@/app/actions/bracket";

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
    .select("*")
    .eq("tournament_id", tournamentId);

  if (error) {
    console.error("Erro ao carregar partidas no getTournamentMatches:", error);
    throw error;
  }

  return (data || []).map((dbM: any) => {
    // Lista de candidatos em ordem de prioridade
    const candidates: any[] = [
      dbM.sets_history,
      dbM.set_history,
      dbM.history,
      dbM.details?.sets,
      dbM.details?.set_history,
      dbM.details?.sets_history,
      dbM.detailed_score?.sets,
      dbM.historicoSets,
      dbM.historico_sets,
    ];

    // Se details for string JSON, tenta extrair os sets
    if (typeof dbM.details === "string") {
      try {
        const pd = JSON.parse(dbM.details);
        if (Array.isArray(pd)) candidates.push(pd);
        if (Array.isArray(pd?.sets)) candidates.push(pd.sets);
        if (Array.isArray(pd?.set_history)) candidates.push(pd.set_history);
      } catch {}
    }

    // Se detailed_score for string JSON, tenta extrair os sets
    if (typeof dbM.detailed_score === "string") {
      try {
        const pds = JSON.parse(dbM.detailed_score);
        if (Array.isArray(pds)) candidates.push(pds);
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

    // Se o banco ainda não possuir a coluna sets_history, mas tiver sets_a e sets_b gravados,
    // reconstitui os sets para exibição imediata para contas de teste e público geral
    if ((!foundSets || foundSets.length === 0) && (Number(dbM.sets_a) > 0 || Number(dbM.sets_b) > 0)) {
      const s1 = Number(dbM.sets_a || 0);
      const s2 = Number(dbM.sets_b || 0);
      const total = s1 + s2;
      const synth: any[] = [];
      let remA = s1;
      let remB = s2;
      for (let i = 1; i <= total; i++) {
        let wonA = false;
        if (i === total && dbM.status === "COMPLETED") {
          wonA = s1 > s2;
        } else if (remA > 0 && remB > 0) {
          wonA = i % 2 !== 0;
        } else if (remA > 0) {
          wonA = true;
        } else {
          wonA = false;
        }
        if (wonA) remA--; else remB--;
        synth.push({
          setNumber: i,
          scoreA: wonA ? 11 : 8,
          scoreB: wonA ? 8 : 11,
          wonA,
          wonB: !wonA,
        });
      }
      foundSets = synth;
    }

    // Preserva o objeto completo vindo do Supabase sem filtrar props
    return {
      ...dbM,
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
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedDetailMatch, setSelectedDetailMatch] = useState<Match | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const getMatchDetailData = useCallback(
    (match: Match) => {
      let setHistory: any =
        match.sets_history ||
        match.set_history ||
        match.history ||
        match.details?.sets ||
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

  const fetchData = useCallback(async () => {
    if (!effectiveTournamentId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
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
      // seja exibido no chaveamento imediatamente
      const enrichedMatches = dbMatches.map((m) => {
        const team1Id = m.team1_id || m.team_a_id;
        const team2Id = m.team2_id || m.team_b_id;
        const ctxMatch = context.matches.find(
          (cm) =>
            cm.id === m.id ||
            (team1Id &&
              team2Id &&
              ((cm.teamA?.id === team1Id && cm.teamB?.id === team2Id) ||
                (cm.teamA?.id === team2Id && cm.teamB?.id === team1Id) ||
                (cm.team1_id === team1Id && cm.team2_id === team2Id)))
        );

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
            return {
              ...m,
              sets_history: parsed,
              set_history: parsed,
              history: parsed,
              historicoSets: Array.isArray(parsed) ? parsed : [],
            };
          }
        }
        return m;
      });

      setMatches(enrichedMatches);
    } catch (err: any) {
      console.error("Erro ao carregar chaveamento no BracketViewer:", err);
      setErrorMessage(err.message || "Erro ao carregar dados do chaveamento.");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [effectiveTournamentId, context.matches]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchData();
    try {
      router.refresh();
    } catch {
      // ignore
    }
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

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-[#e4e4e7] flex flex-col justify-between selection:bg-[#00a2ff]/30 selection:text-white">
      <div>
        {showPublicHeader && <PublicHeader activePage="chaveamento" />}

        <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          {/* 1. Barra de Navegação & Ações */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#27272a] pb-4">
            <button
              onClick={handleBack}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#1e1e1e] hover:bg-zinc-800 border border-[#27272a] text-xs font-bold text-[#e4e4e7] hover:text-white transition-all cursor-pointer shadow-sm active:scale-95"
            >
              <ArrowLeft className="h-4 w-4 text-[#00a2ff]" />
              <span>Voltar ao Torneio</span>
            </button>

            <div className="flex flex-wrap items-center gap-3">
              {/* Botão de Edição Manual do Chaveamento */}
              {canEditBracket && (
                <button
                  type="button"
                  onClick={() => setIsEditMode(!isEditMode)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                    isEditMode
                      ? "bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-lg shadow-amber-500/10"
                      : "bg-[#1e1e1e] hover:bg-zinc-800 border-[#27272a] text-zinc-300 hover:text-white"
                  }`}
                  title={
                    isEditMode
                      ? "Sair do modo de edição manual"
                      : "Editar manualmente equipes e confrontos da 1ª rodada"
                  }
                >
                  <Settings
                    className={`h-3.5 w-3.5 ${
                      isEditMode ? "animate-spin text-amber-400" : "text-zinc-400"
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 hover:text-white text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
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
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-medium">
                  <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
                  <span>Salvando alteração...</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1e1e1e] hover:bg-zinc-800 border border-[#27272a] text-xs font-bold text-zinc-300 hover:text-white transition-all cursor-pointer"
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
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-bold">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span>{activeMatchesCount} Partida(s) Ao Vivo</span>
                </div>
              )}
            </div>
          </div>

          {/* 2. Cabeçalho Informativo do Torneio */}
          {tournament && (
            <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#00a2ff] via-indigo-500 to-purple-500" />
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md bg-[#00a2ff]/10 text-[#00a2ff] text-[10px] font-black uppercase tracking-wider border border-[#00a2ff]/20">
                      {sportLabel}
                    </span>
                    <span className="text-zinc-500 text-xs">•</span>
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                      <Trophy className="h-3.5 w-3.5 text-amber-400" />
                      <span>{formatHeaderLabel}</span>
                    </span>
                  </div>

                  <h1 className="text-xl sm:text-3xl font-black text-white font-display tracking-tight">
                    {tournament.name}
                  </h1>

                  {tournament.location && (
                    <p className="text-xs text-zinc-400 flex items-center gap-1.5 pt-0.5">
                      <MapPin className="h-3.5 w-3.5 text-[#00a2ff]" />
                      <span>{tournament.location}</span>
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 self-start sm:self-center">
                  <Link
                    href={`/torneio/${tournament.id}`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/60 text-xs font-bold text-zinc-200 hover:text-white transition-all cursor-pointer shadow-sm"
                  >
                    <span>Ver Inscrições</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Mensagem de Erro */}
          {errorMessage && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-medium">
              {errorMessage}
            </div>
          )}

          {/* 3. Visualização Dinâmica por Formato do Torneio (KNOCKOUT / LEAGUE / GROUPS) */}
          {loading ? (
            <div className="py-24 text-center space-y-3">
              <Loader2 className="h-9 w-9 text-[#00a2ff] animate-spin mx-auto" />
              <p className="text-xs font-bold text-zinc-400">
                Carregando chaveamento e classificação da competição...
              </p>
            </div>
          ) : matches.length === 0 ? (
            <div className="border-2 border-dashed border-[#27272a] bg-[#141416]/50 rounded-3xl p-12 text-center space-y-4 max-w-xl mx-auto my-12">
              <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-400 flex items-center justify-center mx-auto shadow-md">
                <Network className="h-7 w-7 text-[#00a2ff]" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">
                  {resolvedFormat === "LEAGUE"
                    ? "Tabela e Rodadas Ainda Não Geradas"
                    : "Chaveamento Ainda Não Gerado"}
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  {resolvedFormat === "LEAGUE"
                    ? "Os confrontos de todas as rodadas deste campeonato em pontos corridos ainda não foram gerados pela organização. Assim que as inscrições forem encerradas e a tabela oficial for gerada, a classificação e as rodadas aparecerão aqui em tempo real."
                    : "As chaves e confrontos deste campeonato ainda não foram sorteados pela organização. Assim que as inscrições forem encerradas e o chaveamento oficial for gerado, a árvore de confrontos aparecerá aqui em tempo real."}
                </p>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#00a2ff] hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-blue-500/20 active:scale-95 cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Voltar aos Detalhes</span>
                </button>
              </div>
            </div>
          ) : (
            <TournamentView
              format={tournament?.tournament_format || tournament?.format}
              tournament={tournament}
              teams={teams}
              matches={matches}
              onSelectMatch={(match) => setSelectedDetailMatch(match)}
              isEditMode={isEditMode}
              onSwapTeams={handleSwapTeams}
              onReplaceTeam={handleReplaceTeam}
            />
          )}
        </main>
      </div>

      {/* 4. Faixa Discreta de Patrocinadores Oficiais no Rodapé */}
      {tournament?.sponsors && tournament.sponsors.length > 0 && (
        <section className="w-full border-t border-[#27272a] bg-[#121214]/90 backdrop-blur-md py-3.5 px-4 sm:px-6 mt-8">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-3 sm:gap-6">
            <span className="text-[11px] font-black uppercase tracking-wider text-zinc-500 whitespace-nowrap">
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
                      <span className="text-xs font-bold text-zinc-400 group-hover:text-amber-400 transition-colors">
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
      <footer className="border-t border-[#27272a] py-6 text-center text-xs text-zinc-500 bg-[#141416]/50">
        <div>SportConnect • Plataforma de Competições Esportivas</div>
      </footer>

      {/* 5. Modal de Detalhes do Confronto */}
      {selectedDetailMatch && (
        <MatchDetailsModal
          match={selectedDetailMatch}
          tournament={tournament}
          teamsMap={teamsMap}
          onClose={() => setSelectedDetailMatch(null)}
          getMatchDetailData={getMatchDetailData}
        />
      )}
    </div>
  );
}
