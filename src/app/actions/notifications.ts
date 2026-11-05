"use server";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { revalidatePath } from "next/cache";

export interface NotifyRulesChangedParams {
  tournamentId: string;
  tournamentName?: string;
}

/**
 * Gatilho 1: Alteração de Regras (Organizador -> Atletas)
 * Notifica todos os atletas inscritos no torneio que o regulamento ou formulário foi atualizado.
 */
export async function notifyTournamentRulesChanged(
  params: NotifyRulesChangedParams
): Promise<{ success: boolean; notifiedCount: number; error?: string }> {
  try {
    const { tournamentId, tournamentName } = params;
    if (!tournamentId) {
      return { success: false, notifiedCount: 0, error: "ID do torneio não informado." };
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Obter nome do torneio caso não tenha sido passado
    let tourName = tournamentName;
    if (!tourName) {
      const { data: tour } = await supabaseAdmin
        .from("tournaments")
        .select("name")
        .eq("id", tournamentId)
        .maybeSingle();
      tourName = tour?.name || "Campeonato";
    }

    // 2. Buscar equipes inscritas
    const { data: teams, error: teamsErr } = await supabaseAdmin
      .from("teams")
      .select("id, user_id")
      .eq("tournament_id", tournamentId)
      .neq("status", "CANCELLED");

    if (teamsErr) {
      console.error("[NOTIFICATIONS ERROR]: Falha ao buscar equipes para alteração de regras -", teamsErr);
      return { success: false, notifiedCount: 0, error: teamsErr.message };
    }

    if (!teams || teams.length === 0) {
      return { success: true, notifiedCount: 0 };
    }

    // Buscar também membros vinculados em team_members
    const teamIds = teams.map((t) => t.id).filter(Boolean);
    let memberUserIds: string[] = [];
    if (teamIds.length > 0) {
      try {
        const { data: members } = await supabaseAdmin
          .from("team_members")
          .select("user_id")
          .in("team_id", teamIds)
          .not("user_id", "is", null);
        if (members) {
          memberUserIds = members.map((m: any) => m.user_id).filter(Boolean);
        }
      } catch (mErr) {
        console.warn("[Notificações] Aviso ao buscar team_members:", mErr);
      }
    }

    const uniqueUserIds = Array.from(
      new Set([
        ...teams.map((t) => t.user_id).filter(Boolean),
        ...memberUserIds,
      ])
    ) as string[];

    if (uniqueUserIds.length === 0) {
      return { success: true, notifiedCount: 0 };
    }

    const message = `O regulamento ou formulário do torneio ${tourName} foi atualizado. Verifique se precisa de complementar a sua inscrição.`;
    const notificationsToInsert = uniqueUserIds.map((userId) => ({
      user_id: userId,
      tournament_id: tournamentId,
      message,
      is_read: false,
    }));

    const { error: notifErr } = await supabaseAdmin
      .from("notifications")
      .insert(notificationsToInsert);

    if (notifErr) {
      console.error("[NOTIFICATIONS ERROR]: Falha ao inserir notificação -", notifErr);
      return { success: false, notifiedCount: 0, error: notifErr.message };
    }

    revalidatePath("/hub");
    revalidatePath(`/torneio/${tournamentId}`);

    console.log(
      `[Notificações] ${uniqueUserIds.length} atletas notificados sobre alteração de regras do torneio ${tourName}.`
    );
    return { success: true, notifiedCount: uniqueUserIds.length };
  } catch (error: any) {
    console.error("[NOTIFICATIONS ERROR]: Falha ao inserir notificação -", error);
    return { success: false, notifiedCount: 0, error: error?.message || "Erro desconhecido." };
  }
}

export interface NotifyNewRegistrationParams {
  tournamentId: string;
  tournamentName?: string;
  teamName: string;
}

/**
 * Gatilho 2: Nova Inscrição (Atleta -> Organizador)
 * Notifica o organizador do torneio imediatamente após uma nova inscrição ser submetida.
 */
export async function notifyNewRegistration(
  params: NotifyNewRegistrationParams
): Promise<{ success: boolean; error?: string }> {
  try {
    const { tournamentId, tournamentName, teamName } = params;
    if (!tournamentId) {
      return { success: false, error: "ID do torneio não informado." };
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Obter dono do torneio e nome oficial
    const { data: tour, error: tourErr } = await supabaseAdmin
      .from("tournaments")
      .select("owner_id, name")
      .eq("id", tournamentId)
      .maybeSingle();

    if (tourErr || !tour) {
      console.error("[NOTIFICATIONS ERROR]: Torneio não encontrado para nova inscrição -", tourErr);
      return { success: false, error: tourErr?.message || "Torneio não encontrado." };
    }

    const organizerId = tour.owner_id;
    if (!organizerId) {
      console.log(`[Notificações] Torneio ${tournamentId} não possui owner_id cadastrado.`);
      return { success: true };
    }

    const tourName = tournamentName || tour.name || "Campeonato";
    const message = `Nova inscrição! ${teamName} solicitou uma vaga no torneio ${tourName}.`;

    const { error: notifErr } = await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: organizerId,
        tournament_id: tournamentId,
        message,
        is_read: false,
      });

    if (notifErr) {
      console.error("[NOTIFICATIONS ERROR]: Falha ao inserir notificação -", notifErr);
      return { success: false, error: notifErr.message };
    }

    revalidatePath("/hub");
    revalidatePath(`/torneio/${tournamentId}`);

    console.log(
      `[Notificações] Organizador (${organizerId}) notificado de nova inscrição de '${teamName}' no torneio ${tourName}.`
    );
    return { success: true };
  } catch (error: any) {
    console.error("[NOTIFICATIONS ERROR]: Falha ao inserir notificação -", error);
    return { success: false, error: error?.message || "Erro desconhecido." };
  }
}

