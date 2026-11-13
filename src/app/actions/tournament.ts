"use server";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { revalidatePath } from "next/cache";

export interface DeleteTournamentResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Server Action para exclusão definitiva de um torneio pelo organizador.
 *
 * 1. Valida se existem inscrições ATIVAS vinculadas ao torneio.
 *    Inscrições com status 'CANCELLED', 'REJECTED' ou payment_status 'CANCELED' são explicitamente ignoradas.
 * 2. Se houver inscrições ativas, bloqueia a exclusão com mensagem explicativa.
 * 3. Se não houver inscrições ativas, executa a exclusão em cascata (cascading delete)
 *    de todos os registros filhos dependentes (team_members, teams, matches, notifications, staff, etc.)
 *    e por fim deleta o torneio pai.
 */
export async function deleteTournament(tournamentId: string): Promise<DeleteTournamentResponse> {
  if (!tournamentId) {
    return { success: false, error: "ID do torneio não informado." };
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Valida se existem inscrições ATIVAS (ignora CANCELLED e REJECTED)
    const { data: teamsData, error: teamsError } = await supabaseAdmin
      .from("teams")
      .select("id, status, payment_status, cancellation_status", { count: "exact" })
      .eq("tournament_id", tournamentId)
      .neq("status", "CANCELLED")
      .neq("status", "REJECTED");

    if (teamsError) {
      console.error("[Tournament Action] Erro ao verificar equipes:", teamsError);
      return { success: false, error: teamsError.message };
    }

    const activeTeams = (teamsData || []).filter(
      (t) =>
        t.status !== "CANCELLED" &&
        t.status !== "REJECTED" &&
        t.payment_status !== "CANCELED" &&
        t.payment_status !== "CANCELLED" &&
        t.payment_status !== "REJECTED" &&
        t.cancellation_status !== "REFUNDED"
    );

    if (activeTeams.length > 0) {
      return {
        success: false,
        error:
          "Não é possível excluir um torneio com inscrições ativas. Cancele o torneio ou remova as inscrições primeiro.",
      };
    }

    // 2. Cascading Delete Manual: Exclui registros filhos para evitar conflitos de Foreign Key
    // A. Buscar IDs de todas as equipes (inclusive as canceladas) deste torneio para limpar membros
    const { data: allTournamentTeams } = await supabaseAdmin
      .from("teams")
      .select("id")
      .eq("tournament_id", tournamentId);

    const teamIds = allTournamentTeams?.map((t) => t.id).filter(Boolean) || [];
    if (teamIds.length > 0) {
      await supabaseAdmin.from("team_members").delete().in("team_id", teamIds);
    }

    // B. Excluir equipes vinculadas
    await supabaseAdmin.from("teams").delete().eq("tournament_id", tournamentId);

    // C. Excluir partidas do torneio
    await supabaseAdmin.from("matches").delete().eq("tournament_id", tournamentId);

    // D. Excluir notificações vinculadas ao torneio
    await supabaseAdmin.from("notifications").delete().eq("tournament_id", tournamentId);

    // E. Excluir equipe/staff do torneio
    try {
      await supabaseAdmin.from("tournament_staff").delete().eq("tournament_id", tournamentId);
    } catch {}

    // F. Excluir patrocinadores do torneio
    try {
      await supabaseAdmin.from("tournament_sponsors").delete().eq("tournament_id", tournamentId);
    } catch {}

    // G. Excluir campos personalizados de inscrição
    try {
      await supabaseAdmin.from("tournament_custom_fields").delete().eq("tournament_id", tournamentId);
    } catch {}

    // 3. Exclui o torneio pai
    const { error: deleteTourError } = await supabaseAdmin
      .from("tournaments")
      .delete()
      .eq("id", tournamentId);

    if (deleteTourError) {
      console.error("[Tournament Action] Erro ao deletar torneio pai:", deleteTourError);
      return { success: false, error: deleteTourError.message };
    }

    // 4. Revalida caches
    revalidatePath("/hub");
    revalidatePath("/explorar");
    revalidatePath("/admin");
    revalidatePath(`/torneio/${tournamentId}`);

    return {
      success: true,
      message: "Torneio e registros vinculados excluídos com sucesso.",
    };
  } catch (err: any) {
    console.error("[Tournament Action] Exceção ao excluir torneio:", err);
    return {
      success: false,
      error: err?.message || "Ocorreu um erro inesperado ao excluir o torneio.",
    };
  }
}

export interface InviteStaffParams {
  tournamentId: string;
  email: string;
  role: "ADMIN" | "REFEREE" | "SCOREKEEPER";
}

export interface InviteStaffResponse {
  success: boolean;
  message?: string;
  error?: string;
  staff?: any;
}

