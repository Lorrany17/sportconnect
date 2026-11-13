"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toPng } from "html-to-image";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Users,
  Trophy,
  DollarSign,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Share2,
  ExternalLink,
  Layers,
  Sparkles,
  Clock,
  Ban,
  Network,
  Building2,
  CreditCard,
  AlertTriangle,
  X,
  Lock,
  Swords,
  FileText,
  Award,
  Shield,
  Pencil,
  MessageCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthProvider";
import { useTournament } from "@/context/TournamentContext";
import { Tournament, SportType, Team } from "@/types";
import { DEFAULT_COVERS, SPORT_SELECT_OPTIONS } from "@/components/CreateTournamentForm";
import PublicRegistrationForm from "@/components/PublicRegistrationForm";
import PublicHeader from "@/components/PublicHeader";
import PixCheckoutForm from "@/components/PixCheckoutForm";
import { cancelRegistration } from "@/app/actions/registration";
import { translateTournamentFormat } from "@/utils/formatMap";

export default function DetalhesTorneioPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { tournaments: contextTournaments, setCurrentTournamentId } = useTournament();

  const id = (params?.id as string) || "";

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [loginNotice, setLoginNotice] = useState("");
  const [isEnrolledRequested, setIsEnrolledRequested] = useState(false);
  const [registrationStatus, setRegistrationStatus] = useState<string | null>(null);
  const [cancellationStatus, setCancellationStatus] = useState<string | null>(null);
  const [registeredTeamId, setRegisteredTeamId] = useState<string | null>(null);
  const [registeredTeamData, setRegisteredTeamData] = useState<any | null>(null);
  const [isEditingRegistration, setIsEditingRegistration] = useState<boolean>(false);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [showRegistrationModal, setShowRegistrationModal] = useState(false);
  const [tournamentTeams, setTournamentTeams] = useState<Team[]>([]);
  const [isRulebookExpanded, setIsRulebookExpanded] = useState(false);
  const [organizerPhone, setOrganizerPhone] = useState<string>("");

  // Modais de pagamento e cancelamento pós-pagamento
  const [showPaidCancelModal, setShowPaidCancelModal] = useState<boolean>(false);
  const [showResumeCheckout, setShowResumeCheckout] = useState<boolean>(false);

  // Ref e estado para geração do cartaz de compartilhamento (WhatsApp / Stories)
  const showcaseRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // Verificação de inscrição do usuário autenticado no torneio
  useEffect(() => {
    if (!id || !user?.id) {
      setRegistrationStatus(null);
      setCancellationStatus(null);
      setRegisteredTeamId(null);
      setRegisteredTeamData(null);
      return;
    }

    const currentUserId = user.id;

    async function checkExistingRegistration() {
      try {
        // 1. Busca por equipe em que o usuário seja o capitão/criador
        let foundTeam: any = null;
        const { data: teamByUser, error: teamErr } = await supabase
          .from("teams")
          .select("*")
          .eq("tournament_id", id)
          .eq("user_id", currentUserId)
          .neq("status", "CANCELLED")
          .order("created_at", { ascending: false })
          .limit(1);

        if (!teamErr && teamByUser && teamByUser.length > 0) {
          foundTeam = teamByUser[0];
        } else {
          // 2. Busca alternativa em team_members caso não seja o user_id principal da equipe
          const { data: memberRows } = await supabase
            .from("team_members")
            .select("team_id")
            .eq("user_id", currentUserId);

          const memberTeamIds = memberRows?.map((m) => m.team_id).filter(Boolean) || [];
          if (memberTeamIds.length > 0) {
            const { data: teamByMember } = await supabase
              .from("teams")
              .select("*")
              .in("id", memberTeamIds)
              .eq("tournament_id", id)
              .neq("status", "CANCELLED")
              .order("created_at", { ascending: false })
              .limit(1);

            if (teamByMember && teamByMember.length > 0) {
              foundTeam = teamByMember[0];
            }
          }
        }

        if (foundTeam) {
          setRegisteredTeamId(foundTeam.id);
          const rawPayStatus = String(foundTeam.payment_status || "").toUpperCase();
          const rawStatus = String(foundTeam.status || "").toUpperCase();

          const resolvedStatus =
            rawPayStatus === "APPROVED" ||
              rawPayStatus === "PAID" ||
              rawStatus === "CONFIRMED" ||
              rawStatus === "PAID"
              ? "APPROVED"
              : rawPayStatus === "WAITING_APPROVAL" || Boolean(foundTeam.payment_proof_url)
                ? "WAITING_APPROVAL"
                : rawPayStatus === "WAITING_PIX" || rawStatus === "PENDING"
                  ? "WAITING_PIX"
                  : rawPayStatus || rawStatus || "PENDING";

          setRegistrationStatus(resolvedStatus);
          setCancellationStatus(foundTeam.cancellation_status || null);

          const { data: membersData } = await supabase
            .from("team_members")
            .select("*")
            .eq("team_id", foundTeam.id);

          setRegisteredTeamData({
            ...foundTeam,
            players: [foundTeam.player1 || "Jogador 1", foundTeam.player2 || ""],
            members: membersData || [],
          });
        } else {
          setRegisteredTeamId(null);
          setRegistrationStatus(null);
          setCancellationStatus(null);
          setRegisteredTeamData(null);
        }
      } catch (err) {
        console.warn("Aviso ao checar inscrição existente:", err);
        setRegistrationStatus(null);
        setCancellationStatus(null);
        setRegisteredTeamId(null);
        setRegisteredTeamData(null);
      }
    }

    checkExistingRegistration();
  }, [id, user?.id, refreshKey]);

  // Listener em tempo real para sincronizar o status da inscrição quando houver alterações
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`tournament-teams-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "teams",
          filter: `tournament_id=eq.${id}`,
        },
        () => {
          setRefreshKey((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  // Fetch do torneio por ID
  useEffect(() => {
    if (!id) return;

    async function fetchTournament() {
      try {
        if (!tournament) {
          setLoading(true);
        }
        setErrorMessage("");

        const { data, error } = await supabase
          .from("tournaments")
          .select("*")
          .eq("id", id)
          .maybeSingle();

        if (error) {
          console.warn("Erro ao buscar detalhes do torneio no Supabase:", error);
          // Fallback ao contexto
          const foundInContext = contextTournaments.find((t) => t.id === id);
          if (foundInContext) {
            setTournament(foundInContext);
          } else {
            setErrorMessage("Torneio não encontrado.");
          }
        } else if (data) {
          const parsedRulesObj =
            typeof data.match_rules === "string"
              ? (() => {
                  try {
                    return JSON.parse(data.match_rules);
                  } catch {
                    return {};
                  }
                })()
              : data.match_rules || {};
          const resolvedRegulationUrl =
            data.regulation_url ||
            data.rulebook_url ||
            parsedRulesObj?.regulation_url ||
            parsedRulesObj?.rulebook_url ||
            null;

          const mapped: Tournament = {
            id: data.id,
            name: data.name,
            status: data.status,
            createdAt: data.created_at,
            sport_type: (data.sport_type as SportType) || "DOMINO",
            format: data.format,
            tournament_format: data.tournament_format,
            rulebook_url: resolvedRegulationUrl,
            regulation_url: resolvedRegulationUrl,
            owner_id: data.owner_id,
            max_teams: data.max_teams ? Number(data.max_teams) : 16,
            entry_fee: data.entry_fee ? Number(data.entry_fee) : 0,
            location: data.location,
            start_date: data.start_date,
            start_time: data.start_time,
            end_date: data.end_date,
            rules: data.rules || data.rules_description || data.custom_rules || "",
            cover_url: data.cover_url,
            gender_category: data.gender_category,
            sponsors: data.sponsors || [],
            organizer_pix_key: data.organizer_pix_key,
            pix_key_type: data.pix_key_type,
            custom_registration_fields: data.custom_registration_fields,
            match_rules: data.match_rules,
            prize_first: data.prize_first,
            prize_second: data.prize_second,
            prize_third: data.prize_third,
            min_players: data.min_players,
            max_players: data.max_players,
            min_age: data.min_age,
            max_age: data.max_age,
            skill_level: data.skill_level || "ALL",
            require_cpf: Boolean(data.require_cpf),
            require_phone: Boolean(data.require_phone),
          };
          setTournament(mapped);

          // Buscar telefone do organizador na tabela profiles (ou chave Pix celular)
          let rawOrgPhone =
            data.organizer_phone ||
            data.contact ||
            (data.pix_key_type === "CELULAR" ? data.organizer_pix_key : "") ||
            "";
          if (data.owner_id) {
            try {
              const { data: orgProfile } = await supabase
                .from("profiles")
                .select("phone")
                .eq("id", data.owner_id)
                .maybeSingle();
              if (orgProfile?.phone) {
                rawOrgPhone = orgProfile.phone;
              }
            } catch (orgErr) {
              console.warn("Aviso ao buscar telefone do organizador:", orgErr);
            }
          }
          const cleanDigits = String(rawOrgPhone || "").replace(/\D/g, "");
          const formattedWaPhone =
            cleanDigits.length >= 10 && cleanDigits.length <= 11 && !cleanDigits.startsWith("55")
              ? `55${cleanDigits}`
              : cleanDigits;
          setOrganizerPhone(formattedWaPhone);

          // Fetch das equipes inscritas no torneio
          const { data: teamsData } = await supabase
            .from("teams")
            .select("*")
            .eq("tournament_id", id)
            .in("payment_status", ["APPROVED", "PAID"])
            .order("created_at", { ascending: true });

          if (teamsData) {
            const approvedTeamsData = teamsData.filter(
              (t: any) =>
                (t.payment_status === "APPROVED" ||
                  t.payment_status === "PAID" ||
                  t.status === "APPROVED" ||
                  t.status === "CONFIRMED" ||
                  t.status === "PAID") &&
                t.payment_status !== "PENDING" &&
                t.payment_status !== "WAITING_PIX" &&
                t.payment_status !== "WAITING_APPROVAL" &&
                t.payment_status !== "CANCELED" &&
                t.payment_status !== "REJECTED" &&
                t.status !== "PENDING" &&
                t.status !== "CANCELED" &&
                t.status !== "REJECTED" &&
                t.cancellation_status !== "REFUNDED"
            );
            const mappedTeams: Team[] = approvedTeamsData.map((t: any) => ({
              id: t.id,
              name: t.name,
              players: [t.player1 || "Jogador 1", t.player2].filter(Boolean),
              roster: t.roster,
              createdAt: t.created_at || new Date().toISOString(),
              status: t.status,
              tournamentId: t.tournament_id,
              payment_status: t.payment_status,
              manager_name: t.manager_name || t.player1,
              category: t.category,
              user_id: t.user_id,
            }));
            setTournamentTeams(mappedTeams);
          }
        } else {
          const foundInContext = contextTournaments.find((t) => t.id === id);
          if (foundInContext) {
            setTournament(foundInContext);
          } else {
            setErrorMessage("Torneio não encontrado.");
          }
        }
      } catch (err) {
        console.error("Exceção ao buscar torneio:", err);
        const foundInContext = contextTournaments.find((t) => t.id === id);
        if (foundInContext) {
          setTournament(foundInContext);
        } else {
          setErrorMessage("Ocorreu um erro ao carregar as informações do torneio.");
        }
      } finally {
        setLoading(false);
      }
    }

    fetchTournament();
  }, [id, contextTournaments, refreshKey]);

  // Formatação de data e horário do evento
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
        day: "numeric",
        month: "long",
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

  // Formatação de taxa de inscrição
  const formatFee = (fee?: number) => {
    if (fee === undefined || fee === null || Number(fee) === 0) return "Gratuito";
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(Number(fee));
  };

  // Clique no botão de Inscrição
  const handleEnrollClick = () => {
    if (registrationStatus) return;

    if (!tournament || tournament.status === "CLOSED" || tournament.status === "IN_PROGRESS" || tournament.status === "CANCELLED") {
      alert("As inscrições para este torneio estão encerradas.");
      return;
    }

    if (!user) {
      setLoginNotice("Faça login para se inscrever");
      setTimeout(() => {
        router.push(`/login?redirect=/torneio/${id}&message=Faça login para se inscrever`);
      }, 1200);
      return;
    }

    // Se estiver logado, abre o formulário público dinâmico
    // Se estiver logado, abre o formulário público dinâmico em modo criação
    setIsEditingRegistration(false);
    setShowRegistrationModal(true);
  };

  const isTournamentNotOpen = Boolean(tournament?.status && tournament.status !== "OPEN");

  // Ação de Edição da Inscrição pelo Atleta
  const handleEditRegistration = () => {
    if (!registeredTeamId) return;

    if (tournament && tournament.status !== "OPEN") {
      alert("Não é possível editar a inscrição: o chaveamento do torneio já foi gerado.");
      return;
    }

    setIsEditingRegistration(true);
    setShowRegistrationModal(true);
  };

  const renderEditRegistrationButton = () => {
    if (tournament?.status !== "OPEN") return null;
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={handleEditRegistration}
          className="w-full py-2.5 px-4 rounded-xl border border-blue-500/30 hover:border-blue-500/60 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 hover:text-white text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-95"
          title="Editar dados da inscrição"
        >
          <Pencil className="h-3.5 w-3.5 text-blue-400" />
          <span>Editar Inscrição</span>
        </button>
      </div>
    );
  };

  // Ação de Cancelamento pelo Atleta
  const handleCancelRegistration = async () => {
    if (!registeredTeamId) return;

    if (tournament && tournament.status !== "OPEN") {
      alert("Não é possível cancelar a inscrição: o chaveamento do torneio já foi gerado.");
      return;
    }

    if (registrationStatus === "APPROVED" || registrationStatus === "PAID") {
      setShowPaidCancelModal(true);
      return;
    }

    if (!window.confirm("Deseja realmente cancelar sua inscrição nesta competição?")) {
      return;
    }

    await executeCancelRegistration("REQUESTED_BY_ATHLETE");
  };

  const executeCancelRegistration = async (status: "REQUESTED_BY_ATHLETE" | "REFUND_REQUESTED") => {
    if (!registeredTeamId) return;
    try {
      const { data: authData } = await supabase.auth.getSession();
      const res = await cancelRegistration(registeredTeamId, status, authData?.session?.access_token);

      if (!res.success) {
        console.error("Erro ao solicitar cancelamento via Server Action:", res.error);
        alert(res.error || "Erro ao solicitar cancelamento.");
        return;
      }

      setCancellationStatus(status);
      setShowPaidCancelModal(false);
    } catch (err: any) {
      console.error("Exceção ao solicitar cancelamento:", err);
      alert(err?.message || "Erro ao solicitar cancelamento.");
    }
  };

  // Visualizar Chaveamento
  const handleViewBracket = () => {
    if (tournament) {
      setCurrentTournamentId(tournament.id);
      router.push(`/torneio/${tournament.id}/chaveamento`);
    }
  };

  // Gerar Cartaz da Vitrine (Download Direto ou Web Share API Mobile)
  const handleGeneratePoster = async () => {
    if (!showcaseRef.current || isGenerating || !tournament) return;

    try {
      setIsGenerating(true);

      // Aguarda um ciclo de renderização para aplicar o formato 1080px e ocultar elementos indesejados
      await new Promise((resolve) => setTimeout(resolve, 200));

      const node = showcaseRef.current;
      const posterWidth = 1080;
      const posterHeight = Math.max(1080, node.scrollHeight);

      const dataUrl = await toPng(node, {
        cacheBust: true,
        backgroundColor: "#09090b",
        pixelRatio: 2,
        width: posterWidth,
        height: posterHeight,
        style: {
          width: `${posterWidth}px`,
          minWidth: `${posterWidth}px`,
          maxWidth: `${posterWidth}px`,
          minHeight: "1080px",
          height: `${posterHeight}px`,
          margin: "0",
          padding: "0",
          transform: "none",
        },
      });

      const fileName = "cartaz-sportconnect.png";

      // 1. Mobile / Web Share API (WhatsApp, Instagram Stories, etc.)
      if (typeof navigator !== "undefined" && navigator.share && navigator.canShare) {
        try {
          const response = await fetch(dataUrl);
          const blob = await response.blob();
          const file = new File([blob], fileName, { type: "image/png" });

          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: tournament.name,
              text: `Confira o torneio ${tournament.name} na SportConnect!`,
            });
            return;
          }
        } catch (shareError: unknown) {
          if (shareError instanceof Error && shareError.name === "AbortError") {
            return;
          }
          console.warn("Web Share API indisponível ou falhou, usando download direto:", shareError);
        }
      }

      // 2. Desktop / Fallback: Download Direto via link virtual
      const link = document.createElement("a");
      link.download = fileName;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Erro ao gerar cartaz do torneio:", err);
      alert("Não foi possível gerar o cartaz neste momento. Tente novamente.");
    } finally {
      setIsGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-white flex flex-col items-center justify-center p-6">
        <Loader2 className="h-10 w-10 text-blue-500 animate-spin mb-4" />
        <p className="text-sm font-bold text-zinc-400">Carregando detalhes do torneio...</p>
      </div>
    );
  }

  if (errorMessage || !tournament) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mb-4">
          <AlertCircle className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-black font-display uppercase tracking-tight mb-2">
          Torneio Não Encontrado
        </h1>
        <p className="text-sm text-zinc-400 max-w-md mb-6">
          {errorMessage || "Não foi possível localizar os dados desta competição."}
        </p>
        <Link
          href="/explorar"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-600/30"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Voltar ao Explorador</span>
        </Link>
      </div>
    );
  }

  const sportType: SportType = tournament.sport_type || "DOMINO";
  const coverImage = tournament.cover_url || DEFAULT_COVERS[sportType] || DEFAULT_COVERS.DOMINO;
  const sportMeta = SPORT_SELECT_OPTIONS.find((s) => s.id === sportType);

  // Status Badge
  const maxSpots = tournament.max_teams || 16;
  const vagasRestantes = Math.max(maxSpots - tournamentTeams.length, 0);
  const isTournamentOpen = tournament.status === "OPEN";

  // Vitrine de Premiação (1º, 2º e 3º Lugar)
  const hasPrizes = Boolean(
    tournament.prize_first?.trim() ||
    tournament.prize_second?.trim() ||
    tournament.prize_third?.trim()
  );
  const filledPrizesCount = [
    tournament.prize_first?.trim(),
    tournament.prize_second?.trim(),
    tournament.prize_third?.trim(),
  ].filter(Boolean).length;
  const prizeGridColsClass = isGenerating
    ? filledPrizesCount === 1
      ? "grid-cols-1"
      : filledPrizesCount === 2
        ? "grid-cols-2"
        : "grid-cols-3"
    : filledPrizesCount === 1
      ? "grid-cols-1"
      : filledPrizesCount === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : "grid-cols-1 sm:grid-cols-3";

  // Restrições de Inscrição (Faixa Etária e Tamanho do Elenco)
  const getAgeRestrictionText = () => {
    const min = tournament.min_age;
    const max = tournament.max_age;
    if (min !== null && min !== undefined && max !== null && max !== undefined) {
      return `Faixa Etária: ${min} a ${max} anos`;
    }
    if (min !== null && min !== undefined) {
      return `A partir de ${min} anos`;
    }
    if (max !== null && max !== undefined) {
      return `Até ${max} anos`;
    }
    return null;
  };
  const ageRestrictionText = getAgeRestrictionText();

  const getSquadRestrictionText = () => {
    const min = tournament.min_players;
    const max = tournament.max_players;
    if (min !== null && min !== undefined && max !== null && max !== undefined) {
      if (min === max) {
        return `Elenco: Exatamente ${min} jogadores por equipe`;
      }
      return `Elenco: de ${min} a ${max} jogadores por equipe`;
    }
    if (min !== null && min !== undefined) {
      return `Elenco: Mínimo de ${min} jogadores por equipe`;
    }
    if (max !== null && max !== undefined) {
      return `Elenco: Até ${max} jogadores por equipe`;
    }
    return null;
  };
  const squadRestrictionText = getSquadRestrictionText();
  const SKILL_LEVEL_LABELS: Record<string, string> = {
    ALL: "Nível: Aberto / Livre",
    BEGINNER: "Iniciante / Amador",
    INTERMEDIATE: "Intermediário",
    ADVANCED: "Avançado / Pro",
  };
  const currentSkillLevel = (tournament.skill_level || "ALL").toUpperCase();
  const skillLevelText =
    currentSkillLevel === "ALL"
      ? SKILL_LEVEL_LABELS.ALL
      : `Nível: ${SKILL_LEVEL_LABELS[currentSkillLevel] || tournament.skill_level}`;
  const hasRestrictions = Boolean(skillLevelText || ageRestrictionText || squadRestrictionText);

  const getStatusBadge = () => {
    const rawStatus = String(tournament.status || "").toUpperCase();

    if (rawStatus === "CANCELLED" || rawStatus === "CANCELADO") {
      return {
        text: "TORNEIO CANCELADO",
        classes: "bg-red-500/20 text-red-400 border-red-500/40 shadow-lg shadow-red-500/25",
        dotClass: "bg-red-400",
      };
    }

    if (rawStatus === "FINISHED" || rawStatus === "FINALIZADO" || rawStatus === "COMPLETED") {
      return {
        text: "TORNEIO FINALIZADO",
        classes: "bg-gray-600 text-white border-zinc-700",
        dotClass: "bg-zinc-300",
      };
    }

    // 1. PRECEDÊNCIA: CAMPEONATO EM ANDAMENTO (Aceita IN_PROGRESS ou CLOSED)
    if (
      ["IN_PROGRESS", "CLOSED", "EM_ANDAMENTO", "LIVE"].includes(rawStatus)
    ) {
      return {
        text: "CAMPEONATO EM ANDAMENTO",
        classes: "bg-blue-600 text-white border-blue-400/50 shadow-lg shadow-blue-600/30 animate-pulse",
        dotClass: "bg-white",
      };
    }

    // 2. INSCRIÇÕES ABERTAS (Status OPEN ou não definido)
    return {
      text: "INSCRIÇÕES ABERTAS",
      classes: "bg-green-600 text-white border-green-500/40 shadow-lg shadow-green-600/25",
      dotClass: "bg-white animate-pulse",
    };
  };

  const statusBadge = getStatusBadge();
  const isOpenForEnrollment = tournament.status === "OPEN" && vagasRestantes > 0;

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-[#e4e4e7] selection:bg-[#00a2ff]/30 selection:text-white flex flex-col justify-between">
      <div>
        {/* Header Global Público Padronizado */}
        <PublicHeader activePage="torneio" />

        {/* Sub-barra de Navegação e Status */}
        {!isGenerating && (
          <div className="w-full border-b border-[#27272a] bg-[#141416]/50">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-2 min-h-14 flex flex-wrap items-center justify-between gap-3">
              <Link
                href="/explorar"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1e1e1e] hover:bg-zinc-800 border border-[#27272a] text-xs font-bold text-[#e4e4e7] hover:text-white transition-all cursor-pointer shadow-sm active:scale-95"
              >
                <ArrowLeft className="h-4 w-4 text-[#00a2ff]" />
                <span>Voltar às Arenas</span>
              </Link>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleGeneratePoster}
                  disabled={isGenerating}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border border-emerald-400/30 text-white text-xs font-black tracking-wide transition-all cursor-pointer shadow-md shadow-emerald-600/20 active:scale-95 disabled:opacity-50"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Gerando Cartaz...</span>
                    </>
                  ) : (
                    <>
                      <Share2 className="h-3.5 w-3.5" />
                      <span>📸 Compartilhar banner</span>
                    </>
                  )}
                </button>

                <Link
                  href={`/torneio/${tournament.id}/chaveamento`}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#00a2ff]/10 hover:bg-[#00a2ff]/20 border border-[#00a2ff]/30 text-[#00a2ff] text-xs font-bold transition-all"
                >
                  <Network className="h-3.5 w-3.5" />
                  <span>Chaveamento Oficial</span>
                </Link>

                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider border shadow-md ${statusBadge.classes}`}
                >
                  <span className={`w-2 h-2 rounded-full ${statusBadge.dotClass || "bg-white"} animate-pulse`} />
                  <span>{statusBadge.text}</span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Container Principal do Cartaz (Banner + Visão Geral + Premiação) */}
        <div
          ref={showcaseRef}
          style={
            isGenerating
              ? {
                width: "1080px",
                minWidth: "1080px",
                maxWidth: "1080px",
                minHeight: "1080px",
                margin: 0,
              }
              : undefined
          }
          className={
            isGenerating
              ? "bg-[#09090b] w-[1080px] min-w-[1080px] max-w-[1080px] min-h-[1080px] m-0 border border-zinc-800 shadow-2xl flex flex-col justify-between"
              : "bg-[#0f0f0f]"
          }
        >
          {/* 1. Hero Section (Foto de Capa Grande + Nome Sobreposto) */}
          <section
            className={`relative w-full ${isGenerating ? "h-[340px] shrink-0" : "h-72 sm:h-96 overflow-hidden"
              } bg-zinc-950`}
          >
            <img
              src={coverImage}
              alt={tournament.name}
              className="w-full h-full object-cover"
            />
            {/* Gradiente Escuro Sobreposto com foco nas cores SportConnect e alto contraste */}
            <div
              className={`absolute inset-0 ${isGenerating
                ? "bg-gradient-to-t from-[#09090b] via-[#09090b]/85 to-black/50"
                : "bg-gradient-to-t from-[#0f0f0f] via-[#0f0f0f]/70 to-black/40"
                }`}
            />

            {/* Conteúdo do Hero Sobreposto */}
            <div
              className={`absolute inset-0 ${isGenerating ? "w-full px-10 pb-7" : "max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-8"
                } flex flex-col justify-end`}
            >
              <div className={`${isGenerating ? "space-y-3 w-full" : "space-y-3 max-w-3xl"} animate-fadeIn`}>
                {/* Grupo de Tags Superiores (Modalidade, Formato, Gênero, Status) */}
                <div className={`flex flex-wrap items-center ${isGenerating ? "gap-3" : "gap-2"}`}>
                  <span
                    className={`inline-flex items-center gap-2 rounded-xl bg-black/85 backdrop-blur-md border border-blue-400/30 font-black uppercase tracking-wider text-blue-400 shadow-lg ${isGenerating ? "px-4 py-2 text-base" : "px-3 py-1 text-xs"
                      }`}
                  >
                    <span>{sportMeta?.icon || "🏆"}</span>
                    <span>{sportMeta?.label || sportType}</span>
                  </span>
                  {tournament.gender_category && (
                    <span
                      className={`inline-flex items-center gap-2 rounded-xl bg-purple-950/80 backdrop-blur-md border border-purple-400/40 font-extrabold text-purple-200 shadow-lg ${isGenerating ? "px-4 py-2 text-base" : "px-3 py-1 text-xs font-bold text-purple-300"
                        }`}
                    >
                      <span>
                        {tournament.gender_category.charAt(0).toUpperCase() +
                          tournament.gender_category.slice(1).toLowerCase()}
                      </span>
                    </span>
                  )}
                  {(tournament.format || tournament.tournament_format) && (
                    <span
                      className={`inline-flex items-center gap-2 rounded-xl bg-zinc-900/90 backdrop-blur-md border border-white/20 font-extrabold text-zinc-100 shadow-lg ${isGenerating ? "px-4 py-2 text-base" : "px-3 py-1 text-xs font-bold text-zinc-300"
                        }`}
                    >
                      <Layers className={isGenerating ? "h-5 w-5 text-blue-400" : "h-3.5 w-3.5 text-blue-400"} />
                      <span>{translateTournamentFormat(tournament.tournament_format || tournament.format)}</span>
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center gap-2 rounded-xl backdrop-blur-md border font-black uppercase tracking-wider shadow-lg ${isGenerating ? "px-4 py-2 text-base" : "px-3 py-1 text-xs"
                      } ${statusBadge.classes}`}
                  >
                    <span
                      className={`${isGenerating ? "w-3 h-3" : "w-2 h-2"
                        } rounded-full ${statusBadge.dotClass || "bg-white"} animate-pulse`}
                    />
                    <span>{statusBadge.text}</span>
                  </span>
                </div>

                <h1
                  className={`${isGenerating
                    ? "text-5xl font-black text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.95)]"
                    : "text-3xl sm:text-5xl font-black text-white"
                    } font-display tracking-tight leading-tight`}
                >
                  {tournament.name}
                </h1>

                <div
                  className={`flex flex-wrap items-center ${isGenerating
                    ? "gap-6 text-xl font-bold text-zinc-100 pt-2"
                    : "gap-4 sm:gap-6 text-xs sm:text-sm text-zinc-300 pt-1"
                    }`}
                >
                  {tournament.location && (
                    <span className="flex items-center gap-2">
                      <MapPin className={isGenerating ? "h-6 w-6 text-[#00a2ff] shrink-0" : "h-4 w-4 text-[#00a2ff]"} />
                      <span>{tournament.location}</span>
                    </span>
                  )}
                  <span className="flex items-center gap-2">
                    <Calendar className={isGenerating ? "h-6 w-6 text-[#00a2ff] shrink-0" : "h-4 w-4 text-[#00a2ff]"} />
                    <span>{formatDate(tournament.start_date, tournament.start_time)}</span>
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* 2. Informações Detalhadas (Corpo Principal em Grid 2 Colunas) */}
          <main
            className={
              isGenerating
                ? "w-full flex-1 flex flex-col justify-between m-0 px-10 py-7"
                : "max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10"
            }
          >
            <div className={isGenerating ? "w-full block" : "grid grid-cols-1 lg:grid-cols-3 gap-8"}>
              {/* Coluna Esquerda: Visão Geral, Localização com Iframe e Regras (2 Cols, ou largura total durante captura do cartaz) */}
              <div className={`${isGenerating ? "w-full space-y-6" : "lg:col-span-2 space-y-8"}`}>
                {/* Visão Geral (Cards de Estatísticas Rápidas) */}
                <div
                  className={
                    isGenerating
                      ? "bg-[#121215] border-2 border-zinc-700 rounded-3xl p-6 shadow-2xl space-y-4"
                      : "bg-[#18181b] border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4"
                  }
                >
                  <h2
                    className={`${isGenerating ? "text-lg gap-2.5 text-white" : "text-sm gap-2 text-zinc-300"
                      } font-black uppercase tracking-wider flex items-center`}
                  >
                    <Trophy className={isGenerating ? "h-5 w-5 text-blue-400" : "h-4 w-4 text-blue-500"} />
                    <span>Visão Geral da Competição</span>
                  </h2>

                  <div
                    className={`grid ${isGenerating ? "grid-cols-4 gap-4 pt-1" : "grid-cols-2 sm:grid-cols-4 gap-4 pt-2"
                      }`}
                  >
                    <div
                      className={
                        isGenerating
                          ? "bg-[#09090b] border-2 border-zinc-700/90 rounded-2xl p-4"
                          : "bg-[#121214] border border-zinc-800/80 rounded-xl p-3.5"
                      }
                    >
                      <span
                        className={
                          isGenerating
                            ? "text-xs text-zinc-300 font-extrabold uppercase tracking-wider block mb-1.5"
                            : "text-[11px] text-zinc-500 font-bold uppercase block mb-1"
                        }
                      >
                        Modalidade
                      </span>
                      <span
                        className={`${isGenerating ? "text-xl gap-2" : "text-sm gap-1.5"
                          } font-black text-white flex items-center`}
                      >
                        <span>{sportMeta?.icon}</span>
                        <span>{sportMeta?.label || sportType}</span>
                      </span>
                    </div>

                    <div
                      className={
                        isGenerating
                          ? "bg-[#09090b] border-2 border-zinc-700/90 rounded-2xl p-4"
                          : "bg-[#121214] border border-zinc-800/80 rounded-xl p-3.5"
                      }
                    >
                      <span
                        className={
                          isGenerating
                            ? "text-xs text-zinc-300 font-extrabold uppercase tracking-wider block mb-1.5"
                            : "text-[11px] text-zinc-500 font-bold uppercase block mb-1"
                        }
                      >
                        Formato
                      </span>
                      <span className={`${isGenerating ? "text-xl" : "text-sm"} font-black text-white block`}>
                        {translateTournamentFormat(tournament.tournament_format || tournament.format)}
                      </span>
                    </div>

                    <div
                      className={
                        isGenerating
                          ? "bg-[#09090b] border-2 border-emerald-500/40 rounded-2xl p-4"
                          : "bg-[#121214] border border-zinc-800/80 rounded-xl p-3.5"
                      }
                    >
                      <span
                        className={
                          isGenerating
                            ? "text-xs text-zinc-300 font-extrabold uppercase tracking-wider block mb-1.5"
                            : "text-[11px] text-zinc-500 font-bold uppercase block mb-1"
                        }
                      >
                        Inscrição
                      </span>
                      <span className={`${isGenerating ? "text-xl" : "text-sm"} font-black text-emerald-400 block`}>
                        {formatFee(tournament.entry_fee)}
                      </span>
                    </div>

                    <div
                      className={
                        isGenerating
                          ? "bg-[#09090b] border-2 border-zinc-700/90 rounded-2xl p-4"
                          : "bg-[#121214] border border-zinc-800/80 rounded-xl p-3.5"
                      }
                    >
                      <span
                        className={
                          isGenerating
                            ? "text-xs text-zinc-300 font-extrabold uppercase tracking-wider block mb-1.5"
                            : "text-[11px] text-zinc-500 font-bold uppercase block mb-1"
                        }
                      >
                        Capacidade
                      </span>
                      <span
                        className={`${isGenerating ? "text-xl gap-2" : "text-sm gap-1.5"
                          } font-black text-white flex items-center`}
                      >
                        <Users className={isGenerating ? "h-5 w-5 text-blue-400" : "h-4 w-4 text-blue-400"} />
                        <span>{tournament.max_teams || 16} vagas</span>
                      </span>
                    </div>
                  </div>

                  {/* Avisos de Restrições da Competição (Idade e Elenco) */}
                  {hasRestrictions && (
                    <div
                      className={`${isGenerating ? "pt-3.5 space-y-2.5" : "pt-3 space-y-2"
                        } border-t border-zinc-800/80 animate-fadeIn`}
                    >
                      <span
                        className={`${isGenerating ? "text-xs text-zinc-200 gap-2" : "text-[11px] text-zinc-400 gap-1.5"
                          } font-black uppercase tracking-wider flex items-center`}
                      >
                        <Shield className={isGenerating ? "h-4 w-4 text-purple-400" : "h-3.5 w-3.5 text-purple-400"} />
                        <span>Restrições e Elegibilidade</span>
                      </span>

                      <div className={`flex flex-wrap items-center ${isGenerating ? "gap-3" : "gap-2.5"}`}>
                        {skillLevelText && (
                          <div
                            className={`inline-flex items-center gap-2 rounded-xl bg-blue-500/15 border border-blue-400/40 text-blue-200 font-extrabold ${isGenerating ? "px-3.5 py-2 text-sm" : "px-3 py-1.5 text-xs font-bold text-blue-300"
                              }`}
                          >
                            <span
                              role="img"
                              aria-label="Nível do Torneio"
                              className={`${isGenerating ? "text-base" : "text-sm"} leading-none shrink-0`}
                            >
                              🎯
                            </span>
                            <span>{skillLevelText}</span>
                          </div>
                        )}
                        {ageRestrictionText && (
                          <div
                            className={`inline-flex items-center gap-2 rounded-xl bg-purple-500/15 border border-purple-400/40 text-purple-200 font-extrabold ${isGenerating ? "px-3.5 py-2 text-sm" : "px-3 py-1.5 text-xs font-bold text-purple-300"
                              }`}
                          >
                            <Calendar
                              className={`${isGenerating ? "h-4 w-4" : "h-3.5 w-3.5"
                                } text-purple-400 shrink-0`}
                            />
                            <span>{ageRestrictionText}</span>
                          </div>
                        )}

                        {squadRestrictionText && (
                          <div
                            className={`inline-flex items-center gap-2 rounded-xl bg-cyan-500/15 border border-cyan-400/40 text-cyan-200 font-extrabold ${isGenerating ? "px-3.5 py-2 text-sm" : "px-3 py-1.5 text-xs font-bold text-cyan-300"
                              }`}
                          >
                            <Users
                              className={`${isGenerating ? "h-4 w-4" : "h-3.5 w-3.5"
                                } text-cyan-400 shrink-0`}
                            />
                            <span>{squadRestrictionText}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Vitrine de Premiação (Pódio Oficial: 1º, 2º e 3º Lugar) */}
                {hasPrizes && (
                  <div
                    className={
                      isGenerating
                        ? "bg-[#121215] border-2 border-amber-500/60 rounded-3xl p-6 shadow-2xl space-y-4 relative"
                        : "bg-[#18181b] border border-amber-500/30 rounded-2xl p-6 shadow-xl space-y-4 relative overflow-hidden"
                    }
                  >
                    {/* Efeito Glow / Gradiente sutil */}
                    {!isGenerating && (
                      <div className="absolute -top-16 -right-16 w-56 h-56 bg-gradient-to-br from-amber-500/10 to-yellow-600/5 rounded-full blur-3xl pointer-events-none" />
                    )}

                    <div className="flex items-center justify-between relative z-10">
                      <h2
                        className={`${isGenerating ? "text-lg gap-2.5" : "text-sm gap-2"
                          } font-black uppercase tracking-wider text-amber-400 flex items-center`}
                      >
                        <Award className={isGenerating ? "h-6 w-6 text-amber-400" : "h-5 w-5 text-amber-400"} />
                        <span>Premiação da Competição</span>
                      </h2>
                      <span
                        className={`${isGenerating ? "text-xs px-3.5 py-1" : "text-[10px] px-2.5 py-1"
                          } font-black uppercase tracking-wider rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-200`}
                      >
                        🏆 Pódio Oficial
                      </span>
                    </div>

                    <div
                      className={`grid ${prizeGridColsClass} ${isGenerating ? "gap-4 pt-1" : "gap-3.5 pt-1"
                        } relative z-10`}
                    >
                      {/* 🥇 1º Lugar */}
                      {tournament.prize_first && tournament.prize_first.trim().length > 0 && (
                        <div
                          className={`${isGenerating ? "rounded-2xl p-5 border-2" : "rounded-xl p-4 border overflow-hidden"
                            } bg-gradient-to-b from-amber-500/20 via-amber-950/30 to-[#09090b] border-amber-500/50 relative group hover:border-amber-400 transition-all shadow-lg shadow-amber-500/10`}
                        >
                          <div className={`flex items-center ${isGenerating ? "gap-3 mb-2.5" : "gap-2.5 mb-2.5"}`}>
                            <span
                              className={`${isGenerating ? "text-3xl" : "text-2xl"} leading-none select-none`}
                              role="img"
                              aria-label="1º Lugar"
                            >
                              🥇
                            </span>
                            <div>
                              <span
                                className={`${isGenerating ? "text-xs" : "text-[10px]"
                                  } font-black uppercase tracking-wider text-amber-300 block font-display`}
                              >
                                1º Lugar • Campeão
                              </span>
                            </div>
                          </div>
                          <p
                            className={`${isGenerating
                              ? "text-xl font-black text-white leading-tight"
                              : "text-sm font-bold text-zinc-100 leading-snug"
                              } break-words`}
                          >
                            {tournament.prize_first}
                          </p>
                        </div>
                      )}

                      {/* 🥈 2º Lugar */}
                      {tournament.prize_second && tournament.prize_second.trim().length > 0 && (
                        <div
                          className={`${isGenerating ? "rounded-2xl p-5 border-2" : "rounded-xl p-4 border overflow-hidden"
                            } bg-gradient-to-b from-slate-400/20 via-slate-900/30 to-[#09090b] border-slate-400/50 relative group hover:border-slate-300 transition-all shadow-lg shadow-slate-400/10`}
                        >
                          <div className={`flex items-center ${isGenerating ? "gap-3 mb-2.5" : "gap-2.5 mb-2.5"}`}>
                            <span
                              className={`${isGenerating ? "text-3xl" : "text-2xl"} leading-none select-none`}
                              role="img"
                              aria-label="2º Lugar"
                            >
                              🥈
                            </span>
                            <div>
                              <span
                                className={`${isGenerating ? "text-xs" : "text-[10px]"
                                  } font-black uppercase tracking-wider text-slate-200 block font-display`}
                              >
                                2º Lugar • Vice-Campeão
                              </span>
                            </div>
                          </div>
                          <p
                            className={`${isGenerating
                              ? "text-xl font-black text-white leading-tight"
                              : "text-sm font-bold text-zinc-100 leading-snug"
                              } break-words`}
                          >
                            {tournament.prize_second}
                          </p>
                        </div>
                      )}

                      {/* 🥉 3º Lugar */}
                      {tournament.prize_third && tournament.prize_third.trim().length > 0 && (
                        <div
                          className={`${isGenerating ? "rounded-2xl p-5 border-2" : "rounded-xl p-4 border overflow-hidden"
                            } bg-gradient-to-b from-amber-800/20 via-amber-950/30 to-[#09090b] border-amber-700/50 relative group hover:border-amber-600 transition-all shadow-lg shadow-amber-800/10`}
                        >
                          <div className={`flex items-center ${isGenerating ? "gap-3 mb-2.5" : "gap-2.5 mb-2.5"}`}>
                            <span
                              className={`${isGenerating ? "text-3xl" : "text-2xl"} leading-none select-none`}
                              role="img"
                              aria-label="3º Lugar"
                            >
                              🥉
                            </span>
                            <div>
                              <span
                                className={`${isGenerating ? "text-xs" : "text-[10px]"
                                  } font-black uppercase tracking-wider text-amber-500 block font-display`}
                              >
                                3º Lugar • 3ª Posição
                              </span>
                            </div>
                          </div>
                          <p
                            className={`${isGenerating
                              ? "text-xl font-black text-white leading-tight"
                              : "text-sm font-bold text-zinc-100 leading-snug"
                              } break-words`}
                          >
                            {tournament.prize_third}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Localização & Mapa Reativo com Google Maps Iframe (Oculta Iframe durante geração do cartaz) */}
                {!isGenerating && (
                  <div className="bg-[#18181b] border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
                    <h2 className="text-sm font-black uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-blue-500" />
                      <span>Localização do Evento</span>
                    </h2>

                    <p className="text-sm text-zinc-300">
                      {tournament.location || "O endereço exato será divulgado pela comissão organizadora."}
                    </p>

                    {tournament.location ? (
                      <div className="relative rounded-xl overflow-hidden border border-zinc-700 bg-zinc-900 shadow-md">
                        <iframe
                          width="100%"
                          height="240"
                          className="rounded-xl border-0 w-full block"
                          src={`https://maps.google.com/maps?q=${encodeURIComponent(
                            tournament.location
                          )}&t=&z=15&ie=UTF8&iwloc=&output=embed`}
                          frameBorder="0"
                          scrolling="no"
                          title="Localização do Torneio"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="h-[140px] w-full rounded-xl border border-zinc-800 bg-[#121214] flex flex-col items-center justify-center p-4 text-center">
                        <MapPin className="h-6 w-6 text-zinc-600 mb-2" />
                        <p className="text-xs text-zinc-500 font-medium">
                          Mapa indisponível até o endereço ser confirmado
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Regras e Regulamento em Caixa Destacada */}
                {!isGenerating &&
                  Boolean(
                    (
                      tournament.rules ||
                      (tournament as any).rules_description ||
                      (tournament as any).custom_rules ||
                      ""
                    ).trim() ||
                      tournament.regulation_url ||
                      tournament.rulebook_url
                  ) && (
                    <div className="bg-[#18181b] border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
                      <h2 className="text-sm font-black uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4 text-amber-400" />
                        <span>Regras e Regulamento Oficial</span>
                      </h2>

                      {Boolean(
                        (
                          tournament.rules ||
                          (tournament as any).rules_description ||
                          (tournament as any).custom_rules ||
                          ""
                        ).trim()
                      ) && (
                        <div className="space-y-3">
                          <div
                            className={`p-4 rounded-xl bg-[#121214] border border-zinc-800 text-sm text-zinc-300 whitespace-pre-line leading-relaxed transition-all ${
                              !isRulebookExpanded ? "relative max-h-64 overflow-hidden" : ""
                            }`}
                          >
                            {(
                              tournament.rules ||
                              (tournament as any).rules_description ||
                              (tournament as any).custom_rules ||
                              ""
                            ).trim()}
                            {!isRulebookExpanded && (
                              <div className="absolute bottom-0 left-0 w-full h-24 bg-gradient-to-t from-[#121214] to-transparent pointer-events-none" />
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => setIsRulebookExpanded(!isRulebookExpanded)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-bold text-[#00a2ff] hover:text-blue-300 transition-all cursor-pointer"
                          >
                            <span>{isRulebookExpanded ? "Ler menos" : "Ler mais do regulamento"}</span>
                          </button>
                        </div>
                      )}

                      {(tournament.regulation_url || tournament.rulebook_url) && (
                        <div>
                          <a
                            href={tournament.regulation_url || tournament.rulebook_url || "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2.5 px-4 py-3 rounded-xl bg-red-600/15 hover:bg-red-600/25 border border-red-500/35 hover:border-red-500/60 text-red-300 hover:text-white text-xs sm:text-sm font-black uppercase tracking-wider transition-all shadow-md shadow-red-600/10 active:scale-95 cursor-pointer"
                          >
                            <FileText className="h-4 w-4 text-red-400 shrink-0" />
                            <span>📄 Ler Regulamento Oficial</span>
                            <ExternalLink className="h-3.5 w-3.5 text-red-400 shrink-0" />
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                {/* Equipes e Atletas Inscritos */}
                {!isGenerating && (
                  <div className="bg-[#18181b] border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-black uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                        <Users className="h-4 w-4 text-emerald-400" />
                        <span>Equipes e Atletas Inscritos ({tournamentTeams.length})</span>
                      </h2>
                      <span className="text-[11px] text-zinc-500">
                        {tournament.max_teams ? `${tournamentTeams.length}/${tournament.max_teams} vagas` : "Inscrições abertas"}
                      </span>
                    </div>

                    {tournamentTeams.length === 0 ? (
                      <div className="p-6 rounded-xl bg-[#121214] border border-dashed border-zinc-800 text-center space-y-1">
                        <Users className="h-8 w-8 text-zinc-600 mx-auto mb-1" />
                        <p className="text-xs font-bold text-zinc-400">Nenhuma equipe confirmada ainda</p>
                        <p className="text-[11px] text-zinc-600">Seja o primeiro a inscrever sua equipe neste campeonato!</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        {tournamentTeams.map((team, idx) => (
                          <div
                            key={team.id}
                            className="p-3.5 rounded-xl bg-[#121214] border border-zinc-800/80 hover:border-zinc-700 transition-all flex items-start gap-3"
                          >
                            {team.user_id ? (
                              <Link
                                href={`/atleta/${team.user_id}`}
                                title="Ver perfil do atleta"
                                className="w-9 h-9 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 flex items-center justify-center text-sm font-black text-amber-400 shrink-0 shadow-inner group transition-transform hover:scale-105"
                              >
                                <span>#{idx + 1}</span>
                              </Link>
                            ) : (
                              <div className="w-9 h-9 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-sm font-black text-zinc-400 shrink-0 shadow-inner">
                                <span>#{idx + 1}</span>
                              </div>
                            )}
                            <div className="space-y-0.5 min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1">
                                <h4 className="text-xs font-bold text-white truncate">
                                  {team.user_id ? (
                                    <Link
                                      href={`/atleta/${team.user_id}`}
                                      className="hover:text-amber-400 hover:underline transition-colors"
                                      title="Ver perfil do atleta"
                                    >
                                      {team.name}
                                    </Link>
                                  ) : (
                                    team.name
                                  )}
                                </h4>
                              </div>
                              <div className="text-[11px] text-zinc-400 truncate flex items-center gap-1.5">
                                <span>Capitão:</span>
                                {team.user_id ? (
                                  <Link
                                    href={`/atleta/${team.user_id}`}
                                    className="font-semibold text-zinc-300 hover:text-amber-400 hover:underline"
                                  >
                                    {team.players[0]}
                                  </Link>
                                ) : (
                                  <span className="font-semibold text-zinc-300">{team.players[0]}</span>
                                )}
                                {team.players[1] && (
                                  <span className="text-zinc-500">• {team.players[1]}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Coluna Direita: Box de Inscrição e Ações (Oculto durante geração do cartaz) */}
              {!isGenerating && (
                <div className="space-y-6">
                  <div className="bg-[#18181b] border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-5 sticky top-24">
                    <div className="space-y-2">
                      <span className="text-xs uppercase font-bold text-zinc-500">
                        Taxa de Inscrição
                      </span>
                      <div className="text-3xl font-black text-white font-display text-emerald-400">
                        {formatFee(tournament.entry_fee)}
                      </div>
                      <p className="text-xs text-zinc-400">
                        Garante vaga oficial na tabela e acesso a toda a infraestrutura da arena.
                      </p>
                    </div>

                    {/* Alerta de Login se clicou deslogado */}
                    {loginNotice && (
                      <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center gap-2 animate-fadeIn">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>{loginNotice}</span>
                      </div>
                    )}

                    {/* Botão de Inscrição / Call to Action */}
                    <div className="space-y-3 pt-2">
                      {registrationStatus ? (
                        (cancellationStatus === "CANCELLATION_REQUESTED" ||
                          cancellationStatus === "REFUND_REQUESTED" ||
                          cancellationStatus === "REQUESTED_BY_ATHLETE") ? (
                          <div className="space-y-3">
                            <div className="p-3.5 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-300 text-xs font-bold flex items-center gap-2.5 text-left">
                              <Clock className="h-5 w-5 text-amber-400 shrink-0 animate-pulse" />
                              <span>Aguardando confirmação e estorno por parte do organizador.</span>
                            </div>

                            <a
                              href={`https://wa.me/${organizerPhone}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full py-3.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                            >
                              <MessageCircle className="h-4 w-4 shrink-0" />
                              <span>Falar com o Organizador</span>
                            </a>
                          </div>
                        ) : cancellationStatus === "REFUND_REQUESTED" ? (
                          <div className="space-y-2">
                            <button
                              type="button"
                              disabled
                              className="w-full py-4 px-6 rounded-xl bg-amber-500/15 border border-amber-500/35 cursor-not-allowed text-amber-400 font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 text-center"
                            >
                              <AlertTriangle className="h-5 w-5 text-amber-400 animate-pulse" />
                              <span>Reembolso Solicitado</span>
                            </button>
                            <p className="text-[11px] text-amber-300 text-center font-medium">
                              Cancelamento pós-pagamento solicitado • O reembolso deve ser negociado diretamente com a organização.
                            </p>
                          </div>
                        ) : cancellationStatus === "REQUESTED_BY_ATHLETE" ? (
                          <div className="space-y-2">
                            <button
                              type="button"
                              disabled
                              className="w-full py-4 px-6 rounded-xl bg-amber-500/15 border border-amber-500/35 cursor-not-allowed text-amber-400 font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 text-center"
                            >
                              <Clock className="h-5 w-5 text-amber-400 animate-pulse" />
                              <span>Cancelamento Solicitado</span>
                            </button>
                            <p className="text-[11px] text-amber-300 text-center font-medium">
                              O organizador foi notificado para realizar o estorno do Pix.
                            </p>
                          </div>
                        ) : cancellationStatus === "REFUNDED" ? (
                          <button
                            type="button"
                            disabled
                            className="w-full py-4 px-6 rounded-xl bg-red-500/15 border border-red-500/35 cursor-not-allowed text-red-400 font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 text-center"
                          >
                            <Ban className="h-5 w-5 text-red-400" />
                            <span>Inscrição Cancelada / Estornada</span>
                          </button>
                        ) : registrationStatus === "APPROVED" || registrationStatus === "PAID" ? (
                          <div className="space-y-2.5">
                            <button
                              type="button"
                              disabled
                              className={`w-full py-4 px-6 rounded-xl font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 text-center ${tournament.status === "IN_PROGRESS" ||
                                tournament.status === "EM_ANDAMENTO" ||
                                tournament.status === "LIVE"
                                ? "bg-blue-600 border border-blue-400 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)] animate-pulse"
                                : "bg-emerald-500/20 border border-emerald-400 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                                }`}
                            >

                              {tournament.status === "IN_PROGRESS" ||
                                tournament.status === "EM_ANDAMENTO" ||
                                tournament.status === "LIVE" ? (
                                <Trophy className="h-5 w-5 text-amber-300" />
                              ) : (
                                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                              )}
                              <span>
                                {tournament.status === "IN_PROGRESS" ||
                                  tournament.status === "EM_ANDAMENTO" ||
                                  tournament.status === "LIVE"
                                  ? "CAMPEONATO EM ANDAMENTO"
                                  : "INSCRIÇÃO CONFIRMADA! ✅"}
                              </span>
                            </button>

                            {tournament.status === "OPEN" && (
                              <>
                                <button
                                  type="button"
                                  onClick={handleCancelRegistration}
                                  className="w-full py-2.5 px-4 rounded-xl border border-red-500/30 hover:border-red-500/60 bg-red-500/5 hover:bg-red-500/15 text-red-400 hover:text-red-300 text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-95"
                                >
                                  <Ban className="h-3.5 w-3.5 text-red-400" />
                                  <span>Cancelar Minha Inscrição</span>
                                </button>
                                {renderEditRegistrationButton()}
                              </>
                            )}
                            <a
                              href={`https://wa.me/${organizerPhone}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full py-2.5 px-4 rounded-xl border border-emerald-500/30 hover:border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 hover:text-emerald-200 text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-95"
                              title="Tirar dúvidas sobre o campeonato via WhatsApp"
                            >
                              <MessageCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                              <span>Falar com o Organizador</span>
                            </a>
                          </div>
                        ) : registrationStatus === "WAITING_APPROVAL" ? (
                          <div className="space-y-2.5">
                            <div className="w-full py-4 px-6 rounded-xl bg-blue-500/15 border border-blue-500/35 text-blue-300 font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 text-center shadow-[0_0_15px_rgba(59,130,246,0.2)]">
                              <Clock className="h-5 w-5 text-blue-400 animate-pulse" />
                              <span>Comprovante em Análise ⏳</span>
                            </div>
                            <p className="text-[11px] text-zinc-400 text-center font-medium">
                              Seu comprovante foi enviado com sucesso e está em análise pelo organizador.
                            </p>
                            {tournament.status === "OPEN" && (
                              <>
                                <button
                                  type="button"
                                  onClick={handleCancelRegistration}
                                  className="w-full py-2.5 px-4 rounded-xl border border-red-500/30 hover:border-red-500/60 bg-red-500/5 hover:bg-red-500/15 text-red-400 hover:text-red-300 text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-95"
                                >
                                  <Ban className="h-3.5 w-3.5 text-red-400" />
                                  <span>Cancelar Minha Inscrição</span>
                                </button>
                                {renderEditRegistrationButton()}
                              </>
                            )}
                            <a
                              href={`https://wa.me/${organizerPhone}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full py-2.5 px-4 rounded-xl border border-emerald-500/30 hover:border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 hover:text-emerald-200 text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-95"
                              title="Tirar dúvidas sobre o campeonato via WhatsApp"
                            >
                              <MessageCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                              <span>Falar com o Organizador</span>
                            </a>
                          </div>
                        ) : registrationStatus === "WAITING_PIX" || registrationStatus === "PENDING" ? (
                          <div className="space-y-2.5">
                            {/* Botão Finalizar Pagamento / Anexar Comprovante */}
                            <button
                              type="button"
                              onClick={() => setShowResumeCheckout(true)}
                              className="w-full py-4 px-6 rounded-xl bg-gradient-to-r from-orange-500 via-amber-400 to-yellow-500 hover:from-orange-400 hover:to-amber-300 text-neutral-950 font-black text-sm uppercase tracking-wider transition-all shadow-lg shadow-orange-500/25 active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2 animate-pulse"
                              title="Finalizar pagamento Pix ou anexar comprovante"
                            >
                              <CreditCard className="h-5 w-5" />
                              <span>FINALIZAR PAGAMENTO / ANEXAR COMPROVANTE</span>
                            </button>

                            {tournament.status === "OPEN" && (
                              <>
                                <button
                                  type="button"
                                  onClick={handleCancelRegistration}
                                  className="w-full py-2.5 px-4 rounded-xl border border-red-500/30 hover:border-red-500/60 bg-red-500/5 hover:bg-red-500/15 text-red-400 hover:text-red-300 text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-95"
                                >
                                  <Ban className="h-3.5 w-3.5 text-red-400" />
                                  <span>Cancelar Minha Inscrição</span>
                                </button>
                                {renderEditRegistrationButton()}
                              </>
                            )}
                            <a
                              href={`https://wa.me/${organizerPhone}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full py-2.5 px-4 rounded-xl border border-emerald-500/30 hover:border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 hover:text-emerald-200 text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-95"
                              title="Tirar dúvidas sobre o campeonato via WhatsApp"
                            >
                              <MessageCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                              <span>Falar com o Organizador</span>
                            </a>
                          </div>
                        ) : null
                      ) : (tournament.status === "CANCELLED" || tournament.status === "CANCELADO") ? (
                        <div className="w-full p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-center shadow-sm animate-fadeIn space-y-1">
                          <div className="flex items-center justify-center gap-2 text-red-400 font-black text-sm uppercase tracking-wider">
                            <Ban className="h-4 w-4 text-red-400 shrink-0" />
                            <span>Torneio Cancelado</span>
                          </div>
                          <p className="text-[11px] text-zinc-400 font-medium">
                            Este evento foi cancelado pela organização.
                          </p>
                        </div>
                      ) : (tournament.status === "IN_PROGRESS" ||
                        tournament.status === "EM_ANDAMENTO" ||
                        tournament.status === "LIVE") ? (
                        <div className="w-full py-4 px-6 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-300 font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 text-center shadow-lg shadow-blue-600/20 animate-pulse">
                          <Trophy className="h-4 w-4 text-amber-300" />
                          <span>CAMPEONATO EM ANDAMENTO</span>
                        </div>
                      ) : tournament.status === "CLOSED" ? (
                        <div className="w-full py-4 px-6 rounded-xl bg-zinc-800/90 border border-zinc-700 text-zinc-400 font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 text-center shadow-sm">
                          <Lock className="h-4 w-4 text-zinc-400" />
                          <span>🔒 Inscrições Encerradas</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handleEnrollClick}
                          className="w-full py-4 px-6 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-sm uppercase tracking-wider transition-all shadow-lg shadow-blue-600/30 active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Sparkles className="h-4 w-4" />
                          <span>Inscrever Minha Equipe</span>
                        </button>
                      )}

                      {/* Ação secundária: Ver Chaveamento */}
                      <button
                        type="button"
                        onClick={handleViewBracket}
                        className="w-full py-3 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/60 text-xs font-bold text-zinc-300 hover:text-white transition-all cursor-pointer flex items-center justify-center gap-2 shadow-sm"
                      >
                        <Trophy className="h-3.5 w-3.5 text-[#00a2ff]" />
                        <span>Ver Chaveamento Oficial</span>
                      </button>

                      {/* Ação de compartilhamento: Gerar Cartaz */}
                      <button
                        type="button"
                        onClick={handleGeneratePoster}
                        disabled={isGenerating}
                        className="w-full py-3 px-4 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-xs font-bold text-emerald-300 hover:text-emerald-200 transition-all cursor-pointer flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                      >
                        <Share2 className="h-3.5 w-3.5 text-emerald-400" />
                        <span>📸 Compartilhar banner</span>
                      </button>
                    </div>

                    <div className="pt-4 border-t border-zinc-800 text-[11px] text-zinc-500 text-center space-y-1">
                      <p>Inscrições sujeitas à aprovação pela comissão organizadora.</p>
                      <p>Dúvidas? Entre em contato com o suporte SportConnect.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ========================================================= */}
            {/* SECÇÃO DE APOIO E PATROCÍNIO */}
            {/* ========================================================= */}
            {tournament.sponsors && tournament.sponsors.length > 0 && (
              <section className={`${isGenerating ? "mt-6 pt-5" : "mt-12 pt-8"} border-t border-[#27272a] animate-fadeIn`}>
                <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${isGenerating ? "mb-4" : "mb-6"}`}>
                  <div>
                    <div
                      className={`inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-black uppercase tracking-wider mb-1 ${isGenerating ? "px-3 py-1 text-xs" : "px-3 py-1 text-[11px] text-amber-400"
                        }`}
                    >
                      <Building2 className={isGenerating ? "h-3.5 w-3.5" : "h-3 w-3"} />
                      <span>Marcas Parceiras</span>
                    </div>
                    <h2
                      className={`${isGenerating ? "text-2xl" : "text-xl sm:text-2xl"
                        } font-black text-white font-display tracking-tight`}
                    >
                      Apoio e Patrocínio
                    </h2>
                  </div>
                  <p className={`${isGenerating ? "text-xs text-zinc-300 font-semibold" : "text-xs text-zinc-500"}`}>
                    Apoiadores oficiais que tornam esta competição possível.
                  </p>
                </div>

                <div
                  className={`grid ${isGenerating
                    ? "grid-cols-4 gap-4"
                    : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4"
                    }`}
                >
                  {tournament.sponsors.map((sponsor) => {
                    const CardContent = (
                      <div
                        className={`h-full ${isGenerating ? "p-3.5 border-2 border-zinc-700" : "p-4 border border-[#27272a]"
                          } rounded-2xl bg-[#141416] hover:border-amber-500/50 hover:bg-zinc-900/80 transition-all flex flex-col items-center justify-center text-center gap-2 group shadow-sm`}
                      >
                        {sponsor.logo_url ? (
                          <div
                            className={`w-full ${isGenerating ? "h-16" : "h-16 sm:h-20"
                              } flex items-center justify-center p-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 group-hover:scale-105 transition-transform`}
                          >
                            <img
                              src={sponsor.logo_url}
                              alt={sponsor.name}
                              className="max-h-full max-w-full object-contain filter group-hover:brightness-110 transition-all"
                            />
                          </div>
                        ) : (
                          <div
                            className={`${isGenerating ? "w-12 h-12 text-base" : "w-12 h-12 text-base"
                              } rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 font-black group-hover:scale-105 transition-transform`}
                          >
                            {sponsor.name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span
                          className={`${isGenerating ? "text-sm font-extrabold text-white" : "text-xs font-bold text-zinc-200"
                            } group-hover:text-amber-300 transition-colors line-clamp-1`}
                        >
                          {sponsor.name}
                        </span>
                        {sponsor.link && !isGenerating && (
                          <span className="text-[10px] text-zinc-500 group-hover:text-zinc-400 flex items-center gap-1">
                            <span>Acessar</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>
                    );

                    if (sponsor.link) {
                      return (
                        <a
                          key={sponsor.id}
                          href={sponsor.link.startsWith("http") ? sponsor.link : `https://${sponsor.link}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block cursor-pointer transition-transform active:scale-95"
                          title={`Visitar ${sponsor.name}`}
                        >
                          {CardContent}
                        </a>
                      );
                    }

                    return (
                      <div key={sponsor.id}>
                        {CardContent}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Rodapé exclusivo exibido apenas na imagem capturada do cartaz */}
            {isGenerating && (
              <div className="mt-6 pt-5 border-t-2 border-zinc-800 flex items-center justify-center gap-3 text-base">
                <img
                  src="/logo.png"
                  alt="SportConnect Logo"
                  className="h-8 w-auto object-contain"
                />
                <span className="font-black uppercase tracking-wider text-white">
                  SPORTCONNECT • PORTAL OFICIAL DE COMPETIÇÕES
                </span>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Modal de Inscrição Pública Dinâmica */}
      {tournament && (
        <PublicRegistrationForm
          tournament={tournament}
          initialData={isEditingRegistration ? registeredTeamData : null}
          defaultValues={isEditingRegistration ? registeredTeamData : null}
          isOpen={showRegistrationModal}
          onClose={() => {
            setShowRegistrationModal(false);
            setIsEditingRegistration(false);
            setRefreshKey((prev) => prev + 1);
          }}
          onSuccess={() => {
            setRefreshKey((prev) => prev + 1);
            setIsEditingRegistration(false);
            setShowRegistrationModal(false);
          }}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-[#27272a] py-6 text-center text-xs text-zinc-500 bg-[#141416]/50">
        <div>SportConnect • Portal de Competições Esportivas</div>
      </footer>

      {/* Modal: Finalizar Pagamento (Retomar Checkout Pix) */}
      {showResumeCheckout && tournament && registeredTeamId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto animate-fadeIn">
          <PixCheckoutForm
            tournamentId={tournament.id}
            tournamentName={tournament.name}
            teamId={registeredTeamId}
            teamName={registeredTeamData?.name || user?.user_metadata?.full_name || "Minha Equipe"}
            captainName={registeredTeamData?.player1 || registeredTeamData?.manager_name || user?.user_metadata?.full_name || "Capitão"}
            totalAmount={tournament.entry_fee ? Number(tournament.entry_fee) : 0}
            sportType={tournament.sport_type}
            email={user?.email || undefined}
            initialReceiptUrl={registeredTeamData?.payment_proof_url || undefined}
            onClose={() => {
              setShowResumeCheckout(false);
              setRefreshKey((prev) => prev + 1);
            }}
            onSuccess={() => {
              setShowResumeCheckout(false);
              setRegistrationStatus("WAITING_APPROVAL");
              setRefreshKey((prev) => prev + 1);
              router.refresh();
            }}
          />
        </div>
      )}

      {/* Modal de Aviso: Cancelamento Pós-Pagamento */}
      {showPaidCancelModal && tournament && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fadeIn">
          <div className="bg-[#141416] border border-red-500/40 rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl relative space-y-5 animate-scaleUp">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-600 via-amber-500 to-red-500 rounded-t-3xl" />

            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-black font-display text-white">
                    Aviso de Cancelamento
                  </h3>
                  <p className="text-xs text-zinc-400">
                    {tournament.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPaidCancelModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-red-950/30 border border-red-900/40 text-xs text-zinc-200 leading-relaxed space-y-2.5">
              <p className="font-semibold text-red-300">
                O seu pagamento já foi processado e transferido para o organizador.
              </p>
              <p className="text-zinc-300">
                Ao cancelar, a sua vaga será perdida. O reembolso deve ser negociado diretamente com a organização do evento.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowPaidCancelModal(false)}
                className="py-2.5 px-4 rounded-xl border border-zinc-700 hover:border-zinc-500 bg-zinc-800/80 text-xs font-bold text-zinc-300 hover:text-white transition-all cursor-pointer"
              >
                Voltar / Manter Vaga
              </button>
              <button
                type="button"
                disabled={isTournamentNotOpen}
                onClick={() => executeCancelRegistration("REFUND_REQUESTED")}
                className="py-2.5 px-5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-red-600/30 flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  isTournamentNotOpen
                    ? "Cancelamento indisponível após o fechamento das chaves."
                    : undefined
                }
              >
                <Ban className="h-3.5 w-3.5" />
                <span>Confirmar Cancelamento</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
