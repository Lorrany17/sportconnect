"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { MercadoPagoConfig, PaymentRefund as Refund } from "mercadopago";
import { notifyRegistrationCancelled, notifyTournamentRulesChanged } from "@/app/actions/notifications";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAuthenticatedUser, requireTournamentAccess } from "@/lib/serverAuth";

export interface CancelRegistrationParams {
  teamId: string;
  status?: "REQUESTED_BY_ATHLETE" | "REFUND_REQUESTED" | string;
  tournamentId?: string;
  userAuthToken?: string;
}

export interface CancelRegistrationResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Server Action para cancelamento de inscrição solicitado pelo atleta.
 * 
 * Regra de Segurança:
 * Antes de processar o cancelamento ou estorno, verifica o status atual do torneio na tabela 'tournaments'.
 * Se o status for diferente de 'OPEN' (ex: 'CLOSED', 'IN_PROGRESS', 'FINALIZADO'), a operação é abortada
 * e retorna o erro: "Não é possível cancelar a inscrição: o chaveamento do torneio já foi gerado."
 */
export async function cancelRegistration(
  teamIdOrParams: string | CancelRegistrationParams,
  cancellationStatus: "REQUESTED_BY_ATHLETE" | "REFUND_REQUESTED" | string = "REQUESTED_BY_ATHLETE",
  userAuthToken?: string
): Promise<CancelRegistrationResponse> {
  const teamId = typeof teamIdOrParams === "string" ? teamIdOrParams : teamIdOrParams?.teamId;
  const status =
    typeof teamIdOrParams === "string"
      ? cancellationStatus
      : teamIdOrParams?.status || cancellationStatus || "REQUESTED_BY_ATHLETE";
  let explicitToken = typeof teamIdOrParams === "string" ? userAuthToken : teamIdOrParams?.userAuthToken;

  if (!teamId) {
    return { success: false, error: "ID da inscrição não informado." };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { success: false, error: "Configuração do Supabase ausente no servidor." };
  }

  // Recupera token de autenticação dos cookies se não fornecido
  let authToken = explicitToken;
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

  const supabase = createClient(supabaseUrl, supabaseKey, {
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

  try {
    // 1. Busca a equipe inscrita e descobre o torneio vinculado
    const { data: team, error: teamErr } = await supabase
      .from("teams")
      .select("id, name, tournament_id, cancellation_status")
      .eq("id", teamId)
      .maybeSingle();

    if (teamErr) {
      console.error("Erro ao buscar equipe para cancelamento:", teamErr);
      return { success: false, error: `Erro ao buscar inscrição: ${teamErr.message}` };
    }

    if (!team) {
      return { success: false, error: "Inscrição não encontrada." };
    }

    const tournamentId =
      team.tournament_id ||
      (typeof teamIdOrParams !== "string" ? teamIdOrParams.tournamentId : undefined);

    if (!tournamentId) {
      return { success: false, error: "Torneio não vinculado a esta inscrição." };
    }

    // 2. Trava de Segurança no Servidor: Consulta o status atual do torneio
    const { data: tournament, error: tourErr } = await supabase
      .from("tournaments")
      .select("id, name, status, owner_id")
      .eq("id", tournamentId)
      .maybeSingle();

    if (tourErr) {
      console.error("Erro ao verificar status do torneio:", tourErr);
      return { success: false, error: `Erro ao consultar torneio: ${tourErr.message}` };
    }

    if (!tournament) {
      return { success: false, error: "Torneio correspondente não foi encontrado." };
    }

    // Se o status for diferente de 'OPEN' (ex: 'CLOSED', 'IN_PROGRESS', 'FINALIZADO', etc.)
    if (tournament.status !== "OPEN") {
      return {
        success: false,
        error: "Não é possível cancelar a inscrição: o chaveamento do torneio já foi gerado.",
      };
    }

    // 3. Atualiza o status de cancelamento da inscrição
    const { error: updateErr } = await supabase
      .from("teams")
      .update({ cancellation_status: status })
      .eq("id", teamId);

    if (updateErr) {
      console.error("Erro ao atualizar status de cancelamento:", updateErr);
      return { success: false, error: `Erro ao solicitar cancelamento: ${updateErr.message}` };
    }

    // 4. Disparo do Alerta para o Organizador na tabela 'notifications'
    if (tournament.owner_id) {
      try {
        const notificationMessage = `A equipe ${team.name} solicitou cancelamento na competição ${tournament.name}.`;
        const { error: notifErr } = await supabase.from("notifications").insert({
          user_id: tournament.owner_id,
          tournament_id: tournament.id,
          message: notificationMessage,
          is_read: false,
        });

        if (notifErr) {
          console.warn(
            "Aviso ao inserir notificação com tournament_id, tentando formato simplificado:",
            notifErr.message
          );
          await supabase.from("notifications").insert({
            user_id: tournament.owner_id,
            message: notificationMessage,
            is_read: false,
          });
        }
      } catch (notifEx) {
        console.warn("Exceção ao criar notificação para o organizador:", notifEx);
      }
    }

    revalidatePath(`/dashboard/torneios/${tournamentId}`);
    revalidatePath(`/dashboard/torneios/${tournamentId}/inscricoes`);
    revalidatePath(`/dashboard/${tournamentId}`);
    revalidatePath(`/torneio/${tournamentId}`);

    return {
      success: true,
      message: "Cancelamento solicitado com sucesso.",
    };
  } catch (err: any) {
    console.error("Exceção na Server Action cancelRegistration:", err);
    return {
      success: false,
      error: err?.message || "Ocorreu um erro inesperado ao cancelar a inscrição.",
    };
  }
}

/**
 * Alias com nome alternativo conforme especificação (withdrawFromTournament)
 */
export async function withdrawFromTournament(
  teamIdOrParams: string | CancelRegistrationParams,
  cancellationStatus: "REQUESTED_BY_ATHLETE" | "REFUND_REQUESTED" | string = "REQUESTED_BY_ATHLETE",
  userAuthToken?: string
): Promise<CancelRegistrationResponse> {
  return await cancelRegistration(teamIdOrParams, cancellationStatus, userAuthToken);
}


export interface UpdateRegistrationData {
  name?: string;
  manager_name?: string;
  player1?: string;
  player2?: string;
  roster?: string[];
  contact?: string;
  custom_registration_answers?: Record<string, any>;
  declared_skill_level?: string | null;
  members?: {
    user_id?: string | null;
    name: string;
    email: string;
    is_captain: boolean;
    cpf?: string | null;
    phone?: string | null;
  }[];
}

export interface UpdateRegistrationParams extends UpdateRegistrationData {
  teamId: string;
  tournamentId?: string;
  userAuthToken?: string;
}

export interface UpdateRegistrationResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: any;
}

/**
 * Server Action para editar dados da inscrição (nome, capitão e membros da equipe).
 *
 * Regra de Segurança:
 * Antes de realizar o UPDATE no Supabase, verifica o status do torneio correspondente.
 * Se o status for diferente de 'OPEN', aborta a operação e retorna o erro:
 * "Não é possível editar a inscrição: o chaveamento do torneio já foi gerado."
 */
export async function updateRegistration(
  teamIdOrParams: string | UpdateRegistrationParams,
  updatesArg?: UpdateRegistrationData,
  userAuthToken?: string
): Promise<UpdateRegistrationResponse> {
  const teamId = typeof teamIdOrParams === "string" ? teamIdOrParams : teamIdOrParams?.teamId;
  const updates: UpdateRegistrationData =
    typeof teamIdOrParams === "string" ? updatesArg || {} : teamIdOrParams;
  const explicitToken =
    typeof teamIdOrParams === "string" ? userAuthToken : teamIdOrParams?.userAuthToken;

  if (!teamId) {
    return { success: false, error: "ID da inscrição não informado." };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { success: false, error: "Configuração do Supabase ausente no servidor." };
  }

  let authToken = explicitToken;
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

  const supabase = createClient(supabaseUrl, supabaseKey, {
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

  try {
    // 1. Busca a equipe inscrita e descobre o torneio vinculado
    const { data: team, error: teamErr } = await supabase
      .from("teams")
      .select("id, name, tournament_id")
      .eq("id", teamId)
      .maybeSingle();

    if (teamErr) {
      console.error("Erro ao buscar equipe para edição:", teamErr);
      return { success: false, error: `Erro ao buscar inscrição: ${teamErr.message}` };
    }

    if (!team) {
      return { success: false, error: "Inscrição não encontrada." };
    }

    const tournamentId =
      team.tournament_id ||
      (typeof teamIdOrParams !== "string" ? teamIdOrParams.tournamentId : undefined);

    if (!tournamentId) {
      return { success: false, error: "Torneio não vinculado a esta inscrição." };
    }

    // 2. Trava de Segurança no Servidor: Consulta o status atual do torneio
    const { data: tournament, error: tourErr } = await supabase
      .from("tournaments")
      .select("id, name, status, owner_id")
      .eq("id", tournamentId)
      .maybeSingle();

    if (tourErr) {
      console.error("Erro ao verificar status do torneio para edição:", tourErr);
      return { success: false, error: `Erro ao consultar torneio: ${tourErr.message}` };
    }

    if (!tournament) {
      return { success: false, error: "Torneio correspondente não foi encontrado." };
    }

    if (tournament.status !== "OPEN") {
      return {
        success: false,
        error: "Não é possível editar a inscrição: o chaveamento do torneio já foi gerado.",
      };
    }

    // 3. Monta o payload de atualização da equipe
    const updatePayload: Record<string, any> = {};
    if (updates.name !== undefined) updatePayload.name = updates.name;
    if (updates.manager_name !== undefined) updatePayload.manager_name = updates.manager_name;
    if (updates.player1 !== undefined) updatePayload.player1 = updates.player1;
    if (updates.player2 !== undefined) updatePayload.player2 = updates.player2;
    if (updates.roster !== undefined) updatePayload.roster = updates.roster;
    if (updates.contact !== undefined) updatePayload.contact = updates.contact;
    if (updates.custom_registration_answers !== undefined) {
      // Higienização: remove variáveis internas que comecem com duplo underscore (ex: __athlete_members)
      const sanitizedAnswers: Record<string, any> = {};
      for (const [key, val] of Object.entries(updates.custom_registration_answers || {})) {
        if (!key.startsWith("__")) {
          sanitizedAnswers[key] = val;
        }
      }
      updatePayload.custom_registration_answers = sanitizedAnswers;
    }
    if (updates.declared_skill_level !== undefined) {
      updatePayload.declared_skill_level = updates.declared_skill_level;
    }

    const { data: updatedTeam, error: updateErr } = await supabase
      .from("teams")
      .update(updatePayload)
      .eq("id", teamId)
      .select()
      .single();

    if (updateErr) {
      console.error("Erro ao atualizar dados da inscrição:", updateErr);
      return { success: false, error: `Erro ao atualizar inscrição: ${updateErr.message}` };
    }

    // 4. Se a lista de membros foi informada, atualiza a tabela team_members
    if (Array.isArray(updates.members)) {
      try {
        await supabase.from("team_members").delete().eq("team_id", teamId);
        const rows = updates.members.map((m) => ({
          team_id: teamId,
          user_id: m.user_id || null,
          name: m.name,
          email: m.email || "",
          is_captain: Boolean(m.is_captain),
          ...(m.cpf !== undefined ? { cpf: m.cpf || null } : {}),
          ...(m.phone !== undefined ? { phone: m.phone || null } : {}),
        }));
        if (rows.length > 0) {
          const { error: tmErr } = await supabase.from("team_members").insert(rows);
          if (tmErr) {
            console.error("Erro ao vincular membros em team_members:", tmErr);
            return { success: false, error: `Erro ao vincular membros da equipe: ${tmErr.message}` };
          }
        }
      } catch (tmErr) {
        console.warn("Aviso ao atualizar team_members na edição:", tmErr);
      }
    }

    return {
      success: true,
      message: "Inscrição atualizada com sucesso.",
      data: updatedTeam,
    };
  } catch (err: any) {
    console.error("Exceção na Server Action updateRegistration:", err);
    return {
      success: false,
      error: err?.message || "Ocorreu um erro inesperado ao editar a inscrição.",
    };
  }
}

/**
 * Alias com nome alternativo conforme especificação (editTeamMembers)
 */
export async function editTeamMembers(
  teamIdOrParams: string | UpdateRegistrationParams,
  updatesArg?: UpdateRegistrationData,
  userAuthToken?: string
): Promise<UpdateRegistrationResponse> {
  return await updateRegistration(teamIdOrParams, updatesArg, userAuthToken);
}

export interface ConfirmCancellationResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: any;
  refund?: any;
}

/**
 * Server Action para confirmar o cancelamento de inscrição e estornar Pix (Organizador).
 *
 * - Envolve toda a comunicação com Mercado Pago e Supabase em try/catch.
 * - Se a API de pagamento retornar erro (ex: saldo insuficiente, credenciais inválidas), interrompe com throw new Error.
 * - Aguarda o update definitivo no Supabase ({ status: 'CANCELLED', payment_status: 'CANCELED', cancellation_status: 'REFUNDED' }).
 * - Revalida o cache das rotas do organizador e da vitrine pública via revalidatePath.
 */
export async function confirmCancellation(
  teamId: string,
  userAuthToken?: string
): Promise<ConfirmCancellationResponse> {
  if (!teamId) {
    return { success: false, error: "ID da inscrição não informado." };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { success: false, error: "Configuração do Supabase ausente no servidor." };
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

  const supabase = createClient(supabaseUrl, supabaseKey, {
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

  try {
    // 1. Buscar a equipe no Supabase para obter mp_payment_id e tournament_id
    const { data: team, error: teamError } = await supabase
      .from("teams")
      .select("id, name, mp_payment_id, payment_status, status, cancellation_status, tournament_id, user_id, tournaments(name)")
      .eq("id", teamId)
      .maybeSingle();

    if (teamError) {
      throw new Error(`Erro ao consultar inscrição no banco de dados: ${teamError.message}`);
    }

    if (!team) {
      throw new Error("Inscrição não encontrada no banco de dados.");
    }

    const tournamentId = team.tournament_id;

    // 2. Trava de Segurança: Verificar se o torneio ainda permite cancelamento/estorno
    if (tournamentId) {
      const { data: tournament, error: tourError } = await supabase
        .from("tournaments")
        .select("id, status")
        .eq("id", tournamentId)
        .maybeSingle();

      if (tourError) {
        throw new Error(`Erro ao verificar status do torneio: ${tourError.message}`);
      }

      if (tournament && tournament.status !== "OPEN") {
        throw new Error("Não é possível cancelar a inscrição: o chaveamento do torneio já foi gerado.");
      }
    }

    // 3. Comunicação com a API de pagamento (Mercado Pago)
    // Se houver pagamento vinculado (mp_payment_id) ou pagamento confirmado via MP, tenta o estorno e interrompe em caso de erro
    let refundResult = null;
    if (team.mp_payment_id) {
      const mpAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
      if (!mpAccessToken) {
        throw new Error(
          "Credenciais do Mercado Pago ausentes no servidor (MERCADOPAGO_ACCESS_TOKEN). Não foi possível realizar o estorno."
        );
      }

      try {
        const mpClient = new MercadoPagoConfig({ accessToken: mpAccessToken });
        const refundClient = new Refund(mpClient);
        refundResult = await refundClient.create({
          payment_id: team.mp_payment_id,
        });
      } catch (mpError: any) {
        const apiDetail =
          mpError?.cause?.[0]?.description ||
          mpError?.message ||
          "Saldo insuficiente, pagamento não elegível ou credenciais inválidas no ambiente de teste.";
        throw new Error(`Erro na API do Mercado Pago ao estornar Pix: ${apiDetail}`);
      }
    }

    // 4. Update Definitivo no Supabase (aguardado com await e validado)
    const { data: updatedTeam, error: updateError } = await supabase
      .from("teams")
      .update({
        status: "CANCELLED",
        payment_status: "CANCELED",
        cancellation_status: "REFUNDED",
      })
      .eq("id", teamId)
      .select()
      .single();

    if (updateError || !updatedTeam) {
      throw new Error(
        updateError?.message ||
        "Falha ao persistir o cancelamento no Supabase (nenhum registro atualizado ou permissão negada pelas políticas RLS)."
      );
    }

    // 4.1 Notificar atleta sobre o cancelamento/estorno (Gatilho: Organizador -> Atleta)
    try {
      const athleteUserId = (team as any).user_id || updatedTeam.user_id;
      const tournamentName = (team as any).tournaments?.name;
      await notifyRegistrationCancelled({
        teamId: updatedTeam.id,
        userId: athleteUserId,
        tournamentId: tournamentId,
        tournamentName: tournamentName,
      });
    } catch (notifErr) {
      console.error("[NOTIFICATIONS ERROR]: Falha ao disparar notificação de cancelamento para atleta -", notifErr);
    }

    // 5. Revalidação de Cache (Next.js)
    if (tournamentId) {
      revalidatePath(`/dashboard/torneios/${tournamentId}`);
      revalidatePath(`/torneio/${tournamentId}`);
    }
    revalidatePath("/admin");
    revalidatePath("/hub");

    return {
      success: true,
      message: "Inscrição cancelada e Pix estornado com sucesso!",
      data: updatedTeam,
      refund: refundResult,
    };
  } catch (err: any) {
    console.error("Erro na Server Action confirmCancellation:", err);
    return {
      success: false,
      error: err?.message || "Erro ao confirmar cancelamento e processar estorno.",
    };
  }
}

/**
 * Alias com nome alternativo conforme especificação (refundPix)
 */
export async function refundPix(
  teamId: string,
  userAuthToken?: string
): Promise<ConfirmCancellationResponse> {
  return await confirmCancellation(teamId, userAuthToken);
}

export interface NotifyRequirementsParams {
  tournamentId: string;
  previousRequirements: {
    require_cpf?: boolean;
    require_phone?: boolean;
    require_skill_level?: boolean;
    skill_level?: string | null;
  };
  newRequirements: {
    require_cpf?: boolean;
    require_phone?: boolean;
    require_skill_level?: boolean;
    skill_level?: string | null;
  };
}

export interface NotifyRequirementsResponse {
  success: boolean;
  notifiedCount: number;
  message?: string;
  error?: string;
}

/**
 * Server Action para notificação automática de atletas quando novas regras/exigências
 * (require_cpf, require_phone, require_skill_level) são adicionadas a um torneio que já possui inscritos.
 */
export async function notifyNewTournamentRequirements(
  params: NotifyRequirementsParams
): Promise<NotifyRequirementsResponse> {
  const { tournamentId, previousRequirements, newRequirements } = params;

  if (!tournamentId) {
    return { success: false, notifiedCount: 0, error: "ID do torneio não informado." };
  }

  // Verifica se uma nova regra foi ativada
  const isCpfNew = !previousRequirements.require_cpf && Boolean(newRequirements.require_cpf);
  const isPhoneNew = !previousRequirements.require_phone && Boolean(newRequirements.require_phone);
  const isSkillLevelNew =
    (!previousRequirements.require_skill_level && Boolean(newRequirements.require_skill_level)) ||
    ((!previousRequirements.skill_level || previousRequirements.skill_level === "ALL") &&
      Boolean(newRequirements.skill_level && newRequirements.skill_level !== "ALL"));

  if (!isCpfNew && !isPhoneNew && !isSkillLevelNew) {
    return { success: true, notifiedCount: 0, message: "Nenhuma nova exigência ativada." };
  }

  const res = await notifyTournamentRulesChanged({ tournamentId });
  return {
    success: res.success,
    notifiedCount: res.notifiedCount,
    error: res.error,
  };
}

/**
 * Server Action para exclusão definitiva de equipe órfã (Rollback com bypass de RLS via Supabase Admin).
 * Chamada quando a inserção subsequente de membros ou checkout falha, garantindo que
 * nenhuma equipe "fantasma" sem elenco fique salva no banco de dados.
 */
export async function deleteOrphanTeam(teamId: string): Promise<{ success: boolean; error?: string }> {
  if (!teamId) {
    return { success: false, error: "ID da equipe não informado." };
  }

  try {
    await requireAuthenticatedUser();
    const supabaseAdmin = getSupabaseAdmin();
    console.warn(`[ROLLBACK ADMIN] Iniciando exclusão forçada da equipe órfã ${teamId}...`);

    // 1. Deletar dependências em team_members
    await supabaseAdmin.from("team_members").delete().eq("team_id", teamId);

    // 2. Deletar a equipe em si
    const { error: delError } = await supabaseAdmin.from("teams").delete().eq("id", teamId);

    if (delError) {
      console.error("[ROLLBACK ADMIN ERROR] Erro ao deletar equipe órfã no banco:", delError);
      return { success: false, error: delError.message };
    }

    console.log(`[ROLLBACK ADMIN SUCCESS] Equipe órfã ${teamId} deletada com sucesso.`);
    return { success: true };
  } catch (err: any) {
    console.error("[ROLLBACK ADMIN EXCEPTION]:", err);
    return { success: false, error: err?.message || "Exceção ao deletar equipe órfã." };
  }
}

export interface ManualTeamMemberInput {
  name: string;
  email?: string;
  is_captain: boolean;
  cpf?: string | null;
  phone?: string | null;
}

export interface AddManualTeamParams {
  tournamentId: string;
  name: string;
  managerName: string;
  player1: string;
  player2?: string;
  roster?: string[];
  contact?: string;
  captainEmail?: string;
  category: string;
  status: string;
  paymentStatus: string;
  declaredSkillLevel?: string | null;
  customResponses: Record<string, any>;
  members?: ManualTeamMemberInput[];
}

export interface AddManualTeamResponse {
  success: boolean;
  team?: any;
  members?: any[];
  error?: string;
}

/**
 * Server Action para salvar inscrição manual garantindo que todos os campos não nativos
 * da tabela `teams` (CPF, Contato, E-mail, Nível Técnico, Jogador 2, perguntas customizadas, etc.)
 * sejam agrupados e persistidos de forma segura na coluna JSONB (`custom_responses` e `custom_registration_answers`).
 */
export async function addManualTeam(params: AddManualTeamParams): Promise<AddManualTeamResponse> {
  const {
    tournamentId,
    name,
    managerName,
    player1,
    player2 = "",
    roster = [],
    contact = "",
    category,
    status,
    paymentStatus,
    declaredSkillLevel = null,
    customResponses = {},
    members = [],
  } = params;

  if (!tournamentId || !name) {
    return { success: false, error: "Torneio e nome da inscrição são obrigatórios." };
  }

  try {
    const authUser = await requireAuthenticatedUser();
    await requireTournamentAccess(authUser, tournamentId, ["ADMIN"]);
    const supabaseAdmin = getSupabaseAdmin();

    const { data: tourCheck } = await supabaseAdmin
      .from("tournaments")
      .select("status")
      .eq("id", tournamentId)
      .maybeSingle();

    if (
      tourCheck &&
      ["COMPLETED", "FINALIZADO", "FINISHED", "CONCLUIDO"].includes(
        String(tourCheck.status || "").toUpperCase().trim()
      )
    ) {
      throw new Error("Ações não permitidas em torneios finalizados.");
    }

    // Limpa valores vazios e preserva todos os metadados e campos personalizados na estrutura JSONB
    const sanitizedCustomResponses: Record<string, any> = {};
    Object.entries(customResponses || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        sanitizedCustomResponses[key] = value;
      }
    });

    // Inclui backup estruturado dos membros dentro de custom_registration_answers
    const jsonbWithBackup: Record<string, any> = {
      ...sanitizedCustomResponses,
      ...(members.length > 0 ? { __athlete_members: members } : {}),
    };

    const captainEmail =
      params.captainEmail ||
      members.find((m) => m.is_captain)?.email ||
      customResponses["E-mail do Capitão"] ||
      customResponses["E-mail"] ||
      "";

    const insertPayload: Record<string, any> = {
      tournament_id: tournamentId,
      name,
      manager_name: managerName || player1,
      player1,
      player2: player2 || "",
      roster,
      contact,
      ...(captainEmail ? { captain_email: captainEmail } : {}),
      category,
      status,
      payment_status: paymentStatus,
      declared_skill_level: declaredSkillLevel,
      custom_responses: sanitizedCustomResponses,
      custom_registration_answers: jsonbWithBackup,
    };

    let insertedTeam: any = null;
    let insertError: any = null;
    const currentPayload = { ...insertPayload };

    // Tentativa resiliente: caso o banco ainda não tenha alguma coluna opcional (ex: custom_responses),
    // remove apenas a coluna ausente no cache do PostgREST e preserva os dados em custom_registration_answers.
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await supabaseAdmin
        .from("teams")
        .insert(currentPayload as any)
        .select()
        .single();

      insertedTeam = res.data;
      insertError = res.error;

      if (!insertError) break;

      const errMsg = String(insertError.message || "");
      const errDetails = String(insertError.details || "");
      const combined = `${errMsg} ${errDetails}`;

      // Detecta coluna inexistente reportada pelo PostgREST / PostgreSQL
      const matchCol =
        combined.match(/Could not find the '([^']+)' column/i) ||
        combined.match(/column "([^"]+)" of relation "teams" does not exist/i) ||
        combined.match(/column teams\.([a-zA-Z0-9_]+) does not exist/i);

      if (matchCol && matchCol[1] && matchCol[1] in currentPayload) {
        const missingCol = matchCol[1];
        console.warn(`[addManualTeam] Coluna '${missingCol}' ausente no schema de teams. Removendo do payload e tentando novamente...`);
        delete currentPayload[missingCol];
        continue;
      }

      if ("custom_responses" in currentPayload && combined.toLowerCase().includes("custom_responses")) {
        delete currentPayload.custom_responses;
        continue;
      }

      break;
    }

    if (insertError || !insertedTeam) {
      console.error("[addManualTeam] Erro ao inserir equipe:", insertError);
      return {
        success: false,
        error: insertError?.message || "Não foi possível salvar a inscrição no banco de dados.",
      };
    }

    // Inserção padronizada dos integrantes em team_members
    const insertedMembersResult: any[] = [];
    if (members.length > 0) {
      const dbMembersPayload: any[] = [];

      for (let idx = 0; idx < members.length; idx++) {
        const m = members[idx];
        let matchedUserId: string | null = null;
        const cleanEmail = (m.email || "").trim().toLowerCase();

        if (cleanEmail) {
          try {
            const { data: profileFound } = await supabaseAdmin
              .from("profiles")
              .select("id")
              .eq("email", cleanEmail)
              .maybeSingle();
            if (profileFound?.id) {
              matchedUserId = profileFound.id;
            }
          } catch {
            // ignore
          }
        }

        const memberRecord = {
          team_id: insertedTeam.id,
          user_id: matchedUserId,
          name: m.name,
          email: cleanEmail,
          is_captain: Boolean(m.is_captain),
          ...(m.cpf ? { cpf: m.cpf } : {}),
          ...(m.phone ? { phone: m.phone } : {}),
        };

        dbMembersPayload.push(memberRecord);
        insertedMembersResult.push({
          id: `${insertedTeam.id}-${idx}`,
          ...memberRecord,
        });
      }

      if (dbMembersPayload.length > 0) {
        const { error: tmErr } = await supabaseAdmin.from("team_members").insert(dbMembersPayload);
        if (tmErr) {
          console.warn("[addManualTeam] Aviso ao inserir em team_members com cpf/phone, tentando payload básico:", tmErr.message);
          const fallbackMembersPayload = dbMembersPayload.map((item) => ({
            team_id: item.team_id,
            user_id: item.user_id,
            name: item.name,
            email: item.email,
            is_captain: item.is_captain,
          }));
          await supabaseAdmin.from("team_members").insert(fallbackMembersPayload);
        }
      }
    }

    try {
      revalidatePath(`/tournaments/${tournamentId}`);
      revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    } catch {
      // ignore revalidation errors in client contexts
    }

    return {
      success: true,
      team: {
        ...insertedTeam,
        custom_responses:
          insertedTeam.custom_responses ||
          insertedTeam.custom_registration_answers ||
          sanitizedCustomResponses,
        custom_registration_answers:
          insertedTeam.custom_registration_answers ||
          insertedTeam.custom_responses ||
          jsonbWithBackup,
      },
      members: insertedMembersResult,
    };
  } catch (err: any) {
    console.error("[addManualTeam] Exceção:", err);
    return {
      success: false,
      error: err?.message || "Erro interno ao processar inscrição manual.",
    };
  }
}

