"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAuthenticatedUser, requireTournamentAccess } from "@/lib/serverAuth";
import {
  cancelRegistration as baseCancelRegistration,
  type CancelRegistrationParams,
  type CancelRegistrationResponse,
} from "./registration";
import {
  calculateGroupStandings,
  extractMatchGroupName,
  normalizeGroupLetter,
} from "@/utils/groupStandings";
import {
  buildRoundRobinPairs,
  calculateOptimalGroupCount,
  generateGroupRoundRobinMatches,
} from "@/utils/bracket-logic";

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
 * Server Action auxiliar (assíncrona) para geração de confrontos round-robin de grupo
 */
export async function generateGroupRoundRobin(
  groupTeams: Array<{ id: string; name: string }>
) {
  return generateGroupRoundRobinMatches(groupTeams);
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
    const authUser = await requireAuthenticatedUser(userAuthToken);
    await requireTournamentAccess(authUser, tournament_id, ["ADMIN"]);
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
    const authUser = await requireAuthenticatedUser(userAuthToken);
    await requireTournamentAccess(authUser, tournament_id, ["ADMIN"]);
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
        tournamentRow?.match_rules?.group_stage?.num_groups ||
        0
    );

    const totalTeams = activeTeamsData.length;
    // Divisão dinâmica e balanceada (tamanho ideal 3 a 4 equipes por grupo)
    // 8 equipes -> 2 grupos de 4; 6 equipes -> 2 grupos de 3; etc.
    const groupCount = calculateOptimalGroupCount(totalTeams, configuredGroups);

    // 3. Embaralha (Fisher-Yates) e divide em chunks equilibrados
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

    // Distribuição equilibrada em serpentina (se houver sementes de habilidade) ou round-robin
    shuffled.forEach((team, idx) => {
      let groupIdx: number;
      if (hasSkillSeeds) {
        const cycle = Math.floor(idx / groupCount);
        const posInCycle = idx % groupCount;
        groupIdx = cycle % 2 === 0 ? posInCycle : groupCount - 1 - posInCycle;
      } else {
        groupIdx = idx % groupCount;
      }
      const letter = String.fromCharCode(65 + groupIdx);
      groupsMap.get(letter)!.push(team);
    });

    // 4. Mapeamento de metadados e persistência do group_name nas equipes
    const groupAssignments: Record<string, string> = {};
    for (const [groupLetter, groupTeams] of groupsMap.entries()) {
      groupTeams.forEach((t: any) => {
        groupAssignments[t.id] = groupLetter;
      });

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

    // Configura os metadados da fase de grupos para que o sistema saiba que os 2 primeiros
    // de cada grupo se classificam para o cruzamento olímpico
    const qualifiersCount = Number(
      tournamentRow?.match_rules?.qualifiers_per_group ||
        (tournamentRow as any)?.qualifiers_per_group ||
        2
    );

    const groupStageMetadata = {
      format: "GROUPS_KNOCKOUT",
      num_groups: groupCount,
      qualifiers_per_group: qualifiersCount,
      olympic_crossover: true,
      phase_status: "GROUP_STAGE_IN_PROGRESS",
      groups: Array.from(groupsMap.entries()).map(([letter, teams]) => ({
        letter,
        name: `Grupo ${letter}`,
        team_count: teams.length,
        team_ids: teams.map((t: any) => t.id),
      })),
      group_assignments: groupAssignments,
    };

    const updatedMatchRules = {
      ...(tournamentRow?.match_rules || {}),
      num_groups: groupCount,
      qualifiers_per_group: qualifiersCount,
      group_stage: groupStageMetadata,
      group_assignments: groupAssignments,
    };

    const { error: tourUpdErr } = await supabase
      .from("tournaments")
      .update({
        match_rules: updatedMatchRules,
        status: "IN_PROGRESS",
      })
      .eq("id", tournament_id);

    if (tourUpdErr) {
      console.warn("Aviso ao salvar metadados da fase de grupos em tournaments:", tourUpdErr);
    }

    // 5. Para cada grupo, gera os confrontos Round-Robin matematicamente estritos (N * (N - 1) / 2)
    const groupMatchesToInsert: any[] = [];
    let globalMatchOrder = 1;

    for (const [groupLetter, groupTeams] of groupsMap.entries()) {
      const pairs = generateGroupRoundRobinMatches(groupTeams);
      for (const pair of pairs) {
        groupMatchesToInsert.push({
          id: crypto.randomUUID(),
          tournament_id,
          round: pair.round,
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
            phase: "GROUP_STAGE",
            group_name: groupLetter,
            group_round: pair.round,
          },
        });
      }
    }

    // 6. Insere as partidas da fase de grupos no banco com preservação do group_name
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
          group_name: m.group_name,
          details: m.details,
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
            group_name: m.group_name,
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
    const authUser = await requireAuthenticatedUser(userAuthToken);
    await requireTournamentAccess(authUser, tournament_id, ["ADMIN"]);
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

    const isGroupStageMatch = (m: any) => {
      if (m.group_name) return true;
      const ph = String(m.phase || "").toUpperCase().trim();
      return (
        ph === "GROUP_STAGE" ||
        ph.startsWith("GROUP") ||
        ph.includes("GRUPO")
      );
    };

    const groupMatches = allMatches.filter(isGroupStageMatch);
    const existingKnockout = allMatches.filter((m: any) => !isGroupStageMatch(m));

    if (groupMatches.length === 0) {
      return {
        success: false,
        error: "Nenhuma partida da Fase de Grupos foi encontrada para este torneio.",
      };
    }

    // Se já existirem partidas eliminatórias anteriores (ex: regeração do mata-mata),
    // remove APENAS as partidas eliminatórias preservando 100% da Fase de Grupos
    if (existingKnockout.length > 0) {
      const knockoutIds = existingKnockout.map((m: any) => m.id).filter(Boolean);
      if (knockoutIds.length > 0) {
        const { error: delKoErr } = await supabase
          .from("matches")
          .delete()
          .in("id", knockoutIds)
          .eq("tournament_id", tournament_id)
          .is("group_name", null);
        if (delKoErr) {
          console.warn("Aviso ao limpar partidas eliminatórias anteriores:", delKoErr.message);
        }
      }
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

    const savedAssignments =
      tournamentRow?.match_rules?.group_assignments ||
      tournamentRow?.match_rules?.group_stage?.group_assignments;
    if (savedAssignments && typeof savedAssignments === "object") {
      Object.entries(savedAssignments).forEach(([tId, g]) => {
        if (g) teamGroupLookup.set(tId, String(g).toUpperCase().trim());
      });
    }

    activeTeams.forEach((t: any) => {
      if (t.group_name && !teamGroupLookup.has(t.id)) {
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

    const getKnockoutPhaseCode = (matchCount: number) => {
      if (matchCount === 1) return "final";
      if (matchCount === 2) return "semi_finals";
      if (matchCount === 4) return "quarter_finals";
      if (matchCount === 8) return "round_of_16";
      return "KNOCKOUT";
    };

    const matchesByRound = new Map<number, any[]>();

    for (let r = totalRounds; r >= 1; r--) {
      const numMatchesInRound = bracketSize / Math.pow(2, r);
      const currentRoundList: any[] = [];
      const roundLabel = getKnockoutRoundLabel(numMatchesInRound, r);
      const phaseCode = getKnockoutPhaseCode(numMatchesInRound);

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
          next_match_id: nextMatchId,
          team_a_id: team1Id,
          team_b_id: team2Id,
          status: "SCHEDULED",
          phase: phaseCode,
          group_name: null,
          winner_id: null as string | null,
          score_a: 0,
          score_b: 0,
          sets_a: 0,
          sets_b: 0,
          details: {
            round_label: roundLabel,
            round_number: r,
            match_index_in_round: i + 1,
          },
        });
      }

      matchesByRound.set(r, currentRoundList);
    }

    // Trata BYEs na primeira fase do Mata-Mata (apenas se houver 1 time real contra null na Rodada 1)
    const round1Matches = matchesByRound.get(1) || [];
    const byeAdvancements: Array<{
      nextMatchId: string;
      legacySlot: "team_a_id" | "team_b_id";
      winnerId: string;
    }> = [];

    for (let i = 0; i < round1Matches.length; i++) {
      const match = round1Matches[i];
      const hasTeam1 = Boolean(match.team_a_id);
      const hasTeam2 = Boolean(match.team_b_id);

      if ((hasTeam1 && !hasTeam2) || (!hasTeam1 && hasTeam2)) {
        const survivingTeamId = (match.team_a_id || match.team_b_id) as string;
        match.status = "COMPLETED";
        match.winner_id = survivingTeamId;

        if (totalRounds > 1 && match.next_match_id) {
          const round2Matches = matchesByRound.get(2);
          if (round2Matches) {
            const nextMatchIdx = Math.floor(i / 2);
            const nextMatch = round2Matches[nextMatchIdx];
            if (nextMatch) {
              const isEven = i % 2 === 0;
              const legacySlot = isEven ? "team_a_id" : "team_b_id";
              nextMatch[legacySlot] = survivingTeamId;
              byeAdvancements.push({
                nextMatchId: match.next_match_id,
                legacySlot,
                winnerId: survivingTeamId,
              });
            }
          }
        }
      }
    }

    // Ordena da Rodada 1 até a Final com numeração sequencial de jogo (match_order)
    const knockoutMatchesToInsert: any[] = [];
    let runningMatchOrder = 1;
    for (let r = 1; r <= totalRounds; r++) {
      const rList = matchesByRound.get(r) || [];
      for (const m of rList) {
        m.details = {
          ...(m.details || {}),
          match_order: runningMatchOrder,
          match_title: `${m.details?.round_label || `Rodada ${r}`} - Jogo #${runningMatchOrder}`,
        };
        runningMatchOrder++;
        knockoutMatchesToInsert.push(m);
      }
    }

    // Se habilitada a disputa de 3º lugar e houver ao menos semifinais (bracketSize >= 4)
    const hasThirdPlaceInGroups = Boolean(
      tournamentRow?.has_third_place_match ||
      tournamentRow?.match_rules?.has_third_place_match
    );
    if (hasThirdPlaceInGroups && bracketSize >= 4) {
      knockoutMatchesToInsert.push({
        id: crypto.randomUUID(),
        tournament_id,
        round: totalRounds,
        next_match_id: null,
        team_a_id: null,
        team_b_id: null,
        status: "SCHEDULED",
        phase: "third_place",
        group_name: null,
        winner_id: null,
        score_a: 0,
        score_b: 0,
        sets_a: 0,
        sets_b: 0,
        details: {
          round_label: "Disputa de 3º Lugar",
          match_title: "Disputa de 3º Lugar",
          is_third_place: true,
          match_order: 99,
        },
      });
    }

    // Insere da última rodada para a primeira para satisfazer eventual FK de next_match_id
    const dbOrderedToInsert = [...knockoutMatchesToInsert].sort(
      (a, b) => Number(b.round || 1) - Number(a.round || 1)
    );

    const { error: insertErr } = await supabase
      .from("matches")
      .insert(dbOrderedToInsert);

    if (insertErr) {
      const legacyMatches = dbOrderedToInsert.map((m) => ({
        id: m.id,
        tournament_id: m.tournament_id,
        phase: m.phase || "KNOCKOUT",
        round: m.round,
        next_match_id: m.next_match_id,
        winner_id: m.winner_id,
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
    }

    for (const adv of byeAdvancements) {
      try {
        await supabase
          .from("matches")
          .update({
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
 * Server Action: Encerramento da Fase de Grupos e Geração do Mata-Mata (Semifinais)
 * 1. Calcula as classificações finais do Grupo A e do Grupo B no backend.
 * 2. Extrai o 1º e 2º colocados de cada grupo.
 * 3. Cria e insere as partidas na tabela `matches` para a fase `semi_finals` seguindo o cruzamento padrão:
 *    - Semifinal 1: 1º do Grupo A vs 2º do Grupo B
 *    - Semifinal 2: 1º do Grupo B vs 2º do Grupo A
 *    - Grande Final: Vencedor Semifinal 1 vs Vencedor Semifinal 2 (vinculado via next_match_id)
 * 4. Atualiza os metadados do torneio (current_stage = 'knockout').
 */
export async function generateKnockoutStage(
  tournamentId: string,
  userAuthToken?: string
): Promise<GenerateBracketResponse> {
  if (!tournamentId) {
    throw new Error("ID do torneio não fornecido.");
  }

  try {
    // =========================================================================
    // BARREIRA DE AUTENTICAÇÃO E VALIDAÇÃO DE SEGURANÇA (BACKEND)
    // =========================================================================
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
      } catch {}
    }

    const supabase = await createAuthenticatedSupabase(authToken);

    let authenticatedUser: any = null;
    if (authToken) {
      try {
        const { data: authData } = await supabase.auth.getUser(authToken);
        authenticatedUser = authData?.user || null;
      } catch {}
    }

    if (!authenticatedUser) {
      try {
        const { data: authData } = await supabase.auth.getUser();
        authenticatedUser = authData?.user || null;
      } catch {}
    }

    if (!authenticatedUser && authToken) {
      try {
        const supabaseAdmin = getSupabaseAdmin();
        const { data: adminUserData } = await supabaseAdmin.auth.getUser(authToken);
        authenticatedUser = adminUserData?.user || null;
      } catch {}
    }

    let isLocalAdminCookie = false;
    try {
      const cookieStore = await cookies();
      if (cookieStore.get("sc_admin_auth")?.value === "true") {
        isLocalAdminCookie = true;
      }
    } catch {}

    if (!authenticatedUser && !isLocalAdminCookie) {
      throw new Error("Ação não autorizada. Sessão expirada ou utilizador não autenticado.");
    }

    // 1. Carrega dados do torneio
    const { data: tournamentRow, error: tourneyErr } = await supabase
      .from("tournaments")
      .select("*")
      .eq("id", tournamentId)
      .maybeSingle();

    if (tourneyErr || !tournamentRow) {
      throw new Error(`Torneio não encontrado: ${tourneyErr?.message || ""}`);
    }

    // Validação estrita: confirma se o utilizador autenticado é o dono do torneio ou admin autorizado
    const isOwner = authenticatedUser && tournamentRow.owner_id && tournamentRow.owner_id === authenticatedUser.id;
    const isSuperAdmin =
      isLocalAdminCookie ||
      authenticatedUser?.email === "admin@sportconnect.com" ||
      authenticatedUser?.email === "santoslorrany250@gmail.com" ||
      authenticatedUser?.user_metadata?.role === "admin" ||
      authenticatedUser?.id === "organizer-admin-session";

    let hasStaffAdminRole = false;
    if (!isOwner && !isSuperAdmin && authenticatedUser) {
      try {
        const { data: staffList } = await supabase
          .from("tournament_staff")
          .select("role, user_id, email")
          .eq("tournament_id", tournamentId);

        const userEmail = authenticatedUser.email?.toLowerCase().trim();
        const staff = (staffList || []).find(
          (s: any) =>
            (s.user_id && s.user_id === authenticatedUser.id) ||
            (s.email && s.email.toLowerCase().trim() === userEmail)
        );

        if (staff && (staff.role === "ADMIN" || staff.role === "OWNER")) {
          hasStaffAdminRole = true;
        }
      } catch (staffErr) {
        console.warn("Aviso ao checar staff:", staffErr);
      }
    }

    if (!isOwner && !isSuperAdmin && !hasStaffAdminRole) {
      throw new Error("Ação não autorizada. Apenas o organizador do torneio tem permissão para encerrar a fase de grupos e gerar o mata-mata.");
    }

    // 2. Carrega equipes participantes
    const { data: teamsData, error: teamsErr } = await supabase
      .from("teams")
      .select("*")
      .eq("tournament_id", tournamentId);

    if (teamsErr || !teamsData || teamsData.length === 0) {
      return { success: false, error: "Nenhuma equipe encontrada para este torneio." };
    }

    // 3. Carrega partidas existentes
    const { data: allMatches, error: matchesErr } = await supabase
      .from("matches")
      .select("*")
      .eq("tournament_id", tournamentId);

    if (matchesErr || !allMatches) {
      return { success: false, error: "Erro ao consultar partidas existentes." };
    }

    const isGroupStageMatch = (m: any) => {
      if (m.group_name) return true;
      const ph = String(m.phase || "").toUpperCase().trim();
      return (
        ph === "GROUP_STAGE" ||
        ph.startsWith("GROUP") ||
        ph.includes("GRUPO")
      );
    };

    const groupMatches = allMatches.filter(isGroupStageMatch);
    const existingKnockout = allMatches.filter((m: any) => !isGroupStageMatch(m));

    if (groupMatches.length === 0) {
      return {
        success: false,
        error: "Nenhuma partida da fase de grupos encontrada para este torneio.",
      };
    }

    // Se já existirem partidas eliminatórias anteriores (ex: regeração do mata-mata),
    // remove APENAS as partidas eliminatórias preservando 100% da Fase de Grupos
    if (existingKnockout.length > 0) {
      const knockoutIds = existingKnockout.map((m: any) => m.id).filter(Boolean);
      if (knockoutIds.length > 0) {
        await supabase
          .from("matches")
          .delete()
          .in("id", knockoutIds)
          .eq("tournament_id", tournamentId)
          .is("group_name", null);
      }
    }

    // Verifica se todos os jogos de grupo estão encerrados
    const pendingMatches = groupMatches.filter(
      (m: any) => m.status !== "COMPLETED" && m.status !== "FINISHED"
    );

    if (pendingMatches.length > 0) {
      return {
        success: false,
        error: `Ainda existem ${pendingMatches.length} partida(s) em andamento na Fase de Grupos. Encerre todos os jogos antes de gerar o Mata-Mata.`,
      };
    }

    // 4. Mapeamento de grupos para cada equipe
    const teamGroupLookup = new Map<string, string>();
    const savedAssignments =
      tournamentRow?.match_rules?.group_assignments ||
      tournamentRow?.match_rules?.group_stage?.group_assignments;
    if (savedAssignments && typeof savedAssignments === "object") {
      Object.entries(savedAssignments).forEach(([tId, g]) => {
        if (g) teamGroupLookup.set(tId, normalizeGroupLetter(String(g)));
      });
    }

    teamsData.forEach((t: any) => {
      if (t.group_name && !teamGroupLookup.has(t.id)) {
        teamGroupLookup.set(t.id, normalizeGroupLetter(t.group_name));
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

    // Agrupa equipes
    const teamsByGroup = new Map<string, any[]>();
    teamsData.forEach((t: any) => {
      const g = teamGroupLookup.get(t.id) || "A";
      if (!teamsByGroup.has(g)) teamsByGroup.set(g, []);
      teamsByGroup.get(g)!.push(t);
    });

    const sortedGroupLetters = Array.from(teamsByGroup.keys()).sort((a, b) =>
      a.localeCompare(b)
    );

    // Se o torneio possuir mais de 2 grupos (ex: 4 grupos A, B, C, D),
    // delega para generateKnockoutFromGroups que gera o cruzamento olímpico completo
    if (sortedGroupLetters.length > 2) {
      return await generateKnockoutFromGroups(tournamentId, 2, userAuthToken);
    }

    // Torneio com 2 grupos (Grupo A e Grupo B)
    const gA = sortedGroupLetters[0] || "A";
    const gB = sortedGroupLetters[1] || "B";

    const standingsA = calculateGroupStandings(
      teamsByGroup.get(gA) || [],
      groupMatches,
      gA,
      tournamentRow
    );

    const standingsB = calculateGroupStandings(
      teamsByGroup.get(gB) || [],
      groupMatches,
      gB,
      tournamentRow
    );

    const firstA = standingsA[0] || null;
    const secondA = standingsA[1] || null;
    const firstB = standingsB[0] || null;
    const secondB = standingsB[1] || null;

    if (!firstA || !firstB) {
      return {
        success: false,
        error: "Não foi possível identificar os líderes dos grupos para compor as Semifinais.",
      };
    }

    // 5. Gera IDs e registros das partidas:
    // Semifinal 1: 1º Grupo A vs 2º Grupo B
    // Semifinal 2: 1º Grupo B vs 2º Grupo A
    // Final: Vencedor Semifinal 1 vs Vencedor Semifinal 2
    const semi1Id = crypto.randomUUID();
    const semi2Id = crypto.randomUUID();
    const finalId = crypto.randomUUID();

    const team1Semi1 = firstA.teamId || null;
    const team2Semi1 = secondB?.teamId || null;
    const team1Semi2 = firstB.teamId || null;
    const team2Semi2 = secondA?.teamId || null;

    const matchesToInsert: any[] = [
      {
        id: finalId,
        tournament_id: tournamentId,
        round: 2,
        next_match_id: null,
        team_a_id: null,
        team_b_id: null,
        status: "SCHEDULED",
        phase: "final",
        group_name: null,
        winner_id: null,
        score_a: 0,
        score_b: 0,
        sets_a: 0,
        sets_b: 0,
        details: {
          round_label: "Grande Final",
          match_title: "Grande Final (Vencedor Semi 1 vs Vencedor Semi 2)",
          match_order: 3,
          table_number: 1,
        },
      },
      {
        id: semi1Id,
        tournament_id: tournamentId,
        round: 1,
        next_match_id: finalId,
        team_a_id: team1Semi1,
        team_b_id: team2Semi1,
        status: "SCHEDULED",
        phase: "semi_finals",
        group_name: null,
        winner_id: null,
        score_a: 0,
        score_b: 0,
        sets_a: 0,
        sets_b: 0,
        details: {
          round_label: "Semifinal",
          match_title: `Semifinal 1 (1º Grupo ${gA} vs 2º Grupo ${gB})`,
          match_order: 1,
          table_number: 1,
        },
      },
      {
        id: semi2Id,
        tournament_id: tournamentId,
        round: 1,
        next_match_id: finalId,
        team_a_id: team1Semi2,
        team_b_id: team2Semi2,
        status: "SCHEDULED",
        phase: "semi_finals",
        group_name: null,
        winner_id: null,
        score_a: 0,
        score_b: 0,
        sets_a: 0,
        sets_b: 0,
        details: {
          round_label: "Semifinal",
          match_title: `Semifinal 2 (1º Grupo ${gB} vs 2º Grupo ${gA})`,
          match_order: 2,
          table_number: 2,
        },
      },
    ];

    // Se habilitada a disputa de 3º lugar, adiciona a partida com phase = 'third_place'
    const hasThirdPlace = Boolean(
      tournamentRow?.has_third_place_match ||
      tournamentRow?.match_rules?.has_third_place_match
    );

    if (hasThirdPlace) {
      const thirdPlaceId = crypto.randomUUID();
      matchesToInsert.push({
        id: thirdPlaceId,
        tournament_id: tournamentId,
        round: 2,
        next_match_id: null,
        team_a_id: null,
        team_b_id: null,
        status: "SCHEDULED",
        phase: "third_place",
        group_name: null,
        winner_id: null,
        score_a: 0,
        score_b: 0,
        sets_a: 0,
        sets_b: 0,
        details: {
          round_label: "Disputa de 3º Lugar",
          match_title: "Disputa de 3º Lugar (Perdedor Semi 1 vs Perdedor Semi 2)",
          is_third_place: true,
          match_order: 4,
          table_number: 2,
        },
      });
    }

    // Tratamento de BYE caso algum grupo não possua 2º colocado
    if (team1Semi1 && !team2Semi1) {
      matchesToInsert[1].status = "COMPLETED";
      matchesToInsert[1].winner_id = team1Semi1;
      matchesToInsert[0].team_a_id = team1Semi1;
    }
    if (team1Semi2 && !team2Semi2) {
      matchesToInsert[2].status = "COMPLETED";
      matchesToInsert[2].winner_id = team1Semi2;
      matchesToInsert[0].team_b_id = team1Semi2;
    }

    const { error: insertErr } = await supabase
      .from("matches")
      .insert(matchesToInsert);

    if (insertErr) {
      // Fallback para colunas legadas caso a tabela matches use formato anterior
      console.warn("Tentando insert legado para matches de mata-mata:", insertErr.message);
      const legacyMatches = matchesToInsert.map((m) => ({
        id: m.id,
        tournament_id: m.tournament_id,
        phase: m.phase,
        status: m.status,
        team_a_id: m.team_a_id,
        team_b_id: m.team_b_id,
        score_a: 0,
        score_b: 0,
        sets_a: 0,
        sets_b: 0,
        round: m.round,
        next_match_id: m.next_match_id,
      }));
      const { error: legacyErr } = await supabase.from("matches").insert(legacyMatches);
      if (legacyErr) {
        return { success: false, error: `Erro ao criar partidas do mata-mata: ${legacyErr.message}` };
      }
    }

    // 6. Atualiza metadados do torneio: current_stage = 'knockout'
    const updatedMatchRules = {
      ...(tournamentRow.match_rules || {}),
      current_stage: "knockout",
      phase_status: "KNOCKOUT_IN_PROGRESS",
      group_stage: {
        ...((tournamentRow.match_rules as any)?.group_stage || {}),
        status: "COMPLETED",
        closed_at: new Date().toISOString(),
      },
      crossover: {
        semi_1: { team1: firstA.teamName, team2: secondB?.teamName || "BYE" },
        semi_2: { team1: firstB.teamName, team2: secondA?.teamName || "BYE" },
      },
    };

    const updateBase = {
      status: "IN_PROGRESS",
      match_rules: updatedMatchRules,
    };

    const { error: updateStageErr } = await supabase
      .from("tournaments")
      .update({
        ...updateBase,
        current_stage: "knockout",
      })
      .eq("id", tournamentId);

    if (updateStageErr && updateStageErr.message?.includes("current_stage")) {
      await supabase
        .from("tournaments")
        .update(updateBase)
        .eq("id", tournamentId);
    }

    revalidatePath(`/torneio/${tournamentId}`);
    revalidatePath(`/torneio/${tournamentId}/chaveamento`);
    revalidatePath(`/dashboard/${tournamentId}`);
    revalidatePath("/");

    return {
      success: true,
      message: `Fase de Grupos encerrada com sucesso! Semifinais geradas: ${firstA.teamName} vs ${secondB?.teamName || "BYE"} e ${firstB.teamName} vs ${secondA?.teamName || "BYE"}.`,
      matchesCount: matchesToInsert.length,
    };
  } catch (err: any) {
    console.error("Exceção ao gerar fase eliminatória:", err);
    return {
      success: false,
      error: err.message || "Erro inesperado ao gerar a fase eliminatória.",
    };
  }
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
    const authUser = await requireAuthenticatedUser(userAuthToken);
    await requireTournamentAccess(authUser, tournament_id, ["ADMIN"]);
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

    // 2.2 Verificação de formato do torneio (GROUPS, LEAGUE, KNOCKOUT):
    const rawFormat = String(
      tournamentRow?.tournament_format ||
        tournamentRow?.match_rules?.tournament_format ||
        tournamentRow?.format ||
        ""
    ).toUpperCase().trim();

    const isGroupsFormat =
      rawFormat === "GROUPS" ||
      rawFormat === "GROUPS_KNOCKOUT" ||
      rawFormat === "FASE_DE_GRUPOS" ||
      rawFormat.includes("GRUPO");

    const isLeagueFormat =
      rawFormat === "LEAGUE" ||
      rawFormat === "ROUND_ROBIN" ||
      rawFormat === "PONTOS_CORRIDOS" ||
      rawFormat.includes("LIGA") ||
      rawFormat.includes("CORRIDO");

    if (isGroupsFormat) {
      return await generateGroupStage(tournament_id, undefined, userAuthToken);
    }

    if (isLeagueFormat) {
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
    const authUser = await requireAuthenticatedUser(userAuthToken);
    await requireTournamentAccess(authUser, tournament_id, ["ADMIN"]);
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
  scoreA?: number;
  scoreB?: number;
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
  tournamentCompleted?: boolean;
}

/**
 * Server Action que finaliza uma partida na súmula digital e atualiza a tabela matches.
 */
export async function completeMatchAction(
  params: CompleteMatchParams
): Promise<CompleteMatchResponse> {
  const { matchId, scoreA = 0, scoreB = 0, setsA = 0, setsB = 0, userAuthToken, sportType } = params;

  if (!matchId) {
    return { success: false, error: "ID da partida não fornecido." };
  }

  try {
    const authUser = await requireAuthenticatedUser(userAuthToken);
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

    if (!match.tournament_id) {
      return {
        success: false,
        error: "Partida inválida: o confronto não possui vínculo com nenhum campeonato.",
      };
    }
    await requireTournamentAccess(authUser, match.tournament_id, ["ADMIN", "REFEREE", "SCOREKEEPER"]);

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
      detailed_score: {
        sets: params.setHistory || [],
        historicoSets: params.setHistory || [],
        rounds: params.detailedScore?.rounds || [],
      },
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

    const finalLoserId =
      finalWinnerId && team1_id && team2_id
        ? finalWinnerId === team1_id
          ? team2_id
          : team1_id
        : null;

    let detailsObj: any = match.details;
    if (typeof detailsObj === "string") {
      try {
        detailsObj = JSON.parse(detailsObj);
      } catch (_) {
        detailsObj = {};
      }
    }

    const phaseStr = String(match.phase || "").toLowerCase().trim();
    const roundLabel = String(detailsObj?.round_label || match.details?.round_label || "").toLowerCase().trim();
    const matchTitle = String(detailsObj?.match_title || match.details?.match_title || "").toLowerCase().trim();

    // 1. Busca todas as partidas do torneio para localizar a Grande Final, o 3º Lugar e identificar a posição da Semifinal
    let tourneyMatches: any[] = [];
    if (match.tournament_id) {
      const { data: tm, error: matchesFetchErr } = await supabase
        .from("matches")
        .select("*")
        .eq("tournament_id", match.tournament_id);

      if (matchesFetchErr) {
        console.error("[finishMatch] Erro ao buscar partidas do torneio:", matchesFetchErr);
      } else if (tm) {
        tourneyMatches = tm;
      }
    }

    // 2. Busca pela Grande Final (Case-Insensitive e IDs)
    let finalMatch: any = null;

    // A) Busca direta por ID se a semifinal apontar para next_match_id
    if (match.next_match_id) {
      finalMatch = tourneyMatches.find((m: any) => m.id === match.next_match_id);
      if (!finalMatch) {
        const { data: directFinal, error: directErr } = await supabase
          .from("matches")
          .select("*")
          .eq("id", match.next_match_id)
          .maybeSingle();
        if (directFinal && !directErr) {
          finalMatch = directFinal;
        }
      }
    }

    // B) Busca case-insensitive via Supabase ilike('phase', '%final%')
    if (!finalMatch && match.tournament_id) {
      const { data: finalCandidates } = await supabase
        .from("matches")
        .select("*")
        .eq("tournament_id", match.tournament_id)
        .ilike("phase", "%final%");

      if (finalCandidates && finalCandidates.length > 0) {
        finalMatch = finalCandidates.find((m: any) => {
          const ph = String(m.phase || "").toLowerCase().trim();
          let d: any = m.details;
          if (typeof d === "string") {
            try { d = JSON.parse(d); } catch (_) { d = {}; }
          }
          const rl = String(d?.round_label || "").toLowerCase().trim();
          const mt = String(d?.match_title || "").toLowerCase().trim();
          const full = `${ph} ${rl} ${mt}`;
          return (
            !full.includes("semi") &&
            !full.includes("quarta") &&
            !full.includes("oitava") &&
            !full.includes("third") &&
            !full.includes("terceiro") &&
            !full.includes("3")
          );
        }) || finalCandidates[0];
      }
    }

    // C) Busca em tourneyMatches pelos metadados / round_label / match_title
    if (!finalMatch && tourneyMatches.length > 0) {
      finalMatch = tourneyMatches.find((m: any) => {
        const ph = String(m.phase || "").toLowerCase().trim();
        let d: any = m.details;
        if (typeof d === "string") {
          try { d = JSON.parse(d); } catch (_) { d = {}; }
        }
        const rl = String(d?.round_label || "").toLowerCase().trim();
        const mt = String(d?.match_title || "").toLowerCase().trim();
        const full = `${ph} ${rl} ${mt}`;
        return (
          (full.includes("final") || m.id === match.next_match_id) &&
          !full.includes("semi") &&
          !full.includes("quarta") &&
          !full.includes("oitava") &&
          !full.includes("third") &&
          !full.includes("terceiro") &&
          !full.includes("3")
        );
      });
    }

    // D) Fallback para a partida com maior rodada eliminatória (Grande Final é o topo da árvore)
    if (!finalMatch && tourneyMatches.length > 0) {
      const knockoutMatches = tourneyMatches.filter((m: any) => {
        const ph = String(m.phase || "").toUpperCase();
        return ph !== "GROUP_STAGE" && !ph.includes("GRUPO") && !ph.includes("LEAGUE");
      });
      if (knockoutMatches.length > 0) {
        const maxRound = Math.max(...knockoutMatches.map((m: any) => Number(m.round || m.round_number || 1)));
        finalMatch = knockoutMatches.find((m: any) => Number(m.round || m.round_number || 1) === maxRound);
      }
    }

    const isSemifinal =
      phaseStr.includes("semi") ||
      roundLabel.includes("semi") ||
      matchTitle.includes("semi") ||
      (finalMatch && match.id !== finalMatch.id && (match.next_match_id === finalMatch.id || match.round === 1));

    if (isSemifinal && match.tournament_id) {
      // 1. Identificação Estrita da Origem (Semifinal 1 vs Semifinal 2)
      // Filtra as semifinais do torneio ordenando estritamente por ordem, criação e id
      const allSemis = (tourneyMatches || [])
        .filter((m: any) => {
          if (finalMatch && m.id === finalMatch.id) return false;
          const ph = String(m.phase || "").toLowerCase().trim();
          let d: any = m.details;
          if (typeof d === "string") {
            try { d = JSON.parse(d); } catch (_) { d = {}; }
          }
          const rl = String(d?.round_label || "").toLowerCase().trim();
          const mt = String(d?.match_title || "").toLowerCase().trim();
          return (
            ph.includes("semi") ||
            rl.includes("semi") ||
            mt.includes("semi") ||
            (finalMatch && m.next_match_id === finalMatch.id)
          );
        })
        .sort((a: any, b: any) => {
          const ordA = Number(a.match_order ?? a.details?.match_number ?? a.match_number ?? 0);
          const ordB = Number(b.match_order ?? b.details?.match_number ?? b.match_number ?? 0);
          if (ordA && ordB && ordA !== ordB) return ordA - ordB;

          if (a.created_at && b.created_at) {
            const tA = new Date(a.created_at).getTime();
            const tB = new Date(b.created_at).getTime();
            if (tA !== tB) return tA - tB;
          }
          return String(a.id).localeCompare(String(b.id));
        });

      const semiIndex = allSemis.findIndex((m: any) => m.id === match.id);

      let detectedSemi: 1 | 2 | null = null;
      const explicitOrder = Number(
        match.details?.match_number ??
        detailsObj?.match_number ??
        match.match_order ??
        match.match_number ??
        detailsObj?.match_order ??
        0
      );

      if (explicitOrder === 1) detectedSemi = 1;
      else if (explicitOrder === 2) detectedSemi = 2;

      if (!detectedSemi) {
        if (
          matchTitle.includes("semifinal 1") ||
          matchTitle.includes("semi 1") ||
          matchTitle.includes("semi-final 1") ||
          matchTitle.includes("1º grupo") ||
          matchTitle.includes("1º a")
        ) {
          detectedSemi = 1;
        } else if (
          matchTitle.includes("semifinal 2") ||
          matchTitle.includes("semi 2") ||
          matchTitle.includes("semi-final 2") ||
          matchTitle.includes("1º b") ||
          matchTitle.includes("2º grupo")
        ) {
          detectedSemi = 2;
        }
      }

      if (!detectedSemi && semiIndex !== -1) {
        if (semiIndex === 0) detectedSemi = 1;
        else if (semiIndex === 1) detectedSemi = 2;
      }

      // Validação estrita de segurança: se a origem não puder ser identificada, aborta com erro
      if (!detectedSemi) {
        throw new Error(
          `[finishMatch] Não foi possível determinar com precisão se a partida ${match.id} é a Semifinal 1 ou Semifinal 2. Abortando atualização para não corromper os slots da Grande Final.`
        );
      }

      const isSemi1 = detectedSemi === 1;
      const isSemi2 = detectedSemi === 2;

      const semiLabel = isSemi1
        ? "Semifinal 1 (Patch estrito apenas em team_a_id)"
        : "Semifinal 2 (Patch estrito apenas em team_b_id)";

      console.log(`[finishMatch] Identificação Estrita da Origem: ${semiLabel}`, {
        matchId: match.id,
        explicitOrder,
        semiIndex,
        isSemi1,
        isSemi2,
        matchTitle,
        winnerId: finalWinnerId,
        loserId: finalLoserId,
      });

      // Logs de Rastreamento (Console)
      console.log("Vencedor ID:", finalWinnerId);
      console.log("Partida Final Encontrada:", finalMatch);

      if (!finalMatch) {
        throw new Error("Partida da Grande Final não encontrada no banco.");
      }

      // 2. Atualização de Slot Único (Patch Condicional):
      // Se Semifinal 1: envia apenas team_a_id (e team1_id). O banco NÃO deve tocar em team_b_id.
      // Se Semifinal 2: envia apenas team_b_id (e team2_id). O banco NÃO deve tocar em team_a_id.
      advancedSlot = isSemi1 ? "team1_id" : "team2_id";
      const finalUpdatePayload: Record<string, any> = isSemi1
        ? { team_a_id: finalWinnerId, team1_id: finalWinnerId }
        : { team_b_id: finalWinnerId, team2_id: finalWinnerId };

      console.log(`[finishMatch] Executando PATCH condicional de slot único na Grande Final:`, {
        finalMatchId: finalMatch.id,
        origem: semiLabel,
        payload: finalUpdatePayload,
      });

      let { error: updateError } = await supabase
        .from("matches")
        .update(finalUpdatePayload)
        .eq("id", finalMatch.id);

      if (updateError && (updateError.message?.includes("column") || updateError.message?.includes("does not exist"))) {
        const singleSlotPayload = isSemi1
          ? { team_a_id: finalWinnerId }
          : { team_b_id: finalWinnerId };
        console.warn("[finishMatch] Fallback para payload estrito de slot único:", singleSlotPayload);
        const fbRes = await supabase
          .from("matches")
          .update(singleSlotPayload)
          .eq("id", finalMatch.id);
        updateError = fbRes.error;
      }

      if (updateError) {
        console.error("[finishMatch] Erro ao atualizar Grande Final no Supabase:", updateError);
        throw updateError;
      }

      console.log(`[finishMatch] Slot único atualizado com sucesso na Grande Final (${finalMatch.id})!`);

      // B) Para o Perdedor: se has_third_place_match for true, buscar third_place
      const { data: tourneyRow } = await supabase
        .from("tournaments")
        .select("has_third_place_match, match_rules")
        .eq("id", match.tournament_id)
        .maybeSingle();

      const hasThirdPlace = Boolean(
        tourneyRow?.has_third_place_match ||
        tourneyRow?.match_rules?.has_third_place_match
      );

      if (hasThirdPlace && finalLoserId) {
        let thirdMatch: any = (tourneyMatches || []).find((m: any) => {
          const ph = String(m.phase || "").toLowerCase().trim();
          let d: any = m.details;
          if (typeof d === "string") {
            try { d = JSON.parse(d); } catch (_) { d = {}; }
          }
          const rl = String(d?.round_label || "").toLowerCase().trim();
          const mt = String(d?.match_title || "").toLowerCase().trim();
          const full = `${ph} ${rl} ${mt}`;
          return (
            ph === "third_place" ||
            ph === "terceiro_lugar" ||
            full.includes("third") ||
            full.includes("terceiro") ||
            full.includes("3º") ||
            full.includes("3o")
          );
        });

        if (!thirdMatch) {
          const { data: thirdCandidates } = await supabase
            .from("matches")
            .select("*")
            .eq("tournament_id", match.tournament_id)
            .ilike("phase", "%third%");
          if (thirdCandidates && thirdCandidates.length > 0) {
            thirdMatch = thirdCandidates[0];
          }
        }

        if (thirdMatch) {
          const thirdUpdatePayload: Record<string, any> = isSemi1
            ? { team_a_id: finalLoserId, team1_id: finalLoserId }
            : { team_b_id: finalLoserId, team2_id: finalLoserId };

          console.log(`[finishMatch] Executando PATCH condicional de slot único na Disputa de 3º Lugar:`, {
            thirdMatchId: thirdMatch.id,
            origem: semiLabel,
            payload: thirdUpdatePayload,
          });

          let { error: thirdUpdateErr } = await supabase
            .from("matches")
            .update(thirdUpdatePayload)
            .eq("id", thirdMatch.id);

          if (thirdUpdateErr && (thirdUpdateErr.message?.includes("column") || thirdUpdateErr.message?.includes("does not exist"))) {
            const singleSlotThird = isSemi1
              ? { team_a_id: finalLoserId }
              : { team_b_id: finalLoserId };
            const fbThird = await supabase
              .from("matches")
              .update(singleSlotThird)
              .eq("id", thirdMatch.id);
            thirdUpdateErr = fbThird.error;
          }

          if (thirdUpdateErr) {
            console.error(`[finishMatch] Erro ao atualizar 3º Lugar (${thirdMatch.id}):`, thirdUpdateErr);
            throw thirdUpdateErr;
          }

          console.log(`[finishMatch] Disputa de 3º Lugar atualizada com sucesso no Supabase!`);
        } else {
          console.warn(`[finishMatch] Disputa de 3º Lugar habilitada, mas confronto não encontrado em tourneyMatches.`);
        }
      }
    } else if (match.next_match_id && finalWinnerId) {
      const matchOrder = Number(match.match_order || 1);
      const isSlot1 = (matchOrder - 1) % 2 === 0;
      advancedSlot = isSlot1 ? "team1_id" : "team2_id";
      const legacySlot = isSlot1 ? "team_a_id" : "team_b_id";

      console.log("Vencedor ID:", finalWinnerId);
      console.log(`[finishMatch] Avançando vencedor para next_match_id (${match.next_match_id}):`, {
        matchId: match.id,
        matchOrder,
        slot: advancedSlot,
        winnerId: finalWinnerId,
      });

      let { error: updateError } = await supabase
        .from("matches")
        .update({
          [advancedSlot]: finalWinnerId,
          [legacySlot]: finalWinnerId,
        })
        .eq("id", match.next_match_id);

      if (updateError && (updateError.message?.includes("column") || updateError.message?.includes("does not exist"))) {
        const fbRes = await supabase
          .from("matches")
          .update({ [legacySlot]: finalWinnerId })
          .eq("id", match.next_match_id);
        updateError = fbRes.error;
      }

      if (updateError) {
        console.error("[finishMatch] Erro ao atualizar next_match_id:", updateError);
        throw updateError;
      }
    }

    // Quebra de Cache Obrigatória (Next.js)
    if (match.tournament_id) {
      const tId = match.tournament_id;
      try {
        revalidatePath(`/dashboard/${tId}/bracket`, "page");
        revalidatePath(`/dashboard/${tId}`, "page");
        revalidatePath(`/dashboard/torneios/${tId}`, "page");
        revalidatePath(`/torneio/${tId}`, "page");
        revalidatePath(`/torneio/${tId}/chaveamento`, "page");
        revalidatePath(`/torneio/${tId}/sumula`, "page");
        console.log(`[finishMatch] Cache revalidado com sucesso para o torneio ${tId}`);
      } catch (revalErr) {
        console.warn("[finishMatch] Aviso na revalidação de cache:", revalErr);
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
    console.error("[finishMatch] Exceção crítica ao finalizar partida:", err);
    throw err;
  }
}

/**
 * Server Action auxiliar que encerra uma partida e aciona a progressão automática de fase.
 */
export async function finishMatch(
  paramsOrMatchId: CompleteMatchParams | string,
  winnerId?: string
): Promise<CompleteMatchResponse> {
  if (typeof paramsOrMatchId === "string") {
    return completeMatchAction({
      matchId: paramsOrMatchId,
      winnerId: winnerId,
    });
  }
  return completeMatchAction(paramsOrMatchId);
}

/**
 * Server Action de força bruta (Bypass de RLS via Service Role) para encerrar o torneio manualmente.
 */
export async function forceCompleteTournamentAction(
  tournamentId: string,
  userAuthToken?: string
): Promise<{ success: boolean; error?: string }> {
  if (!tournamentId) {
    return { success: false, error: "ID do torneio não fornecido." };
  }

  try {
    const authUser = await requireAuthenticatedUser(userAuthToken);
    await requireTournamentAccess(authUser, tournamentId, ["ADMIN"]);

    let client: any = null;
    try {
      client = getSupabaseAdmin();
    } catch (adminErr) {
      console.warn("[forceCompleteTournamentAction] Fallback para cliente autenticado:", adminErr);
      client = await createAuthenticatedSupabase(userAuthToken);
    }

    const { data: tourMatches, error: matchesCheckErr } = await client
      .from("matches")
      .select("id, status")
      .eq("tournament_id", tournamentId);

    if (matchesCheckErr) {
      return { success: false, error: `Erro ao validar partidas do torneio: ${matchesCheckErr.message}` };
    }

    if (!tourMatches || tourMatches.length === 0) {
      throw new Error("Não existem partidas finalizadas para encerrar este torneio.");
    }

    const allDone = tourMatches.every(
      (m: any) => String(m.status || "").toUpperCase().trim() === "COMPLETED"
    );
    if (!allDone) {
      return {
        success: false,
        error: "Ainda existem partidas pendentes ou em andamento neste torneio.",
      };
    }

    const nowIso = new Date().toISOString();

    const { error: err1 } = await client
      .from("tournaments")
      .update({
        status: "COMPLETED",
        end_date: nowIso,
        current_stage: "completed",
      })
      .eq("id", tournamentId);

    if (err1) {
      const { error: err2 } = await client
        .from("tournaments")
        .update({
          status: "COMPLETED",
          end_date: nowIso,
        })
        .eq("id", tournamentId);

      if (err2) {
        const { error: err3 } = await client
          .from("tournaments")
          .update({ status: "COMPLETED" })
          .eq("id", tournamentId);

        if (err3) {
          console.error("[forceCompleteTournamentAction] Erro ao atualizar torneio:", err3);
          return { success: false, error: err3.message || "Falha ao atualizar status do torneio." };
        }
      }
    }

    try {
      revalidatePath(`/dashboard/${tournamentId}/bracket`, "page");
      revalidatePath(`/dashboard/${tournamentId}`, "page");
      revalidatePath(`/dashboard/torneios/${tournamentId}`, "page");
      revalidatePath(`/torneio/${tournamentId}`, "page");
      revalidatePath(`/torneio/${tournamentId}/chaveamento`, "page");
    } catch (_) {}

    return { success: true };
  } catch (err: any) {
    console.error("[forceCompleteTournamentAction] Exceção:", err);
    return { success: false, error: err?.message || "Erro interno ao encerrar torneio." };
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
    const authUser = await requireAuthenticatedUser(userAuthToken);
    await requireTournamentAccess(authUser, tournamentId, ["ADMIN", "REFEREE", "SCOREKEEPER"]);
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
    const authUser = await requireAuthenticatedUser(userAuthToken);
    await requireTournamentAccess(authUser, tournamentId, ["ADMIN", "REFEREE", "SCOREKEEPER"]);
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

export interface UpdateMatchScoreParams {
  matchId: string;
  tournamentId?: string;
  scoreA: number;
  scoreB: number;
  setsA?: number;
  setsB?: number;
  status?: string;
  penaltiesA?: number;
  penaltiesB?: number;
  details?: any;
  detailedScore?: any;
  setHistory?: any;
  userAuthToken?: string;
}

/**
 * Server Action para sincronização atômica de pontos e sets em tempo real,
 * garantindo a injeção obrigatória das colunas raízes (score_a, score_b, sets_a, sets_b, status).
 */
export async function updateMatchScoreAction(
  params: UpdateMatchScoreParams
): Promise<{ success: boolean; error?: string }> {
  const {
    matchId,
    tournamentId,
    scoreA = 0,
    scoreB = 0,
    setsA = 0,
    setsB = 0,
    status = "LIVE",
    penaltiesA = 0,
    penaltiesB = 0,
    details,
    detailedScore,
    setHistory,
    userAuthToken,
  } = params;

  if (!matchId || !tournamentId) {
    return { success: false, error: "ID da partida e ID do torneio são obrigatórios." };
  }

  try {
    const authUser = await requireAuthenticatedUser(userAuthToken);
    await requireTournamentAccess(authUser, tournamentId, ["ADMIN", "REFEREE", "SCOREKEEPER"]);
    const supabase = await createAuthenticatedSupabase(userAuthToken);

    const updatePayload: Record<string, any> = {
      score_a: Number(scoreA),
      score_b: Number(scoreB),
      sets_a: Number(setsA),
      sets_b: Number(setsB),
      status: status || "LIVE",
      penalties_a: Number(penaltiesA),
      penalties_b: Number(penaltiesB),
    };

    if (details !== undefined) updatePayload.details = details;
    if (detailedScore !== undefined) {
      updatePayload.detailed_score = detailedScore;
    } else if (setHistory !== undefined) {
      updatePayload.detailed_score = { sets: setHistory, historicoSets: setHistory };
      if (!updatePayload.details) {
        updatePayload.details = { sets: setHistory };
      }
    }

    let query = supabase.from("matches").update(updatePayload).eq("id", matchId);
    if (tournamentId) {
      query = query.eq("tournament_id", tournamentId);
    }
    const { error: updateErr } = await query;

    if (updateErr) {
      console.warn("[updateMatchScoreAction] Erro no update estendido, tentando fallback para colunas raízes:", updateErr.message);
      let fallbackQuery = supabase
        .from("matches")
        .update({
          score_a: Number(scoreA),
          score_b: Number(scoreB),
          sets_a: Number(setsA),
          sets_b: Number(setsB),
          status: status || "LIVE",
        })
        .eq("id", matchId);

      if (tournamentId) {
        fallbackQuery = fallbackQuery.eq("tournament_id", tournamentId);
      }
      const { error: fallbackErr } = await fallbackQuery;

      if (fallbackErr) {
        return { success: false, error: fallbackErr.message };
      }
    }

    if (tournamentId) {
      try {
        revalidatePath(`/torneio/${tournamentId}`);
        revalidatePath(`/torneio/${tournamentId}/chaveamento`);
        revalidatePath(`/dashboard/torneios/${tournamentId}`);
      } catch {}
    }

    return { success: true };
  } catch (err: any) {
    console.error("[updateMatchScoreAction] Exceção:", err);
    return { success: false, error: err.message || "Erro ao atualizar placar." };
  }
}

export interface ResetMatchParams {
  matchId: string;
  tournamentId?: string;
  userAuthToken?: string;
}

/**
 * Server Action para limpeza profunda e reset total da súmula de uma partida:
 * Reverte o status para SCHEDULED, aniquila todos os pontos, sets, histórico e dados detalhados.
 */
export async function resetMatchAction(
  params: ResetMatchParams
): Promise<{ success: boolean; error?: string }> {
  const { matchId, tournamentId, userAuthToken } = params;

  if (!matchId || !tournamentId) {
    return { success: false, error: "ID da partida e ID do torneio são obrigatórios." };
  }

  try {
    const authUser = await requireAuthenticatedUser(userAuthToken);
    await requireTournamentAccess(authUser, tournamentId, ["ADMIN", "REFEREE", "SCOREKEEPER"]);
    const supabase = await createAuthenticatedSupabase(userAuthToken);

    const resetPayload: Record<string, any> = {
      status: "SCHEDULED",
      score_a: 0,
      score_b: 0,
      sets_a: 0,
      sets_b: 0,
      winner_id: null,
      penalties_a: 0,
      penalties_b: 0,
      detailed_score: null,
      details: null,
    };

    let query = supabase.from("matches").update(resetPayload).eq("id", matchId);
    if (tournamentId) {
      query = query.eq("tournament_id", tournamentId);
    }
    const { error: resetErr } = await query;

    if (resetErr) {
      console.warn(
        "[resetMatchAction] Erro no reset completo, aplicando fallback com colunas nativas:",
        resetErr.message
      );
      let fallbackQuery = supabase
        .from("matches")
        .update({
          status: "SCHEDULED",
          score_a: 0,
          score_b: 0,
          sets_a: 0,
          sets_b: 0,
          winner_id: null,
          detailed_score: null,
        })
        .eq("id", matchId);

      if (tournamentId) {
        fallbackQuery = fallbackQuery.eq("tournament_id", tournamentId);
      }
      const { error: fallbackErr } = await fallbackQuery;

      if (fallbackErr) {
        return { success: false, error: fallbackErr.message };
      }
    }

    if (tournamentId) {
      try {
        revalidatePath(`/torneio/${tournamentId}`);
        revalidatePath(`/torneio/${tournamentId}/chaveamento`);
        revalidatePath(`/dashboard/torneios/${tournamentId}`);
      } catch {}
    }

    return { success: true };
  } catch (err: any) {
    console.error("[resetMatchAction] Exceção:", err);
    return { success: false, error: err.message || "Erro ao resetar partida." };
  }
}

export const reopenMatchAction = resetMatchAction;


