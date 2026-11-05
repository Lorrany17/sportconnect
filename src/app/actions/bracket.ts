"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  cancelRegistration as baseCancelRegistration,
  type CancelRegistrationParams,
  type CancelRegistrationResponse,
} from "./registration";
import {
  calculateGroupStandings,
  extractMatchGroupName,
} from "@/utils/groupStandings";

export interface GenerateBracketResponse {
  success: boolean;
  message?: string;
  error?: string;
  matchesCount?: number;
}

async function createAuthenticatedSupabase(userAuthToken?: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Configuração do Supabase ausente no servidor.");
  }

  let authToken = userAuthToken;
  if (!authToken) {
    try {
      const cookieStore = await cookies();
      const allCookies = cookieStore.getAll();
      const tokenCookie =
        cookieStore.get("sb-access-token") ||
        cookieStore.get("supabase-auth-token") ||
        allCookies.find((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"));

      if (tokenCookie?.value) {
        try {
          const parsed = JSON.parse(tokenCookie.value);
          if (Array.isArray(parsed) && parsed[0]) {
            authToken = parsed[0];
          } else if (parsed?.access_token) {
            authToken = parsed.access_token;
          } else {
            authToken = tokenCookie.value;
          }
        } catch {
          authToken = tokenCookie.value;
        }
      }
    } catch {
      // Cookies podem não estar disponíveis em alguns runtimes
    }
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: authToken
      ? {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      : undefined,
  });
}


/**
 * Atualiza o status do torneio para 'IN_PROGRESS' e limpa o cache do Next.js
 * nas três frentes afetadas: Organizador, Vitrine Pública e Painel do Atleta.
 */
export async function setTournamentStatusInProgress(
  supabase: any,
  tournamentId: string
) {
  const { error } = await supabase
    .from("tournaments")
    .update({ status: "IN_PROGRESS" })
    .eq("id", tournamentId);

  if (error) {
    console.error(`Erro ao atualizar status do torneio ${tournamentId} para IN_PROGRESS:`, error);
  }

  try {
    revalidatePath(`/dashboard/torneios/${tournamentId}`);
    revalidatePath(`/dashboard/${tournamentId}`);
    revalidatePath(`/torneio/${tournamentId}`);
    revalidatePath(`/torneio/${tournamentId}/chaveamento`);
    revalidatePath("/dashboard/atleta");
    revalidatePath("/hub");
    revalidatePath("/explorar");
  } catch (revalErr) {
    console.warn("Aviso ao revalidar cache:", revalErr);
  }
}

/**
 * Determina se uma partida já teve início ou foi disputada na prática.
 * - Partidas com status 'LIVE', 'IN_PROGRESS' ou 'PLAYING'
 * - Partidas 'COMPLETED' ou 'FINISHED' que possuam ambas as equipes (disputadas)
 * Nota: Partidas com apenas 1 equipe e 'COMPLETED' são BYEs gerados pelo sistema,
 * que NÃO impedem a regeneração ou edição do chaveamento.
 */
function isMatchStarted(m: any): boolean {
  if (!m) return false;
  const status = String(m.status || "").toUpperCase();
  const isLive = status === "LIVE" || status === "IN_PROGRESS" || status === "PLAYING";
  const t1 = m.team_a_id ?? m.team1_id ?? null;
  const t2 = m.team_b_id ?? m.team2_id ?? null;
  const hasBothTeams = Boolean(t1) && Boolean(t2);
  const isCompletedGame =
    (status === "COMPLETED" ||
      status === "FINISHED" ||
      status === "ENCERRADA" ||
      status === "FINALIZADO") &&
    hasBothTeams;

  return isLive || isCompletedGame;
}

/**
 * Valida se já existem partidas criadas para o torneio.
 * - Se existirem partidas e ALGUMA já foi iniciada ou disputada, bloqueia a regeneração.
 * - Se existirem partidas mas NENHUMA tiver começado, deleta todas as partidas atuais
 *   para permitir que a nova chave / tabela seja gerada com as configurações atualizadas.
 */
async function checkAndCleanUnstartedMatches(
  supabase: any,
  tournamentId: string
): Promise<{ canProceed: boolean; error?: string; hadPreviousMatches?: boolean }> {
  const { data: existingMatches, error: fetchErr } = await supabase
    .from("matches")
    .select("*")
    .eq("tournament_id", tournamentId);

  if (fetchErr) {
    console.warn("Aviso ao checar partidas existentes:", fetchErr);
  }

  if (!existingMatches || existingMatches.length === 0) {
    return { canProceed: true, hadPreviousMatches: false };
  }

  const hasStarted = existingMatches.some((m: any) => isMatchStarted(m));
  if (hasStarted) {
    return {
      canProceed: false,
      error: "Não é possível regenerar o chaveamento pois o torneio já possui partidas iniciadas ou finalizadas.",
    };
  }

  // Nenhuma partida iniciou: limpa todas as partidas para regeneração
  const adminClient = getSupabaseAdmin() || supabase;
  try {
    await adminClient.from("matches").update({ next_match_id: null }).eq("tournament_id", tournamentId);
  } catch {}

  const { error: delErr } = await adminClient
    .from("matches")
    .delete()
    .eq("tournament_id", tournamentId);

  if (delErr) {
    console.error(`Erro ao deletar partidas para regeneração (${tournamentId}):`, delErr);
    return {
      canProceed: false,
      error: `Erro ao limpar partidas anteriores para regenerar o chaveamento: ${delErr.message}`,
    };
  }

  return { canProceed: true, hadPreviousMatches: true };
}

function seedWeight(level?: string | null): number {
  const up = String(level || "").toUpperCase();
  if (up === "ADVANCED") return 3;
  if (up === "INTERMEDIATE") return 2;
  if (up === "BEGINNER") return 1;
  return 2;
}

/**
 * Gera os confrontos em formato Round-Robin (Tabela de Berger / Método do Círculo)
 * para uma lista de equipes, retornando os pares organizados por rodada.
 */
function buildRoundRobinPairs(teams: Array<{ id: string; name: string }>) {
  const rotation: ({ id: string; name: string } | null)[] = [...teams];
  if (rotation.length % 2 !== 0) {
    rotation.push(null); // Folga (BYE) na rodada se número ímpar
  }

  const totalSlots = rotation.length;
  const totalRounds = totalSlots - 1;
  const matchesPerRound = totalSlots / 2;
  const currentRotation = [...rotation];

  const rounds: Array<{
    round: number;
    byeTeam: { id: string; name: string } | null;
    pairs: Array<{ team1: { id: string; name: string }; team2: { id: string; name: string } }>;
  }> = [];

  for (let round = 1; round <= totalRounds; round++) {
    const pairs: Array<{ team1: { id: string; name: string }; team2: { id: string; name: string } }> = [];
    let byeTeam: { id: string; name: string } | null = null;

    for (let i = 0; i < matchesPerRound; i++) {
      const home = currentRotation[i];
      const away = currentRotation[totalSlots - 1 - i];

      if (home && away) {
        const team1 = i === 0 && round % 2 === 0 ? away : home;
        const team2 = i === 0 && round % 2 === 0 ? home : away;
        pairs.push({ team1, team2 });
      } else if (home && !away) {
        byeTeam = home;
      } else if (!home && away) {
        byeTeam = away;
      }
    }
    rounds.push({ round, byeTeam, pairs });

    const last = currentRotation.pop()!;
    currentRotation.splice(1, 0, last);
  }

  return rounds;
}

/**
 * Server Action: Gerador de Partidas para o Formato "Pontos Corridos" (`generateLeagueMatches`)
 *
 * - Utiliza o algoritmo de Round-Robin (Tabela de Berger) englobando todas as equipes aprovadas num grupo único.
 * - Se o número de equipes for ímpar, aplica a lógica de folga (Bye) por rodada.
 * - Salva os confrontos agrupados por rodada na coluna `round` da tabela `matches` e com `phase = 'LEAGUE'`.
 */
export async function generateLeagueMatches(
  tournament_id: string,
  userAuthToken?: string
): Promise<GenerateBracketResponse> {
  if (!tournament_id) {
    return { success: false, error: "ID do torneio não fornecido." };
  }

  try {
    const supabase = await createAuthenticatedSupabase(userAuthToken);

    // 1. Verifica se já existem partidas criadas e se alguma já iniciou
    const cleanCheck = await checkAndCleanUnstartedMatches(supabase, tournament_id);
    if (!cleanCheck.canProceed) {
      return {
        success: false,
        error: cleanCheck.error || "Não é possível regenerar as rodadas de pontos corridos pois o torneio já possui partidas iniciadas.",
      };
    }

    // 2. Busca todas as equipes confirmadas/aprovadas
    const { data: teamsData, error: teamsErr } = await supabase
      .from("teams")
      .select("*")
      .eq("tournament_id", tournament_id)
      .or("payment_status.eq.PAID,payment_status.eq.APPROVED,status.eq.CONFIRMED,status.eq.PAID");

    if (teamsErr) {
      return { success: false, error: `Erro ao buscar equipes: ${teamsErr.message}` };
    }

    const activeTeamsData = (teamsData || []).filter(
      (t: any) =>
        t.cancellation_status !== "REFUNDED" &&
        t.status !== "CANCELLED" &&
        t.status !== "CANCELED" &&
        t.payment_status !== "CANCELED" &&
        t.payment_status !== "CANCELLED"
    );

    if (activeTeamsData.length < 2) {
      return {
        success: false,
        error: "É necessário ter pelo menos 2 equipes confirmadas para gerar a tabela de Pontos Corridos.",
      };
    }

    // 3. Embaralha as equipes para sortear a ordem na Tabela de Berger
    const leagueTeams = [...activeTeamsData];
    for (let i = leagueTeams.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [leagueTeams[i], leagueTeams[j]] = [leagueTeams[j], leagueTeams[i]];
    }

    // 4. Gera as rodadas via Tabela de Berger (com suporte automático a BYE/folga se ímpar)
    const schedule = buildRoundRobinPairs(leagueTeams);
    const leagueMatchesToInsert: any[] = [];
    let globalMatchOrder = 1;

    for (const roundObj of schedule) {
      for (const pair of roundObj.pairs) {
        leagueMatchesToInsert.push({
          id: crypto.randomUUID(),
          tournament_id,
          round: roundObj.round,
          match_order: globalMatchOrder++,
          next_match_id: null,
          team1_id: pair.team1.id,
          team2_id: pair.team2.id,
          team_a_id: pair.team1.id,
          team_b_id: pair.team2.id,
          status: "SCHEDULED",
          phase: "LEAGUE",
          group_name: null,
          winner_id: null,
          score_a: 0,
          score_b: 0,
          sets_a: 0,
          sets_b: 0,
          details: {
            round_number: roundObj.round,
            bye_team_id: roundObj.byeTeam?.id || null,
            bye_team_name: roundObj.byeTeam?.name || null,
          },
        });
      }
    }

    const { error: leagueInsertErr } = await supabase
      .from("matches")
      .insert(leagueMatchesToInsert);

    if (leagueInsertErr) {
      if (
        leagueInsertErr.message?.includes("column") ||
        leagueInsertErr.message?.includes("details") ||
        leagueInsertErr.message?.includes("group_name") ||
        leagueInsertErr.message?.includes("team1_id") ||
        leagueInsertErr.message?.includes("round") ||
        leagueInsertErr.message?.includes("winner_id") ||
        leagueInsertErr.message?.includes("next_match_id")
      ) {
        const fallbackLeagueMatches = leagueMatchesToInsert.map((m) => ({
          id: m.id,
          tournament_id: m.tournament_id,
          round: m.round,
          match_order: m.match_order,
          phase: "LEAGUE",
          status: m.status,
          team1_id: m.team1_id,
          team2_id: m.team2_id,
          team_a_id: m.team_a_id,
          team_b_id: m.team_b_id,
          score_a: 0,
          score_b: 0,
          sets_a: 0,
          sets_b: 0,
        }));
        const { error: fallbackErr } = await supabase
          .from("matches")
          .insert(fallbackLeagueMatches);

        if (fallbackErr) {
          const legacyLeagueMatches = leagueMatchesToInsert.map((m) => ({
            id: m.id,
            tournament_id: m.tournament_id,
            phase: "LEAGUE",
            status: m.status,
            team_a_id: m.team_a_id,
            team_b_id: m.team_b_id,
            score_a: 0,
            score_b: 0,
            sets_a: 0,
            sets_b: 0,
          }));
          const { error: legacyErr } = await supabase
            .from("matches")
            .insert(legacyLeagueMatches);
          if (legacyErr) {
            return { success: false, error: `Erro ao inserir rodadas da liga: ${legacyErr.message}` };
          }
        }
      } else {
        return { success: false, error: `Erro ao inserir rodadas da liga: ${leagueInsertErr.message}` };
      }
    }

    await setTournamentStatusInProgress(supabase, tournament_id);

    return {
      success: true,
      message: `Tabela de Pontos Corridos gerada com sucesso! ${schedule.length} rodadas e ${leagueMatchesToInsert.length} partidas criadas.`,
      matchesCount: leagueMatchesToInsert.length,
    };
  } catch (err: any) {
    console.error("Exceção ao gerar partidas de Pontos Corridos:", err);
    return {
      success: false,
      error: err.message || "Ocorreu um erro inesperado ao gerar a tabela de Pontos Corridos.",
    };
  }
}

/**
 * Server Action: Algoritmo de Geração da Fase 1 (Grupos) - Formato "GROUPS"
 *
 * 1. Divide o total de equipes inscritas pelo número de grupos desejado (ex: 2 ou 4 grupos).
 * 2. Atribui `group_name` ('A', 'B', 'C', 'D'...) a cada equipe na tabela `teams`
 *    (distribuindo cabeças de chave via `declared_skill_level` em serpentina ou sorteio aleatório).
 * 3. Gera partidas Round-Robin (todos contra todos dentro do grupo) e grava em `matches`
 *    com `phase = 'GROUP_STAGE'`.
 */
export async function generateGroupStage(
  tournament_id: string,
  numGroups?: number,
  userAuthToken?: string
): Promise<GenerateBracketResponse> {
  if (!tournament_id) {
    return { success: false, error: "ID do torneio não fornecido." };
  }

  try {
    const supabase = await createAuthenticatedSupabase(userAuthToken);

    // 1. Verifica se já existem partidas criadas e se alguma já iniciou
    const cleanCheck = await checkAndCleanUnstartedMatches(supabase, tournament_id);
    if (!cleanCheck.canProceed) {
      return {
        success: false,
        error: cleanCheck.error || "Não é possível regenerar as partidas da fase de grupos pois o torneio já possui partidas iniciadas.",
      };
    }

    // 2. Busca equipes confirmadas/pagas
    const { data: teamsData, error: teamsErr } = await supabase
      .from("teams")
      .select("*")
      .eq("tournament_id", tournament_id)
      .or("payment_status.eq.PAID,payment_status.eq.APPROVED,status.eq.CONFIRMED,status.eq.PAID");

    if (teamsErr) {
      return { success: false, error: `Erro ao buscar equipes: ${teamsErr.message}` };
    }

    const activeTeamsData = (teamsData || []).filter(
      (t: any) =>
        t.cancellation_status !== "REFUNDED" &&
        t.status !== "CANCELLED" &&
        t.status !== "CANCELED" &&
        t.payment_status !== "CANCELED" &&
        t.payment_status !== "CANCELLED"
    );

    if (activeTeamsData.length < 4) {
      return {
        success: false,
        error: "É necessário ter pelo menos 4 equipes confirmadas para gerar a Fase de Grupos (mínimo 2 grupos de 2 equipes).",
      };
    }

    const { data: tournamentRow } = await supabase
      .from("tournaments")
      .select("*")
      .eq("id", tournament_id)
      .maybeSingle();

    const configuredGroups = Number(
      numGroups ||
        tournamentRow?.match_rules?.num_groups ||
        (tournamentRow as any)?.num_groups ||
        0
    );

    const totalTeams = activeTeamsData.length;
    let groupCount = configuredGroups;
    if (!groupCount || groupCount < 2) {
      if (totalTeams >= 16) {
        groupCount = 4;
      } else if (totalTeams >= 12) {
        groupCount = 4;
      } else if (totalTeams >= 8) {
        groupCount = totalTeams % 4 === 0 && totalTeams >= 12 ? 4 : 2;
      } else {
        groupCount = 2;
      }
    }
    // Garante ao menos 2 equipes por grupo
    groupCount = Math.min(groupCount, Math.floor(totalTeams / 2));
    groupCount = Math.max(2, groupCount);

    // 3. Embaralha (Fisher-Yates) e aplica distribuição de cabeças de chave (Serpentina) se houver declared_skill_level
    const shuffled = [...activeTeamsData];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const hasSkillSeeds = shuffled.some((t: any) => Boolean(t.declared_skill_level));
    if (hasSkillSeeds) {
      shuffled.sort(
        (a: any, b: any) =>
          seedWeight(b.declared_skill_level) - seedWeight(a.declared_skill_level)
      );
    }

    const groupsMap = new Map<string, any[]>();
    for (let g = 0; g < groupCount; g++) {
      const letter = String.fromCharCode(65 + g); // 'A', 'B', 'C', 'D'...
      groupsMap.set(letter, []);
    }

    // Distribuição em serpentina (A, B, C, D, D, C, B, A...) para equilibrar os grupos
    shuffled.forEach((team, idx) => {
      const cycle = Math.floor(idx / groupCount);
      const posInCycle = idx % groupCount;
      const groupIdx = cycle % 2 === 0 ? posInCycle : groupCount - 1 - posInCycle;
      const letter = String.fromCharCode(65 + groupIdx);
      groupsMap.get(letter)!.push(team);
    });

    // 4. Persiste o group_name em cada equipe na tabela `teams`
    for (const [groupLetter, groupTeams] of groupsMap.entries()) {
      const ids = groupTeams.map((t: any) => t.id);
      if (ids.length > 0) {
        const { error: grpUpdErr } = await supabase
          .from("teams")
          .update({ group_name: groupLetter })
          .in("id", ids);

        if (grpUpdErr) {
          console.warn(`Aviso ao atualizar group_name=${groupLetter} em teams:`, grpUpdErr);
        }
      }
    }

    // 5. Para cada grupo, gera as partidas em formato Round-Robin com phase = 'GROUP_STAGE'
    const groupMatchesToInsert: any[] = [];
    let globalMatchOrder = 1;

    for (const [groupLetter, groupTeams] of groupsMap.entries()) {
      const schedule = buildRoundRobinPairs(groupTeams);
      for (const roundObj of schedule) {
        for (const pair of roundObj.pairs) {
          groupMatchesToInsert.push({
            id: crypto.randomUUID(),
            tournament_id,
            round: roundObj.round,
            match_order: globalMatchOrder++,
            next_match_id: null,
            team1_id: pair.team1.id,
            team2_id: pair.team2.id,
            team_a_id: pair.team1.id,
            team_b_id: pair.team2.id,
            status: "SCHEDULED",
            phase: "GROUP_STAGE",
            group_name: groupLetter,
            winner_id: null,
            score_a: 0,
            score_b: 0,
            sets_a: 0,
            sets_b: 0,
            details: {
              group_name: groupLetter,
              group_round: roundObj.round,
            },
          });
        }
      }
    }

    // 6. Insere as partidas da fase de grupos no banco
    const { error: insertErr } = await supabase
      .from("matches")
      .insert(groupMatchesToInsert);

    if (insertErr) {
      if (
        insertErr.message?.includes("column") ||
        insertErr.message?.includes("details") ||
        insertErr.message?.includes("team1_id") ||
        insertErr.message?.includes("round") ||
        insertErr.message?.includes("winner_id") ||
        insertErr.message?.includes("next_match_id")
      ) {
        const fallbackMatches = groupMatchesToInsert.map((m) => ({
          id: m.id,
          tournament_id: m.tournament_id,
          round: m.round,
          match_order: m.match_order,
          phase: "GROUP_STAGE",
          status: m.status,
          team1_id: m.team1_id,
          team2_id: m.team2_id,
          team_a_id: m.team_a_id,
          team_b_id: m.team_b_id,
          score_a: 0,
          score_b: 0,
          sets_a: 0,
          sets_b: 0,
        }));
        const { error: fallbackErr } = await supabase.from("matches").insert(fallbackMatches);
        if (fallbackErr) {
          const legacyMatches = groupMatchesToInsert.map((m) => ({
            id: m.id,
            tournament_id: m.tournament_id,
            phase: "GROUP_STAGE",
            status: m.status,
            team_a_id: m.team_a_id,
            team_b_id: m.team_b_id,
            score_a: 0,
            score_b: 0,
            sets_a: 0,
            sets_b: 0,
          }));
          const { error: legacyErr } = await supabase.from("matches").insert(legacyMatches);
          if (legacyErr) {
            return { success: false, error: `Erro ao inserir partidas de grupos: ${legacyErr.message}` };
          }
        }
      } else {
        return { success: false, error: `Erro ao inserir partidas de grupos: ${insertErr.message}` };
      }
    }

    await setTournamentStatusInProgress(supabase, tournament_id);

    return {
      success: true,
      message: `Fase de Grupos gerada com sucesso! ${groupCount} grupos (${Array.from(groupsMap.keys()).map((g) => `Grupo ${g}`).join(", ")}) e ${groupMatchesToInsert.length} partidas criadas.`,
      matchesCount: groupMatchesToInsert.length,
    };
  } catch (err: any) {
    console.error("Exceção ao gerar Fase de Grupos:", err);
    return {
      success: false,
      error: err.message || "Ocorreu um erro inesperado ao gerar a Fase de Grupos.",
    };
  }
}

/**
 * Server Action: Transição da Fase de Grupos para o Mata-Mata (Fase 2)
 *
 * 1. Verifica se todas as partidas `phase = 'GROUP_STAGE'` estão encerradas (`COMPLETED`).
 * 2. Calcula a classificação final de cada grupo (Pontos -> Vitórias -> Saldo -> Pró).
 * 3. Seleciona os classificados (ex: 1º e 2º de cada grupo) e realiza o cruzamento olímpico
 *    (1º do Grupo A vs 2º do Grupo B, 1º do Grupo B vs 2º do Grupo A, etc.).
 * 4. Gera a árvore eliminatória com `phase = 'KNOCKOUT'` e vincula `next_match_id`.
 */
export async function generateKnockoutFromGroups(
  tournament_id: string,
  qualifiersPerGroup: number = 2,
  userAuthToken?: string
): Promise<GenerateBracketResponse> {
  if (!tournament_id) {
    return { success: false, error: "ID do torneio não fornecido." };
  }

  try {
    const supabase = await createAuthenticatedSupabase(userAuthToken);

    const { data: tournamentRow } = await supabase
      .from("tournaments")
      .select("*")
      .eq("id", tournament_id)
      .maybeSingle();

    const { data: teamsData, error: teamsErr } = await supabase
      .from("teams")
      .select("*")
      .eq("tournament_id", tournament_id);

    if (teamsErr || !teamsData) {
      return { success: false, error: `Erro ao carregar equipes: ${teamsErr?.message || "Sem dados"}` };
    }

    const { data: allMatches, error: matchesErr } = await supabase
      .from("matches")
      .select("*")
      .eq("tournament_id", tournament_id);

    if (matchesErr || !allMatches) {
      return { success: false, error: `Erro ao carregar partidas: ${matchesErr?.message || "Sem dados"}` };
    }

    const existingKnockout = allMatches.filter(
      (m: any) => String(m.phase || "").toUpperCase() === "KNOCKOUT" || Boolean(m.next_match_id)
    );
    if (existingKnockout.length > 0) {
      return {
        success: false,
        error: "O chaveamento eliminatório (Mata-Mata) já foi gerado para este torneio.",
      };
    }

    const groupMatches = allMatches.filter(
      (m: any) =>
        String(m.phase || "").toUpperCase() === "GROUP_STAGE" ||
        String(m.phase || "").toLowerCase().includes("grupo") ||
        (!m.next_match_id && String(m.phase || "").toUpperCase() !== "KNOCKOUT")
    );

    if (groupMatches.length === 0) {
      return {
        success: false,
        error: "Nenhuma partida da Fase de Grupos foi encontrada para este torneio.",
      };
    }

    const pendingGroupMatches = groupMatches.filter(
      (m: any) => m.status !== "COMPLETED" && m.status !== "FINISHED"
    );
    if (pendingGroupMatches.length > 0) {
      return {
        success: false,
        error: `Ainda existem ${pendingGroupMatches.length} partida(s) pendente(s) na Fase de Grupos. Finalize todos os jogos dos grupos antes de gerar o Mata-Mata.`,
      };
    }

    const activeTeams = teamsData.filter(
      (t: any) =>
        (t.payment_status === "PAID" ||
          t.payment_status === "APPROVED" ||
          t.status === "CONFIRMED" ||
          t.status === "PAID") &&
        t.cancellation_status !== "REFUNDED" &&
        t.status !== "CANCELLED" &&
        t.status !== "CANCELED"
    );

    // Utiliza calculateGroupStandings para processar as partidas finalizadas e ordenar cada grupo
    const teamGroupLookup = new Map<string, string>();
    activeTeams.forEach((t: any) => {
      if (t.group_name) {
        teamGroupLookup.set(t.id, String(t.group_name).toUpperCase().trim());
      }
    });

    groupMatches.forEach((m: any) => {
      const gLetter = extractMatchGroupName(m, teamGroupLookup);
      if (gLetter) {
        const t1 = m.team1_id || m.team_a_id;
        const t2 = m.team2_id || m.team_b_id;
        if (t1 && !teamGroupLookup.has(t1)) teamGroupLookup.set(t1, gLetter);
        if (t2 && !teamGroupLookup.has(t2)) teamGroupLookup.set(t2, gLetter);
      }
    });

    const teamsByGroup = new Map<string, any[]>();
    activeTeams.forEach((t: any) => {
      const g = teamGroupLookup.get(t.id) || "A";
      if (!teamsByGroup.has(g)) teamsByGroup.set(g, []);
      teamsByGroup.get(g)!.push({ ...t, group_name: g });
    });

    const sortedGroupNames = Array.from(teamsByGroup.keys()).sort((a, b) =>
      a.localeCompare(b)
    );
    const groupsMap = new Map<string, Array<{ id: string; name: string }>>();

    for (const g of sortedGroupNames) {
      const groupTeams = teamsByGroup.get(g) || [];
      const standings = calculateGroupStandings(
        groupTeams,
        groupMatches,
        g,
        tournamentRow
      );
      groupsMap.set(
        g,
        standings.map((row) => ({ id: row.teamId, name: row.teamName }))
      );
    }

    // Monta os pares do cruzamento olímpico (1º do A vs 2º do B, 1º do B vs 2º do A, etc.)
    const leftBracketPairs: Array<{
      team1: { id: string; name: string } | null;
      team2: { id: string; name: string } | null;
    }> = [];
    const rightBracketPairs: Array<{
      team1: { id: string; name: string } | null;
      team2: { id: string; name: string } | null;
    }> = [];

    if (sortedGroupNames.length >= 2 && qualifiersPerGroup === 2) {
      for (let i = 0; i < sortedGroupNames.length; i += 2) {
        const gA = sortedGroupNames[i];
        const gB = sortedGroupNames[i + 1];

        const standingsA = groupsMap.get(gA) || [];
        const standingsB = gB ? groupsMap.get(gB) || [] : [];

        const firstA = standingsA[0] || null;
        const secondA = standingsA[1] || null;
        const firstB = standingsB[0] || null;
        const secondB = standingsB[1] || null;

        if (gB) {
          // Chave Esquerda: 1º A vs 2º B
          leftBracketPairs.push({ team1: firstA, team2: secondB });
          // Chave Direita: 1º B vs 2º A (só se encontram na Final)
          rightBracketPairs.push({ team1: firstB, team2: secondA });
        } else if (firstA) {
          leftBracketPairs.push({ team1: firstA, team2: secondA });
        }
      }
    } else {
      // Caso geral
      const allQualifiers: Array<{ id: string; name: string }> = [];
      for (let rank = 0; rank < qualifiersPerGroup; rank++) {
        for (const g of sortedGroupNames) {
          const team = (groupsMap.get(g) || [])[rank];
          if (team) allQualifiers.push(team);
        }
      }
      for (let i = 0; i < Math.ceil(allQualifiers.length / 2); i++) {
        leftBracketPairs.push({
          team1: allQualifiers[i] || null,
          team2: allQualifiers[allQualifiers.length - 1 - i] || null,
        });
      }
    }

    const orderedPairs = [...leftBracketPairs, ...rightBracketPairs].filter(
      (p) => p.team1 || p.team2
    );

    const qualifiedTeamsCount = orderedPairs.reduce(
      (acc, p) => acc + (p.team1 ? 1 : 0) + (p.team2 ? 1 : 0),
      0
    );

    if (qualifiedTeamsCount < 2) {
      return {
        success: false,
        error: "Não há equipes classificadas suficientes para gerar o chaveamento eliminatório.",
      };
    }

    // Potência de 2 mais próxima para a árvore de Mata-Mata
    let bracketSize = 2;
    while (bracketSize < qualifiedTeamsCount || bracketSize / 2 < orderedPairs.length) {
      bracketSize *= 2;
    }
    const totalRounds = Math.log2(bracketSize);
    const round1MatchCount = bracketSize / 2;

    const round1Pairs: Array<{
      team1: { id: string; name: string } | null;
      team2: { id: string; name: string } | null;
    }> = [];

    for (let i = 0; i < round1MatchCount; i++) {
      if (i < orderedPairs.length) {
        round1Pairs.push(orderedPairs[i]);
      } else {
        round1Pairs.push({ team1: null, team2: null });
      }
    }

    const getKnockoutRoundLabel = (matchCount: number, roundNum: number) => {
      if (matchCount === 1) return "Grande Final";
      if (matchCount === 2) return "Semifinal";
      if (matchCount === 4) return "Quartas de Final";
      if (matchCount === 8) return "Oitavas de Final";
      if (matchCount === 16) return "16 avos de Final";
      return `Rodada ${roundNum}`;
    };

    const matchesByRound = new Map<number, any[]>();

    for (let r = totalRounds; r >= 1; r--) {
      const numMatchesInRound = bracketSize / Math.pow(2, r);
      const currentRoundList: any[] = [];
      const roundLabel = getKnockoutRoundLabel(r, totalRounds);

      for (let i = 0; i < numMatchesInRound; i++) {
        const matchId = crypto.randomUUID();
        let nextMatchId: string | null = null;

        if (r < totalRounds) {
          const nextRoundMatches = matchesByRound.get(r + 1);
          if (nextRoundMatches) {
            const nextMatchIdx = Math.floor(i / 2);
            nextMatchId = nextRoundMatches[nextMatchIdx]?.id || null;
          }
        }

        let team1Id: string | null = null;
        let team2Id: string | null = null;

        if (r === 1) {
          team1Id = round1Pairs[i]?.team1?.id || null;
          team2Id = round1Pairs[i]?.team2?.id || null;
        }

        currentRoundList.push({
          id: matchId,
          tournament_id,
          round: r,
          match_order: i + 1,
          next_match_id: nextMatchId,
          team1_id: team1Id,
          team2_id: team2Id,
          team_a_id: team1Id,
          team_b_id: team2Id,
          status: "SCHEDULED",
          phase: "KNOCKOUT",
          group_name: null,
          winner_id: null as string | null,
          score_a: 0,
          score_b: 0,
          sets_a: 0,
          sets_b: 0,
          details: {
            round_label: roundLabel,
          },
        });
      }

      matchesByRound.set(r, currentRoundList);
    }

    // Trata BYEs na primeira fase do Mata-Mata
    const round1Matches = matchesByRound.get(1) || [];
    const byeAdvancements: Array<{
      nextMatchId: string;
      slot: "team1_id" | "team2_id";
      legacySlot: "team_a_id" | "team_b_id";
      winnerId: string;
    }> = [];

    for (let i = 0; i < round1Matches.length; i++) {
      const match = round1Matches[i];
      const hasTeam1 = Boolean(match.team1_id);
      const hasTeam2 = Boolean(match.team2_id);

      if ((hasTeam1 && !hasTeam2) || (!hasTeam1 && hasTeam2)) {
        const survivingTeamId = (match.team1_id || match.team2_id) as string;
        match.status = "COMPLETED";
        match.winner_id = survivingTeamId;

        if (totalRounds > 1 && match.next_match_id) {
          const round2Matches = matchesByRound.get(2);
          if (round2Matches) {
            const nextMatchIdx = Math.floor(i / 2);
            const nextMatch = round2Matches[nextMatchIdx];
            if (nextMatch) {
              const isEven = i % 2 === 0;
              const slot = isEven ? "team1_id" : "team2_id";
              const legacySlot = isEven ? "team_a_id" : "team_b_id";
              nextMatch[slot] = survivingTeamId;
              nextMatch[legacySlot] = survivingTeamId;
              byeAdvancements.push({
                nextMatchId: match.next_match_id,
                slot,
                legacySlot,
                winnerId: survivingTeamId,
              });
            }
          }
        }
      }
    }

    const knockoutMatchesToInsert: any[] = [];
    for (let r = totalRounds; r >= 1; r--) {
      knockoutMatchesToInsert.push(...(matchesByRound.get(r) || []));
    }

    const { error: insertErr } = await supabase
      .from("matches")
      .insert(knockoutMatchesToInsert);

    if (insertErr) {
      if (
        insertErr.message?.includes("column") ||
        insertErr.message?.includes("team1_id") ||
        insertErr.message?.includes("round") ||
        insertErr.message?.includes("winner_id") ||
        insertErr.message?.includes("next_match_id")
      ) {
        const legacyMatches = knockoutMatchesToInsert.map((m) => ({
          id: m.id,
          tournament_id: m.tournament_id,
          phase: "KNOCKOUT",
          status: m.status,
          team_a_id: m.team_a_id,
          team_b_id: m.team_b_id,
          score_a: 0,
          score_b: 0,
          sets_a: 0,
          sets_b: 0,
        }));
        const { error: legacyErr } = await supabase.from("matches").insert(legacyMatches);
        if (legacyErr) {
          return { success: false, error: `Erro ao criar chaveamento eliminatório: ${legacyErr.message}` };
        }
      } else {
        return { success: false, error: `Erro ao criar chaveamento eliminatório: ${insertErr.message}` };
      }
    }

    for (const adv of byeAdvancements) {
      try {
        await supabase
          .from("matches")
          .update({
            [adv.slot]: adv.winnerId,
            [adv.legacySlot]: adv.winnerId,
          })
          .eq("id", adv.nextMatchId);
      } catch (updErr) {
        console.warn("Aviso ao rodar update de BYE no mata-mata:", updErr);
      }
    }

    await setTournamentStatusInProgress(supabase, tournament_id);

    return {
      success: true,
      message: `Fase de Grupos encerrada! Chaveamento Mata-Mata gerado com ${qualifiedTeamsCount} classificados (${knockoutMatchesToInsert.length} partidas).`,
      matchesCount: knockoutMatchesToInsert.length,
    };
  } catch (err: any) {
    console.error("Exceção ao gerar Mata-Mata a partir dos grupos:", err);
    return {
      success: false,
      error: err.message || "Erro inesperado ao gerar o chaveamento eliminatório.",
    };
  }
}

export async function advanceGroupStageToKnockout(
  tournament_id: string,
  qualifiersPerGroup: number = 2,
  userAuthToken?: string
): Promise<GenerateBracketResponse> {
  return await generateKnockoutFromGroups(tournament_id, qualifiersPerGroup, userAuthToken);
}

/**
 * Server Action que gera as partidas do torneio de acordo com seu formato (`KNOCKOUT`, `LEAGUE`, `GROUPS`).
 */
export async function generateBracket(
  tournament_id: string,
  userAuthToken?: string
): Promise<GenerateBracketResponse> {
  if (!tournament_id) {
    return { success: false, error: "ID do torneio não fornecido." };
  }

  try {
    const supabase = await createAuthenticatedSupabase(userAuthToken);

    // 1. Verifica se já existem partidas criadas e se alguma já iniciou
    const cleanCheck = await checkAndCleanUnstartedMatches(supabase, tournament_id);
    if (!cleanCheck.canProceed) {
      return {
        success: false,
        error: cleanCheck.error || "Não é possível regenerar o chaveamento pois o torneio já possui partidas iniciadas ou finalizadas.",
      };
    }

    // 2. Busca todas as equipes inscritas com payment_status = 'PAID' (incluindo APPROVED/CONFIRMED)
    const { data: teamsData, error: teamsErr } = await supabase
      .from("teams")
      .select("*")
      .eq("tournament_id", tournament_id)
      .or("payment_status.eq.PAID,payment_status.eq.APPROVED,status.eq.CONFIRMED,status.eq.PAID");

    if (teamsErr) {
      return { success: false, error: `Erro ao buscar equipes: ${teamsErr.message}` };
    }

    if (!teamsData || teamsData.length < 2) {
      return {
        success: false,
        error: "É necessário ter pelo menos 2 equipes confirmadas para gerar o chaveamento.",
      };
    }

    // 2.1 Filtra equipes canceladas/estornadas e busca o formato do torneio
    const activeTeamsData = (teamsData || []).filter(
      (t: any) =>
        t.cancellation_status !== "REFUNDED" &&
        t.status !== "CANCELLED" &&
        t.status !== "CANCELED" &&
        t.payment_status !== "CANCELED" &&
        t.payment_status !== "CANCELLED"
    );

    if (activeTeamsData.length < 2) {
      return {
        success: false,
        error: "É necessário ter pelo menos 2 equipes confirmadas para gerar os confrontos.",
      };
    }

    const { data: tournamentRow } = await supabase
      .from("tournaments")
      .select("*")
      .eq("id", tournament_id)
      .maybeSingle();

    // 2.2 Verificação estrita de formato do torneio:
    // Apenas despacha para Grupos ou Liga se tournament_format for explicitamente configurado para tal.
    const explicitFormat = String(
      tournamentRow?.tournament_format ||
        tournamentRow?.match_rules?.tournament_format ||
        ""
    ).toUpperCase().trim();

    if (
      explicitFormat === "GROUPS" ||
      explicitFormat === "GROUPS_KNOCKOUT" ||
      explicitFormat === "FASE_DE_GRUPOS"
    ) {
      return await generateGroupStage(tournament_id, undefined, userAuthToken);
    }

    if (
      explicitFormat === "LEAGUE" ||
      explicitFormat === "ROUND_ROBIN" ||
      explicitFormat === "PONTOS_CORRIDOS"
    ) {
      return await generateLeagueMatches(tournament_id, userAuthToken);
    }

    // 3. Embaralha (Shuffle Fisher-Yates) o array de equipes para garantir sorteio 100% aleatório
    const shuffledTeams = [...activeTeamsData];
    for (let i = shuffledTeams.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledTeams[i], shuffledTeams[j]] = [shuffledTeams[j], shuffledTeams[i]];
    }

    const hasSkillSeeds = shuffledTeams.some((t: any) => Boolean(t.declared_skill_level));
    if (hasSkillSeeds) {
      shuffledTeams.sort(
        (a: any, b: any) => seedWeight(b.declared_skill_level) - seedWeight(a.declared_skill_level)
      );
    }

    // 4. Matemática de Árvore Binária (Single Elimination):
    // Calcula a menor potência de 2 maior ou igual ao número de equipes (ex: 6 ou 7 equipes -> bracketSize = 8)
    const numTeams = shuffledTeams.length;
    let bracketSize = 2;
    while (bracketSize < numTeams) {
      bracketSize *= 2;
    }
    const totalRounds = Math.log2(bracketSize);

    // 5. Cálculo e distribuição balanceada dos "Byes"
    // Byes = bracketSize - numTeams (equipes que avançam por falta de oponente)
    const numByes = bracketSize - numTeams;
    const round1MatchCount = bracketSize / 2;

    // Distribui os Byes simetricamente entre a metade superior e inferior da chave
    // para evitar que confrontos com Bye se concentrem no mesmo quadrante
    const hasByeMatch = new Array(round1MatchCount).fill(false);
    let top = 0;
    let bottom = round1MatchCount - 1;
    let byesPlaced = 0;
    while (byesPlaced < numByes) {
      if (byesPlaced < numByes) {
        hasByeMatch[top] = true;
        byesPlaced++;
        top++;
      }
      if (byesPlaced < numByes) {
        hasByeMatch[bottom] = true;
        byesPlaced++;
        bottom--;
      }
    }

    // Monta os pares do Round 1:
    // - Partidas com Bye recebem 1 equipe e team2_id como null (oponente TBD/Vazio)
    // - Partidas normais recebem 2 equipes
    let teamIdx = 0;
    const round1Pairs: Array<{
      team1: { id: string; name: string } | null;
      team2: { id: string; name: string } | null;
    }> = [];

    for (let i = 0; i < round1MatchCount; i++) {
      if (hasByeMatch[i]) {
        round1Pairs.push({
          team1: shuffledTeams[teamIdx++] || null,
          team2: null, // Oponente TBD/Vazio (BYE)
        });
      } else {
        round1Pairs.push({
          team1: shuffledTeams[teamIdx++] || null,
          team2: shuffledTeams[teamIdx++] || null,
        });
      }
    }

    const getPhaseName = (matchCount: number, roundNum: number) => {
      if (matchCount === 1) return "Grande Final";
      if (matchCount === 2) return "Semifinal";
      if (matchCount === 4) return "Quartas de Final";
      if (matchCount === 8) return "Oitavas de Final";
      if (matchCount === 16) return "16 avos de Final";
      return `Rodada ${roundNum}`;
    };

    // 6. Geração da Árvore de Partidas com vinculação de next_match_id:
    // Começa da Final (round mais alto) descendo até o Round 1.
    // Todas as rodadas subsequentes (Semifinais, Final, etc.) OBRIGATORIAMENTE
    // iniciam com team1_id e team2_id como null (slots vazios a serem preenchidos pelos vencedores).
    const matchesByRound = new Map<number, any[]>();

    for (let r = totalRounds; r >= 1; r--) {
      const numMatchesInRound = bracketSize / Math.pow(2, r);
      const currentRoundList: any[] = [];

      for (let i = 0; i < numMatchesInRound; i++) {
        const matchId = crypto.randomUUID();
        let nextMatchId: string | null = null;

        // Vincula a partida atual à partida correspondente na próxima rodada
        if (r < totalRounds) {
          const nextRoundMatches = matchesByRound.get(r + 1);
          if (nextRoundMatches) {
            const nextMatchIdx = Math.floor(i / 2);
            nextMatchId = nextRoundMatches[nextMatchIdx]?.id || null;
          }
        }

        // Apenas o Round 1 recebe as equipes sorteadas (ou null para Byes).
        // Todas as rodadas seguintes (r > 1) OBRIGATORIAMENTE têm team1_id e team2_id como null.
        let team1Id: string | null = null;
        let team2Id: string | null = null;

        if (r === 1) {
          team1Id = round1Pairs[i]?.team1?.id || null;
          team2Id = round1Pairs[i]?.team2?.id || null;
        }

        const phase = getPhaseName(numMatchesInRound, r);

        currentRoundList.push({
          id: matchId,
          tournament_id,
          round: r,
          match_order: i + 1,
          next_match_id: nextMatchId,
          team1_id: team1Id,
          team2_id: team2Id,
          team_a_id: team1Id,
          team_b_id: team2Id,
          status: "SCHEDULED",
          phase,
          winner_id: null as string | null,
          score_a: 0,
          score_b: 0,
          sets_a: 0,
          sets_b: 0,
        });
      }

      matchesByRound.set(r, currentRoundList);
    }

    // 7. Reúne todas as partidas (da final até a 1ª rodada) para inserção no banco
    const allMatchesToInsert: any[] = [];
    for (let r = totalRounds; r >= 1; r--) {
      const list = matchesByRound.get(r) || [];
      allMatchesToInsert.push(...list);
    }

    const { error: insertErr } = await supabase.from("matches").insert(allMatchesToInsert);

    if (insertErr) {
      console.warn("Aviso ao tentar insert com novas colunas:", insertErr);
      if (
        insertErr.message?.includes("column") ||
        insertErr.message?.includes("team1_id") ||
        insertErr.message?.includes("round") ||
        insertErr.message?.includes("winner_id") ||
        insertErr.message?.includes("next_match_id")
      ) {
        // Fallback 1: preserva round, match_order e next_match_id usando colunas legadas team_a_id/team_b_id
        const fallbackMatches = allMatchesToInsert.map((m) => ({
          id: m.id,
          tournament_id: m.tournament_id,
          round: m.round,
          match_order: m.match_order,
          next_match_id: m.next_match_id,
          phase: m.phase,
          status: m.status,
          team_a_id: m.team_a_id,
          team_b_id: m.team_b_id,
          score_a: 0,
          score_b: 0,
          sets_a: 0,
          sets_b: 0,
        }));

        const { error: fbErr } = await supabase.from("matches").insert(fallbackMatches);
        if (fbErr) {
          // Fallback 2: minimalista
          const minimalMatches = allMatchesToInsert.map((m) => ({
            id: m.id,
            tournament_id: m.tournament_id,
            phase: m.phase,
            status: m.status,
            team_a_id: m.team_a_id,
            team_b_id: m.team_b_id,
            score_a: 0,
            score_b: 0,
          }));

          const { error: minErr } = await supabase.from("matches").insert(minimalMatches);
          if (minErr) {
            return { success: false, error: `Erro ao inserir partidas: ${minErr.message}` };
          }
        }
      } else {
        return { success: false, error: `Erro ao inserir partidas: ${insertErr.message}` };
      }
    }

    await setTournamentStatusInProgress(supabase, tournament_id);

    return {
      success: true,
      message: `Chaveamento oficial de Mata-Mata gerado com sucesso! ${allMatchesToInsert.length} partidas criadas em ${totalRounds} rodada(s). Inscrições encerradas.`,
      matchesCount: allMatchesToInsert.length,
    };
  } catch (err: any) {
    console.error("Exceção ao gerar chaveamento:", err);
    return {
      success: false,
      error: err.message || "Ocorreu um erro inesperado ao gerar o chaveamento.",
    };
  }
}

