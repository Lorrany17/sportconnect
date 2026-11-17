"use client";

import React, { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Trophy,
  Users,
  Calendar,
  MapPin,
  Plus,
  Compass,
  ArrowRight,
  LogOut,
  Sparkles,
  Clock,
  CheckCircle2,
  AlertCircle,
  LayoutDashboard,
  Shield,
  Loader2,
  RefreshCw,
  ExternalLink,
  Ban,
  ShieldCheck,
  ShieldAlert,
  CreditCard,
  AlertTriangle,
  X,
  Lock,
  MessageCircle,
  PlayCircle,
} from "lucide-react";
// end lucide-react
// end lucide-react
import { useAuth } from "@/context/AuthProvider";
import { useTournament } from "@/context/TournamentContext";
import { supabase } from "@/lib/supabase";
import { Tournament, SportType } from "@/types";
import { translateTournamentFormat, formatTournamentDate } from "@/utils/formatMap";
import CreateTournamentModal from "@/components/CreateTournamentModal";
import PixCheckoutForm from "@/components/PixCheckoutForm";
import PublicHeader from "@/components/PublicHeader";
import { cancelRegistration } from "@/app/actions/registration";
import { syncUserStaffAndNotifications } from "@/app/actions/tournament";
import NotificationBell from "@/components/NotificationBell";

export interface MyRegistration {
  id: string; // Team ID
  name: string; // Team/Dupla Name
  player1?: string;
  player2?: string;
  manager_name?: string;
  payment_status: "APPROVED" | "PAID" | "WAITING_PIX" | "WAITING_APPROVAL" | "PENDING" | string;
  payout_status?: "COMPLETED" | "FAILED_TRANSFER" | "PENDING" | string;
  payment_proof_url?: string | null;
  status?: string;
  isApproved?: boolean;
  cancellation_status?: string;
  created_at?: string;
  tournament_id?: string;
  organizer_phone?: string | null;
  tournament?: Tournament | null;
}

export interface MyOrganizedTournament extends Tournament {
  teamsCount: number;
  approvedTeamsCount: number;
  staffRole?: string;
}

const SPORT_META: Record<string, { label: string; icon: string; color: string }> = {
  DOMINO: { label: "Dominó", icon: "🁓", color: "text-amber-400" },
  PING_PONG: { label: "Ping Pong", icon: "🏓", color: "text-blue-400" },
  FUTSAL: { label: "Futsal", icon: "⚽", color: "text-emerald-400" },
  VOLEI: { label: "Vôlei", icon: "🏐", color: "text-orange-400" },
};