/**
 * Server Action para convidar um membro da equipe (Staff / Arbitragem).
 *
 * 1. Insere o registro na tabela tournament_staff usando supabaseAdmin.
 * 2. Identifica se o e-mail convidado já possui conta no sistema (auth.users).
 * 3. Dispara notificação no sino do usuário convidado:
 *    "Você foi convidado para ser [cargo] no torneio [nome do torneio]"
 * 4. Revalida caches de /hub e do torneio.
 */
export async function inviteTournamentStaff(
  params: InviteStaffParams
): Promise<InviteStaffResponse> {
  const { tournamentId, email, role } = params;

  if (!tournamentId || !email || !role) {
    return { success: false, error: "Dados incompletos para envio do convite." };
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    return { success: false, error: "Por favor, informe um endereço de e-mail válido." };
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Obter informações básicas do torneio
    const { data: tour, error: tourErr } = await supabaseAdmin
      .from("tournaments")
      .select("id, name, owner_id")
      .eq("id", tournamentId)
      .maybeSingle();

    if (tourErr || !tour) {
      return { success: false, error: "Torneio não encontrado." };
    }

    // 2. Bloquear caso seja o e-mail do próprio dono
    if (tour.owner_id) {
      try {
        const { data: ownerData } = await supabaseAdmin.auth.admin.getUserById(tour.owner_id);
        if (ownerData?.user?.email?.toLowerCase().trim() === cleanEmail) {
          return { success: false, error: "Este e-mail pertence ao proprietário do torneio." };
        }
      } catch (ownerErr) {
        console.warn("[inviteTournamentStaff] Aviso ao verificar proprietário:", ownerErr);
      }
    }

    // 3. Localizar se o convidado já é um usuário cadastrado
    let targetUserId: string | null = null;
    try {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      const foundUser = usersData?.users?.find(
        (u) => u.email?.toLowerCase().trim() === cleanEmail
      );
      if (foundUser) {
        targetUserId = foundUser.id;
      }
    } catch (uErr) {
      console.warn("[inviteTournamentStaff] Aviso ao buscar lista de usuários:", uErr);
    }

    // 4. Inserir no tournament_staff
    const staffPayload: any = {
      tournament_id: tournamentId,
      email: cleanEmail,
      role: role,
    };
    if (targetUserId) {
      staffPayload.user_id = targetUserId;
    }

    const { data: staffData, error: staffErr } = await supabaseAdmin
      .from("tournament_staff")
      .insert(staffPayload)
      .select()
      .single();

    if (staffErr) {
      console.error("[inviteTournamentStaff] Erro ao inserir staff:", staffErr);
      if (staffErr.code === "23505" || staffErr.message?.includes("unique")) {
        return {
          success: false,
          error: "Este e-mail já possui convite ou permissão ativa neste torneio.",
        };
      }
      return { success: false, error: "Não foi possível enviar o convite." };
    }

    // 5. Integração com Notificações (Sino)
    const roleLabels: Record<string, string> = {
      ADMIN: "Administrador",
      REFEREE: "Árbitro",
      SCOREKEEPER: "Mesário",
    };
    const cargo = roleLabels[role] || role;
    const tourName = tour.name || "Campeonato";
    const notifMessage = `Você foi convidado para ser ${cargo} no torneio ${tourName}.`;

    if (targetUserId) {
      try {
        await supabaseAdmin.from("notifications").insert({
          user_id: targetUserId,
          tournament_id: tournamentId,
          message: notifMessage,
          is_read: false,
        });
      } catch (notifErr) {
        console.warn("[inviteTournamentStaff] Aviso ao inserir notificação:", notifErr);
      }
    }

    // 6. Revalidação de caminhos
    revalidatePath("/hub");
    revalidatePath(`/dashboard/${tournamentId}`);
    revalidatePath(`/torneio/${tournamentId}`);

    return {
      success: true,
      message: "Convite enviado com sucesso!",
      staff: staffData,
    };
  } catch (err: any) {
    console.error("[inviteTournamentStaff] Exceção:", err);
    return {
      success: false,
      error: err?.message || "Ocorreu um erro inesperado ao enviar o convite.",
    };
  }
}

export interface SyncStaffResult {
  linkedCount: number;
  sharedTournaments: any[];
}

/**
 * Realiza o auto-vínculo de registros de tournament_staff com base no e-mail do usuário autenticado.
 * 
 * 1. Localiza convites pendentes (user_id nulo) para o e-mail do usuário logado.
 * 2. Atualiza tournament_staff preenchendo user_id com o ID do usuário.
 * 3. Dispara notificação retroativa no sino ("Você foi convidado para ser [cargo] no torneio [nome]") caso ainda não tenha sido gerada.
 * 4. Retorna a lista de registros de staff para exibição imediata no HubCentral.
 */