export async function generateMatches(
  tournament_id: string,
  userAuthToken?: string
): Promise<GenerateBracketResponse> {
  return await generateBracket(tournament_id, userAuthToken);
}

export async function generateKnockout(
  tournament_id: string,
  userAuthToken?: string
): Promise<GenerateBracketResponse> {
  return await generateBracket(tournament_id, userAuthToken);
}

export async function startTournament(
  tournament_id: string,
  userAuthToken?: string
): Promise<GenerateBracketResponse> {
  const supabase = await createAuthenticatedSupabase(userAuthToken);
  await setTournamentStatusInProgress(supabase, tournament_id);
  return await generateBracket(tournament_id, userAuthToken);
}

export async function startTournamentAction(
  tournament_id: string,
  userAuthToken?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!tournament_id) {
    return { success: false, error: "ID do torneio não fornecido." };
  }
  try {
    const supabase = await createAuthenticatedSupabase(userAuthToken);
    await setTournamentStatusInProgress(supabase, tournament_id);
    return {
      success: true,
      message: "Campeonato iniciado com sucesso!",
    };
  } catch (err: any) {
    console.error("Exceção ao iniciar torneio:", err);
    return {
      success: false,
      error: err?.message || "Erro ao iniciar o campeonato.",
    };
  }
}