/**
 * Server Action para submissão segura de comprovante de pagamento pelo atleta (BUG-01).
 * Valida a sessão autenticada, verifica que o usuário é o dono da equipe (user_id)
 * ou organizador do torneio, e atualiza o status para WAITING_APPROVAL de forma atômica.
 */
export async function submitPaymentProofAction(
  teamId: string,
  filePath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const authUser = await requireAuthenticatedUser();
    if (!teamId || !filePath) {
      return { success: false, error: "Identificador da equipe ou caminho do arquivo inválido." };
    }

    const adminClient = getSupabaseAdmin();
    const { data: team, error: teamErr } = await adminClient
      .from("teams")
      .select("id, user_id, tournament_id, status, payment_status")
      .eq("id", teamId)
      .maybeSingle();

    if (teamErr || !team) {
      return { success: false, error: "Equipe não encontrada." };
    }

    // Verifica se o usuário autenticado é o capitão ou se é Super Admin / dono do torneio
    const isTeamOwner = team.user_id === authUser.id;
    if (!isTeamOwner) {
      const { data: tour } = await adminClient
        .from("tournaments")
        .select("owner_id")
        .eq("id", team.tournament_id)
        .maybeSingle();
      const isTourOwner = tour?.owner_id === authUser.id;

      const { data: prof } = await adminClient
        .from("profiles")
        .select("is_admin")
        .eq("id", authUser.id)
        .maybeSingle();
      const isSuperAdmin = prof?.is_admin === true;

      if (!isTourOwner && !isSuperAdmin) {
        return { success: false, error: "Permissão negada para atualizar o comprovante desta equipe." };
      }
    }

    const { error: updateErr } = await adminClient
      .from("teams")
      .update({
        payment_proof_url: filePath,
        payment_status: "WAITING_APPROVAL",
      })
      .eq("id", teamId);

    if (updateErr) {
      return { success: false, error: "Erro ao registrar comprovante: " + updateErr.message };
    }

    try {
      revalidatePath(`/torneio/${team.tournament_id}`);
      revalidatePath(`/dashboard/tournaments/${team.tournament_id}`);
    } catch {
      // ignore revalidation error
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro interno ao processar comprovante.";
    return { success: false, error: msg };
  }
}