export async function syncUserStaffAndNotifications(
  userId: string,
  userEmail: string
): Promise<SyncStaffResult> {
  if (!userId || !userEmail) {
    return { linkedCount: 0, sharedTournaments: [] };
  }

  const cleanEmail = userEmail.trim().toLowerCase();

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Buscar todos os registros de tournament_staff vinculados ao user_id ou e-mail
    const { data: staffRows, error: staffErr } = await supabaseAdmin
      .from("tournament_staff")
      .select("id, tournament_id, role, user_id, email, tournaments(*)")
      .or(`user_id.eq.${userId},email.ilike.${cleanEmail}`);

    if (staffErr || !staffRows) {
      console.warn("[syncUserStaffAndNotifications] Aviso ao buscar staff:", staffErr);
      return { linkedCount: 0, sharedTournaments: [] };
    }

    let linkedCount = 0;
    const roleLabels: Record<string, string> = {
      ADMIN: "Administrador",
      REFEREE: "Árbitro",
      SCOREKEEPER: "Mesário",
    };

    // 2. Auto-vínculo e Notificação Retroativa
    for (const row of staffRows) {
      const isMyEmail = row.email && row.email.toLowerCase().trim() === cleanEmail;

      if (isMyEmail && (!row.user_id || row.user_id !== userId)) {
        await supabaseAdmin
          .from("tournament_staff")
          .update({ user_id: userId })
          .eq("id", row.id);

        row.user_id = userId;
        linkedCount++;
      }

      // 3. Garantir disparo da notificação retroativa
      if (row.tournament_id) {
        try {
          const { data: existingNotif } = await supabaseAdmin
            .from("notifications")
            .select("id")
            .eq("user_id", userId)
            .eq("tournament_id", row.tournament_id)
            .maybeSingle();

          if (!existingNotif) {
            const joinedTour = Array.isArray(row.tournaments) ? row.tournaments[0] : row.tournaments;
            const tourName = joinedTour?.name || "Campeonato";
            const cargo = roleLabels[row.role] || row.role;
            const message = `Você foi convidado para ser ${cargo} no torneio ${tourName}.`;

            await supabaseAdmin.from("notifications").insert({
              user_id: userId,
              tournament_id: row.tournament_id,
              message,
              is_read: false,
            });
          }
        } catch (notifErr) {
          console.warn("[syncUserStaffAndNotifications] Aviso ao criar notificação retroativa:", notifErr);
        }
      }
    }

    return { linkedCount, sharedTournaments: staffRows };
  } catch (err) {
    console.error("[syncUserStaffAndNotifications] Exceção:", err);
    return { linkedCount: 0, sharedTournaments: [] };
  }
}

export interface UploadRegulationResponse {
  success: boolean;
  publicUrl?: string;
  error?: string;
}

/**
 * Server Action para upload seguro do Regulamento Oficial em PDF no Supabase Storage.
 * Garante que o bucket 'tournament-documents' exista e seja público antes de enviar o arquivo.
 */