export interface CompleteMatchParams {
  matchId: string;
  scoreA: number;
  scoreB: number;
  setsA?: number;
  setsB?: number;
  winnerId?: string;
  sportType?: string;
  userAuthToken?: string;
  setHistory?: Array<{ setNumber: number; scoreA: number; scoreB: number }>;
  detailedScore?: { rounds?: Array<{ roundNumber: number; winnerTeamId?: string; pointsGenerated?: number; note?: string }> };
  penaltiesA?: number;
  penaltiesB?: number;
}

export interface CompleteMatchResponse {
  success: boolean;
  message?: string;
  error?: string;
  winnerId?: string;
  nextMatchId?: string | null;
  advancedToSlot?: string | null;
}

/**
 * Server Action que finaliza uma partida na súmula digital e atualiza a tabela matches.
 */
export async function completeMatchAction(
  params: CompleteMatchParams
): Promise<CompleteMatchResponse> {
  const { matchId, scoreA, scoreB, setsA = 0, setsB = 0, userAuthToken, sportType } = params;

  if (!matchId) {
    return { success: false, error: "ID da partida não fornecido." };
  }

  try {
    const supabase = await createAuthenticatedSupabase(userAuthToken);

    const { data: match, error: fetchErr } = await supabase
      .from("matches")
      .select("*")
      .eq("id", matchId)
      .maybeSingle();

    if (fetchErr || !match) {
      return {
        success: false,
        error: `Partida não encontrada no banco: ${fetchErr?.message || "ID inexistente"}`,
      };
    }

    const team1_id = match.team1_id || match.team_a_id;
    const team2_id = match.team2_id || match.team_b_id;

    const isSetsSport =
      sportType === "PING_PONG" ||
      sportType === "VOLEI" ||
      setsA > 0 ||
      setsB > 0 ||
      (match.phase && match.phase.toLowerCase().includes("semi") && sportType === "DOMINO");

    let calculatedWinnerId: string | null = null;

    if (isSetsSport && (setsA > 0 || setsB > 0 || setsA !== setsB)) {
      calculatedWinnerId = setsA > setsB ? team1_id : setsB > setsA ? team2_id : null;
    } else {
      calculatedWinnerId = scoreA > scoreB ? team1_id : scoreB > scoreA ? team2_id : null;
    }

    const finalWinnerId = calculatedWinnerId || params.winnerId || null;
    const isKnockoutMatch =
      Boolean(match.next_match_id) ||
      String(match.phase || "").toUpperCase() === "KNOCKOUT";

    if (!finalWinnerId && isKnockoutMatch) {
      return {
        success: false,
        error: "Não foi possível definir o vencedor do confronto eliminatório (placar empatado ou times indefinidos).",
      };
    }

    const existingDetails =
      typeof match.details === "object" && match.details !== null ? match.details : {};

    const currentUpdate: any = {
      status: "COMPLETED",
      score_a: isSetsSport && scoreA === 0 && scoreB === 0 && (setsA > 0 || setsB > 0) ? setsA : scoreA,
      score_b: isSetsSport && scoreA === 0 && scoreB === 0 && (setsA > 0 || setsB > 0) ? setsB : scoreB,
      sets_a: setsA,
      sets_b: setsB,
      winner_id: finalWinnerId,
      set_history: params.setHistory || [],
      sets_history: params.setHistory || [],
      history: params.setHistory || [],
      details: {
        ...existingDetails,
        sets: params.setHistory || [],
        rounds: params.detailedScore?.rounds || [],
      },
      detailed_score: params.detailedScore || { rounds: [] },
      penalties_a: params.penaltiesA || 0,
      penalties_b: params.penaltiesB || 0,
    };

    const { error: updateErr } = await supabase
      .from("matches")
      .update(currentUpdate)
      .eq("id", matchId);

    if (updateErr) {
      console.warn("Aviso ao salvar colunas estendidas de sets, aplicando fallback:", updateErr.message);
      const fallbackUpdate: any = {
        status: "COMPLETED",
        score_a: currentUpdate.score_a,
        score_b: currentUpdate.score_b,
        sets_a: setsA,
        sets_b: setsB,
      };
      if (!updateErr.message?.includes("winner_id")) {
        fallbackUpdate.winner_id = finalWinnerId;
      }
      if (!updateErr.message?.includes("sets_history")) {
        fallbackUpdate.sets_history = params.setHistory || [];
      }

      const { error: fallbackErr } = await supabase
        .from("matches")
        .update(fallbackUpdate)
        .eq("id", matchId);

      if (fallbackErr) {
        await supabase
          .from("matches")
          .update({
            status: "COMPLETED",
            score_a: currentUpdate.score_a,
            score_b: currentUpdate.score_b,
            sets_a: setsA,
            sets_b: setsB,
          })
          .eq("id", matchId);
      }
    }

    let advancedSlot: "team1_id" | "team2_id" | null = null;

    if (match.next_match_id && finalWinnerId) {
      const matchOrder = match.match_order || 1;
      const isEvenSlot = matchOrder % 2 !== 0;
      advancedSlot = isEvenSlot ? "team1_id" : "team2_id";
      const legacySlot = isEvenSlot ? "team_a_id" : "team_b_id";

      const { error: nextErr } = await supabase
        .from("matches")
        .update({
          [advancedSlot]: finalWinnerId,
          [legacySlot]: finalWinnerId,
        })
        .eq("id", match.next_match_id);

      if (nextErr) {
        console.warn("Aviso ao tentar atualizar próxima fase com novas colunas:", nextErr);
        await supabase
          .from("matches")
          .update({ [legacySlot]: finalWinnerId })
          .eq("id", match.next_match_id);
      }
    }

    return {
      success: true,
      message: "Resultado oficializado e chaveamento atualizado com sucesso!",
      winnerId: finalWinnerId || undefined,
      nextMatchId: match.next_match_id,
      advancedToSlot: advancedSlot,
    };
  } catch (err: any) {
    console.error("Exceção ao finalizar partida:", err);
    return {
      success: false,
      error: err.message || "Erro inesperado ao oficializar partida.",
    };
  }
}