export default function HubCentral() {
  const { user, profile, isAdmin, signOut } = useAuth();
  const { logout, setCurrentTournamentId } = useTournament();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [tournamentTab, setTournamentTab] = useState<"ACTIVE" | "COMPLETED">("ACTIVE");

  const isTournamentCompletedStatus = (status?: string) => {
    const st = String(status || "").toUpperCase().trim();
    return st === "COMPLETED" || st === "FINALIZADO" || st === "FINISHED" || st === "CONCLUIDO";
  };

  // Estados com os dados reais do usuário
  const [myTournaments, setMyTournaments] = useState<MyOrganizedTournament[]>([]);
  const [sharedTournaments, setSharedTournaments] = useState<MyOrganizedTournament[]>([]);
  const [myRegistrations, setMyRegistrations] = useState<MyRegistration[]>([]);

  // Estados para retomada de pagamento e cancelamento pós-pagamento
  const [checkoutRegistration, setCheckoutRegistration] = useState<MyRegistration | null>(null);
  const [cancellingPaidReg, setCancellingPaidReg] = useState<MyRegistration | null>(null);
  const [isCancellingId, setIsCancellingId] = useState<string | null>(null);

  // Nome do usuário formatado
  const userName =
    profile?.full_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Atleta";

  // Busca simultânea no Supabase: Torneios do Organizador e Inscrições do Atleta
  const fetchUserData = useCallback(async () => {
    if (!user?.id) return;

    try {
      // 1. Torneios Organizados: Criados e gerenciados pelo próprio usuário (owner_id)
      const { data: tournamentsData, error: tournError } = await supabase
        .from("tournaments")
        .select("*")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false });

      if (tournError) {
        console.warn("Aviso ao carregar torneios organizados:", tournError);
      }

      const ownedTournaments = tournamentsData || [];
      const ownedIds = new Set(ownedTournaments.map((t) => t.id));

      // 1.1 Torneios Compartilhados (Equipe via RBAC / tournament_staff)
      const currentUserEmail = user.email || "";
      const userEmail = currentUserEmail.toLowerCase().trim();
      let staffList: any[] = [];

      if (currentUserEmail || user.id) {
        try {
          // Query ajustada conforme especificação: user_id.eq.${currentUser.id},email.eq.${currentUser.email}
          const orFilter = currentUserEmail
            ? `user_id.eq.${user.id},email.eq.${currentUserEmail},email.eq.${userEmail}`
            : `user_id.eq.${user.id}`;

          const { data: staffData, error: staffErr } = await supabase
            .from("tournament_staff")
            .select("id, tournament_id, role, user_id, email, tournaments(*)")
            .or(orFilter);

          if (staffErr) {
            console.warn("Aviso ao consultar tournament_staff no cliente:", staffErr);
          } else if (staffData) {
            staffList = staffData;
          }
        } catch (staffErr) {
          console.warn("Aviso ao consultar tournament_staff:", staffErr);
        }

        // Auto-vínculo de convites pendentes e disparo de notificações retroativas (Admin Bypass)
        try {
          const syncResult = await syncUserStaffAndNotifications(user.id, currentUserEmail);
          // Se a query cliente não encontrou registros devido a políticas de RLS, usa o resultado do sync admin
          if (staffList.length === 0 && syncResult.sharedTournaments.length > 0) {
            staffList = syncResult.sharedTournaments;
          }
        } catch (syncErr) {
          console.warn("[HubCentral] Aviso ao sincronizar staff/notificações:", syncErr);
        }
      }

      // Auto-vínculo no cliente: se encontrar registro com email correspondente e user_id nulo, atualiza silenciosamente
      const unlinkedStaff = staffList.filter(
        (s) => (!s.user_id || s.user_id !== user.id) && user.id && s.email && s.email.toLowerCase().trim() === userEmail
      );
      if (unlinkedStaff.length > 0) {
        const unlinkedIds = unlinkedStaff.map((s) => s.id).filter(Boolean);
        if (unlinkedIds.length > 0) {
          supabase
            .from("tournament_staff")
            .update({ user_id: user.id })
            .in("id", unlinkedIds)
            .then();
        }
      }

      // Separar torneios compartilhados onde o usuário atua como staff (exclui os criados por ele mesmo)
      const staffRoleMap: Record<string, string> = {};
      const sharedTournamentsRaw: any[] = [];
      const missingSharedTournIds: string[] = [];

      staffList.forEach((s) => {
        if (!s.tournament_id) return;
        if (ownedIds.has(s.tournament_id)) return; // Já está na lista de próprios

        staffRoleMap[s.tournament_id] = s.role;

        const joinedTourn = Array.isArray(s.tournaments) ? s.tournaments[0] : s.tournaments;
        if (joinedTourn && joinedTourn.id) {
          sharedTournamentsRaw.push(joinedTourn);
        } else {
          missingSharedTournIds.push(s.tournament_id);
        }
      });

      // Fallback para buscar torneios compartilhados caso o join aninhado não tenha vindo
      if (missingSharedTournIds.length > 0) {
        try {
          const { data: extraShared } = await supabase
            .from("tournaments")
            .select("*")
            .in("id", missingSharedTournIds);

          if (extraShared) {
            sharedTournamentsRaw.push(...extraShared);
          }
        } catch (extErr) {
          console.warn("Aviso ao carregar torneios compartilhados via fallback:", extErr);
        }
      }

      // Desduplicar torneios compartilhados por ID
      const uniqueSharedMap = new Map<string, any>();
      sharedTournamentsRaw.forEach((t) => {
        if (t && t.id && !ownedIds.has(t.id)) {
          uniqueSharedMap.set(t.id, t);
        }
      });
      const uniqueSharedTournaments = Array.from(uniqueSharedMap.values());

      // 2. Minhas Inscrições (Atleta): Busca inscrições com dados do torneio (incluindo status) e telefone do organizador
      let { data: teamsData, error: teamsError } = await supabase
        .from("teams")
        .select("*, tournaments(id, name, status, start_date, start_time, end_date, location, format, sport_type, cover_url, entry_fee, max_teams, owner_id)")
        .eq("user_id", user?.id || "")
        .neq("status", "CANCELLED")
        .order("created_at", { ascending: false });

      if (teamsError) {
        const fallbackTeams = await supabase
          .from("teams")
          .select("*, tournaments(*)")
          .eq("user_id", user?.id || "")
          .neq("status", "CANCELLED")
          .order("created_at", { ascending: false });
        teamsData = fallbackTeams.data;
        teamsError = fallbackTeams.error;
      }

      if (teamsError) {
        console.warn("Aviso ao carregar inscrições do atleta:", teamsError);
      }

      // Processar Torneios (Próprios e Compartilhados) e contagem de vagas preenchidas
      const allTournIds = [
        ...ownedTournaments.map((t) => t.id),
        ...uniqueSharedTournaments.map((t) => t.id),
      ];

      const teamCounts: Record<string, { total: number; approved: number }> = {};
      if (allTournIds.length > 0) {
        const { data: teamRows } = await supabase
          .from("teams")
          .select("id, tournament_id, payment_status, status")
          .in("tournament_id", allTournIds)
          .neq("status", "CANCELLED")
          .neq("status", "REJECTED");

        if (teamRows) {
          // Ignora explicitamente equipes canceladas ou rejeitadas
          const activeTeamRows = teamRows.filter(
            (team) => team.status !== "CANCELLED" && team.status !== "REJECTED"
          );

          activeTeamRows.forEach((r) => {
            if (!teamCounts[r.tournament_id]) {
              teamCounts[r.tournament_id] = { total: 0, approved: 0 };
            }
            teamCounts[r.tournament_id].total++;
            if (
              r.payment_status === "PAID" ||
              r.payment_status === "APPROVED" ||
              r.status === "CONFIRMED" ||
              r.status === "PAID"
            ) {
              teamCounts[r.tournament_id].approved++;
            }
          });
        }
      }

      // Mapear Meus Torneios (Criados pelo usuário)
      const mappedMyTournaments: MyOrganizedTournament[] = ownedTournaments.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        createdAt: t.created_at,
        sport_type: (t.sport_type as SportType) || "DOMINO",
        format: t.format,
        owner_id: t.owner_id,
        max_teams: t.max_teams ? Number(t.max_teams) : 16,
        entry_fee: t.entry_fee ? Number(t.entry_fee) : 0,
        location: t.location,
        start_date: t.start_date,
        end_date: t.end_date,
        rules: t.rules,
        cover_url: t.cover_url,
        organizer_pix_key: t.organizer_pix_key,
        pix_key_type: t.pix_key_type,
        rulebook_url: t.regulation_url || t.rulebook_url || t.match_rules?.regulation_url || t.match_rules?.rulebook_url || null,
        regulation_url: t.regulation_url || t.rulebook_url || t.match_rules?.regulation_url || t.match_rules?.rulebook_url || null,
        teamsCount: teamCounts[t.id]?.total || 0,
        approvedTeamsCount: teamCounts[t.id]?.approved || 0,
      }));
      setMyTournaments(mappedMyTournaments);

      // Mapear Torneios Compartilhados Comigo (Equipe / Arbitragem)
      const mappedSharedTournaments: MyOrganizedTournament[] = uniqueSharedTournaments.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        createdAt: t.created_at,
        sport_type: (t.sport_type as SportType) || "DOMINO",
        format: t.format,
        owner_id: t.owner_id,
        max_teams: t.max_teams ? Number(t.max_teams) : 16,
        entry_fee: t.entry_fee ? Number(t.entry_fee) : 0,
        location: t.location,
        start_date: t.start_date,
        end_date: t.end_date,
        rules: t.rules,
        cover_url: t.cover_url,
        organizer_pix_key: t.organizer_pix_key,
        pix_key_type: t.pix_key_type,
        rulebook_url: t.regulation_url || t.rulebook_url || t.match_rules?.regulation_url || t.match_rules?.rulebook_url || null,
        regulation_url: t.regulation_url || t.rulebook_url || t.match_rules?.regulation_url || t.match_rules?.rulebook_url || null,
        teamsCount: teamCounts[t.id]?.total || 0,
        approvedTeamsCount: teamCounts[t.id]?.approved || 0,
        staffRole: staffRoleMap[t.id] || "REFEREE",
      }));
      setSharedTournaments(mappedSharedTournaments);

      // Processar Minhas Inscrições
      if (teamsData) {
        // Fallback para buscar torneios caso a junção direta não tenha preenchido
        const missingTournIds = teamsData
          .filter((t) => {
            const rawTourn = Array.isArray(t.tournaments) ? t.tournaments[0] : t.tournaments;
            return !rawTourn && t.tournament_id;
          })
          .map((t) => t.tournament_id);

        const fallbackMap: Record<string, any> = {};
        if (missingTournIds.length > 0) {
          const { data: fbData } = await supabase
            .from("tournaments")
            .select("id, name, status, start_date, start_time, end_date, location, format, sport_type, cover_url, entry_fee, max_teams, owner_id")
            .in("id", missingTournIds);

          if (fbData) {
            fbData.forEach((fb) => {
              fallbackMap[fb.id] = fb;
            });
          }
        }

        const ownerIds = Array.from(
          new Set(
            teamsData
              .map((t) => {
                const rawTourn = Array.isArray(t.tournaments) ? t.tournaments[0] : t.tournaments;
                const finalTourn = rawTourn || fallbackMap[t.tournament_id] || null;
                return finalTourn?.owner_id;
              })
              .filter(Boolean)
          )
        );

        const organizerPhonesByOwnerId: Record<string, string> = {};
        if (ownerIds.length > 0) {
          try {
            const { data: orgProfiles } = await supabase
              .from("profiles")
              .select("id, phone")
              .in("id", ownerIds);
            if (orgProfiles) {
              orgProfiles.forEach((p: any) => {
                if (p.id && p.phone) {
                  organizerPhonesByOwnerId[p.id] = p.phone;
                }
              });
            }
          } catch (orgErr) {
            console.warn("Aviso ao carregar telefone dos organizadores:", orgErr);
          }
        }

        const mappedRegistrations: MyRegistration[] = teamsData
          .filter(
            (t) =>
              t.status !== "CANCELLED" &&
              t.status !== "CANCELED" &&
              t.payment_status !== "CANCELED" &&
              t.payment_status !== "CANCELLED" &&
              t.cancellation_status !== "REFUNDED"
          )
          .map((t) => {
          const rawTourn = Array.isArray(t.tournaments) ? t.tournaments[0] : t.tournaments;
          const finalTourn = rawTourn || fallbackMap[t.tournament_id] || null;
          const joinedProfile = Array.isArray(finalTourn?.profiles)
            ? finalTourn?.profiles[0]
            : finalTourn?.profiles;
          const rawOrganizerPhone =
            joinedProfile?.phone ||
            (finalTourn?.owner_id ? organizerPhonesByOwnerId[finalTourn.owner_id] : undefined) ||
            finalTourn?.organizer_phone ||
            finalTourn?.contact ||
            (finalTourn?.pix_key_type === "CELULAR" ? finalTourn?.organizer_pix_key : undefined) ||
            null;

          return {
            id: t.id,
            name: t.name,
            player1: t.player1,
            player2: t.player2,
            manager_name: t.manager_name,
            payment_status: t.payment_status || (t.status === "CONFIRMED" || t.status === "PAID" ? "PAID" : "PENDING"),
            payout_status: t.payout_status,
            payment_proof_url: t.payment_proof_url || null,
            status: t.status,
            isApproved:
              ["APPROVED", "PAID", "CONFIRMED"].includes(String(t.status || "").toUpperCase()) ||
              ["APPROVED", "PAID", "CONFIRMED"].includes(String(t.payment_status || "").toUpperCase()),
            cancellation_status: t.cancellation_status,
            created_at: t.created_at,
            tournament_id: t.tournament_id,
            organizer_phone: rawOrganizerPhone,
            tournament: finalTourn
              ? {
                id: finalTourn.id,
                name: finalTourn.name,
                status: finalTourn.status,
                createdAt: finalTourn.created_at,
                sport_type: (finalTourn.sport_type as SportType) || "DOMINO",
                format: finalTourn.format,
                location: finalTourn.location,
                start_date: finalTourn.start_date,
                end_date: finalTourn.end_date,
                cover_url: finalTourn.cover_url,
                entry_fee: finalTourn.entry_fee ? Number(finalTourn.entry_fee) : 0,
                max_teams: finalTourn.max_teams ? Number(finalTourn.max_teams) : 16,
              }
              : null,
          };
        });

        setMyRegistrations(mappedRegistrations);
      }
    } catch (err) {
      console.error("Exceção ao buscar dados da dashboard:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchUserData();
  };

  const handleLogout = async () => {
    logout();
    await signOut();
    router.push("/login");
  };

  // Ação de Cancelamento de Inscrição pelo Atleta
  const handleRequestCancellation = (reg: MyRegistration) => {
    if (reg.tournament?.status && reg.tournament.status !== "OPEN") {
      alert("Não é possível cancelar a inscrição: o chaveamento do torneio já foi gerado.");
      return;
    }

    const isPaid = reg.status === "PAID" || reg.payment_status === "PAID" || reg.payment_status === "APPROVED";

    if (isPaid) {
      // Abre o Modal de Aviso de Cancelamento Pós-Pagamento
      setCancellingPaidReg(reg);
      return;
    }

    if (!window.confirm("Deseja realmente cancelar sua inscrição nesta competição?")) {
      return;
    }

    executeCancellation(reg.id, "REQUESTED_BY_ATHLETE");
  };

  const executeCancellation = async (teamId: string, status: "REQUESTED_BY_ATHLETE" | "REFUND_REQUESTED") => {
    setIsCancellingId(teamId);
    try {
      const { data: authData } = await supabase.auth.getSession();
      const res = await cancelRegistration(teamId, status, authData?.session?.access_token);

      if (!res.success) {
        console.error("Erro ao solicitar cancelamento via Server Action:", res.error);
        alert(res.error || "Erro ao solicitar cancelamento.");
        return;
      }

      setMyRegistrations((prev) =>
        prev.map((reg) =>
          reg.id === teamId
            ? { ...reg, cancellation_status: status }
            : reg
        )
      );

      setCancellingPaidReg(null);
    } catch (err: any) {
      console.error("Exceção ao solicitar cancelamento:", err);
      alert(err?.message || "Erro ao solicitar cancelamento da inscrição.");
    } finally {
      setIsCancellingId(null);
    }
  };

  const formatDate = (dateString?: string, timeString?: string) => {
    if (!dateString) return "Data a definir";
    try {
      let d: Date;
      if (typeof dateString === "string" && dateString.includes("-")) {
        const datePart = dateString.split("T")[0];
        const parts = datePart.split("-").map(Number);
        if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
          d = new Date(parts[0], parts[1] - 1, parts[2]);
        } else {
          d = new Date(dateString);
        }
      } else {
        d = new Date(dateString);
      }
      if (isNaN(d.getTime())) return "Data a definir";
      const formatted = d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      if (timeString && timeString.trim()) {
        return `${formatted} às ${timeString.trim()}`;
      }
      return formatted;
    } catch {
      return "Data a definir";
    }
  };

  // Log de Depuração solicitado para verificar os dados reais na memória antes do retorno do JSX
  
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0f0f0f] text-zinc-900 dark:text-[#e4e4e7] flex flex-col justify-between selection:bg-[#00a2ff]/30 selection:text-white">
      {/* 1. Header de Navegação Global Uniformizado */}
      <PublicHeader activePage="hub" />

      {/* 2. Conteúdo Principal da Dashboard */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-12">
        {/* Banner de Saudação e Resumo */}
        <section className="bg-gradient-to-r from-white via-zinc-50 to-white dark:from-[#18181b] dark:via-[#141416] dark:to-[#121214] border border-zinc-200 dark:border-[#27272a] rounded-3xl p-6 sm:p-8 relative overflow-hidden shadow-sm dark:shadow-2xl">
          <div className="absolute top-0 right-0 w-96 h-96 bg-[#00a2ff]/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#00a2ff]/10 border border-[#00a2ff]/20 text-[#00a2ff] text-xs font-black uppercase tracking-wider">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Painel de Competições</span>
              </div>
              <h1 className="text-2xl sm:text-4xl font-black text-zinc-900 dark:text-white font-display tracking-tight">
                Olá, <span className="text-[#00a2ff]">{userName}</span>! 👋
              </h1>
              <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Acompanhe o andamento das suas inscrições como atleta e gerencie os campeonatos oficiais que você organizou na plataforma.
              </p>
            </div>

            {/* Ações do Topo */}
            <div className="flex flex-wrap items-center gap-3 shrink-0 self-start md:self-auto">
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#00a2ff] to-blue-600 hover:from-blue-500 hover:to-blue-600 text-white font-bold text-xs uppercase tracking-wider shadow-md shadow-blue-500/20 active:scale-95 transition-all cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Novo Torneio</span>
              </button>

              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="px-4 py-2.5 rounded-xl bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/60 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-all flex items-center gap-2 cursor-pointer shadow-sm active:scale-95"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin text-[#00a2ff]" : ""}`} />
                <span>Atualizar</span>
              </button>
            </div>
          </div>

          {/* Cards de Métricas Rápidas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-8 pt-6 border-t border-zinc-200 dark:border-zinc-800/80">
            <div className="bg-zinc-50 dark:bg-[#101012] border border-zinc-200 dark:border-zinc-800/80 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-zinc-500 mb-1">
                <span className="text-[11px] font-bold uppercase tracking-wider">Inscrições Ativas</span>
                <Users className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
              </div>
              <div className="text-2xl font-black text-zinc-900 dark:text-white font-display">
                {myRegistrations.length}
              </div>
              <span className="text-[10px] text-zinc-500">Como atleta ou capitão</span>
            </div>

            <div className="bg-zinc-50 dark:bg-[#101012] border border-zinc-200 dark:border-zinc-800/80 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-zinc-500 mb-1">
                <span className="text-[11px] font-bold uppercase tracking-wider">Meus Campeonatos</span>
                <Trophy className="h-4 w-4 text-blue-500 dark:text-blue-400" />
              </div>
              <div className="text-2xl font-black text-zinc-900 dark:text-white font-display">
                {myTournaments.length}
              </div>
              <span className="text-[10px] text-zinc-500">Torneios criados</span>
            </div>

            <div className="bg-zinc-50 dark:bg-[#101012] border border-zinc-200 dark:border-zinc-800/80 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-zinc-500 mb-1">
                <span className="text-[11px] font-bold uppercase tracking-wider">Compartilhados</span>
                <ShieldCheck className="h-4 w-4 text-purple-500 dark:text-purple-400" />
              </div>
              <div className="text-2xl font-black text-zinc-900 dark:text-white font-display">
                {sharedTournaments.length}
              </div>
              <span className="text-[10px] text-zinc-500">Como staff / arbitragem</span>
            </div>

            <div className="col-span-2 sm:col-span-1 bg-zinc-50 dark:bg-[#101012] border border-zinc-200 dark:border-zinc-800/80 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-zinc-500 mb-1">
                <span className="text-[11px] font-bold uppercase tracking-wider">Modalidades</span>
                <Shield className="h-4 w-4 text-amber-500 dark:text-amber-400" />
              </div>
              <div className="text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-2 mt-1">
                <span>🁓 Dominó</span>
                <span>•</span>
                <span>🏓 Ping Pong</span>
                <span>•</span>
                <span>⚽ Futsal</span>
                <span>•</span>
                <span>🏐 Vôlei</span>
              </div>
              <span className="text-[10px] text-zinc-500 block mt-1">Multiesportes integrado</span>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="py-20 text-center space-y-3">
            <Loader2 className="h-8 w-8 text-[#00a2ff] animate-spin mx-auto" />
            <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400">Carregando seus campeonatos e inscrições...</p>
          </div>
        ) : (
          <div className="space-y-12">
            {/* ======================================================== */}
            {/* SEÇÃO 1: MINHAS INSCRIÇÕES (VISÃO ATLETA) */}
            {/* ======================================================== */}
            <section className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-200 dark:border-[#27272a] pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-zinc-900 dark:text-white font-display tracking-tight flex items-center gap-2">
                      <span>Minhas Inscrições</span>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-black">
                        {myRegistrations.length}
                      </span>
                    </h2>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">
                      Competições nas quais você inscreveu sua equipe ou dupla.
                    </p>
                  </div>
                </div>

                {myRegistrations.length > 0 && (
                  <Link
                    href="/explorar"
                    className="text-xs font-bold text-[#00a2ff] hover:text-blue-500 flex items-center gap-1 self-start sm:self-auto transition-colors"
                  >
                    <span>Inscrever-se em outro campeonato</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>

              {/* Renderização de Inscrições ou Empty State */}
              {myRegistrations.length === 0 ? (
                <div className="border-2 border-dashed border-zinc-300 dark:border-zinc-800 bg-white/50 dark:bg-[#141416]/50 rounded-3xl p-10 text-center space-y-4 shadow-sm">
                  <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/80 text-zinc-400 flex items-center justify-center mx-auto shadow-sm">
                    <Compass className="h-7 w-7 text-emerald-500 dark:text-emerald-400" />
                  </div>
                  <div className="space-y-1 max-w-md mx-auto">
                    <h3 className="text-base font-bold text-zinc-900 dark:text-white">
                      Ainda não estás a participar em nenhum campeonato.
                    </h3>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      Explore as arenas com inscrições abertas, encontre sua modalidade favorita e coloque sua equipe na disputa!
                    </p>
                  </div>
                  <div className="pt-2">
                    <Link
                      href="/explorar"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-emerald-600/20 active:scale-95"
                    >
                      <Compass className="h-4 w-4" />
                      <span>Explorar Torneios</span>
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  
                  {myRegistrations.map((reg) => {
                    const sportType = reg.tournament?.sport_type || "DOMINO";
                    const sportInfo = SPORT_META[sportType] || SPORT_META.DOMINO;
                    const tournamentId = reg.tournament?.id || reg.tournament_id || "";

                    const tournament = reg.tournament;
                    const rawRegStatus = String(reg.status || "").toUpperCase();
                    const rawPaymentStatus = String(reg.payment_status || "").toUpperCase();
                    const rawTournStatus = String(tournament?.status || reg.tournament?.status || "").toUpperCase();
                    const tournStatus = rawTournStatus;

                    // 1. Verifica se o atleta está de facto aprovado/pago
                    const isRegistrationValid =
                      reg.isApproved === true ||
                      ["APPROVED", "PAID", "CONFIRMED"].includes(rawRegStatus) ||
                      ["APPROVED", "PAID", "CONFIRMED"].includes(rawPaymentStatus);

                    // 2. Considera o torneio ativo se estiver IN_PROGRESS ou se já estiver CLOSED (chaves geradas)
                    const isTournamentActive =
                      ["IN_PROGRESS", "CLOSED", "EM_ANDAMENTO", "LIVE"].includes(rawTournStatus);

                    const isApproved = isRegistrationValid;
                    const isPaid = rawRegStatus === "PAID" || rawPaymentStatus === "PAID";
                    const isTournamentInProgress = isTournamentActive;
                    const isWaitingApproval = !isApproved && (reg.payment_status === "WAITING_APPROVAL" || Boolean(reg.payment_proof_url));
                    const isWaitingPix = !isApproved && !isWaitingApproval && reg.payment_status === "WAITING_PIX";
                    const isPending = !isApproved && !isWaitingApproval && !isWaitingPix;
                    const isTournamentNotOpen = Boolean(tournStatus && tournStatus !== "OPEN");
                    const cleanOrgDigits = (reg.organizer_phone || "").replace(/\D/g, "");
                    const organizerPhone =
                      cleanOrgDigits.length >= 10 && cleanOrgDigits.length <= 11 && !cleanOrgDigits.startsWith("55")
                        ? `55${cleanOrgDigits}`
                        : cleanOrgDigits;
                    const isCancellationRequested =
                      Boolean((reg as any).cancel_requested) ||
                      reg.cancellation_status === "CANCELLATION_REQUESTED" ||
                      reg.cancellation_status === "REQUESTED_BY_ATHLETE" ||
                      reg.cancellation_status === "REFUND_REQUESTED" ||
                      reg.status === "CANCELLATION_REQUESTED";

                    return (
                      <div
                        key={reg.id}
                        onClick={() => {
                          if (tournamentId) router.push(`/torneio/${tournamentId}`);
                        }}
                        className="bg-white dark:bg-[#1a1a1a] border border-zinc-200 dark:border-[#27272a] hover:border-[#00a2ff]/60 rounded-2xl p-5 flex flex-col justify-between transition-all duration-300 shadow-sm dark:shadow-xl hover:shadow-[#00a2ff]/10 cursor-pointer group relative overflow-hidden"
                      >
                        {/* Linha decorativa superior sutil */}
                        <div
                          className={`absolute top-0 left-0 right-0 ${
                            isApproved && isTournamentInProgress
                              ? "h-1.5 bg-gradient-to-r from-blue-600 via-[#00a2ff] to-cyan-400 shadow-[0_0_12px_rgba(37,99,235,0.7)]"
                              : isPaid
                                ? "h-1.5 bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-400 shadow-[0_0_12px_rgba(16,185,129,0.7)]"
                                : isApproved
                                  ? "h-1 bg-emerald-500"
                                  : isWaitingApproval
                                    ? "h-1 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                                    : isWaitingPix
                                      ? "h-1 bg-orange-500"
                                      : "h-1 bg-yellow-500"
                            }`}
                        />

                        <div className="space-y-3.5">
                          {/* Topo do Mini Card: Modalidade & Status do Pagamento */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-[#121214] border border-zinc-200 dark:border-zinc-800 text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
                              <span>{sportInfo.icon}</span>
                              <span>{sportInfo.label}</span>
                            </span>

                            {/* Badge de Status no Topo do Card (Precedência Estrita) */}
                            {isCancellationRequested ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-[10px] font-black uppercase tracking-wider">
                                <Clock className="h-3 w-3 animate-pulse" />
                                <span>Estorno Solicitado</span>
                              </span>
                            ) : reg.cancellation_status === "REFUNDED" ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/25 text-red-600 dark:text-red-400 text-[10px] font-black uppercase tracking-wider">
                                <Ban className="h-3 w-3" />
                                <span>Cancelado / Estornado</span>
                              </span>
                            ) : isTournamentCompletedStatus(tournStatus) ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-[10px] font-black uppercase tracking-wider">
                                <Trophy className="h-3 w-3 text-amber-500 dark:text-amber-400" />
                                <span>Torneio Finalizado</span>
                              </span>
                            ) : isApproved && isTournamentInProgress ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-500/10 text-[11px] font-black uppercase tracking-wider shadow-[0_0_15px_rgba(59,130,246,0.3)] animate-pulse">
                                <PlayCircle className="w-4 h-4 mr-1 text-blue-500 dark:text-blue-400 shrink-0" />
                                <span>CAMPEONATO EM ANDAMENTO</span>
                              </span>
                            ) : isApproved ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/15 text-[11px] font-black uppercase tracking-wider shadow-[0_0_15px_rgba(16,185,129,0.25)]">
                                <CheckCircle2 className="w-4 h-4 mr-1 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span>INSCRIÇÃO CONFIRMADA!</span>
                              </span>
                            ) : isWaitingApproval ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-600 dark:text-blue-400 text-[10px] font-black uppercase tracking-wider">
                                <Clock className="h-3 w-3 animate-pulse" />
                                <span>Em Análise</span>
                              </span>
                            ) : isWaitingPix ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/25 text-orange-600 dark:text-orange-400 text-[10px] font-black uppercase tracking-wider">
                                <Clock className="h-3 w-3 animate-pulse" />
                                <span>Aguardando Pix</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/25 text-yellow-600 dark:text-yellow-400 text-[10px] font-black uppercase tracking-wider">
                                <AlertCircle className="h-3 w-3" />
                                <span>Pendente</span>
                              </span>
                            )}
                          </div>

                          {/* Nome do Torneio */}
                          <div>
                            <h3 className="text-base font-black text-zinc-900 dark:text-white font-display tracking-tight group-hover:text-[#00a2ff] transition-colors line-clamp-1">
                              {reg.tournament?.name || "Campeonato Oficial"}
                            </h3>
                            {reg.tournament?.location && (
                              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1 mt-0.5">
                                <MapPin className="h-3 w-3 text-zinc-400 dark:text-zinc-500 shrink-0" />
                                <span className="truncate">{reg.tournament.location}</span>
                              </p>
                            )}
                          </div>

                          {/* Mensagem / Alerta de Status Central (Precedência Estrita) */}
                          {isCancellationRequested ? (
                            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs font-medium flex items-center gap-2 shadow-sm animate-fadeIn">
                              <Clock className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400 animate-pulse" />
                              <span>Aguardando confirmação e estorno por parte do organizador.</span>
                            </div>
                          ) : isApproved && isTournamentInProgress ? (
                            <div className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20 p-3 rounded-xl flex items-center text-xs font-semibold shadow-sm animate-fadeIn">
                              <Trophy className="w-5 h-5 mr-2 text-blue-500 dark:text-blue-400 shrink-0" />
                              <span>As partidas já começaram! Acompanhe o chaveamento.</span>
                            </div>
                          ) : isApproved ? (
                            <div className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 p-3 rounded-xl flex items-center text-xs font-semibold shadow-sm animate-fadeIn">
                              <CheckCircle2 className="w-5 h-5 mr-2 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              <span>Vaga confirmada! Você está oficialmente no torneio.</span>
                            </div>
                          ) : isWaitingApproval ? (
                            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 text-[11px] font-medium flex items-center gap-2 shadow-sm">
                              <Clock className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400 shrink-0 animate-pulse" />
                              <span>Comprovante em análise • O organizador foi notificado.</span>
                            </div>
                          ) : isWaitingPix || isPending ? (
                            <div className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-700 dark:text-orange-300 text-[11px] font-medium flex items-center gap-2 shadow-sm">
                              <Clock className="h-3.5 w-3.5 text-orange-500 dark:text-orange-400 shrink-0 animate-pulse" />
                              <span>Inscrição pendente de pagamento Pix.</span>
                            </div>
                          ) : null}

                          {/* Dados da Equipe / Dupla Registrada */}
                          <div className="p-3 rounded-xl bg-zinc-50 dark:bg-[#121214] border border-zinc-200 dark:border-zinc-800/80 space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
                              Minha Equipe / Dupla
                            </span>
                            <div className="text-xs font-bold text-zinc-800 dark:text-zinc-100 truncate">
                              {reg.name}
                            </div>
                            {(reg.player1 || reg.player2) && (
                              <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                                {[reg.player1, reg.player2].filter(Boolean).join(" • ")}
                              </div>
                            )}
                          </div>

                          {/* Seção de Botões de Ação (Com UM ÚNICO botão de WhatsApp) */}
                          <div className="pt-1 space-y-2">
                            {isCancellationRequested ? (
                              <a
                                href={organizerPhone ? `https://wa.me/${organizerPhone}` : "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!organizerPhone) {
                                    alert("Telefone do organizador não disponível.");
                                  }
                                }}
                                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-emerald-600/25 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                                title="Falar com o organizador via WhatsApp sobre o estorno"
                              >
                                <MessageCircle className="h-4 w-4 shrink-0" />
                                <span>Falar com o Organizador</span>
                              </a>
                            ) : (
                              <>
                                {/* Botão de Finalizar Pagamento se pendente */}
                                {(isWaitingPix || isPending) && !isWaitingApproval && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCheckoutRegistration(reg);
                                    }}
                                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-orange-500 via-amber-400 to-yellow-500 hover:from-orange-400 hover:to-amber-300 text-neutral-950 text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-orange-500/20 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                                    title="Finalizar pagamento e anexar comprovante"
                                  >
                                    <CreditCard className="h-3.5 w-3.5" />
                                    <span>Finalizar Pagamento</span>
                                  </button>
                                )}

                                {/* Botão Cancelar Minha Inscrição (apenas antes do torneio fechar) */}
                                {!isTournamentNotOpen && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRequestCancellation(reg);
                                    }}
                                    className="w-full py-2 px-3 rounded-xl border border-red-500/30 hover:border-red-500/60 bg-red-500/5 hover:bg-red-500/15 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer active:scale-95"
                                    title="Solicitar cancelamento da inscrição"
                                  >
                                    <Ban className="h-3.5 w-3.5 text-red-500 dark:text-red-400" />
                                    <span>Cancelar Minha Inscrição</span>
                                  </button>
                                )}

                                {/* Botão ÚNICO Falar com o Organizador */}
                                <a
                                  href={organizerPhone ? `https://wa.me/${organizerPhone}` : "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!organizerPhone) {
                                      alert("Telefone do organizador não disponível.");
                                    }
                                  }}
                                  className="w-full py-2 px-3 rounded-xl border border-emerald-500/30 hover:border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer active:scale-95"
                                  title="Falar com o organizador via WhatsApp"
                                >
                                  <MessageCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                  <span>Falar com o Organizador</span>
                                </a>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Rodapé do Mini Card */}
                        <div className="pt-3 mt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between text-xs font-bold text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors">
                          <span className="text-[11px] text-zinc-500">
                            {reg.tournament?.start_date
                              ? formatTournamentDate(reg.tournament.start_date, reg.tournament.end_date, reg.tournament.start_time)
                              : formatDate(reg.created_at)}
                          </span>
                          <span className="flex items-center gap-1 text-[#00a2ff] text-[11px]">
                            <span>Ver Página</span>
                            <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ======================================================== */}
            {/* SEÇÃO 2: MEUS CAMPEONATOS (VISÃO ORGANIZADOR) */}
            {/* ======================================================== */}
            <section className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-200 dark:border-[#27272a] pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-[#00a2ff]/10 border border-[#00a2ff]/20 text-[#00a2ff]">
                    <Trophy className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-zinc-900 dark:text-white font-display tracking-tight flex items-center gap-2">
                      <span>Meus Campeonatos</span>
                      <span className="px-2 py-0.5 rounded-full bg-[#00a2ff]/10 text-[#00a2ff] border border-[#00a2ff]/20 text-[10px] font-black">
                        {myTournaments.length}
                      </span>
                    </h2>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">
                      Torneios criados e administrados por você com controle total de súmula e chaveamento.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/60 text-xs font-bold text-zinc-800 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white transition-all self-start sm:self-auto cursor-pointer shadow-sm"
                >
                  <Plus className="h-3.5 w-3.5 text-[#00a2ff]" />
                  <span>Novo Campeonato</span>
                </button>
              </div>

              {/* Renderização de Campeonatos Criados ou Empty State */}
              {myTournaments.length === 0 ? (
                <div className="border-2 border-dashed border-zinc-300 dark:border-zinc-800 bg-white/50 dark:bg-[#141416]/50 rounded-3xl p-10 text-center space-y-4 shadow-sm">
                  <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/80 text-zinc-400 flex items-center justify-center mx-auto shadow-sm">
                    <Trophy className="h-7 w-7 text-[#00a2ff]" />
                  </div>
                  <div className="space-y-1 max-w-md mx-auto">
                    <h3 className="text-base font-bold text-zinc-900 dark:text-white">
                      Você ainda não criou nenhum campeonato.
                    </h3>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      Monte seu torneio personalizado em minutos com chaveamento mata-mata automático, súmula digital e pagamentos via Pix.
                    </p>
                  </div>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(true)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#00a2ff] hover:bg-blue-500 text-white font-black text-xs uppercase tracking-wider transition-all shadow-md shadow-blue-500/20 active:scale-95 cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Criar Meu Primeiro Torneio</span>
                    </button>
                  </div>
                </div>
              ) : (
                (() => {
                  const activeMyTournaments = myTournaments.filter(
                    (t) => !isTournamentCompletedStatus(t.status)
                  );
                  const completedMyTournaments = myTournaments.filter((t) =>
                    isTournamentCompletedStatus(t.status)
                  );
                  const displayedTournaments =
                    tournamentTab === "ACTIVE" ? activeMyTournaments : completedMyTournaments;

                  return (
                    <div className="space-y-5">
                      {/* Abas de Segregação: Ativos vs Histórico / Finalizados */}
                      <div className="flex flex-wrap items-center gap-2 bg-zinc-100 dark:bg-[#141416] p-1.5 rounded-2xl border border-zinc-200 dark:border-[#27272a] w-fit shadow-sm">
                        <button
                          type="button"
                          onClick={() => setTournamentTab("ACTIVE")}
                          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                            tournamentTab === "ACTIVE"
                              ? "bg-[#00a2ff] text-white shadow-md shadow-blue-500/20"
                              : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
                          }`}
                        >
                          <span>Torneios Ativos</span>
                          <span
                            className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                              tournamentTab === "ACTIVE"
                                ? "bg-white/20 text-white"
                                : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                            }`}
                          >
                            {activeMyTournaments.length}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setTournamentTab("COMPLETED")}
                          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                            tournamentTab === "COMPLETED"
                              ? "bg-zinc-700 text-white shadow-md"
                              : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
                          }`}
                        >
                          <span>Histórico / Finalizados</span>
                          <span
                            className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                              tournamentTab === "COMPLETED"
                                ? "bg-white/20 text-white"
                                : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                            }`}
                          >
                            {completedMyTournaments.length}
                          </span>
                        </button>
                      </div>

                      {displayedTournaments.length === 0 ? (
                        <div className="border border-dashed border-zinc-300 dark:border-zinc-800 bg-white/40 dark:bg-[#141416]/40 rounded-2xl p-8 text-center space-y-2 shadow-sm">
                          <Trophy className="h-8 w-8 text-zinc-400 dark:text-zinc-600 mx-auto" />
                          <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-300">
                            {tournamentTab === "ACTIVE"
                              ? "Nenhum torneio ativo no momento"
                              : "Nenhum torneio finalizado no histórico ainda"}
                          </h3>
                          <p className="text-xs text-zinc-500">
                            {tournamentTab === "ACTIVE"
                              ? "Crie um novo campeonato ou confira seus eventos encerrados na aba Histórico."
                              : "Quando você encerrar um campeonato após concluir todas as partidas, ele aparecerá arquivado aqui."}
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                          {displayedTournaments.map((tourn) => {
                            const sportType = tourn.sport_type || "DOMINO";
                            const sportInfo = SPORT_META[sportType] || SPORT_META.DOMINO;
                            const maxVagas = tourn.max_teams || 16;
                            const preenchidas = tourn.teamsCount;
                            const pct = Math.min(100, Math.round((preenchidas / maxVagas) * 100));

                            const isFinalizado = isTournamentCompletedStatus(tourn.status);
                            const isCancelado =
                              String(tourn.status || "").toUpperCase() === "CANCELLED" ||
                              String(tourn.status || "").toUpperCase() === "CANCELADO";

                            return (
                              <div
                                key={tourn.id}
                                onClick={() => {
                                  setCurrentTournamentId(tourn.id);
                                  router.push(`/dashboard/${tourn.id}`);
                                }}
                                className="bg-white dark:bg-[#1a1a1a] border border-zinc-200 dark:border-[#27272a] hover:border-[#00a2ff]/60 rounded-2xl p-5 flex flex-col justify-between transition-all duration-300 shadow-sm dark:shadow-xl hover:shadow-[#00a2ff]/10 cursor-pointer group relative overflow-hidden"
                              >
                                {/* Linha decorativa superior azul */}
                                <div
                                  className={`absolute top-0 left-0 right-0 h-1 ${
                                    isFinalizado
                                      ? "bg-zinc-400 dark:bg-zinc-600"
                                      : "bg-gradient-to-r from-[#00a2ff] to-indigo-500"
                                  }`}
                                />

                                <div className="space-y-4">
                                  {/* Topo do Card: Modalidade & Status do Torneio */}
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-[#121214] border border-zinc-200 dark:border-zinc-800 text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
                                      <span>{sportInfo.icon}</span>
                                      <span>{sportInfo.label}</span>
                                      {tourn.format && (
                                        <>
                                          <span className="text-zinc-400 dark:text-zinc-600">•</span>
                                          <span className="text-zinc-500 dark:text-zinc-400">{translateTournamentFormat(tourn.format)}</span>
                                        </>
                                      )}
                                    </span>

                                    <div className="flex items-center gap-1.5">
                                      {isFinalizado ? (
                                        <span className="px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 text-[10px] font-black uppercase tracking-wider">
                                          FINALIZADO
                                        </span>
                                      ) : isCancelado ? (
                                        <span className="px-2.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/25 text-[10px] font-black uppercase tracking-wider">
                                          CANCELADO
                                        </span>
                                      ) : String(tourn.status || "").toUpperCase() === "IN_PROGRESS" ||
                                        String(tourn.status || "").toUpperCase() === "EM_ANDAMENTO" ||
                                        String(tourn.status || "").toUpperCase() === "LIVE" ? (
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-600 border border-blue-400 text-white text-[10px] font-black uppercase tracking-wider shadow-lg shadow-blue-600/30 animate-pulse">
                                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                                          <span>EM ANDAMENTO</span>
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-wider">
                                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                                          <span>Ativo</span>
                                        </span>
                                      )}
                                    </div>
                                  </div>

                          {/* Nome do Torneio */}
                          <div>
                            <h3 className="text-base font-black text-zinc-900 dark:text-white font-display tracking-tight group-hover:text-[#00a2ff] transition-colors line-clamp-1">
                              {tourn.name}
                            </h3>
                            <div className="flex items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3 text-zinc-400 dark:text-zinc-500 shrink-0" />
                                <span>{formatTournamentDate(tourn.start_date, tourn.end_date, tourn.start_time)}</span>
                              </span>
                              {tourn.location && (
                                <span className="flex items-center gap-1 truncate max-w-[130px]">
                                  <MapPin className="h-3 w-3 text-zinc-400 dark:text-zinc-500 shrink-0" />
                                  <span className="truncate">{tourn.location}</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Estatísticas Rápidas: Vagas Preenchidas & Taxa */}
                          <div className="p-3 rounded-xl bg-zinc-50 dark:bg-[#121214] border border-zinc-200 dark:border-zinc-800/80 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-zinc-500 font-medium">Vagas Ocupadas:</span>
                              <span className="font-bold text-zinc-900 dark:text-white">
                                <strong className="text-[#00a2ff]">{preenchidas}</strong> / {maxVagas} equipes
                              </span>
                            </div>

                            {/* Barra de Progresso de Ocupação */}
                            <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-[#00a2ff] to-blue-500 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>

                            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-zinc-200 dark:border-zinc-800/50">
                              <span className="text-zinc-500">Inscrição:</span>
                              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                {tourn.entry_fee && tourn.entry_fee > 0
                                  ? `R$ ${tourn.entry_fee.toFixed(2).replace(".", ",")}`
                                  : "Gratuito"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Botão de Ação / Rodapé */}
                        <div className="pt-3 mt-4 border-t border-zinc-100 dark:border-zinc-800/80">
                          <button
                            type="button"
                            className="w-full py-2 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-900 group-hover:bg-[#00a2ff] text-zinc-700 dark:text-zinc-300 group-hover:text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                          >
                            <LayoutDashboard className="h-3.5 w-3.5" />
                            <span>Gerenciar Painel</span>
                            <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                        </div>
                      )}
                    </div>
                  );
                })()
              )}
            </section>

            {/* ======================================================== */}
            {/* SEÇÃO 3: TORNEIOS COMPARTILHADOS COMIGO (EQUIPE / STAFF) */}
            {/* ======================================================== */}
            <section className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-200 dark:border-[#27272a] pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-zinc-900 dark:text-white font-display tracking-tight flex items-center gap-2">
                      <span>Torneios Compartilhados Comigo</span>
                      <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 text-[10px] font-black">
                        {sharedTournaments.length}
                      </span>
                    </h2>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">
                      Competições nas quais você faz parte da comissão técnica ou arbitragem (Administrador, Árbitro ou Mesário).
                    </p>
                  </div>
                </div>
              </div>

              {sharedTournaments.length === 0 ? (
                <div className="border border-dashed border-zinc-300 dark:border-zinc-800/80 bg-white/30 dark:bg-[#141416]/30 rounded-2xl p-6 text-center space-y-2 shadow-sm">
                  <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-400 flex items-center justify-center mx-auto shadow-sm">
                    <Shield className="h-5 w-5 text-purple-500 dark:text-purple-400/60" />
                  </div>
                  <h3 className="text-xs font-bold text-zinc-800 dark:text-zinc-300">
                    Nenhum torneio compartilhado com você no momento
                  </h3>
                  <p className="text-[11px] text-zinc-500 max-w-sm mx-auto leading-relaxed">
                    Quando o organizador de uma competição adicionar seu e-mail como Administrador, Árbitro ou Mesário, ele aparecerá aqui com acesso direto ao painel.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {sharedTournaments.map((tourn) => {
                    const sportType = tourn.sport_type || "DOMINO";
                    const sportInfo = SPORT_META[sportType] || SPORT_META.DOMINO;
                    const maxVagas = tourn.max_teams || 16;
                    const preenchidas = tourn.teamsCount;
                    const pct = Math.min(100, Math.round((preenchidas / maxVagas) * 100));
                    const isFinalizado = isTournamentCompletedStatus(tourn.status);

                    return (
                      <div
                        key={tourn.id}
                        onClick={() => {
                          setCurrentTournamentId(tourn.id);
                          router.push(`/dashboard/${tourn.id}`);
                        }}
                        className="bg-white dark:bg-[#1a1a1a] border border-zinc-200 dark:border-[#27272a] hover:border-purple-500/60 rounded-2xl p-5 flex flex-col justify-between transition-all duration-300 shadow-sm dark:shadow-xl hover:shadow-purple-500/10 cursor-pointer group relative overflow-hidden"
                      >
                        {/* Linha decorativa superior roxo/indigo */}
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-indigo-500 to-[#00a2ff]" />

                        <div className="space-y-4">
                          {/* Topo do Card: Modalidade & Cargo de Staff */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-[#121214] border border-zinc-200 dark:border-zinc-800 text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
                              <span>{sportInfo.icon}</span>
                              <span>{sportInfo.label}</span>
                              {tourn.format && (
                                <>
                                  <span className="text-zinc-400 dark:text-zinc-600">•</span>
                                  <span className="text-zinc-500 dark:text-zinc-400">{translateTournamentFormat(tourn.format)}</span>
                                </>
                              )}
                            </span>

                            {/* Cargo atribuído */}
                            <span
                              className={`px-2.5 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-wider flex items-center gap-1 ${
                                tourn.staffRole === "ADMIN"
                                  ? "bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-300"
                                  : tourn.staffRole === "REFEREE"
                                  ? "bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300"
                                  : "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300"
                              }`}
                            >
                              {tourn.staffRole === "ADMIN" ? (
                                <>
                                  <ShieldCheck className="h-3 w-3" />
                                  <span>Administrador</span>
                                </>
                              ) : tourn.staffRole === "REFEREE" ? (
                                <>
                                  <Shield className="h-3 w-3" />
                                  <span>Árbitro</span>
                                </>
                              ) : (
                                <>
                                  <ShieldAlert className="h-3 w-3" />
                                  <span>Mesário</span>
                                </>
                              )}
                            </span>
                          </div>

                          {/* Nome do Torneio */}
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="text-base font-black text-zinc-900 dark:text-white font-display tracking-tight group-hover:text-purple-500 dark:group-hover:text-purple-400 transition-colors line-clamp-1">
                                {tourn.name}
                              </h3>
                              {String(tourn.status || "").toUpperCase() === "IN_PROGRESS" ||
                              String(tourn.status || "").toUpperCase() === "EM_ANDAMENTO" ||
                              String(tourn.status || "").toUpperCase() === "LIVE" ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-600/80 text-white text-[9px] font-black uppercase tracking-wider shrink-0">
                                  <span className="w-1 h-1 rounded-full bg-white animate-ping" />
                                  <span>Ao Vivo</span>
                                </span>
                              ) : isFinalizado ? (
                                <span className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[9px] font-bold uppercase tracking-wider shrink-0">
                                  Finalizado
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3 text-zinc-400 dark:text-zinc-500 shrink-0" />
                                <span>{formatTournamentDate(tourn.start_date, tourn.end_date, tourn.start_time)}</span>
                              </span>
                              {tourn.location && (
                                <span className="flex items-center gap-1 truncate max-w-[130px]">
                                  <MapPin className="h-3 w-3 text-zinc-400 dark:text-zinc-500 shrink-0" />
                                  <span className="truncate">{tourn.location}</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Estatísticas Rápidas: Vagas Preenchidas */}
                          <div className="p-3 rounded-xl bg-zinc-50 dark:bg-[#121214] border border-zinc-200 dark:border-zinc-800/80 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-zinc-500 font-medium">Vagas Ocupadas:</span>
                              <span className="font-bold text-zinc-900 dark:text-white">
                                <strong className="text-purple-600 dark:text-purple-400">{preenchidas}</strong> / {maxVagas} equipes
                              </span>
                            </div>

                            {/* Barra de Progresso de Ocupação */}
                            <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>

                            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-zinc-200 dark:border-zinc-800/50">
                              <span className="text-zinc-500">Inscrição:</span>
                              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                {tourn.entry_fee && tourn.entry_fee > 0
                                  ? `R$ ${tourn.entry_fee.toFixed(2).replace(".", ",")}`
                                  : "Gratuito"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Botão de Ação / Rodapé */}
                        <div className="pt-3 mt-4 border-t border-zinc-100 dark:border-zinc-800/80">
                          <button
                            type="button"
                            className="w-full py-2 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-900 group-hover:bg-purple-600 text-zinc-700 dark:text-zinc-300 group-hover:text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                          >
                            <LayoutDashboard className="h-3.5 w-3.5" />
                            <span>
                              {tourn.staffRole === "ADMIN"
                                ? "Painel de Gestão"
                                : tourn.staffRole === "REFEREE"
                                ? "Painel de Arbitragem"
                                : "Mesa de Pontuação"}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* 3. Rodapé Minimalista */}
      <footer className="border-t border-zinc-200 dark:border-[#27272a] py-6 text-center text-xs text-zinc-500 bg-white/50 dark:bg-[#141416]/50">
        <div>SportConnect Hub • Plataforma de Gestão Esportiva Multimodal</div>
      </footer>

      {/* Modal de Criação de Torneio */}
      <CreateTournamentModal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          fetchUserData();
        }}
      />

      {/* MODAL: FINALIZAR PAGAMENTO (RETOMAR CHECKOUT PIX) */}
      {checkoutRegistration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto animate-fadeIn">
          <PixCheckoutForm
            tournamentId={checkoutRegistration.tournament?.id || checkoutRegistration.tournament_id || ""}
            tournamentName={checkoutRegistration.tournament?.name || "Torneio Oficial"}
            teamId={checkoutRegistration.id}
            teamName={checkoutRegistration.name}
            captainName={checkoutRegistration.manager_name || checkoutRegistration.player1 || userName}
            totalAmount={checkoutRegistration.tournament?.entry_fee ? Number(checkoutRegistration.tournament.entry_fee) : 0}
            sportType={checkoutRegistration.tournament?.sport_type}
            email={user?.email || undefined}
            onClose={() => setCheckoutRegistration(null)}
            onSuccess={() => {
              setCheckoutRegistration(null);
              fetchUserData();
              router.refresh();
            }}
          />
        </div>
      )}

      {/* MODAL DE AVISO: CANCELAMENTO PÓS-PAGAMENTO */}
      {cancellingPaidReg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/85 backdrop-blur-md p-4 animate-fadeIn">
          <div className="bg-white dark:bg-[#141416] border border-red-500/30 dark:border-red-500/40 rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl relative space-y-5 animate-scaleUp">
            {/* Linha superior vermelha de aviso */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-600 via-amber-500 to-red-500 rounded-t-3xl" />

            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-500 dark:text-red-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-black font-display text-zinc-900 dark:text-white">
                    Aviso de Cancelamento
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-[240px]">
                    {cancellingPaidReg.tournament?.name || "Campeonato Oficial"} • {cancellingPaidReg.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCancellingPaidReg(null)}
                className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed space-y-2.5">
              <p className="font-semibold text-red-700 dark:text-red-300">
                O seu pagamento já foi processado e transferido para o organizador.
              </p>
              <p className="text-zinc-600 dark:text-zinc-300">
                Ao cancelar, a sua vaga será perdida. O reembolso deve ser negociado diretamente com a organização do evento.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCancellingPaidReg(null)}
                className="py-2.5 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:border-zinc-500 bg-white dark:bg-zinc-800/80 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-all cursor-pointer shadow-sm"
              >
                Voltar / Manter Vaga
              </button>
              <button
                type="button"
                disabled={
                  isCancellingId === cancellingPaidReg.id ||
                  (Boolean(cancellingPaidReg.tournament?.status) &&
                    cancellingPaidReg.tournament?.status !== "OPEN")
                }
                onClick={() => executeCancellation(cancellingPaidReg.id, "REFUND_REQUESTED")}
                className="py-2.5 px-5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-red-600/30 flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  cancellingPaidReg.tournament?.status !== "OPEN"
                    ? "Cancelamento indisponível após o fechamento das chaves."
                    : undefined
                }
              >
                {isCancellingId === cancellingPaidReg.id ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Cancelando...</span>
                  </>
                ) : (
                  <>
                    <Ban className="h-3.5 w-3.5" />
                    <span>Confirmar Cancelamento</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
