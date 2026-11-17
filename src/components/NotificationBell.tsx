"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CheckCheck,
  AlertTriangle,
  ChevronRight,
  Loader2,
  Inbox,
  UserPlus,
  CheckCircle2,
  FileText,
  Ban,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthProvider";
import { useTournament } from "@/context/TournamentContext";

export interface AppNotification {
  id: string;
  user_id: string;
  tournament_id?: string | null;
  message: string;
  read?: boolean;
  is_read?: boolean;
  read_at?: string | null;
  created_at?: string;
}

export const isNotificationUnread = (notif: AppNotification): boolean => {
  if (typeof notif.read === "boolean") {
    return notif.read === false;
  }
  if (notif.read_at !== undefined) {
    return notif.read_at === null;
  }
  if (typeof notif.is_read === "boolean") {
    return notif.is_read === false;
  }
  return false;
};

export default function NotificationBell() {
  const router = useRouter();
  const { user } = useAuth();
  const { setCurrentTournamentId } = useTournament();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Busca todas as notificações do usuário atual ordenadas pela data decrescente
  const fetchNotifications = useCallback(async () => {
    if (!user?.id) {
      setNotifications([]);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[NOTIFICATIONS ERROR]: Falha ao buscar notificações do usuário -", error);
      } else if (data) {
        setNotifications(data as AppNotification[]);
      }
    } catch (err) {
      console.error("[NOTIFICATIONS ERROR]: Exceção ao carregar notificações -", err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Assinatura Realtime para atualizar o sino instantaneamente quando um alerta for disparado
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`notifications-bell-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, fetchNotifications]);

  // Fecha o popover ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  if (!user) return null;

  const unreadCount = notifications.filter(isNotificationUnread).length;

  const handleNotificationClick = async (notif: AppNotification) => {
    setProcessingId(notif.id);
    try {
      // 1. Atualiza o banco marcando como lida se ainda estiver pendente
      if (isNotificationUnread(notif)) {
        setNotifications((prev) =>
          prev.map((item) =>
            item.id === notif.id
              ? { ...item, read: true, is_read: true, read_at: new Date().toISOString() }
              : item
          )
        );

        // Atualização resiliente suportando os esquemas 'read', 'is_read' e 'read_at'
        try {
          await supabase
            .from("notifications")
            .update({
              read: true,
              is_read: true,
              read_at: new Date().toISOString(),
            })
            .eq("id", notif.id);
        } catch {
          try {
            await supabase.from("notifications").update({ is_read: true }).eq("id", notif.id);
          } catch {
            await supabase.from("notifications").update({ read: true }).eq("id", notif.id);
          }
        }
      }
      setIsOpen(false);

      // 2. Redireciona diretamente para a rota contextual do torneio
      let targetTournamentId = notif.tournament_id;

      // Fallback caso tournament_id não esteja preenchido: tenta extrair pelo nome
      if (!targetTournamentId && notif.message) {
        const match =
          notif.message.match(/torneio\s+([^.]+)/i) ||
          notif.message.match(/competi[çc][ãa]o\s+([^.]+)/i);
        if (match?.[1]) {
          const compName = match[1].trim();
          const { data: foundTour } = await supabase
            .from("tournaments")
            .select("id")
            .ilike("name", compName)
            .maybeSingle();
          if (foundTour?.id) {
            targetTournamentId = foundTour.id;
          }
        }
      }

      const isStaffInvite =
        notif.message.includes("convidado") ||
        notif.message.toLowerCase().includes("árbitro") ||
        notif.message.toLowerCase().includes("mesário") ||
        notif.message.toLowerCase().includes("administrador");

      const isOrganizerAlert =
        notif.message.includes("Nova inscrição") ||
        notif.message.includes("solicitou") ||
        notif.message.includes("cancelamento");

      if (isStaffInvite && targetTournamentId) {
        setCurrentTournamentId(targetTournamentId);
        router.push(`/dashboard/${targetTournamentId}`);
      } else if (isOrganizerAlert && targetTournamentId) {
        setCurrentTournamentId(targetTournamentId);
        router.push(`/dashboard/torneios/${targetTournamentId}/inscricoes`);
      } else if (targetTournamentId) {
        router.push(`/torneio/${targetTournamentId}`);
      } else {
        router.push("/hub");
      }
    } catch (err) {
      console.error("[NOTIFICATIONS ERROR]: Falha ao processar clique na notificação -", err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!user?.id || unreadCount === 0) return;
    try {
      const unreadIds = notifications.filter(isNotificationUnread).map((n) => n.id);
      setNotifications((prev) =>
        prev.map((n) => ({
          ...n,
          read: true,
          is_read: true,
          read_at: new Date().toISOString(),
        }))
      );
      if (unreadIds.length > 0) {
        try {
          await supabase
            .from("notifications")
            .update({
              read: true,
              is_read: true,
              read_at: new Date().toISOString(),
            })
            .in("id", unreadIds);
        } catch {
          try {
            await supabase.from("notifications").update({ is_read: true }).in("id", unreadIds);
          } catch {
            await supabase.from("notifications").update({ read: true }).in("id", unreadIds);
          }
        }
      }
    } catch (err) {
      console.error("[NOTIFICATIONS ERROR]: Erro ao marcar todas as notificações como lidas -", err);
      fetchNotifications();
    }
  };

  const formatTimeAgo = (dateStr?: string) => {
    if (!dateStr) return "Agora";
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return "Recente";
      const diffMs = Date.now() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return "Agora mesmo";
      if (diffMin < 60) return `Há ${diffMin} min`;
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) return `Há ${diffHours}h`;
      return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    } catch {
      return "Recente";
    }
  };

  const renderIcon = (message: string) => {
    if (message.includes("Nova inscrição") || message.includes("solicitou")) {
      return (
        <div className="p-2 rounded-xl bg-blue-500/15 border border-blue-500/30 text-[#00a2ff] shrink-0 mt-0.5">
          <UserPlus className="h-4 w-4" />
        </div>
      );
    }
    if (message.includes("confirmada") || message.includes("aprovad") || message.includes("liberada")) {
      return (
        <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shrink-0 mt-0.5">
          <CheckCircle2 className="h-4 w-4" />
        </div>
      );
    }
    if (message.includes("atualizado") || message.includes("regulamento") || message.includes("regras")) {
      return (
        <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0 mt-0.5">
          <FileText className="h-4 w-4" />
        </div>
      );
    }
    if (message.includes("cancelad") || message.includes("estornad")) {
      return (
        <div className="p-2 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 shrink-0 mt-0.5">
          <Ban className="h-4 w-4" />
        </div>
      );
    }
    return (
      <div className="p-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 shrink-0 mt-0.5">
        <AlertTriangle className="h-4 w-4" />
      </div>
    );
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => {
          const nextOpen = !isOpen;
          setIsOpen(nextOpen);
          if (nextOpen) {
            fetchNotifications();
          }
        }}
        className={`relative p-2.5 rounded-xl border transition-all cursor-pointer active:scale-95 flex items-center justify-center ${
          isOpen
            ? "bg-surface-elevated border-[#00a2ff]/50 text-[#00a2ff]"
            : "bg-surface hover:bg-surface-elevated border-subtle text-secondary hover:text-primary"
        }`}
        title="Notificações e Alertas"
        aria-label="Notificações"
      >
        <Bell className="h-4 w-4" />

        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 border-2 border-surface text-white text-[10px] font-black flex items-center justify-center leading-none shadow-md shadow-red-600/40 animate-pulse">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown / Popover de Notificações */}
      {isOpen && (
        <div className="absolute right-0 mt-2.5 w-80 sm:w-96 rounded-2xl bg-surface-elevated border border-subtle shadow-2xl z-50 overflow-hidden animate-fadeIn">
          {/* Cabeçalho do Popover */}
          <div className="px-4 py-3 border-b border-subtle flex items-center justify-between bg-surface">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-[#00a2ff]" />
              <span className="text-xs font-black uppercase tracking-wider text-primary">
                Notificações
              </span>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-[10px] font-black">
                  {unreadCount} nova{unreadCount > 1 ? "s" : ""}
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllAsRead}
                className="text-[11px] font-bold text-muted hover:text-[#00a2ff] flex items-center gap-1 transition-colors cursor-pointer"
                title="Marcar todas como lidas"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span>Marcar todas como lidas</span>
              </button>
            )}
          </div>

          {/* Lista de Notificações */}
          <div className="max-h-80 overflow-y-auto divide-y divide-subtle">
            {loading && notifications.length === 0 ? (
              <div className="py-8 px-4 flex flex-col items-center justify-center gap-2 text-muted">
                <Loader2 className="h-5 w-5 animate-spin text-[#00a2ff]" />
                <span className="text-xs">Carregando alertas...</span>
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-10 px-6 text-center space-y-2">
                <div className="w-10 h-10 rounded-2xl bg-canvas border border-subtle text-muted flex items-center justify-center mx-auto">
                  <Inbox className="h-5 w-5" />
                </div>
                <p className="text-xs font-bold text-primary">
                  Nenhuma notificação no momento
                </p>
                <p className="text-[11px] text-muted leading-relaxed">
                  Você será alertado aqui sobre novas inscrições, aprovações e alterações de regulamento.
                </p>
              </div>
            ) : (
              notifications.map((notif) => {
                const unread = isNotificationUnread(notif);
                return (
                  <button
                    key={notif.id}
                    type="button"
                    disabled={processingId === notif.id}
                    onClick={() => handleNotificationClick(notif)}
                    className={`w-full text-left p-4 hover:bg-surface transition-colors flex items-start gap-3 group cursor-pointer disabled:opacity-50 relative ${
                      unread ? "bg-[#00a2ff]/5 font-semibold" : "opacity-85"
                    }`}
                  >
                    {/* Indicador de não lida */}
                    {unread && (
                      <span className="absolute top-4 left-1.5 w-1.5 h-1.5 rounded-full bg-[#00a2ff]" />
                    )}

                    {processingId === notif.id ? (
                      <div className="p-2 rounded-xl bg-surface border border-subtle text-muted shrink-0 mt-0.5">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : (
                      renderIcon(notif.message)
                    )}

                    <div className="flex-1 min-w-0 space-y-1">
                      <p
                        className={`text-xs leading-snug group-hover:text-primary ${
                          unread ? "text-primary font-bold" : "text-secondary"
                        }`}
                      >
                        {notif.message}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-muted font-semibold">
                        <span>{formatTimeAgo(notif.created_at)}</span>
                        <span className="text-[#00a2ff] group-hover:underline flex items-center gap-0.5 font-bold">
                          <span>Ver detalhes</span>
                          <ChevronRight className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