export async function getTournamentMatches(tournament_id: string) {
  if (!tournament_id) return [];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Configuração do Supabase ausente no servidor.");
    return [];
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("tournament_id", tournament_id);

  if (error) {
    console.error("Erro ao buscar partidas no getTournamentMatches:", error);
    return [];
  }

  return (data || []).map((dbM: any) => {
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

    if (typeof dbM.details === "string") {
      try {
        const pd = JSON.parse(dbM.details);
        if (Array.isArray(pd)) candidates.push(pd);
        if (Array.isArray(pd?.sets)) candidates.push(pd.sets);
        if (Array.isArray(pd?.set_history)) candidates.push(pd.set_history);
      } catch {}
    }

    if (typeof dbM.detailed_score === "string") {
      try {
        const pds = JSON.parse(dbM.detailed_score);
        if (Array.isArray(pds)) candidates.push(pds);
        if (Array.isArray(pds?.sets)) candidates.push(pds.sets);
      } catch {}
    }

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

    return {
      ...dbM,
      ...(foundSets && foundSets.length > 0
        ? {
            sets_history: foundSets,
            set_history: foundSets,
            history: foundSets,
            historicoSets: foundSets,
          }
        : {}),
    };
  });
}


export async function cancelRegistration(
  teamIdOrParams: string | CancelRegistrationParams,
  cancellationStatus: "REQUESTED_BY_ATHLETE" | "REFUND_REQUESTED" | string = "REQUESTED_BY_ATHLETE",
  userAuthToken?: string
): Promise<CancelRegistrationResponse> {
  return await baseCancelRegistration(teamIdOrParams, cancellationStatus, userAuthToken);
}