export interface NotifyRegistrationApprovedParams {
  teamId?: string;
  userId?: string;
  tournamentId?: string;
  tournamentName?: string;
  newStatus?: "APPROVED" | "PAID" | "WAITING_PIX" | string;
}

/**
 * Gatilho 3: Aprovação / Liberação de Vaga (Organizador -> Atleta)
 * Notifica o atleta quando sua inscrição for aprovada/confirmada ou quando a vaga for liberada para pagamento.
 */
export async function notifyRegistrationApproved(
  params: NotifyRegistrationApprovedParams
): Promise<{ success: boolean; error?: string }> {
  try {
    const { teamId, userId, tournamentId, tournamentName, newStatus = "APPROVED" } = params;

    const supabaseAdmin = getSupabaseAdmin();

    let targetUserId = userId;
    let targetTournId = tournamentId;
    let targetTournName = tournamentName;

    // Se o targetUserId não foi informado, busca na tabela teams
    if (!targetUserId && teamId) {
      const { data: team } = await supabaseAdmin
        .from("teams")
        .select("user_id, tournament_id, tournaments(name)")
        .eq("id", teamId)
        .maybeSingle();

      if (team) {
        targetUserId = team.user_id;
        targetTournId = targetTournId || team.tournament_id;
        targetTournName = targetTournName || (team as any).tournaments?.name;
      }
    }

    if (!targetTournName && targetTournId) {
      const { data: tour } = await supabaseAdmin
        .from("tournaments")
        .select("name")
        .eq("id", targetTournId)
        .maybeSingle();
      targetTournName = tour?.name || "Campeonato";
    }

    if (!targetUserId) {
      console.warn("[Notificações] Inscrição não possui user_id vinculado para notificação de aprovação.");
      return { success: true };
    }

    const tourName = targetTournName || "Campeonato";
    let message = `A sua inscrição no torneio ${tourName} foi confirmada!`;

    if (newStatus === "WAITING_PIX") {
      message = `A sua vaga no torneio ${tourName} foi liberada! Efetue o pagamento via Pix para confirmar sua participação.`;
    } else if (newStatus !== "APPROVED" && newStatus !== "PAID") {
      message = `O status da sua inscrição no torneio ${tourName} foi atualizado para ${newStatus}.`;
    }

    const { error: notifErr } = await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: targetUserId,
        tournament_id: targetTournId || null,
        message,
        is_read: false,
      });

    if (notifErr) {
      console.error("[NOTIFICATIONS ERROR]: Falha ao inserir notificação -", notifErr);
      return { success: false, error: notifErr.message };
    }

    revalidatePath("/hub");
    if (targetTournId) {
      revalidatePath(`/torneio/${targetTournId}`);
    }

    console.log(
      `[Notificações] Atleta (${targetUserId}) notificado sobre status ${newStatus} no torneio ${tourName}.`
    );
    return { success: true };
  } catch (error: any) {
    console.error("[NOTIFICATIONS ERROR]: Falha ao inserir notificação -", error);
    return { success: false, error: error?.message || "Erro desconhecido." };
  }
}


export interface NotifyRegistrationCancelledParams {
  teamId?: string;
  userId?: string;
  tournamentId?: string;
  tournamentName?: string;
}

/**
 * Gatilho 4: Cancelamento / Estorno (Organizador -> Atleta)
 * Notifica o atleta quando sua inscrição for cancelada/estornada pelo organizador.
 */
export async function notifyRegistrationCancelled(
  params: NotifyRegistrationCancelledParams
): Promise<{ success: boolean; error?: string }> {
  try {
    const { teamId, userId, tournamentId, tournamentName } = params;

    const supabaseAdmin = getSupabaseAdmin();

    let targetUserId = userId;
    let targetTournId = tournamentId;
    let targetTournName = tournamentName;

    // Se o targetUserId não foi informado, busca na tabela teams
    if (!targetUserId && teamId) {
      const { data: team } = await supabaseAdmin
        .from("teams")
        .select("user_id, tournament_id, tournaments(name)")
        .eq("id", teamId)
        .maybeSingle();

      if (team) {
        targetUserId = team.user_id;
        targetTournId = targetTournId || team.tournament_id;
        targetTournName = targetTournName || (team as any).tournaments?.name;
      }
    }

    if (!targetTournName && targetTournId) {
      const { data: tour } = await supabaseAdmin
        .from("tournaments")
        .select("name")
        .eq("id", targetTournId)
        .maybeSingle();
      targetTournName = tour?.name || "Campeonato";
    }

    if (!targetUserId) {
      console.warn("[Notificações] Inscrição não possui user_id vinculado para notificação de cancelamento.");
      return { success: true };
    }

    const tourName = targetTournName || "Campeonato";
    const message = `A sua inscrição no torneio ${tourName} foi cancelada/estornada pelo organizador.`;

    const { error: notifErr } = await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: targetUserId,
        tournament_id: targetTournId || null,
        message,
        is_read: false,
      });

    if (notifErr) {
      console.error("[NOTIFICATIONS ERROR]: Falha ao inserir notificação -", notifErr);
      return { success: false, error: notifErr.message };
    }

    revalidatePath("/hub");
    if (targetTournId) {
      revalidatePath(`/torneio/${targetTournId}`);
    }

    console.log(
      `[Notificações] Atleta (${targetUserId}) notificado sobre cancelamento no torneio ${tourName}.`
    );
    return { success: true };
  } catch (error: any) {
    console.error("[NOTIFICATIONS ERROR]: Falha ao inserir notificação -", error);
    return { success: false, error: error?.message || "Erro desconhecido." };
  }
}