export async function uploadTournamentRegulationPdf(
  formData: FormData
): Promise<UploadRegulationResponse> {
  try {
    const file = formData.get("file") as File | null;
    if (!file) {
      return { success: false, error: "Nenhum ficheiro PDF recebido para upload." };
    }

    const supabaseAdmin = getSupabaseAdmin();
    const bucketName = "tournament-documents";

    // 1. Garantir que o bucket 'tournament-documents' existe e está configurado como público
    try {
      const { data: bucketInfo, error: getBucketErr } =
        await supabaseAdmin.storage.getBucket(bucketName);

      if (getBucketErr || !bucketInfo) {
        await supabaseAdmin.storage.createBucket(bucketName, {
          public: true,
          fileSizeLimit: 15 * 1024 * 1024,
        });
      } else if (!bucketInfo.public) {
        await supabaseAdmin.storage.updateBucket(bucketName, {
          public: true,
        });
      }
    } catch (bucketSetupErr) {
      console.warn("[uploadTournamentRegulationPdf] Aviso ao verificar bucket:", bucketSetupErr);
    }

    const cleanDocName = (file.name || "regulamento.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueDocName = `regulamento_${Date.now()}_${cleanDocName}`;
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // 2. Upload no bucket 'tournament-documents' via Service Role (bypass de RLS de escrita)
    const { error: uploadErr } = await supabaseAdmin.storage
      .from(bucketName)
      .upload(uniqueDocName, fileBuffer, {
        contentType: "application/pdf",
        cacheControl: "3600",
        upsert: true,
      });

    if (!uploadErr) {
      const { data: urlData } = supabaseAdmin.storage
        .from(bucketName)
        .getPublicUrl(uniqueDocName);

      if (urlData?.publicUrl) {
        return { success: true, publicUrl: urlData.publicUrl };
      }
    } else {
      console.warn(
        "[uploadTournamentRegulationPdf] Falha no bucket principal, tentando fallback em 'covers':",
        uploadErr
      );
    }

    // 3. Fallback de segurança no bucket 'covers' caso 'tournament-documents' esteja indisponível
    const fallbackPath = `documents/${uniqueDocName}`;
    const { error: fallbackErr } = await supabaseAdmin.storage
      .from("covers")
      .upload(fallbackPath, fileBuffer, {
        contentType: "application/pdf",
        cacheControl: "3600",
        upsert: true,
      });

    if (fallbackErr) {
      return {
        success: false,
        error: uploadErr?.message || fallbackErr.message || "Falha ao enviar o PDF para o Storage.",
      };
    }

    const { data: fallbackUrlData } = supabaseAdmin.storage
      .from("covers")
      .getPublicUrl(fallbackPath);

    return {
      success: true,
      publicUrl: fallbackUrlData?.publicUrl,
    };
  } catch (err: any) {
    console.error("[uploadTournamentRegulationPdf] Exceção:", err);
    return {
      success: false,
      error: err?.message || "Erro inesperado ao fazer upload do regulamento em PDF.",
    };
  }
}

export interface SaveTournamentResponse {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Server Action para criar ou atualizar um torneio na tabela 'tournaments',
 * garantindo a persistência da URL do regulamento em 'regulation_url', 'rulebook_url' e 'match_rules'.
 */
export async function saveTournamentAction(
  payload: Record<string, any>,
  tournamentId?: string
): Promise<SaveTournamentResponse> {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    const resolvedRegulationUrl =
      payload.regulation_url !== undefined
        ? payload.regulation_url
        : payload.rulebook_url !== undefined
          ? payload.rulebook_url
          : null;

    const currentMatchRules =
      payload.match_rules && typeof payload.match_rules === "object"
        ? { ...payload.match_rules }
        : {};

    const resolvedPhaseExceptions =
      payload.phase_exceptions !== undefined
        ? payload.phase_exceptions
        : currentMatchRules.phase_exceptions !== undefined
          ? currentMatchRules.phase_exceptions
          : {};

    const enrichedPayload: Record<string, any> = {
      ...payload,
      rulebook_url: resolvedRegulationUrl,
      regulation_url: resolvedRegulationUrl,
      phase_exceptions: resolvedPhaseExceptions,
      match_rules: {
        ...currentMatchRules,
        rulebook_url: resolvedRegulationUrl,
        regulation_url: resolvedRegulationUrl,
        phase_exceptions: resolvedPhaseExceptions,
      },
    };

    const executeWrite = async (body: Record<string, any>) => {
      if (tournamentId) {
        return await supabaseAdmin
          .from("tournaments")
          .update(body)
          .eq("id", tournamentId)
          .select()
          .single();
      } else {
        return await supabaseAdmin
          .from("tournaments")
          .insert(body)
          .select()
          .single();
      }
    };

    let { data, error } = await executeWrite(enrichedPayload);

    // Fallback resiliente caso o cache do PostgREST ainda não tenha 'regulation_url', 'rulebook_url' ou 'phase_exceptions'
    if (error && error.message) {
      const retryPayload = { ...enrichedPayload };
      let shouldRetry = false;

      if (error.message.includes("regulation_url")) {
        delete retryPayload.regulation_url;
        shouldRetry = true;
      }
      if (error.message.includes("rulebook_url")) {
        delete retryPayload.rulebook_url;
        shouldRetry = true;
      }
      if (error.message.includes("phase_exceptions")) {
        delete retryPayload.phase_exceptions;
        shouldRetry = true;
      }

      if (shouldRetry) {
        const retryRes = await executeWrite(retryPayload);
        data = retryRes.data;
        error = retryRes.error;
      }
    }

    if (error) {
      console.error("[saveTournamentAction] Erro ao salvar torneio:", error);
      return { success: false, error: error.message };
    }

    const savedId = data?.id || tournamentId;
    revalidatePath("/hub");
    revalidatePath("/explorar");
    revalidatePath("/dashboard");
    if (savedId) {
      revalidatePath(`/torneio/${savedId}`);
      revalidatePath(`/dashboard/${savedId}`);
    }

    return {
      success: true,
      data: {
        ...data,
        regulation_url:
          data?.regulation_url ??
          data?.rulebook_url ??
          resolvedRegulationUrl,
        rulebook_url:
          data?.rulebook_url ??
          data?.regulation_url ??
          resolvedRegulationUrl,
        phase_exceptions:
          data?.phase_exceptions ??
          data?.match_rules?.phase_exceptions ??
          resolvedPhaseExceptions,
      },
    };
  } catch (err: any) {
    console.error("[saveTournamentAction] Exceção:", err);
    return {
      success: false,
      error: err?.message || "Erro inesperado ao salvar os dados do torneio.",
    };
  }
}