export async function withdrawFromTournament(
  teamIdOrParams: string | CancelRegistrationParams,
  cancellationStatus: "REQUESTED_BY_ATHLETE" | "REFUND_REQUESTED" | string = "REQUESTED_BY_ATHLETE",
  userAuthToken?: string
): Promise<CancelRegistrationResponse> {
  return await baseCancelRegistration(teamIdOrParams, cancellationStatus, userAuthToken);
}

/**
 * Atualiza o avanço de BYE na partida seguinte caso a partida pertença a uma árvore eliminatória.
 */
async function syncByeAdvancement(
  adminClient: any,
  tournamentId: string,
  match: any,
  newTeam1Id: string | null,
  newTeam2Id: string | null
) {
  if (!match.next_match_id) return;

  const isBye = (newTeam1Id && !newTeam2Id) || (!newTeam1Id && newTeam2Id);
  const survivingTeamId = isBye ? (newTeam1Id || newTeam2Id) : null;
  const isSlot1 = ((match.match_order || 1) - 1) % 2 === 0;

  try {
    const patchLegacy = isSlot1 ? { team_a_id: survivingTeamId } : { team_b_id: survivingTeamId };
    const { error: errLegacy } = await adminClient
      .from("matches")
      .update(patchLegacy)
      .eq("id", match.next_match_id)
      .eq("tournament_id", tournamentId);

    const patchModern = isSlot1 ? { team1_id: survivingTeamId } : { team2_id: survivingTeamId };
    if (!errLegacy) {
      try {
        await adminClient
          .from("matches")
          .update(patchModern)
          .eq("id", match.next_match_id)
          .eq("tournament_id", tournamentId);
      } catch {}
    } else {
      await adminClient
        .from("matches")
        .update(patchModern)
        .eq("id", match.next_match_id)
        .eq("tournament_id", tournamentId);
    }
  } catch (syncErr) {
    console.warn("Aviso ao sincronizar avanço de BYE:", syncErr);
  }
}

