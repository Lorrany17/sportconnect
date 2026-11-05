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