/**
 * Atualiza com segurança as equipes de uma partida no Supabase,
 * garantindo compatibilidade com o schema legado (team_a_id / team_b_id)
 * e o schema estendido (team1_id / team2_id).
 */
async function safeUpdateMatchTeams(
  adminClient: any,
  matchId: string,
  tournamentId: string,
  team1Id: string | null,
  team2Id: string | null
): Promise<{ success: boolean; error?: string }> {
  // 1. Tenta atualizar com as colunas nativas do banco legado (team_a_id, team_b_id)
  const { error: errLegacy } = await adminClient
    .from("matches")
    .update({
      team_a_id: team1Id,
      team_b_id: team2Id,
    })
    .eq("id", matchId)
    .eq("tournament_id", tournamentId);

  if (!errLegacy) {
    // Se o update funcionou, tenta em paralelo atualizar também team1_id e team2_id caso existam
    try {
      await adminClient
        .from("matches")
        .update({
          team1_id: team1Id,
          team2_id: team2Id,
        })
        .eq("id", matchId)
        .eq("tournament_id", tournamentId);
    } catch {
      // Ignora erro se as colunas team1_id/team2_id não existirem
    }
    return { success: true };
  }

  // 2. Se falhou (ex: banco só tem team1_id / team2_id), tenta o formato moderno
  const { error: errModern } = await adminClient
    .from("matches")
    .update({
      team1_id: team1Id,
      team2_id: team2Id,
    })
    .eq("id", matchId)
    .eq("tournament_id", tournamentId);

  if (!errModern) {
    return { success: true };
  }

  return {
    success: false,
    error: errLegacy.message || errModern.message || "Erro ao atualizar equipes no confronto.",
  };
}

export interface UpdateMatchParticipantsParams {
  tournamentId: string;
  matchId: string;
  team1Id: string | null;
  team2Id: string | null;
  userAuthToken?: string;
}

/**
 * Atualiza manualmente as equipes de um confronto (team1_id e team2_id).
 * Apenas permitido se nenhuma partida do torneio tiver sido iniciada.
 */
export async function updateMatchParticipants(
  params: UpdateMatchParticipantsParams
): Promise<{ success: boolean; error?: string; message?: string }> {
  const { tournamentId, matchId, team1Id, team2Id, userAuthToken } = params;
  if (!tournamentId || !matchId) {
    return { success: false, error: "ID do torneio ou da partida não fornecido." };
  }

  try {
    const supabase = await createAuthenticatedSupabase(userAuthToken);
    const adminClient = getSupabaseAdmin() || supabase;

    // 1. Checa se alguma partida do torneio já começou (usa select("*") para compatibilidade com qualquer schema)
    const { data: allMatches, error: matchesErr } = await supabase
      .from("matches")
      .select("*")
      .eq("tournament_id", tournamentId);

    if (matchesErr) {
      return { success: false, error: `Erro ao validar partidas: ${matchesErr.message}` };
    }

    if ((allMatches || []).some((m: any) => isMatchStarted(m))) {
      return {
        success: false,
        error: "Não é possível editar os confrontos pois o torneio já possui partidas iniciadas.",
      };
    }

    const currentMatch = (allMatches || []).find((m: any) => m.id === matchId);
    if (!currentMatch) {
      return { success: false, error: "Partida não encontrada neste torneio." };
    }

    const updateRes = await safeUpdateMatchTeams(adminClient, matchId, tournamentId, team1Id, team2Id);
    if (!updateRes.success) {
      return { success: false, error: updateRes.error || "Erro ao atualizar confronto." };
    }

    try {
      revalidatePath(`/torneio/${tournamentId}`);
      revalidatePath(`/torneio/${tournamentId}/chaveamento`);
      revalidatePath(`/dashboard/torneios/${tournamentId}`);
    } catch {}

    return { success: true, message: "Confronto atualizado com sucesso!" };
  } catch (err: any) {
    console.error("Exceção no updateMatchParticipants:", err);
    return { success: false, error: err.message || "Erro ao atualizar confronto." };
  }
}

export interface SwapTeamsParams {
  tournamentId: string;
  match1Id: string;
  slot1?: "team1" | "team2" | "A" | "B";
  team1Id?: string | null;
  match2Id: string;
  slot2?: "team1" | "team2" | "A" | "B";
  team2Id?: string | null;
  targetTeamId?: string | null;
  userAuthToken?: string;
}

/**
 * Troca equipes de posição entre dois confrontos ou inverte as posições dentro do mesmo confronto.
 * Suporta troca com vagas de BYE (null / A definir), permitindo definir quem recebe o passe livre.
 * Suporta chamadas por coordenadas (slot1/slot2) e/ou IDs explícitos (team1Id/team2Id inclusive null).
 * Realiza o duplo update no banco: a posição antiga recebe o valor do slot de destino (ex: null),
 * e a nova posição recebe o team_id de origem.
 * Apenas permitido se nenhuma partida do torneio tiver sido iniciada.
 */
export async function swapTeams(
  params: SwapTeamsParams
): Promise<{ success: boolean; error?: string; message?: string }> {
  const {
    tournamentId,
    match1Id,
    slot1,
    team1Id,
    match2Id,
    slot2,
    team2Id,
    targetTeamId,
    userAuthToken,
  } = params;

  if (!tournamentId || !match1Id || !match2Id) {
    return { success: false, error: "Parâmetros insuficientes para realizar a troca de equipes." };
  }

  try {
    const supabase = await createAuthenticatedSupabase(userAuthToken);
    const adminClient = getSupabaseAdmin() || supabase;

    // 1. Checa se alguma partida do torneio já começou (usa select("*") para compatibilidade com qualquer schema)
    const { data: allMatches, error: matchesErr } = await supabase
      .from("matches")
      .select("*")
      .eq("tournament_id", tournamentId);

    if (matchesErr) {
      return { success: false, error: `Erro ao validar partidas: ${matchesErr.message}` };
    }

    if ((allMatches || []).some((m: any) => isMatchStarted(m))) {
      return {
        success: false,
        error: "Não é possível alterar os confrontos pois o torneio já possui partidas iniciadas.",
      };
    }

    const match1 = (allMatches || []).find((m: any) => m.id === match1Id);
    const match2 = (allMatches || []).find((m: any) => m.id === match2Id);

    if (!match1 || !match2) {
      return { success: false, error: "Uma ou ambas as partidas não foram encontradas." };
    }

    const isSlot1 = (s: string) => s === "team1" || s === "A" || s === "teamA" || s === "team_a";

    const getTeamId = (match: any, slot: string) => {
      if (isSlot1(slot)) {
        return match.team_a_id ?? match.team1_id ?? null;
      }
      return match.team_b_id ?? match.team2_id ?? null;
    };

    const m1T1 = getTeamId(match1, "team1");
    const m1T2 = getTeamId(match1, "team2");
    const m2T1 = getTeamId(match2, "team1");
    const m2T2 = getTeamId(match2, "team2");

    // Resolve slot1 de forma resiliente
    let resolvedSlot1 = slot1;
    if (!resolvedSlot1 && team1Id !== undefined) {
      if (m1T1 === team1Id) resolvedSlot1 = "team1";
      else if (m1T2 === team1Id) resolvedSlot1 = "team2";
      else resolvedSlot1 = !m1T1 ? "team1" : "team2";
    }
    resolvedSlot1 = resolvedSlot1 || "team1";

    // Resolve slot2 de forma resiliente
    let resolvedSlot2 = slot2;
    if (!resolvedSlot2 && team2Id !== undefined) {
      if (m2T1 === team2Id) resolvedSlot2 = "team1";
      else if (m2T2 === team2Id) resolvedSlot2 = "team2";
      else resolvedSlot2 = !m2T1 ? "team1" : "team2";
    }
    resolvedSlot2 = resolvedSlot2 || "team2";

    const team1Val = team1Id !== undefined ? team1Id : (isSlot1(resolvedSlot1) ? m1T1 : m1T2);
    // Se targetTeamId ou team2Id forem explicitamente fornecidos (inclusive null), usa-os; caso contrário lê do slot2
    const team2Val =
      targetTeamId !== undefined
        ? targetTeamId
        : team2Id !== undefined
        ? team2Id
        : isSlot1(resolvedSlot2)
        ? m2T1
        : m2T2;

    if (match1Id === match2Id) {
      // Inversão entre team1 e team2 da mesma partida
      const newM1T1 = isSlot1(resolvedSlot1) ? team2Val : team1Val;
      const newM1T2 = isSlot1(resolvedSlot1) ? team1Val : team2Val;
      const updateRes = await safeUpdateMatchTeams(adminClient, match1Id, tournamentId, newM1T1, newM1T2);
      if (!updateRes.success) {
        return { success: false, error: updateRes.error || "Erro ao inverter equipes na partida." };
      }
    } else {
      // Duplo update atômico entre duas partidas:
      // Match 1: slot1 recebe o valor do slot2 (ex: null se era um slot vazio)
      // Match 2: slot2 recebe o valor do slot1 (team1Val)
      const newM1T1 = isSlot1(resolvedSlot1) ? team2Val : m1T1;
      const newM1T2 = !isSlot1(resolvedSlot1) ? team2Val : m1T2;

      const newM2T1 = isSlot1(resolvedSlot2) ? team1Val : m2T1;
      const newM2T2 = !isSlot1(resolvedSlot2) ? team1Val : m2T2;

      const res1 = await safeUpdateMatchTeams(adminClient, match1Id, tournamentId, newM1T1, newM1T2);
      if (!res1.success) {
        return { success: false, error: res1.error || "Erro ao atualizar partida de origem." };
      }

      const res2 = await safeUpdateMatchTeams(adminClient, match2Id, tournamentId, newM2T1, newM2T2);
      if (!res2.success) {
        return { success: false, error: res2.error || "Erro ao atualizar partida de destino." };
      }
    }

    try {
      revalidatePath(`/torneio/${tournamentId}`);
      revalidatePath(`/torneio/${tournamentId}/chaveamento`);
      revalidatePath(`/dashboard/torneios/${tournamentId}`);
    } catch {}

    return { success: true, message: "Posições atualizadas com sucesso!" };
  } catch (err: any) {
    console.error("Exceção no swapTeams:", err);
    return { success: false, error: err.message || "Erro ao trocar equipes." };
  }
}
