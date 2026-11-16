"use client";

import React, { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Users,
  CheckCircle2,
  Clock,
  Receipt,
  Filter,
  Plus,
  Search,
  X,
  MapPin,
  Trophy,
  Trash2,
  Eye,
  AlertCircle,
  FileText,
  UserCheck,
  User,
  Shield,
  ArrowLeft,
  Loader2,
  Check,
  ExternalLink,
  RotateCcw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Mail,
  Phone,
  Lock,
  Download,
  LayoutGrid,
  List,
} from "lucide-react";
import { Team, Match, SportType, TeamMember, Tournament, CustomRegistrationField } from "@/types";
import { useTournament } from "@/context/TournamentContext";
import { useAuth } from "@/context/AuthProvider";
import { supabase } from "@/lib/supabase";
import { useTournamentPermissions } from "@/hooks/useTournamentPermissions";
import { confirmCancellation, addManualTeam } from "@/app/actions/registration";
import { notifyRegistrationApproved } from "@/app/actions/notifications";
import { extractModalityFormat, parseMatchRulesObject } from "@/components/CreateTournamentForm";

export interface RegistrationManagementProps {
  tournament?: Tournament | null;
  teams: Team[];
  matches?: Match[];
  onAddTeam: (
    name: string,
    p1: string,
    p2?: string,
    roster?: string[],
    format?: "solo" | "duplas",
    paymentStatus?: string,
    category?: string
  ) => void;
  onImportTeams?: (importedTeams: Team[]) => void;
  onDeleteTeam?: (id: string) => void;
  onGenerateBracket?: () => void;
  isReadOnly?: boolean;
  canManageFinances?: boolean;
  onFinishTournament?: () => void;
  onDeleteTournament?: () => void;
  onBack?: () => void;
  tournamentStatus?: string;
  onCloseRegistrations?: () => void;
  tournamentId?: string;
}

export default function RegistrationManagement({
  tournament: propTournament,
  teams: propTeams,
  matches = [],
  onAddTeam,
  onImportTeams,
  onDeleteTeam,
  onGenerateBracket,
  isReadOnly = false,
  canManageFinances: canManageFinancesProp,
  onFinishTournament,
  onDeleteTournament,
  onBack,
  tournamentStatus,
  onCloseRegistrations,
  tournamentId,
}: RegistrationManagementProps) {
  const { currentSportType, currentTournamentId, currentTournament, setTeams } = useTournament();
  const effectiveTournamentId =
    tournamentId || propTournament?.id || currentTournamentId || propTeams[0]?.tournamentId;
  const { user, isAdmin } = useAuth();
  const permissions = useTournamentPermissions(effectiveTournamentId || undefined);

  // Estado sincronizado do torneio para garantir leitura fiel de modality_format, categorias e campos personalizados
  const [dbTournament, setDbTournament] = useState<Tournament | null>(null);

  const activeTournament = useMemo<Tournament | null>(() => {
    if (!currentTournament && !propTournament && !dbTournament) return null;
    return {
      ...(currentTournament && currentTournament.id === effectiveTournamentId ? currentTournament : {}),
      ...(propTournament || {}),
      ...(dbTournament || {}),
    } as Tournament;
  }, [currentTournament, propTournament, dbTournament, effectiveTournamentId]);

  // Validação de acesso financeiro (Dono, Admin ou prop explícita)
  const hasFinancialAccess =
    canManageFinancesProp !== undefined
      ? canManageFinancesProp
      : permissions.canManageFinances;

  const effectiveStatus = String(
    tournamentStatus || activeTournament?.status || ""
  )
    .toUpperCase()
    .trim();
  const isTournamentCompleted = [
    "COMPLETED",
    "FINALIZADO",
    "FINISHED",
    "CONCLUIDO",
  ].includes(effectiveStatus);

  const isOrganizerOrAdmin = Boolean(
    isAdmin ||
      permissions.isOwner ||
      permissions.isAdmin ||
      canManageFinancesProp ||
      (user?.id && activeTournament?.owner_id && user.id === activeTournament.owner_id)
  );

  // Regra exclusiva de remoção: organizador/admin pode remover em qualquer status EXCETO quando COMPLETED
  const canRemove = isOrganizerOrAdmin && !isTournamentCompleted;

  // Estado local das equipes para atualizações instantâneas de status
  const [localTeams, setLocalTeams] = useState<Team[]>(propTeams);
  const [mounted, setMounted] = useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Sincroniza localTeams sempre que propTeams mudar
  React.useEffect(() => {
    setLocalTeams(propTeams);
  }, [propTeams]);

  // Busca direta no Supabase garantindo seleção explícita da coluna cancellation_status e configurações do torneio
  const fetchTeamsFromDb = React.useCallback(async () => {
    if (!effectiveTournamentId) return;
    try {
      // Sincroniza configurações atualizadas do torneio
      try {
        const { data: tourRow } = await supabase
          .from("tournaments")
          .select("*")
          .eq("id", effectiveTournamentId)
          .maybeSingle();
        if (tourRow) {
          setDbTournament(tourRow as unknown as Tournament);
        }
      } catch (tErr) {
        console.warn("Aviso ao carregar dados do torneio no RegistrationManagement:", tErr);
      }

      const { data: dbTeams, error: teamsError } = await supabase
        .from("teams")
        .select("*, cancellation_status")
        .eq("tournament_id", effectiveTournamentId);

      if (teamsError) {
        console.error("Erro ao buscar equipes no RegistrationManagement:", teamsError);
        return;
      }

      if (dbTeams) {
        const mapped: Team[] = dbTeams.map((dbT: any) => ({
          id: dbT.id,
          name: dbT.name,
          players: [dbT.player1, dbT.player2],
          createdAt: dbT.created_at || new Date().toISOString(),
          source: "manual",
          status: dbT.status,
          tournamentId: dbT.tournament_id,
          payment_status: dbT.payment_status || (dbT.status === "CONFIRMED" || dbT.status === "PAID" ? "PAID" : "PENDING"),
          payout_status: dbT.payout_status || "PENDING",
          payout_amount: dbT.payout_amount ? Number(dbT.payout_amount) : undefined,
          amount_paid: dbT.amount_paid !== undefined && dbT.amount_paid !== null ? Number(dbT.amount_paid) : undefined,
          payment_proof_url: dbT.payment_proof_url,
          manager_name: dbT.manager_name || dbT.player1,
          category: dbT.category || "",
          cancellation_status: dbT.cancellation_status,
          mp_payment_id: dbT.mp_payment_id,
          contact: dbT.contact,
          roster: dbT.roster,
          custom_registration_answers:
            dbT.custom_registration_answers || dbT.custom_responses || dbT.metadata || undefined,
          custom_responses:
            dbT.custom_responses || dbT.custom_registration_answers || dbT.metadata || undefined,
          declared_skill_level: dbT.declared_skill_level,
          user_id: dbT.user_id,
        }));
        setLocalTeams(mapped);

        // Fetch de todos os membros vinculados (team_members) para os times do torneio
        const teamIds = dbTeams.map((t: any) => t.id).filter(Boolean);
        if (teamIds.length > 0) {
          try {
            const { data: membersData } = await supabase
              .from("team_members")
              .select("*")
              .in("team_id", teamIds);

            const map: Record<string, TeamMember[]> = {};
            if (membersData) {
              membersData.forEach((m: any) => {
                if (!map[m.team_id]) map[m.team_id] = [];
                map[m.team_id].push({
                  id: m.id,
                  team_id: m.team_id,
                  user_id: m.user_id,
                  name: m.name || "",
                  email: m.email || "",
                  cpf: m.cpf || undefined,
                  phone: m.phone || undefined,
                  is_captain: Boolean(m.is_captain),
                  created_at: m.created_at,
                });
              });
            }

            // Fallback: se team_members não tiver os dados completos (ex: cpf/phone), mescla com __athlete_members do JSONB
            dbTeams.forEach((dbT: any) => {
              const jsonbObj = dbT.custom_registration_answers || dbT.custom_responses;
              const backupMembers = jsonbObj?.__athlete_members;
              if (Array.isArray(backupMembers) && backupMembers.length > 0) {
                if (!map[dbT.id] || map[dbT.id].length === 0) {
                  map[dbT.id] = backupMembers.map((bm: any, idx: number) => ({
                    id: bm.id || `${dbT.id}-bm-${idx}`,
                    team_id: dbT.id,
                    user_id: bm.user_id || undefined,
                    name: bm.name || "",
                    email: bm.email || "",
                    cpf: bm.cpf || undefined,
                    phone: bm.phone || undefined,
                    is_captain: Boolean(bm.is_captain),
                  }));
                } else {
                  map[dbT.id] = map[dbT.id].map((existing, idx) => {
                    const matchBackup =
                      backupMembers.find(
                        (bm: any) =>
                          (bm.is_captain && existing.is_captain) ||
                          (bm.name &&
                            existing.name &&
                            bm.name.trim().toLowerCase() === existing.name.trim().toLowerCase())
                      ) || backupMembers[idx];
                    return {
                      ...existing,
                      name: existing.name || matchBackup?.name || "",
                      email: existing.email || matchBackup?.email || "",
                      cpf: existing.cpf || matchBackup?.cpf || undefined,
                      phone: existing.phone || matchBackup?.phone || undefined,
                    };
                  });
                }
              }
            });

            setTeamMembersMap(map);
          } catch (mErr) {
            console.warn("Aviso ao carregar team_members:", mErr);
          }
        }
      }
    } catch (err) {
      console.error("Exceção ao buscar equipes:", err);
    }
  }, [effectiveTournamentId]);

  React.useEffect(() => {
    fetchTeamsFromDb();
  }, [fetchTeamsFromDb]);

  // Filtros de busca, status e modo de visualização (Cards vs. Tabela)
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilterBar, setShowFilterBar] = useState(false);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");

  // Modais e visualizadores
  const [showAddModal, setShowAddModal] = useState(false);
  const [showProofReviewModal, setShowProofReviewModal] = useState(false);
  const [viewingReceiptTeam, setViewingReceiptTeam] = useState<Team | null>(null);
  const [receiptModalSignedUrl, setReceiptModalSignedUrl] = useState<string | null>(null);
  const [loadingReceiptUrl, setLoadingReceiptUrl] = useState(false);
  const [proofSignedUrls, setProofSignedUrls] = useState<Record<string, string>>({});
  const [selectedTeamDetails, setSelectedTeamDetails] = useState<Team | null>(null);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [isApprovingId, setIsApprovingId] = useState<string | null>(null);
  const [isRefundingId, setIsRefundingId] = useState<string | null>(null);
  const [isDeletingTeamId, setIsDeletingTeamId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorToastMessage, setErrorToastMessage] = useState<string | null>(null);

  // Acordeão de Elenco / Atletas da Equipe
  const [expandedRosterIds, setExpandedRosterIds] = useState<Record<string, boolean>>({});
  const [teamMembersMap, setTeamMembersMap] = useState<Record<string, TeamMember[]>>({});

  // Contexto sincronizado do torneio: Modalidade, Formato da Modalidade Travado e Exigências
  const activeSportType: SportType = activeTournament?.sport_type || currentSportType || "DOMINO";
  const modalityFormat = useMemo(
    () => extractModalityFormat({ ...(activeTournament || {}), sport_type: activeSportType }),
    [activeTournament, activeSportType]
  );
  const formatLower = modalityFormat.toLowerCase();

  // Trava o formato da modalidade estritamente com base na configuração real do torneio
  const isSoloFormat =
    formatLower.includes("solo") ||
    formatLower.includes("1v1") ||
    formatLower.includes("1x1") ||
    formatLower.includes("individual") ||
    Number((activeTournament as any)?.team_size) === 1;

  const isDuplasFormat =
    !isSoloFormat &&
    (formatLower.includes("dupla") ||
      formatLower.includes("2v2") ||
      formatLower.includes("2x2") ||
      activeSportType === "DOMINO" ||
      Number((activeTournament as any)?.team_size) === 2);

  const isTeamFormat =
    !isSoloFormat &&
    !isDuplasFormat &&
    (activeSportType === "FUTSAL" ||
      activeSportType === "VOLEI" ||
      Number((activeTournament as any)?.team_size) > 2);

  // Definições contextuais de acordo com o esporte e formato travado (Roteador de Regras)
  const isDomino = activeSportType === "DOMINO";
  const isPingPong = activeSportType === "PING_PONG";
  const isFutsal = activeSportType === "FUTSAL";
  const isVolei = activeSportType === "VOLEI";
  const isTeamSport = isTeamFormat;
  const isPingPongSolo = isSoloFormat;
  const isPingPongDuplas = isDuplasFormat;

  const entitySingular = isSoloFormat
    ? "Jogador"
    : isTeamFormat
    ? "Equipe"
    : "Dupla";

  const teamNameCol = isSoloFormat
    ? "Nome (Jogador)"
    : isTeamFormat
    ? "Nome (Equipe)"
    : "Nome (Dupla)";

  // Ícone por modalidade
  const sportIcon = isDomino ? "🁓" : isPingPong ? "🏓" : isFutsal ? "⚽" : "🏐";

  // Exigências e Campos Personalizados do Torneio (espelhados do Formulário Público)
  const requireCpf = Boolean(activeTournament?.require_cpf);
  const requirePhone = Boolean(activeTournament?.require_phone);
  const isAllSkillLevels =
    !activeTournament?.skill_level ||
    activeTournament.skill_level.toUpperCase() === "ALL" ||
    activeTournament.skill_level.toUpperCase() === "LIVRE";
  const customFields: CustomRegistrationField[] = useMemo(() => {
    const raw = activeTournament?.custom_registration_fields;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }, [activeTournament?.custom_registration_fields]);

  const maxPlayersLimit =
    activeTournament?.max_players !== null &&
    activeTournament?.max_players !== undefined &&
    Number(activeTournament.max_players) > 0
      ? Number(activeTournament.max_players)
      : null;

  // Categorias reais configuradas para este torneio específico
  const availableCategories = useMemo<string[]>(() => {
    const list: string[] = [];
    const addUnique = (val?: string | null) => {
      const clean = (val || "").trim();
      if (clean && !list.includes(clean)) list.push(clean);
    };

    const rulesObj = parseMatchRulesObject(activeTournament?.match_rules);
    const explicitCategories =
      (activeTournament as any)?.categories || rulesObj?.categories;
    if (Array.isArray(explicitCategories)) {
      explicitCategories.forEach((c: any) => {
        if (typeof c === "string") addUnique(c);
      });
    }

    // Verifica se há um campo personalizado de seleção chamado Categoria
    const customCategoryField = customFields.find(
      (f) =>
        f.type === "select" &&
        (f.label.toLowerCase() === "categoria" || f.label.toLowerCase() === "categorias")
    );
    if (customCategoryField && Array.isArray(customCategoryField.options)) {
      customCategoryField.options.forEach((opt) => addUnique(opt));
    }

    const genderRaw = String(activeTournament?.gender_category || "MISTO")
      .trim()
      .toUpperCase();
    const genderDisplay =
      genderRaw === "MASCULINO"
        ? "Masculino"
        : genderRaw === "FEMININO"
        ? "Feminino"
        : "Misto";

    const skillRaw = String(activeTournament?.skill_level || "ALL")
      .trim()
      .toUpperCase();
    const skillDisplayMap: Record<string, string> = {
      BEGINNER: "Iniciante",
      INTERMEDIATE: "Intermediário",
      ADVANCED: "Avançado",
    };

    if (skillDisplayMap[skillRaw]) {
      addUnique(`${genderDisplay} - ${skillDisplayMap[skillRaw]}`);
      addUnique(`${genderDisplay} (${modalityFormat})`);
      addUnique(genderDisplay);
      addUnique(skillDisplayMap[skillRaw]);
    } else {
      addUnique(genderDisplay);
      addUnique(`${genderDisplay} (${modalityFormat})`);
      addUnique(`${genderDisplay} - Iniciante`);
      addUnique(`${genderDisplay} - Intermediário`);
      addUnique(`${genderDisplay} - Avançado`);
      if (genderRaw === "MISTO") {
        addUnique("Masculino");
        addUnique("Feminino");
      }
    }

    return list.length > 0 ? list : ["Misto"];
  }, [activeTournament, customFields, modalityFormat]);

  const defaultTournamentCategory = availableCategories[0] || "Misto";

  // Estados do Formulário de Adição Manual (Espelhados com PublicRegistrationForm)
  const [formName, setFormName] = useState("");
  const [formPlayer1, setFormPlayer1] = useState("");
  const [formCaptainEmail, setFormCaptainEmail] = useState("");
  const [formCaptainCpf, setFormCaptainCpf] = useState("");
  const [formContact, setFormContact] = useState("");
  const [formPlayer2, setFormPlayer2] = useState("");
  const [formPartnerEmail, setFormPartnerEmail] = useState("");
  const [formPartnerCpf, setFormPartnerCpf] = useState("");
  const [formPartnerPhone, setFormPartnerPhone] = useState("");
  const [formCategory, setFormCategory] = useState<string>("");
  const [formDeclaredSkillLevel, setFormDeclaredSkillLevel] = useState<string>("");
  const [formCustomAnswers, setFormCustomAnswers] = useState<Record<string, any>>({});
  const [formPaymentStatus, setFormPaymentStatus] = useState<"PAID" | "PENDING">("PAID");
  const [formRosterMembers, setFormRosterMembers] = useState<
    { name: string; email: string; cpf?: string; phone?: string }[]
  >([]);
  const [formError, setFormError] = useState("");
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);

  // Sincroniza a categoria padrão do select sempre que o torneio ou suas categorias carregarem
  React.useEffect(() => {
    if (availableCategories.length > 0 && (!formCategory || !availableCategories.includes(formCategory))) {
      setFormCategory(availableCategories[0]);
    }
  }, [availableCategories, formCategory]);

  const formatCpfMask = (val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
  };

  const formatPhoneMask = (val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, 11);
    if (digits.length === 0) return "";
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  };

  const handleManualCustomAnswerChange = (fieldLabel: string, value: any) => {
    setFormCustomAnswers((prev) => ({
      ...prev,
      [fieldLabel]: value,
    }));
  };

  // Fechar toast após 4 segundos
  React.useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  React.useEffect(() => {
    if (errorToastMessage) {
      const timer = setTimeout(() => setErrorToastMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [errorToastMessage]);

  // 1. Estatísticas Calculadas Dinamicamente
  const stats = useMemo(() => {
    let paid = 0;
    let pending = 0;
    let waitingPix = 0;
    let cancellations = 0;

    localTeams.forEach((t) => {
      if (
        t.cancellation_status === "REFUNDED" ||
        t.payment_status === "CANCELED" ||
        t.payment_status === "CANCELLED" ||
        t.status === "CANCELED" ||
        t.status === "CANCELLED"
      ) {
        return;
      }
      if (t.cancellation_status === "REQUESTED_BY_ATHLETE" || t.cancellation_status === "REFUND_REQUESTED") {
        cancellations++;
      }
      const pStatus = t.payment_status || (t.status === "CONFIRMED" || t.status === "PAID" ? "APPROVED" : "PENDING");
      if (pStatus === "APPROVED" || pStatus === "PAID") {
        paid++;
      } else if (pStatus === "WAITING_PIX") {
        waitingPix++;
      } else {
        pending++;
      }
    });

    const total = localTeams.filter(
      (t) =>
        t.cancellation_status !== "REFUNDED" &&
        t.payment_status !== "CANCELED" &&
        t.payment_status !== "CANCELLED" &&
        t.status !== "CANCELED" &&
        t.status !== "CANCELLED" &&
        t.status !== "CANCELLED"
    ).length;

    return { total, paid, pending, waitingPix, cancellations };
  }, [localTeams]);

  // Cancelamentos Solicitados
  const cancellationCount = stats.cancellations;

  // Equipes que possuem comprovante anexado ou aguardam conferência Pix
  const teamsToReview = useMemo(() => {
    return localTeams.filter(
      (t) =>
        t.cancellation_status !== "REFUNDED" &&
        t.payment_status !== "CANCELED" &&
        t.status !== "CANCELED" &&
        t.status !== "CANCELLED" &&
        (t.payment_status === "WAITING_PIX" || t.payment_status === "WAITING_APPROVAL" || Boolean(t.payment_proof_url))
    );
  }, [localTeams]);

  // Carregar URLs assinadas seguras (60 min) para visualização das imagens no modal de conferência
  React.useEffect(() => {
    if (!showProofReviewModal || teamsToReview.length === 0) return;

    let isMounted = true;
    async function loadSignedUrls() {
      const urls: Record<string, string> = {};
      for (const t of teamsToReview) {
        if (t.payment_proof_url) {
          let cleanPath = t.payment_proof_url;
          if (cleanPath.startsWith("http://") || cleanPath.startsWith("https://")) {
            if (cleanPath.includes("/receipts/")) {
              cleanPath = cleanPath.split("/receipts/").pop() || cleanPath;
            } else {
              urls[t.id] = cleanPath;
              continue;
            }
          }
          cleanPath = cleanPath.split("?")[0].replace(/^receipts\//, "");

          try {
            const { data } = await supabase.storage
              .from("receipts")
              .createSignedUrl(cleanPath, 3600);

            if (data?.signedUrl) {
              urls[t.id] = data.signedUrl;
            } else {
              urls[t.id] = t.payment_proof_url;
            }
          } catch {
            urls[t.id] = t.payment_proof_url;
          }
        }
      }
      if (isMounted) {
        setProofSignedUrls(urls);
      }
    }

    loadSignedUrls();
    return () => {
      isMounted = false;
    };
  }, [showProofReviewModal, teamsToReview]);

  // Filtragem das equipes
  const filteredTeams = useMemo(() => {
    return localTeams.filter((t) => {
      // Ignora equipes já estornadas da visualização ativa padrão
      if (
        t.cancellation_status === "REFUNDED" ||
        t.payment_status === "CANCELED" ||
        t.payment_status === "CANCELLED" ||
        t.status === "CANCELED" ||
        t.status === "CANCELLED"
      ) {
        return false;
      }

      if (statusFilter === "CANCELLATIONS") {
        return t.cancellation_status === "REQUESTED_BY_ATHLETE" || t.cancellation_status === "REFUND_REQUESTED";
      }

      const pStatus = t.payment_status || (t.status === "CONFIRMED" || t.status === "PAID" ? "APPROVED" : "PENDING");
      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "APPROVED" && (pStatus === "APPROVED" || pStatus === "PAID")) ||
        (statusFilter === "PENDING" && pStatus === "PENDING") ||
        (statusFilter === "WAITING_PIX" && pStatus === "WAITING_PIX");

      const query = searchQuery.toLowerCase().trim();
      const matchesQuery =
        !query ||
        t.name.toLowerCase().includes(query) ||
        (t.manager_name && t.manager_name.toLowerCase().includes(query)) ||
        (t.players && t.players.some((p) => p && p.toLowerCase().includes(query)));

      return matchesStatus && matchesQuery;
    });
  }, [localTeams, statusFilter, searchQuery]);

  // Leitura Segura de Comprovantes via Signed URL de 60 minutos (3600s)
  // Alternar visualização do acordeão de atletas (team_members)
  const getTeamRosterList = (team: Team): TeamMember[] => {
    const result: TeamMember[] = [];
    const seenNames = new Set<string>();
    const captainRef = (team.manager_name || team.players?.[0] || "").trim().toLowerCase();

    const addMember = (m: Partial<TeamMember> & { name: string }) => {
      const cleanName = (m.name || "").trim();
      if (!cleanName) return;
      const key = cleanName.toLowerCase();
      // Não adiciona atleta genérico caso exista nome real disponível
      if (key === "atleta" && (captainRef || (team.players && team.players.length > 0))) {
        return;
      }
      if (seenNames.has(key)) {
        const existingIdx = result.findIndex((item) => (item.name || "").toLowerCase() === key);
        if (existingIdx !== -1) {
          result[existingIdx] = {
            ...result[existingIdx],
            email: result[existingIdx].email || m.email || "",
            cpf: result[existingIdx].cpf || m.cpf || undefined,
            phone: result[existingIdx].phone || m.phone || undefined,
          };
        }
        return;
      }
      seenNames.add(key);
      const isCap =
        Boolean(m.is_captain) ||
        (result.length === 0 && (!captainRef || key === captainRef));
      result.push({
        id: m.id || `${team.id}-${result.length}`,
        team_id: team.id,
        user_id: m.user_id ?? (isCap ? team.user_id : undefined),
        name: cleanName,
        email: m.email || (isCap && team.contact?.includes("@") ? team.contact : ""),
        cpf: m.cpf || undefined,
        phone: m.phone || undefined,
        is_captain: isCap,
        created_at: m.created_at,
      });
    };

    if (captainRef) {
      const capDisplay = (team.manager_name || team.players?.[0] || "").trim();
      const dbCap = (teamMembersMap[team.id] || (team as any).members || []).find(
        (m: any) =>
          m &&
          typeof m === "object" &&
          (m.is_captain || (m.name && m.name.trim().toLowerCase() === captainRef))
      );
      if (dbCap) {
        const finalCapName =
          dbCap.name && dbCap.name.trim().toLowerCase() !== "atleta"
            ? dbCap.name
            : (capDisplay || "Capitão");
        addMember({ ...dbCap, name: finalCapName, is_captain: true });
      } else if (capDisplay) {
        addMember({ name: capDisplay, is_captain: true, user_id: team.user_id });
      }
    }

    const dbMembers = teamMembersMap[team.id] || (team as any).members || [];
    if (Array.isArray(dbMembers)) {
      dbMembers.forEach((m: any) => {
        if (m && typeof m === "object" && m.name) {
          addMember(m);
        } else if (typeof m === "string") {
          addMember({ name: m });
        }
      });
    }

    const customAnswers = team.custom_registration_answers;
    if (customAnswers && Array.isArray(customAnswers.__athlete_members)) {
      customAnswers.__athlete_members.forEach((m: any) => {
        if (m && typeof m === "object" && m.name) {
          addMember(m);
        }
      });
    }

    let rawRoster: any = team.roster;
    if (typeof rawRoster === "string" && rawRoster.trim()) {
      try {
        rawRoster = JSON.parse(rawRoster);
      } catch {
        rawRoster = rawRoster.split(",").map((s: string) => s.trim());
      }
    }
    if (Array.isArray(rawRoster)) {
      rawRoster.forEach((item: any) => {
        if (typeof item === "string") {
          addMember({ name: item });
        } else if (item && typeof item === "object" && item.name) {
          addMember(item);
        }
      });
    }

    if (Array.isArray(team.players)) {
      team.players.filter(Boolean).forEach((pName) => {
        addMember({ name: pName });
      });
    }

    return result.sort((a, b) => (a.is_captain === b.is_captain ? 0 : a.is_captain ? -1 : 1));
  };

  // Tradutor amigável para Nível Técnico (PT-BR)
  const formatSkillLevelLabel = (level?: string | null): string => {
    if (!level) return "";
    const upper = String(level).trim().toUpperCase();
    if (upper === "BEGINNER") return "Iniciante";
    if (upper === "INTERMEDIATE") return "Intermediário";
    if (upper === "ADVANCED") return "Avançado";
    if (upper === "ALL" || upper === "LIVRE") return "";
    return String(level).trim();
  };

  // Extrai e normaliza todos os campos customizados e metadados de inscrição (custom_responses / custom_registration_answers)
  const getTeamCustomResponses = (team: Team): Record<string, any> => {
    const compiled: Record<string, any> = {};
    const roster = getTeamRosterList(team);
    const captainMember = roster.find((m) => m.is_captain) || roster[0] || null;
    const partnerMember = roster.filter((m) => !m.is_captain)[0] || null;

    const rawSources = [
      (team as any).metadata,
      (team as any).form_data,
      team.custom_registration_answers,
      team.custom_responses,
    ];

    rawSources.forEach((src) => {
      if (src && typeof src === "object" && !Array.isArray(src)) {
        Object.entries(src).forEach(([key, val]) => {
          if (key.startsWith("__")) return;
          if (val === null || val === undefined || String(val).trim() === "") return;
          if (typeof val === "object" && !Array.isArray(val)) return;
          if (Array.isArray(val) && val.some((item) => typeof item === "object")) return;

          if (/n[ií]vel/i.test(key) && typeof val === "string") {
            const formatted = formatSkillLevelLabel(val);
            if (formatted) compiled[key] = formatted;
          } else {
            compiled[key] = val;
          }
        });
      }
    });

    const hasKeyMatching = (regex: RegExp) =>
      Object.keys(compiled).some((k) => regex.test(k));

    // Complementa metadados do capitão/atleta caso não estejam explícitos no JSONB (retrocompatibilidade)
    const captainCpf = captainMember?.cpf || "";
    if (captainCpf && !hasKeyMatching(/^cpf$|cpf do (capit[aã]o|atleta|respons[aá]vel)/i)) {
      compiled[isSoloFormat ? "CPF" : "CPF do Capitão"] = captainCpf;
    }

    const captainPhone =
      captainMember?.phone ||
      (team.contact && !team.contact.includes("@") ? team.contact : "") ||
      team.phone ||
      team.manager_phone ||
      "";
    if (captainPhone && !hasKeyMatching(/contato|whatsapp|telefone|celular/i)) {
      compiled[
        isSoloFormat
          ? "Contato (WhatsApp)"
          : isDuplasFormat
          ? "Contato do Capitão"
          : "Contato do Responsável"
      ] = captainPhone;
    }

    const captainEmail =
      captainMember?.email ||
      (team.contact && team.contact.includes("@") ? team.contact : "") ||
      "";
    if (captainEmail && !hasKeyMatching(/^e-?mail$|e-?mail do (jogador|capit[aã]o|respons[aá]vel)/i)) {
      compiled[
        isSoloFormat
          ? "E-mail"
          : isDuplasFormat
          ? "E-mail do Capitão"
          : "E-mail do Responsável"
      ] = captainEmail;
    }

    // Dados do Parceiro / Jogador 2 (Duplas)
    if (isDuplasFormat) {
      const p2Name = partnerMember?.name || team.players?.[1] || "";
      if (p2Name && !hasKeyMatching(/jogador 2|parceiro/i)) {
        compiled["Jogador 2 (Parceiro)"] = p2Name;
      }
      if (partnerMember?.cpf && !hasKeyMatching(/cpf.*(jogador 2|parceiro)/i)) {
        compiled["CPF do Jogador 2"] = partnerMember.cpf;
      }
      if (partnerMember?.phone && !hasKeyMatching(/(telefone|contato|whatsapp).*(jogador 2|parceiro)/i)) {
        compiled["Telefone do Jogador 2"] = partnerMember.phone;
      }
      if (partnerMember?.email && !hasKeyMatching(/e-?mail.*(jogador 2|parceiro)/i)) {
        compiled["E-mail do Jogador 2"] = partnerMember.email;
      }
    }

    // Nível Técnico declarado ou configurado
    const skillLabel = formatSkillLevelLabel(team.declared_skill_level);
    if (skillLabel && !hasKeyMatching(/n[ií]vel/i)) {
      compiled["Nível Técnico"] = skillLabel;
    }

    return compiled;
  };

  // Identifica se uma chave já pertence a um dos blocos estruturados (Equipe, Atleta 1, Atleta 2)
  const isCoreGroupedKey = React.useCallback((key: string): boolean => {
    if (!key || key.startsWith("__")) return true;
    const norm = key.trim().toLowerCase();
    // Chaves cobertas pelo Bloco da Equipe
    if (
      norm === "nome (dupla)" ||
      norm === "nome da dupla" ||
      norm === "nome da equipe" ||
      norm === "nome da equipe/dupla" ||
      norm === "nome do jogador" ||
      norm === "nome (jogador)" ||
      norm === "nome (equipe)" ||
      norm === "categoria" ||
      norm === "categorias" ||
      norm === "nível técnico" ||
      norm === "nivel tecnico" ||
      norm === "nível de jogo" ||
      norm === "nivel de jogo" ||
      norm === "status financeiro" ||
      norm === "data de inscrição" ||
      norm === "data de inscricao"
    ) {
      return true;
    }
    // Chaves cobertas pelo Bloco do Atleta 1
    if (
      norm === "atleta 1 / capitão" ||
      norm === "atleta 1 / capitao" ||
      norm === "atleta 1" ||
      norm === "jogador 1" ||
      norm === "jogador 1 (capitão)" ||
      norm === "jogador 1 (capitao)" ||
      norm === "responsável" ||
      norm === "responsavel" ||
      norm === "capitão / responsável" ||
      norm === "capitao / responsavel" ||
      norm === "capitão" ||
      norm === "capitao" ||
      norm === "e-mail do capitão" ||
      norm === "email do capitão" ||
      norm === "email do capitao" ||
      norm === "e-mail do responsável" ||
      norm === "email do responsável" ||
      norm === "email do responsavel" ||
      norm === "e-mail do jogador" ||
      norm === "email do jogador" ||
      norm === "e-mail" ||
      norm === "email" ||
      norm === "cpf do capitão" ||
      norm === "cpf do capitao" ||
      norm === "cpf do atleta" ||
      norm === "cpf do responsável" ||
      norm === "cpf do responsavel" ||
      norm === "cpf" ||
      norm === "contato/telefone" ||
      norm === "contato (whatsapp)" ||
      norm === "contato do capitão" ||
      norm === "contato do capitao" ||
      norm === "contato do responsável" ||
      norm === "contato do responsavel" ||
      norm === "contato do capitão (whatsapp)" ||
      norm === "contato do responsável (whatsapp)" ||
      norm === "telefone" ||
      norm === "whatsapp" ||
      norm === "contato"
    ) {
      return true;
    }
    // Chaves cobertas pelo Bloco do Atleta 2
    if (
      norm === "atleta 2 (parceiro)" ||
      norm === "atleta 2" ||
      norm === "jogador 2 (parceiro)" ||
      norm === "jogador 2" ||
      norm === "parceiro" ||
      norm === "e-mail do jogador 2" ||
      norm === "email do jogador 2" ||
      norm === "e-mail do parceiro" ||
      norm === "email do parceiro" ||
      norm === "e-mail do parceiro (jogador 2)" ||
      norm === "email do parceiro (jogador 2)" ||
      norm === "cpf do jogador 2" ||
      norm === "cpf do parceiro"
    ) {
      return true;
    }
    // Roster / Atletas genéricos
    if (norm === "elenco completo" || /^atleta \d+$/i.test(norm)) {
      return true;
    }
    return false;
  }, []);

  // Chaves dinâmicas residuais (Outros) que não foram agrupadas nos blocos estruturados
  const otherCustomColumns = useMemo(() => {
    const keys: string[] = [];
    customFields.forEach((f) => {
      if (f.label && !isCoreGroupedKey(f.label) && !keys.includes(f.label)) {
        keys.push(f.label);
      }
    });
    const sourceList = filteredTeams.length > 0 ? filteredTeams : localTeams;
    sourceList.forEach((t) => {
      const customResponses = getTeamCustomResponses(t);
      const mergedObj = {
        ...(t.custom_registration_answers || {}),
        ...(t.custom_responses || {}),
        ...customResponses,
      };
      Object.keys(mergedObj).forEach((k) => {
        if (!isCoreGroupedKey(k) && !keys.includes(k)) {
          keys.push(k);
        }
      });
    });
    return keys;
  }, [customFields, filteredTeams, localTeams, isCoreGroupedKey, teamMembersMap]);

  const toggleTeamRoster = async (teamId: string) => {
    setExpandedRosterIds((prev) => ({
      ...prev,
      [teamId]: !prev[teamId],
    }));

    // Se ainda não temos os membros desse time no mapa, busca sob demanda
    if (!teamMembersMap[teamId]) {
      try {
        const { data: mData } = await supabase
          .from("team_members")
          .select("*")
          .eq("team_id", teamId);

        if (mData) {
          setTeamMembersMap((prev) => ({
            ...prev,
            [teamId]: mData.map((m: any) => ({
              id: m.id,
              team_id: m.team_id,
              user_id: m.user_id,
              name: m.name || "",
              email: m.email || "",
              cpf: m.cpf || undefined,
              phone: m.phone || undefined,
              is_captain: Boolean(m.is_captain),
              created_at: m.created_at,
            })),
          }));
        }
      } catch (err) {
        console.warn("Aviso ao buscar team_members sob demanda:", err);
      }
    }
  };

  // Abrir Modal de Comprovante de Pagamento (Visualização com fallback para vazio)
  const openReceiptModal = async (team: Team) => {
    setViewingReceiptTeam(team);
    setReceiptModalSignedUrl(null);

    if (!team.payment_proof_url) return;

    setLoadingReceiptUrl(true);
    try {
      let cleanPath = team.payment_proof_url;
      if (cleanPath.startsWith("http://") || cleanPath.startsWith("https://")) {
        if (cleanPath.includes("/receipts/")) {
          cleanPath = cleanPath.split("/receipts/").pop() || cleanPath;
        } else {
          setReceiptModalSignedUrl(cleanPath);
          return;
        }
      }
      cleanPath = cleanPath.split("?")[0].replace(/^receipts\//, "");

      const { data, error } = await supabase.storage
        .from("receipts")
        .createSignedUrl(cleanPath, 3600);

      if (data?.signedUrl) {
        setReceiptModalSignedUrl(data.signedUrl);
      } else {
        setReceiptModalSignedUrl(team.payment_proof_url);
      }
    } catch (err) {
      console.warn("Aviso ao gerar URL assinada do comprovante:", err);
      setReceiptModalSignedUrl(team.payment_proof_url);
    } finally {
      setLoadingReceiptUrl(false);
    }
  };

  // Leitura Segura de Comprovantes via Signed URL de 60 minutos (3600s)
  const handleViewReceipt = async (path?: string | null) => {
    console.log("Tentando abrir comprovante no caminho:", path);
    if (!path) return alert("Caminho do comprovante vazio no banco de dados.");

    // Fallback de legado: se for URL completa (http:// ou https://) que não contenha /receipts/
    if (path.startsWith("http://") || path.startsWith("https://")) {
      if (path.includes("/receipts/")) {
        path = path.split("/receipts/").pop() || path;
      } else {
        console.log("Detectada URL legada, abrindo diretamente:", path);
        window.open(path, "_blank");
        return;
      }
    }

    const cleanPath = path.replace("receipts/", "");

    const { data, error } = await supabase.storage.from("receipts").createSignedUrl(cleanPath, 3600);

    if (error) {
      console.error("Erro fatal ao gerar SignedURL:", error);
      alert("Erro ao abrir (Path: " + cleanPath + "): " + error.message);
      return;
    }

    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank");
    }
  };

  // Função para Aprovar Pix com Repasse Manual (/api/manual-split)
  const handleApprovePix = async (teamId: string) => {
    if (isReadOnly || !hasFinancialAccess) {
      alert("Você não possui permissão financeira para aprovar inscrições.");
      return;
    }
    setIsApprovingId(teamId);

    try {
      const response = await fetch("/api/manual-split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_id: teamId }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result?.error || "Erro ao processar repasse e aprovação Pix.");
      }

      // Garante a gravação no Supabase com payment_status PAID e payout_status MANUAL_PENDING
      await supabase
        .from("teams")
        .update({
          status: "PAID",
          payment_status: "PAID",
          payout_status: result.payoutStatus || "MANUAL_PENDING",
          payout_amount: result.amountTransferred ?? result.payout_amount,
          amount_paid: result.amount_paid ?? selectedTeamDetails?.amount_paid,
        })
        .eq("id", teamId);

      // Atualiza o estado local imediatamente
      setLocalTeams((prev) =>
        prev.map((t) =>
          t.id === teamId
            ? {
                ...t,
                status: "PAID",
                payment_status: "PAID",
                payout_status: result.payoutStatus || "MANUAL_PENDING",
                payout_amount: result.amountTransferred ?? result.payout_amount,
          amount_paid: result.amount_paid ?? selectedTeamDetails?.amount_paid,
              }
            : t
        )
      );

      if (selectedTeamDetails?.id === teamId) {
        setSelectedTeamDetails((prev) =>
          prev ? { ...prev, status: "PAID", payment_status: "PAID" } : null
        );
      }

      // Fecha o modal de conferência de comprovante
      if (viewingReceiptTeam?.id === teamId) {
        setViewingReceiptTeam(null);
      }

      setToastMessage(
        result.message || "Pagamento Pix aprovado com sucesso! Inscrição confirmada."
      );

      // Revalida dados com o banco de dados
      fetchTeamsFromDb();
    } catch (err: any) {
      console.error("Erro ao aprovar Pix com split manual:", err);

      // Fallback de contingência caso a rota de split falhe
      try {
        await supabase
          .from("teams")
          .update({
            status: "PAID",
            payment_status: "PAID",
          })
          .eq("id", teamId);

        setLocalTeams((prev) =>
          prev.map((t) =>
            t.id === teamId
              ? { ...t, status: "PAID", payment_status: "PAID" }
              : t
          )
        );

        try {
          await notifyRegistrationApproved({ teamId, newStatus: "PAID" });
        } catch (notifErr) {
          console.warn("Aviso ao notificar atleta no fallback de aprovação:", notifErr);
        }
        setToastMessage("Inscrição confirmada (PAID)! Atenção: split financeiro pendente.");
        fetchTeamsFromDb();
      } catch (dbErr: any) {
        setToastMessage(err?.message || "Erro ao aprovar pagamento Pix.");
      }
    } finally {
      setIsApprovingId(null);
    }
  };

  // Função para Cancelar Inscrição e Estornar Pix via Mercado Pago
  const handleRefundTeam = async (teamId: string) => {
    if (isReadOnly || !hasFinancialAccess) {
      alert("Você não possui permissão para estornar pagamentos.");
      return;
    }

    if (
      !window.confirm(
        "Deseja confirmar o cancelamento desta inscrição e realizar o estorno do Pix via Mercado Pago?"
      )
    ) {
      return;
    }

    setIsRefundingId(teamId);
    setErrorToastMessage(null);
    setToastMessage(null);

    try {
      const { data: authData } = await supabase.auth.getSession();
      const userAuthToken = authData?.session?.access_token;

      const res = await confirmCancellation(teamId, userAuthToken);

      if (!res || !res.success) {
        throw new Error(res?.error || "Falha ao processar cancelamento e estorno do Pix.");
      }

      if (res.success) {
        // Sucesso estrito: mostrar toast de sucesso, atualizar estado local e fechar modal
        setToastMessage(res.message || "Inscrição cancelada e Pix estornado com sucesso!");
        setLocalTeams((prev) =>
          prev
            .map((t) =>
              t.id === teamId
                ? {
                    ...t,
                    status: "CANCELLED",
                    payment_status: "CANCELED",
                    cancellation_status: "REFUNDED",
                  }
                : t
            )
            .filter((t) => t.id !== teamId)
        );
        if (selectedTeamDetails?.id === teamId) {
          setSelectedTeamDetails(null);
        }
        await fetchTeamsFromDb();
      }
      if (false) {
        const response = await fetch("/api/checkout/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Falha ao processar estorno do Pix.");
      }

      // Sucesso: mostrar toast e remover equipe da lista ativa
      setToastMessage("Inscrição cancelada e Pix estornado com sucesso!");
      setLocalTeams((prev) => prev.filter((t) => t.id !== teamId));
      }
      if (selectedTeamDetails?.id === teamId) {
        setSelectedTeamDetails(null);
      }
    } catch (err: any) {
      console.error("Erro no estorno:", err);
      setErrorToastMessage(err?.message || "Ocorreu um erro ao processar o cancelamento e estorno.");
    } finally {
      setIsRefundingId(null);
    }
  };

  // Excluir inscrição pendente e libertar vaga (para evitar vagas fantasmas no limite max_teams)
  const handleDeleteOrFreeSpot = async (team: Team) => {
    const confirmMessage = `Deseja realmente excluir a inscrição da equipe "${team.name}" e libertar esta vaga no torneio?`;
    if (!window.confirm(confirmMessage)) return;

    setIsDeletingTeamId(team.id);

    try {
      // 1. Remove membros vinculados
      try {
        await supabase.from("team_members").delete().eq("team_id", team.id);
      } catch (tmErr) {
        console.warn("Aviso ao remover membros vinculados:", tmErr);
      }

      // 2. Remove da tabela teams para desocupar a contagem de max_teams
      const { error: deleteError } = await supabase
        .from("teams")
        .delete()
        .eq("id", team.id);

      if (deleteError) {
        console.warn("Delete direto falhou, aplicando fallback para status REJECTED:", deleteError);
        const { error: updateError } = await supabase
          .from("teams")
          .update({ status: "REJECTED", payment_status: "REJECTED" })
          .eq("id", team.id);

        if (updateError) {
          throw updateError;
        }
      }

      // 3. Atualiza estado local da lista e notifica componente pai
      setLocalTeams((prev) => prev.filter((t) => t.id !== team.id));
      onDeleteTeam?.(team.id);

      if (selectedTeamDetails?.id === team.id) {
        setSelectedTeamDetails(null);
      }

      setToastMessage(`Inscrição da equipe "${team.name}" excluída e vaga liberada!`);
    } catch (err) {
      console.error("Erro ao excluir/libertar vaga da equipe:", err);
      alert("Erro ao excluir inscrição e libertar vaga.");
    } finally {
      setIsDeletingTeamId(null);
    }
  };

  // Exclusão definitiva confirmada pelo AlertDialog no modal de detalhes da equipe
  const handleConfirmPermanentDelete = async (team: Team) => {
    if (!team?.id || isDeletingTeamId === team.id) return;

    setIsDeletingTeamId(team.id);

    try {
      // 1. Remove membros vinculados
      try {
        await supabase.from("team_members").delete().eq("team_id", team.id);
      } catch (tmErr) {
        console.warn("Aviso ao remover membros vinculados:", tmErr);
      }

      // 2. Executa exclusão no banco e/ou via callback do contexto
      const { error: deleteError } = await supabase
        .from("teams")
        .delete()
        .eq("id", team.id);

      if (deleteError) {
        console.warn("Aviso ao deletar equipe diretamente:", deleteError);
      }

      await Promise.resolve(onDeleteTeam?.(team.id));

      // 3. Atualiza lista local e fecha os modais
      setLocalTeams((prev) => prev.filter((t) => t.id !== team.id));
      setShowDeleteConfirmModal(false);
      setSelectedTeamDetails(null);
      setToastMessage("Inscrição removida com sucesso.");
    } catch (err: any) {
      console.error("Erro ao excluir inscrição definitivamente:", err);
      setErrorToastMessage(err?.message || "Erro ao excluir a inscrição.");
    } finally {
      setIsDeletingTeamId(null);
    }
  };

  // Formatar data de inscrição
  const formatDate = (dateString?: string) => {
    if (!dateString) return "Hoje";
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return "Hoje";
      return d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return "Hoje";
    }
  };

  // Exportação em Massa de Inscritos para Planilha CSV (Agrupamento Lógico por Blocos + UTF-8 BOM)
  const handleExportCSV = () => {
    const sourceTeams = filteredTeams.length > 0 ? filteredTeams : localTeams;
    if (sourceTeams.length === 0) {
      setErrorToastMessage("Não há inscrições disponíveis para exportar.");
      return;
    }

    // Estrutura estrita de ordenação de cabeçalhos por blocos semânticos (headerOrder)
    const headerOrder = [
      // 1. Bloco da Equipe
      teamNameCol,
      "Categoria",
      "Nível Técnico",
      "Status Financeiro",
      "Data de Inscrição",
      // 2. Bloco do Atleta 1
      "Atleta 1 / Capitão",
      "E-mail do Capitão",
      "CPF do Capitão",
      "Contato/Telefone",
      // 3. Bloco do Atleta 2
      "Atleta 2 (Parceiro)",
      "E-mail do Jogador 2",
      "CPF do Jogador 2",
      // 4. Outros
      ...otherCustomColumns,
    ];

    // Achata (flatten) cada inscrição em um objeto unidimensional posicionado pelos índices de headerOrder
    const flatRows: Record<string, string>[] = sourceTeams.map((team) => {
      const pStatus =
        team.payment_status ||
        (team.status === "CONFIRMED" || team.status === "PAID" ? "PAID" : "PENDING");
      const isApproved =
        pStatus === "PAID" ||
        pStatus === "APPROVED" ||
        team.status === "CONFIRMED" ||
        team.status === "PAID";
      const isWaitingApproval =
        !isApproved && (pStatus === "WAITING_APPROVAL" || Boolean(team.payment_proof_url));
      const isWaitingPix = !isApproved && !isWaitingApproval && pStatus === "WAITING_PIX";

      let financialStatusLabel = "Pendente";
      if (team.cancellation_status === "REFUND_REQUESTED") {
        financialStatusLabel = "Cancelamento c/ Reembolso";
      } else if (team.cancellation_status === "REQUESTED_BY_ATHLETE") {
        financialStatusLabel = "Cancelamento Solicitado";
      } else if (isApproved) {
        financialStatusLabel = "Pago (Confirmado)";
      } else if (isWaitingApproval) {
        financialStatusLabel = "Em Análise";
      } else if (isWaitingPix) {
        financialStatusLabel = "Aguardando Pix";
      }

      const roster = getTeamRosterList(team);
      const captainMember = roster.find((m) => m.is_captain) || roster[0] || null;
      const partnerMember = roster.filter((m) => !m.is_captain)[0] || null;
      const customResponses = getTeamCustomResponses(team);

      // 1. Bloco da Equipe
      const teamNameVal = team.name || "";
      const categoryVal = team.category || defaultTournamentCategory;
      const skillLevelVal =
        formatSkillLevelLabel(team.declared_skill_level) ||
        customResponses["Nível Técnico"] ||
        "";
      const regDateVal = formatDate(team.createdAt);

      // 2. Bloco do Atleta 1 (prioriza nome vindo da relação da tabela, fallback responsável)
      const athlete1NameVal =
        captainMember?.name || team.players?.[0] || team.manager_name || "";
      const captainEmailVal =
        captainMember?.email ||
        customResponses["E-mail do Capitão"] ||
        customResponses["E-mail"] ||
        customResponses["E-mail do Responsável"] ||
        customResponses["E-mail do Jogador"] ||
        (team.contact && team.contact.includes("@") ? team.contact : "") ||
        "";
      const captainCpfVal =
        captainMember?.cpf ||
        customResponses["CPF do Capitão"] ||
        customResponses["CPF"] ||
        customResponses["CPF do Atleta"] ||
        customResponses["CPF do Responsável"] ||
        "";
      const captainPhoneVal =
        captainMember?.phone ||
        customResponses["Contato/Telefone"] ||
        customResponses["Contato (WhatsApp)"] ||
        customResponses["Contato do Capitão"] ||
        customResponses["Contato do Responsável"] ||
        (team.contact && !team.contact.includes("@") ? team.contact : "") ||
        team.phone ||
        team.manager_phone ||
        "";

      // 3. Bloco do Atleta 2 (Parceiro)
      const athlete2NameVal =
        partnerMember?.name || team.players?.[1] || customResponses["Jogador 2 (Parceiro)"] || "";
      const partnerEmailVal =
        partnerMember?.email ||
        customResponses["E-mail do Jogador 2"] ||
        customResponses["E-mail do Parceiro (Jogador 2)"] ||
        "";
      const partnerCpfVal =
        partnerMember?.cpf ||
        customResponses["CPF do Jogador 2"] ||
        "";

      const row: Record<string, string> = {
        [teamNameCol]: teamNameVal,
        Categoria: categoryVal,
        "Nível Técnico": skillLevelVal,
        "Status Financeiro": financialStatusLabel,
        "Data de Inscrição": regDateVal,
        "Atleta 1 / Capitão": athlete1NameVal,
        "E-mail do Capitão": captainEmailVal,
        "CPF do Capitão": captainCpfVal,
        "Contato/Telefone": captainPhoneVal,
        "Atleta 2 (Parceiro)": athlete2NameVal,
        "E-mail do Jogador 2": partnerEmailVal,
        "CPF do Jogador 2": partnerCpfVal,
      };

      // 4. Outros campos customizados dinâmicos
      otherCustomColumns.forEach((colKey) => {
        const rawAns =
          customResponses[colKey] ??
          team.custom_responses?.[colKey] ??
          team.custom_registration_answers?.[colKey];
        if (typeof rawAns === "boolean") {
          row[colKey] = rawAns ? "Sim" : "Não";
        } else if (Array.isArray(rawAns)) {
          row[colKey] = rawAns.join(", ");
        } else if (rawAns !== null && rawAns !== undefined && typeof rawAns !== "object") {
          row[colKey] = String(rawAns);
        } else {
          row[colKey] = "";
        }
      });

      return row;
    });

    const escapeCsvCell = (val: string) => {
      const str = String(val ?? "").replace(/\r?\n/g, " ").trim();
      return `"${str.replace(/"/g, '""')}"`;
    };

    const csvLines = [
      headerOrder.map(escapeCsvCell).join(","),
      ...flatRows.map((row) => headerOrder.map((h) => escapeCsvCell(row[h] || "")).join(",")),
    ];

    const csvContent = "\uFEFF" + csvLines.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "inscritos-sportconnect.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setToastMessage(`Planilha exportada com sucesso (${flatRows.length} inscrições)!`);
  };

  const isMaxPlayersReached = Boolean(
    maxPlayersLimit !== null && formRosterMembers.length + 1 >= maxPlayersLimit
  );

  // Manipuladores de Atletas Extras (Futsal / Vôlei)
  const handleAddAthleteField = () => {
    if (isMaxPlayersReached) return;
    setFormRosterMembers((prev) => [
      ...prev,
      { name: "", email: "", cpf: "", phone: "" },
    ]);
  };

  const handleUpdateAthlete = (
    index: number,
    field: "name" | "email" | "cpf" | "phone",
    val: string
  ) => {
    setFormRosterMembers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  };

  const handleRemoveAthlete = (index: number) => {
    setFormRosterMembers((prev) => prev.filter((_, i) => i !== index));
  };

  const resetManualForm = () => {
    setFormName("");
    setFormPlayer1("");
    setFormCaptainEmail("");
    setFormCaptainCpf("");
    setFormContact("");
    setFormPlayer2("");
    setFormPartnerEmail("");
    setFormPartnerCpf("");
    setFormPartnerPhone("");
    setFormDeclaredSkillLevel("");
    setFormCustomAnswers({});
    setFormRosterMembers([]);
    setFormCategory(availableCategories[0] || "Misto");
    setFormPaymentStatus("PAID");
    setFormError("");
  };

  // Submissão do Formulário de Adição Manual (Sincronizado com o Schema Público)
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (isReadOnly || isSubmittingManual) return;

    // 1. Validação dos Participantes conforme o Formato Travado do Torneio
    if (isSoloFormat) {
      if (!formPlayer1.trim()) {
        setFormError("Por favor, preencha o Nome do Jogador.");
        return;
      }
      if (!formContact.trim()) {
        setFormError("Por favor, informe o Contato (WhatsApp) do Jogador.");
        return;
      }
    } else if (isDuplasFormat) {
      if (!formName.trim() || !formPlayer1.trim() || !formPlayer2.trim()) {
        setFormError("Por favor, preencha o Nome da Dupla, Capitão e Jogador 2.");
        return;
      }
      if (!formCaptainEmail.trim()) {
        setFormError("Por favor, informe o E-mail do Capitão.");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formCaptainEmail.trim())) {
        setFormError("Por favor, informe um endereço de e-mail válido para o Capitão.");
        return;
      }
      if (!formContact.trim()) {
        setFormError("Por favor, informe o Contato (WhatsApp) do Capitão.");
        return;
      }
      if (formPartnerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formPartnerEmail.trim())) {
        setFormError("Por favor, informe um endereço de e-mail válido para o Parceiro (Jogador 2).");
        return;
      }
    } else {
      // Equipe (Futsal / Vôlei 6x6 ou 4x4)
      if (!formName.trim() || !formPlayer1.trim()) {
        setFormError("Por favor, informe o Nome da Equipe e o Capitão/Responsável.");
        return;
      }
      if (!formContact.trim()) {
        setFormError("Por favor, informe o Contato (WhatsApp) do Responsável.");
        return;
      }
    }

    // 2. Validação de Nível Técnico Autodeclarado (se livre para todos os níveis)
    if (isAllSkillLevels && !formDeclaredSkillLevel) {
      setFormError(
        isSoloFormat
          ? "Por favor, selecione o nível de jogo do atleta."
          : "Por favor, selecione o nível técnico da equipe."
      );
      return;
    }

    // 3. Validação de CPF e Telefone Exigidos pelo Torneio
    if (requireCpf) {
      if (!formCaptainCpf.trim() || formCaptainCpf.replace(/\D/g, "").length < 11) {
        setFormError("Por favor, informe um CPF válido (11 dígitos) para o Capitão / Jogador.");
        return;
      }
      if (isDuplasFormat && (!formPartnerCpf.trim() || formPartnerCpf.replace(/\D/g, "").length < 11)) {
        setFormError("Por favor, informe um CPF válido (11 dígitos) para o Jogador 2.");
        return;
      }
      if (isTeamFormat) {
        for (let i = 0; i < formRosterMembers.length; i++) {
          const ath = formRosterMembers[i];
          if (ath.name.trim() && (!ath.cpf?.trim() || ath.cpf.replace(/\D/g, "").length < 11)) {
            setFormError(`Por favor, informe um CPF válido para o atleta "${ath.name.trim()}".`);
            return;
          }
        }
      }
    }

    if (requirePhone) {
      if (!formContact.trim()) {
        setFormError("Por favor, informe o Telefone/WhatsApp do Capitão / Responsável.");
        return;
      }
      if (isDuplasFormat && !formPartnerPhone.trim()) {
        setFormError("Por favor, informe o Telefone/WhatsApp do Jogador 2.");
        return;
      }
      if (isTeamFormat) {
        for (let i = 0; i < formRosterMembers.length; i++) {
          const ath = formRosterMembers[i];
          if (ath.name.trim() && !ath.phone?.trim()) {
            setFormError(`Por favor, informe o Telefone/WhatsApp do atleta "${ath.name.trim()}".`);
            return;
          }
        }
      }
    }

    // 4. Validação de Campos Personalizados Obrigatórios
    for (const field of customFields) {
      if (field.required) {
        const val = formCustomAnswers[field.label];
        if (field.type === "checkbox") {
          if (!val || val === "Não" || val === false) {
            setFormError(`Por favor, responda/marque o campo obrigatório: "${field.label}".`);
            return;
          }
        } else {
          if (val === undefined || val === null || String(val).trim() === "") {
            setFormError(`Por favor, preencha o campo obrigatório: "${field.label}".`);
            return;
          }
        }
      }
    }

    // 5. Compilação de nomes e elenco
    let finalName = "";
    let p1 = "";
    let p2 = "";
    let compiledRoster: string[] = [];

    if (isSoloFormat) {
      p1 = formPlayer1.trim();
      finalName = p1;
      p2 = "";
      compiledRoster = [p1];
    } else if (isDuplasFormat) {
      finalName = formName.trim();
      p1 = formPlayer1.trim();
      p2 = formPlayer2.trim();
      compiledRoster = [p1, p2];
    } else {
      finalName = formName.trim();
      p1 = formPlayer1.trim();
      p2 = "";
      const validAthletes = formRosterMembers
        .map((a) => a.name.trim())
        .filter(Boolean);
      compiledRoster = [p1, ...validAthletes];
    }

    // 6. Validação de Tamanho de Elenco (min_players e max_players)
    if (
      isTeamFormat &&
      activeTournament?.min_players &&
      compiledRoster.length < Number(activeTournament.min_players)
    ) {
      setFormError(
        `A equipe precisa ter no mínimo ${activeTournament.min_players} atletas.`
      );
      return;
    }
    if (
      isTeamFormat &&
      activeTournament?.max_players &&
      (compiledRoster.length > Number(activeTournament.max_players) ||
        formRosterMembers.length + 1 > Number(activeTournament.max_players))
    ) {
      setFormError(
        `A equipe ultrapassou o limite de ${activeTournament.max_players} atletas.`
      );
      return;
    }

    // 7. Formatação das respostas personalizadas
    const formattedCustomAnswers: Record<string, any> = {};
    for (const field of customFields) {
      const val = formCustomAnswers[field.label];
      if (field.type === "checkbox") {
        formattedCustomAnswers[field.label] = val === true || val === "Sim" ? "Sim" : "Não";
      } else if (val !== undefined && val !== null && String(val).trim() !== "") {
        formattedCustomAnswers[field.label] = String(val).trim();
      }
    }

    const selectedCategory = formCategory || defaultTournamentCategory;
    const isPaid = formPaymentStatus === "PAID";
    const statusVal = isPaid ? "PAID" : "PENDING";
    const paymentStatusVal = isPaid ? "PAID" : "PENDING";
    const resolvedSkillLevel = isAllSkillLevels
      ? formDeclaredSkillLevel || null
      : activeTournament?.skill_level || null;
    const skillLabelDisplay = formatSkillLevelLabel(resolvedSkillLevel);

    // Agrupa TODOS os campos do formulário que não são colunas nativas da tabela `teams` na estrutura JSONB (custom_responses)
    const compiledCustomResponses: Record<string, any> = {};

    if (formCaptainCpf.trim()) {
      compiledCustomResponses[isSoloFormat ? "CPF" : "CPF do Capitão"] = formCaptainCpf.trim();
    }
    if (formContact.trim()) {
      compiledCustomResponses[
        isSoloFormat
          ? "Contato (WhatsApp)"
          : isDuplasFormat
          ? "Contato do Capitão"
          : "Contato do Responsável"
      ] = formContact.trim();
    }
    if (formCaptainEmail.trim()) {
      compiledCustomResponses[
        isSoloFormat
          ? "E-mail"
          : isDuplasFormat
          ? "E-mail do Capitão"
          : "E-mail do Responsável"
      ] = formCaptainEmail.trim();
    }

    if (isDuplasFormat) {
      if (p2) {
        compiledCustomResponses["Jogador 2 (Parceiro)"] = p2;
      }
      if (formPartnerCpf.trim()) {
        compiledCustomResponses["CPF do Jogador 2"] = formPartnerCpf.trim();
      }
      if (formPartnerPhone.trim()) {
        compiledCustomResponses["Telefone do Jogador 2"] = formPartnerPhone.trim();
      }
      if (formPartnerEmail.trim()) {
        compiledCustomResponses["E-mail do Jogador 2"] = formPartnerEmail.trim();
      }
    } else if (isTeamFormat && formRosterMembers.length > 0) {
      formRosterMembers.forEach((ath, idx) => {
        const athName = ath.name.trim();
        if (!athName) return;
        const details: string[] = [];
        if (ath.cpf?.trim()) details.push(`CPF: ${ath.cpf.trim()}`);
        if (ath.phone?.trim()) details.push(`Tel: ${ath.phone.trim()}`);
        if (ath.email?.trim()) details.push(`E-mail: ${ath.email.trim()}`);
        if (details.length > 0) {
          compiledCustomResponses[`Atleta ${idx + 2} (${athName})`] = details.join(" | ");
        }
      });
    }

    if (skillLabelDisplay) {
      compiledCustomResponses["Nível Técnico"] = skillLabelDisplay;
    }

    Object.entries(formattedCustomAnswers).forEach(([k, v]) => {
      compiledCustomResponses[k] = v;
    });

    if (!effectiveTournamentId) {
      onAddTeam(
        finalName,
        p1,
        p2,
        compiledRoster,
        isSoloFormat ? "solo" : isDuplasFormat ? "duplas" : undefined,
        formPaymentStatus,
        selectedCategory
      );
      setShowAddModal(false);
      resetManualForm();
      setToastMessage(`${entitySingular} adicionad${isSoloFormat ? "o" : "a"} com sucesso!`);
      return;
    }

    setIsSubmittingManual(true);

    try {
      // Prepara integrantes padronizados para persistência em team_members e backup em JSONB
      const rawMembersToProcess: {
        name: string;
        email: string;
        is_captain: boolean;
        cpf?: string | null;
        phone?: string | null;
      }[] = [
        {
          name: p1,
          email: formCaptainEmail.trim().toLowerCase(),
          is_captain: true,
          cpf: formCaptainCpf.trim() || null,
          phone: formContact.trim() || null,
        },
      ];

      if (isDuplasFormat && p2) {
        rawMembersToProcess.push({
          name: p2,
          email: formPartnerEmail.trim().toLowerCase(),
          is_captain: false,
          cpf: formPartnerCpf.trim() || null,
          phone: formPartnerPhone.trim() || null,
        });
      } else if (isTeamFormat) {
        formRosterMembers.forEach((ath) => {
          if (ath.name.trim()) {
            rawMembersToProcess.push({
              name: ath.name.trim(),
              email: ath.email.trim().toLowerCase(),
              is_captain: false,
              cpf: ath.cpf?.trim() || null,
              phone: ath.phone?.trim() || null,
            });
          }
        });
      }

      // 1. Executa a Server Action `addManualTeam` (com Admin Client e persistência garantida em JSONB)
      const actionResult = await addManualTeam({
        tournamentId: effectiveTournamentId,
        name: finalName,
        managerName: p1,
        player1: p1,
        player2: p2 || "",
        roster: compiledRoster,
        contact: formContact.trim() || formCaptainEmail.trim() || "",
        captainEmail: formCaptainEmail.trim().toLowerCase(),
        category: selectedCategory,
        status: statusVal,
        paymentStatus: paymentStatusVal,
        declaredSkillLevel: resolvedSkillLevel,
        customResponses: compiledCustomResponses,
        members: rawMembersToProcess,
      });

      let insertedTeam: any = actionResult.team;

      // Fallback client-side caso o ambiente não possua SUPABASE_SERVICE_ROLE_KEY configurada
      if (!actionResult.success || !insertedTeam) {
        const jsonbPayload = {
          ...compiledCustomResponses,
          __athlete_members: rawMembersToProcess,
        };
        const payload: Record<string, any> = {
          name: finalName,
          manager_name: p1,
          player1: p1,
          player2: p2 || "",
          roster: compiledRoster,
          contact: formContact.trim() || formCaptainEmail.trim() || "",
          tournament_id: effectiveTournamentId,
          status: statusVal,
          payment_status: paymentStatusVal,
          category: selectedCategory,
          custom_registration_answers: jsonbPayload,
          declared_skill_level: resolvedSkillLevel,
        };

        const { data: fallbackTeam, error: insertError } = await supabase
          .from("teams")
          .insert(payload as any)
          .select()
          .single();

        if (insertError || !fallbackTeam) {
          console.error("Erro ao inserir inscrição manual em teams:", insertError || actionResult.error);
          throw insertError || new Error(actionResult.error || "Não foi possível registrar a inscrição no banco de dados.");
        }
        insertedTeam = fallbackTeam;
      }

      const localMembersForState: TeamMember[] = rawMembersToProcess.map((member, idx) => ({
        id: `${insertedTeam.id}-${idx}`,
        team_id: insertedTeam.id,
        user_id: null,
        name: member.name,
        email: member.email || "",
        is_captain: member.is_captain,
        cpf: member.cpf || undefined,
        phone: member.phone || undefined,
      }));

      const finalJsonbAnswers = {
        ...compiledCustomResponses,
        ...(insertedTeam.custom_registration_answers || {}),
        ...(insertedTeam.custom_responses || {}),
        ...compiledCustomResponses,
      };

      const mappedTeam: Team = {
        id: insertedTeam.id,
        name: insertedTeam.name,
        players: [insertedTeam.player1 || p1, insertedTeam.player2 || p2],
        roster: insertedTeam.roster || compiledRoster,
        format: isSoloFormat ? "solo" : isDuplasFormat ? "duplas" : undefined,
        createdAt: insertedTeam.created_at || new Date().toISOString(),
        source: "manual",
        status: insertedTeam.status,
        tournamentId: insertedTeam.tournament_id,
        payment_status: insertedTeam.payment_status,
        manager_name: insertedTeam.manager_name || p1,
        category: insertedTeam.category || selectedCategory,
        contact: insertedTeam.contact || formContact.trim(),
        custom_registration_answers: finalJsonbAnswers,
        custom_responses: finalJsonbAnswers,
        declared_skill_level:
          insertedTeam.declared_skill_level || resolvedSkillLevel,
      };

      setLocalTeams((prev) => [...prev, mappedTeam]);
      setTeams?.((prev: Team[]) => [...prev, mappedTeam]);
      setTeamMembersMap((prev) => ({
        ...prev,
        [insertedTeam.id]: localMembersForState,
      }));

      setShowAddModal(false);
      resetManualForm();
      setToastMessage(`${entitySingular} adicionad${isSoloFormat ? "o" : "a"} com sucesso!`);
      setTimeout(() => {
        fetchTeamsFromDb();
      }, 400);
    } catch (err: any) {
      console.error("Erro ao registrar inscrição manual:", err);
      setFormError(err?.message || "Erro ao registrar inscrição. Verifique os dados e tente novamente.");
    } finally {
      setIsSubmittingManual(false);
    }
  };

  return (
    <div className="w-full min-w-0 space-y-6 text-[#e4e4e7] animate-fadeIn pb-12">
      {/* Toast de Erro (Vermelho) */}
      {errorToastMessage && (
        <div className="fixed bottom-6 right-6 z-50 p-4 rounded-xl bg-red-950/95 border border-red-500/60 text-red-100 text-xs font-bold shadow-2xl shadow-red-950/50 flex items-center gap-3 animate-fadeIn max-w-md">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
          <span className="leading-relaxed">{errorToastMessage}</span>
          <button
            onClick={() => setErrorToastMessage(null)}
            className="p-1 text-red-300 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Toast de Notificação */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 p-4 rounded-xl bg-zinc-900 border border-blue-500/40 text-white text-xs font-bold shadow-2xl flex items-center gap-3 animate-fadeIn">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="p-1 text-zinc-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 1. Cabeçalho e Estatísticas */}
      <div className="space-y-4">
        {/* Topo do Cabeçalho */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#27272a] pb-4">
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-yellow-500 block mb-0.5">
              Painel do Organizador
            </span>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-black text-white font-display tracking-tight uppercase">
                Gestão de Inscrições
              </h1>
            </div>
          </div>

          {/* Botões Superiores: Filtrar, Exportar CSV, Toggle Grade/Lista, Cancelamentos e Conferir Comprovantes */}
          <div className="flex flex-col md:flex-row flex-wrap items-stretch md:items-center gap-3 w-full md:w-auto">
            {cancellationCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowFilterBar(true);
                  setStatusFilter("CANCELLATIONS");
                }}
                className="w-full md:w-auto justify-center inline-flex items-center gap-1.5 px-3 py-2.5 md:py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/35 text-red-400 text-xs font-bold transition-all cursor-pointer shadow-sm animate-pulse"
                title="Ver equipes com cancelamento solicitado pelo atleta"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{cancellationCount} Cancelamento{cancellationCount > 1 ? "s" : ""}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowFilterBar((prev) => !prev)}
              className={`w-full md:w-auto justify-center inline-flex items-center gap-2 px-3.5 py-2.5 md:py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95 ${
                showFilterBar || statusFilter !== "ALL" || searchQuery
                  ? "bg-zinc-800 border-blue-500/50 text-blue-400"
                  : "bg-[#1e1e1e] hover:bg-zinc-800 border-[#27272a] text-zinc-300 hover:text-white"
              }`}
            >
              <Filter className="h-3.5 w-3.5" />
              <span>Filtrar</span>
            </button>

            <button
              type="button"
              onClick={handleExportCSV}
              disabled={localTeams.length === 0}
              className="w-full md:w-auto justify-center inline-flex items-center gap-2 px-3.5 py-2.5 md:py-2 rounded-xl bg-[#1e1e1e] hover:bg-zinc-800 border border-[#27272a] hover:border-emerald-500/40 text-zinc-200 hover:text-emerald-400 text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Exportar todos os dados dos inscritos em formato de planilha CSV"
            >
              <Download className="h-3.5 w-3.5 text-emerald-400" />
              <span>Baixar Planilha CSV</span>
            </button>

            {/* Toggle de Visualização: Grade (Cards) vs. Lista (Tabela) */}
            <div
              className="w-full md:w-auto flex items-center p-1 rounded-xl bg-[#18181b] border border-[#27272a]"
              role="group"
              aria-label="Modo de visualização"
            >
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                className={`flex-1 md:flex-initial justify-center inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  viewMode === "cards"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-zinc-400 hover:text-white"
                }`}
                title="Visualização em Grade (Cards)"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>Grade</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`flex-1 md:flex-initial justify-center inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  viewMode === "table"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-zinc-400 hover:text-white"
                }`}
                title="Visualização em Lista (Tabela)"
              >
                <List className="h-3.5 w-3.5" />
                <span>Lista</span>
              </button>
            </div>

            {hasFinancialAccess &&
              !isReadOnly &&
              onCloseRegistrations &&
              tournamentStatus !== "CLOSED" &&
              tournamentStatus !== "IN_PROGRESS" &&
              tournamentStatus !== "EM_ANDAMENTO" &&
              tournamentStatus !== "LIVE" && (
                <button
                  type="button"
                  onClick={onCloseRegistrations}
                  className="w-full md:w-auto justify-center inline-flex items-center gap-1.5 px-3.5 py-2.5 md:py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 hover:text-red-300 font-bold text-xs uppercase tracking-wider transition-all shadow-sm active:scale-95 cursor-pointer"
                  title="Encerrar inscrições para impedir novos registros ou pagamentos"
                >
                  <Lock className="h-3.5 w-3.5" />
                  <span>Encerrar Inscrições</span>
                </button>
              )}

            <button
              type="button"
              onClick={() => setShowProofReviewModal(true)}
              className="w-full md:w-auto justify-center inline-flex items-center gap-2 px-4 py-2.5 md:py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-blue-600/20 active:scale-95 cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Conferir Comprovantes</span>
              {teamsToReview.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-blue-800 text-[10px] text-white font-black">
                  {teamsToReview.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Barra de Filtros Expansível */}
        {showFilterBar && (
          <div className="p-4 bg-[#18181b] border border-zinc-800 rounded-2xl space-y-3 animate-fadeIn">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por equipe, responsável ou jogador..."
                  className="w-full pl-10 pr-4 py-2.5 bg-[#0f0f0f] border border-zinc-800 focus:border-blue-500 rounded-xl text-xs text-white placeholder:text-zinc-500 outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
                {[
                  { id: "ALL", label: "Todos" },
                  { id: "APPROVED", label: "Pagos" },
                  { id: "PENDING", label: "Pendentes" },
                  { id: "WAITING_PIX", label: "Aguardando Pix" },
                  ...(cancellationCount > 0
                    ? [{ id: "CANCELLATIONS", label: `Cancelamentos (${cancellationCount})` }]
                    : []),
                ].map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setStatusFilter(st.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                      statusFilter === st.id
                        ? st.id === "CANCELLATIONS"
                          ? "bg-red-600 text-white shadow-md shadow-red-500/20"
                          : "bg-blue-600 text-white"
                        : "bg-zinc-800/80 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Grid de Estatísticas (2x2) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* 1. Total Inscritos */}
          <div className="bg-[#1e1e1e] border border-zinc-800 border-l-4 border-l-blue-500 rounded-2xl p-4 sm:p-5 shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-zinc-400">
                Total Inscritos
              </span>
              <Users className="h-4 w-4 text-blue-500" />
            </div>
            <div className="text-3xl sm:text-4xl font-black text-white font-display">
              {stats.total}
            </div>
            <span className="text-[10px] text-zinc-500 mt-1 block">
              {entitySingular.toLowerCase()}s cadastradas
            </span>
          </div>

          {/* 2. Pagos */}
          <div className="bg-[#1e1e1e] border border-zinc-800 border-l-4 border-l-emerald-500 rounded-2xl p-4 sm:p-5 shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-zinc-400">
                Pagos
              </span>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="text-3xl sm:text-4xl font-black text-emerald-400 font-display">
              {stats.paid}
            </div>
            <span className="text-[10px] text-emerald-500/70 mt-1 block font-semibold">
              Inscrições aprovadas
            </span>
          </div>

          {/* 3. Pendentes */}
          <div className="bg-[#1e1e1e] border border-zinc-800 border-l-4 border-l-yellow-500 rounded-2xl p-4 sm:p-5 shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-zinc-400">
                Pendentes
              </span>
              <Clock className="h-4 w-4 text-yellow-400" />
            </div>
            <div className="text-3xl sm:text-4xl font-black text-yellow-400 font-display">
              {stats.pending}
            </div>
            <span className="text-[10px] text-yellow-500/70 mt-1 block font-semibold">
              Aguardando confirmação
            </span>
          </div>

          {/* 4. Aguardando Pix */}
          <div className="bg-[#1e1e1e] border border-zinc-800 border-l-4 border-l-orange-500 rounded-2xl p-4 sm:p-5 shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-zinc-400">
                Aguardando Pix
              </span>
              <Receipt className="h-4 w-4 text-orange-400" />
            </div>
            <div className="text-3xl sm:text-4xl font-black text-orange-400 font-display">
              {stats.waitingPix}
            </div>
            <span className="text-[10px] text-orange-400/70 mt-1 block font-semibold">
              Comprovantes enviados
            </span>
          </div>
        </div>
      </div>

      {/* 2. Lista de Inscrições (Team Cards Verticais) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-wider text-zinc-300">
            Equipes e Participantes ({filteredTeams.length})
          </h2>
          {onGenerateBracket && localTeams.length >= 2 && (
            <button
              type="button"
              onClick={onGenerateBracket}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600 text-[#00a2ff] hover:text-white border border-blue-500/30 text-xs font-bold transition-all cursor-pointer shadow-sm"
            >
              <Trophy className="h-3.5 w-3.5" />
              <span>Gerar Chaveamento</span>
            </button>
          )}
        </div>

        {viewMode === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {filteredTeams.map((team) => {
            const pStatus =
              team.payment_status ||
              (team.status === "CONFIRMED" || team.status === "PAID" ? "PAID" : "PENDING");
            const isApproved = pStatus === "PAID" || pStatus === "APPROVED" || team.status === "CONFIRMED" || team.status === "PAID";
            const isWaitingApproval = !isApproved && (pStatus === "WAITING_APPROVAL" || Boolean(team.payment_proof_url));
            const isWaitingPix = !isApproved && !isWaitingApproval && pStatus === "WAITING_PIX";
            const isPending = !isApproved && !isWaitingApproval && !isWaitingPix;

            const isRefundRequested = team.cancellation_status === "REFUND_REQUESTED";
            const isCancellationRequested = team.cancellation_status === "REQUESTED_BY_ATHLETE" || isRefundRequested;

            const manager = team.manager_name || team.players[0] || "Não informado";
            const category = team.category || defaultTournamentCategory;

            return (
              <div
                key={team.id}
                className={`rounded-2xl p-5 flex flex-col justify-between shadow-xl transition-all group relative ${
                  isCancellationRequested
                    ? "bg-[#180a0a] border-2 border-red-600/90 shadow-red-950/40"
                    : "bg-[#1a1a1a] border border-zinc-800/90 hover:border-zinc-700"
                }`}
              >
                {/* Linha Superior: Avatar/Ícone, Nome, Categoria e Status Badge */}
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      {/* Avatar com Ícone Esportivo e Link para o Perfil */}
                      {team.user_id ? (
                        <Link
                          href={`/atleta/${team.user_id}`}
                          title={`Ver perfil do atleta`}
                          className="w-11 h-11 rounded-xl bg-zinc-800/90 border border-zinc-700 hover:border-amber-400/60 flex items-center justify-center text-lg shadow-inner group-hover:scale-105 transition-all shrink-0 cursor-pointer"
                        >
                          {sportIcon}
                        </Link>
                      ) : (
                        <div className="w-11 h-11 rounded-xl bg-zinc-800/90 border border-zinc-700 flex items-center justify-center text-lg shadow-inner group-hover:scale-105 transition-transform shrink-0">
                          {sportIcon}
                        </div>
                      )}
                      <div>
                        <h3 className="font-display font-black text-base text-white group-hover:text-blue-400 transition-colors line-clamp-1">
                          {team.user_id ? (
                            <Link href={`/atleta/${team.user_id}`} className="hover:underline">
                              {team.name}
                            </Link>
                          ) : (
                            team.name
                          )}
                        </h3>
                        <span className="inline-block px-2 py-0.5 rounded bg-zinc-800/80 text-[10px] font-bold text-zinc-400 mt-0.5">
                          {category}
                        </span>
                      </div>
                    </div>

                    {/* Status Badge - Máxima Prioridade ao Cancelamento Solicitado */}
                    <div className="shrink-0">
                      {isRefundRequested ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-950 border border-red-500 text-red-200 text-[10px] font-black uppercase tracking-wider shadow-sm animate-pulse">
                          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                          <span>CANCELAMENTO COM REEMBOLSO</span>
                        </span>
                      ) : team.cancellation_status === "REQUESTED_BY_ATHLETE" ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-950 border border-red-600 text-red-200 text-[10px] font-black uppercase tracking-wider shadow-sm animate-pulse">
                          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                          <span>CANCELAMENTO SOLICITADO</span>
                        </span>
                      ) : team.status === "PAID" || pStatus === "PAID" ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400 text-emerald-300 text-[10px] font-black uppercase tracking-wider shadow-sm">
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          <span>Pago (Confirmado)</span>
                        </span>
                      ) : isApproved ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400 text-emerald-300 text-[10px] font-black uppercase tracking-wider shadow-sm">
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          <span>Aprovado</span>
                        </span>
                      ) : isWaitingApproval ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/25 text-blue-400 text-[10px] font-black uppercase tracking-wider">
                          <Clock className="h-3 w-3 animate-pulse" />
                          <span>Em Análise</span>
                        </span>
                      ) : isWaitingPix ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-500/10 border border-orange-500/25 text-orange-400 text-[10px] font-black uppercase tracking-wider">
                          <Clock className="h-3 w-3 animate-pulse" />
                          <span>Aguardando Pix</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/25 text-yellow-400 text-[10px] font-black uppercase tracking-wider">
                          <AlertCircle className="h-3 w-3" />
                          <span>Pendente</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Informações: Responsável e Data */}
                  <div className="p-3 rounded-xl bg-[#121214] border border-zinc-800/80 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-zinc-400">
                      <span className="font-medium text-zinc-500">Responsável:</span>
                      {team.user_id ? (
                        <Link
                          href={`/atleta/${team.user_id}`}
                          title="Ver perfil do atleta"
                          className="font-bold text-zinc-200 hover:text-amber-400 hover:underline truncate max-w-[140px] flex items-center gap-1 transition-colors"
                        >
                          <span className="truncate">{manager}</span>
                          <ExternalLink className="h-3 w-3 text-amber-400/80 shrink-0" />
                        </Link>
                      ) : (
                        <span className="font-bold text-zinc-200 truncate max-w-[140px]">
                          {manager}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-zinc-400">
                      <span className="font-medium text-zinc-500">Data:</span>
                      <span className="font-bold text-zinc-300">
                        {formatDate(team.createdAt)}
                      </span>
                    </div>

                    {/* Jogador 2 ou Roster (se houver) */}
                    {/* Jogador 2 ou Roster (se houver) */}
                    {team.players && team.players[1] ? (
                      <div className="flex items-center justify-between text-zinc-400 pt-1 border-t border-zinc-800/50">
                        <span className="font-medium text-zinc-500">Dupla:</span>
                        <span className="font-bold text-zinc-300 truncate max-w-[140px]">
                          {team.players[1]}
                        </span>
                      </div>
                    ) : getTeamRosterList(team).filter((m) => !m.is_captain).length > 0 ? (
                      <div className="pt-1.5 border-t border-zinc-800/50 space-y-1">
                        <span className="font-medium text-zinc-500 block text-[11px]">
                          Atletas da Equipe ({getTeamRosterList(team).filter((m) => !m.is_captain).length}):
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {getTeamRosterList(team)
                            .filter((m) => !m.is_captain)
                            .map((m, mIdx) => (
                              <span
                                key={m.id || mIdx}
                                className="px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-[11px] font-semibold text-zinc-300 truncate max-w-full"
                              >
                                {m.name}
                              </span>
                            ))}
                        </div>
                      </div>
                    ) : null}
                    {false && team.players && team.players[1] && (
                      <div className="flex items-center justify-between text-zinc-400 pt-1 border-t border-zinc-800/50">
                        <span className="font-medium text-zinc-500">Dupla:</span>
                        <span className="font-bold text-zinc-300 truncate max-w-[140px]">
                          {team.players[1]}
                        </span>
                      </div>
                    )}

                    {/* Alerta Visual de Cancelamento com Reembolso Solicitado e Contato do Atleta */}
                    {isCancellationRequested && (
                      <div className="p-3 rounded-xl bg-red-950/70 border border-red-500/60 text-red-200 text-xs space-y-2 shadow-md animate-fadeIn mt-2">
                        <div className="flex items-center gap-1.5 font-black text-red-400 uppercase tracking-wider text-[11px]">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                          <span>
                            {isRefundRequested
                              ? "Cancelamento Pós-Pagamento (Reembolso Solicitado)"
                              : "Cancelamento Solicitado"}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-300 leading-snug">
                          {isRefundRequested
                            ? "O atleta pagou e solicitou cancelamento da vaga. Entre em contato para combinar a devolução do valor:"
                            : "O atleta solicitou o cancelamento da inscrição:"}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          {team.contact ? (
                            <a
                              href={`https://wa.me/${team.contact.replace(/\D/g, "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[11px] transition-all shadow-sm cursor-pointer"
                              title="Abrir WhatsApp para combinar a devolução"
                            >
                              <Phone className="h-3.5 w-3.5" />
                              <span>WhatsApp: {team.contact}</span>
                            </a>
                          ) : (
                            <span className="text-[11px] text-zinc-400 italic">Telefone não informado</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 2. Acordeão: Ver Elenco / Atletas da Equipe (team_members) */}
                    <div className="pt-2 border-t border-zinc-800/60">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTeamRoster(team.id);
                        }}
                        className="w-full py-1.5 px-2.5 rounded-lg bg-zinc-900/60 hover:bg-zinc-800/60 border border-zinc-800 text-[11px] font-bold text-zinc-300 hover:text-white transition-all flex items-center justify-between cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-blue-400" />
                          <span>Ver Elenco/Atletas</span>
                          {getTeamRosterList(team).length > 0 && (
                            <span className="px-1.5 py-0.2 rounded-full bg-blue-500/15 text-blue-400 text-[10px] font-black">
                              {getTeamRosterList(team).length}
                            </span>
                          )}
                          {false && (teamMembersMap[team.id]?.length || team.players?.filter(Boolean).length || 0) > 0 && (
                            <span className="px-1.5 py-0.2 rounded-full bg-blue-500/15 text-blue-400 text-[10px] font-black">
                              {teamMembersMap[team.id]?.length || team.players?.filter(Boolean).length || 0}
                            </span>
                          )}
                        </div>
                        {expandedRosterIds[team.id] ? (
                          <ChevronUp className="h-3.5 w-3.5 text-zinc-400" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                        )}
                      </button>

                      {/* Conteúdo Expandido do Acordeão */}
                      {expandedRosterIds[team.id] && (
                        <div className="mt-2 p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/90 space-y-2 animate-fadeIn">
                          {getTeamRosterList(team).length > 0 ? (
                            <div className="space-y-1.5">
                              {getTeamRosterList(team).map((member, idx) => (
                                <div
                                  key={member.id || idx}
                                  className="p-2 rounded-lg bg-zinc-900/80 border border-zinc-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs"
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-bold text-zinc-100 truncate">
                                        {member.name}
                                      </span>
                                      {member.is_captain && (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-amber-500/15 border border-amber-500/30 text-amber-300">
                                          Capitão
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-zinc-400 truncate flex items-center gap-1 mt-0.5">
                                      <Mail className="h-2.5 w-2.5 text-zinc-500 shrink-0" />
                                      <span>{member.email || "E-mail não informado"}</span>
                                    </div>
                                    {(member.cpf || member.phone) && (
                                      <div className="text-[10px] text-zinc-400 flex flex-wrap items-center gap-2 mt-0.5">
                                        {member.cpf && <span>CPF: {member.cpf}</span>}
                                        {member.phone && <span>WhatsApp: {member.phone}</span>}
                                      </div>
                                    )}
                                  </div>

                                  <div className="shrink-0 self-start sm:self-auto pt-0.5 sm:pt-0">
                                    {member.user_id ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold shadow-sm">
                                        <UserCheck className="h-2.5 w-2.5" />
                                        <span>Conta Vinculada</span>
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-bold">
                                        <Clock className="h-2.5 w-2.5" />
                                        <span>Convite Pendente</span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : false && teamMembersMap[team.id] && teamMembersMap[team.id].length > 0 ? (
                            <div className="space-y-1.5">
                              {teamMembersMap[team.id].map((member, idx) => (
                                <div
                                  key={member.id || idx}
                                  className="p-2 rounded-lg bg-zinc-900/80 border border-zinc-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs"
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-bold text-zinc-100 truncate">
                                        {member.name}
                                      </span>
                                      {member.is_captain && (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-amber-500/15 border border-amber-500/30 text-amber-300">
                                          Capitão
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-zinc-400 truncate flex items-center gap-1 mt-0.5">
                                      <Mail className="h-2.5 w-2.5 text-zinc-500 shrink-0" />
                                      <span>{member.email || "E-mail não informado"}</span>
                                    </div>
                                  </div>

                                  {/* Status do atleta: se o usuário já tem conta ou é convite pendente */}
                                  <div className="shrink-0 self-start sm:self-auto pt-0.5 sm:pt-0">
                                    {member.user_id ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold shadow-sm">
                                        <UserCheck className="h-2.5 w-2.5" />
                                        <span>Conta Vinculada</span>
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-bold">
                                        <Clock className="h-2.5 w-2.5" />
                                        <span>Convite Pendente</span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : team.players && team.players.filter(Boolean).length > 0 ? (
                            <div className="space-y-1.5">
                              {team.players.filter(Boolean).map((playerName, pIdx) => {
                                const isCap = pIdx === 0;
                                const hasAccount = isCap && Boolean(team.user_id);
                                return (
                                  <div
                                    key={pIdx}
                                    className="p-2 rounded-lg bg-zinc-900/80 border border-zinc-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs"
                                  >
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-bold text-zinc-100 truncate">
                                          {playerName}
                                        </span>
                                        {isCap && (
                                          <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-amber-500/15 border border-amber-500/30 text-amber-300">
                                            Capitão
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[10px] text-zinc-400 truncate flex items-center gap-1 mt-0.5">
                                        <Mail className="h-2.5 w-2.5 text-zinc-500 shrink-0" />
                                        <span>{isCap && team.contact ? team.contact : "E-mail não informado"}</span>
                                      </div>
                                    </div>

                                    <div className="shrink-0 self-start sm:self-auto pt-0.5 sm:pt-0">
                                      {hasAccount ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold shadow-sm">
                                          <UserCheck className="h-2.5 w-2.5" />
                                          <span>Conta Vinculada</span>
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-bold">
                                          <Clock className="h-2.5 w-2.5" />
                                          <span>Convite Pendente</span>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="py-2 text-center text-[11px] text-zinc-400">
                              <span>Nenhum atleta detalhado na equipe.</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Botão de Ação Inferior */}
                <div className="mt-5 pt-3 border-t border-zinc-800/80 space-y-2">
                  {/* Botão Individual: Ver Recibo (Abre modal de visualização do comprovante) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openReceiptModal(team);
                    }}
                    className="w-full py-2 px-3 rounded-xl border border-zinc-700 hover:border-zinc-500 bg-transparent hover:bg-zinc-800/60 text-xs font-bold text-zinc-300 hover:text-white transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                    title="Visualizar comprovante de pagamento Pix"
                  >
                    <Receipt className="h-3.5 w-3.5 text-blue-400" />
                    <span>Ver Recibo</span>
                  </button>

                  {isCancellationRequested ? (
                    hasFinancialAccess && !isReadOnly ? (
                      <div className="space-y-2">
                        <button
                          type="button"
                          disabled={isRefundingId === team.id}
                          onClick={() => handleRefundTeam(team.id)}
                          className="w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-red-600/30 active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          {isRefundingId === team.id ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span>Estornando...</span>
                            </>
                          ) : (
                            <>
                              <RotateCcw className="h-4 w-4" />
                              <span>Confirmar Cancelamento e Estornar</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          disabled={isDeletingTeamId === team.id}
                          onClick={() => handleDeleteOrFreeSpot(team)}
                          className="w-full py-2 px-3 rounded-xl border border-red-500/30 hover:border-red-500/60 bg-red-500/5 hover:bg-red-500/15 text-red-400 hover:text-red-300 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          <span>Libertar Vaga Imediatamente</span>
                        </button>
                      </div>
                    ) : (
                      <div className="p-2.5 rounded-xl bg-red-950/40 border border-red-800/40 text-red-300 text-[11px] font-medium text-center">
                        Cancelamento Solicitado • Requer Organizador para estorno
                      </div>
                    )
                  ) : (
                    <>
                      {isApproved && (
                        <button
                          type="button"
                          onClick={() => setSelectedTeamDetails(team)}
                          className="w-full py-2.5 px-4 rounded-xl border border-zinc-700 hover:border-zinc-500 bg-transparent text-zinc-300 hover:text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer hover:bg-zinc-800/40"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Ver Detalhes</span>
                        </button>
                      )}

                      {isWaitingPix && hasFinancialAccess && !isReadOnly && (
                        <button
                          type="button"
                          disabled={isApprovingId === team.id}
                          onClick={() => handleApprovePix(team.id)}
                          className="w-full py-2.5 px-4 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-neutral-950 font-black text-xs uppercase tracking-wider transition-all shadow-md shadow-yellow-500/20 active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          {isApprovingId === team.id ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              <span>Aprovando & Repassando...</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Aprovar Pix</span>
                            </>
                          )}
                        </button>
                      )}

                      {isWaitingPix && (!hasFinancialAccess || isReadOnly) && (
                        <button
                          type="button"
                          onClick={() => setSelectedTeamDetails(team)}
                          className="w-full py-2 px-3 rounded-xl border border-zinc-700 bg-transparent text-zinc-400 text-xs font-bold flex items-center justify-center gap-1.5"
                        >
                          <Clock className="h-3.5 w-3.5 text-orange-400" />
                          <span>Aguardando Pix</span>
                        </button>
                      )}

                      {isPending && (
                        <button
                          type="button"
                          onClick={() => setSelectedTeamDetails(team)}
                          className="w-full py-2.5 px-4 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-neutral-950 font-black text-xs uppercase tracking-wider transition-all shadow-md shadow-yellow-500/20 active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Receipt className="h-3.5 w-3.5" />
                          <span>Conferir Pix</span>
                        </button>
                      )}

                      {/* Botão Vermelho: Excluir / Libertar Vaga para Pendentes e Aguardando Pix */}
                      {(isPending || isWaitingPix) && canRemove && (
                        <button
                          type="button"
                          disabled={isDeletingTeamId === team.id}
                          onClick={() => handleDeleteOrFreeSpot(team)}
                          className="w-full py-2 px-3 rounded-xl border border-red-500/30 hover:border-red-500/60 bg-red-500/5 hover:bg-red-500/15 text-red-400 hover:text-red-300 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
                          title="Excluir inscrição pendente e libertar vaga na competição"
                        >
                          {isDeletingTeamId === team.id ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              <span>Libertando Vaga...</span>
                            </>
                          ) : (
                            <>
                              <Trash2 className="h-3.5 w-3.5 text-red-400" />
                              <span>Excluir / Libertar Vaga</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Botão Vermelho Direto no Card: Remover Inscrição (Confirmadas / Canceladas) */}
                      {!(isPending || isWaitingPix) && canRemove && (
                        <button
                          type="button"
                          disabled={isDeletingTeamId === team.id}
                          onClick={() => {
                            setSelectedTeamDetails(team);
                            setShowDeleteConfirmModal(true);
                          }}
                          className="w-full py-2 px-3 rounded-xl border border-red-500/30 hover:border-red-500/60 bg-red-500/5 hover:bg-red-500/15 text-red-400 hover:text-red-300 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
                          title="Remover / Excluir inscrição desta equipe do torneio"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          <span>Remover Inscrição</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {/* 3. Card Especial Tracejado: Adicionar Time Manualmente */}
          {!isReadOnly && (
            <div
              onClick={() => setShowAddModal(true)}
              className="border-2 border-dashed border-zinc-700 hover:border-yellow-500 bg-zinc-900/30 hover:bg-zinc-900/60 transition-all duration-300 cursor-pointer rounded-2xl min-h-[200px] flex flex-col items-center justify-center p-6 text-center group shadow-md"
            >
              <div className="w-12 h-12 rounded-2xl bg-zinc-800/80 group-hover:bg-yellow-500 group-hover:text-neutral-950 border border-zinc-700 group-hover:border-yellow-500 text-zinc-300 flex items-center justify-center mb-3 transition-all duration-300 group-hover:scale-110 shadow-lg">
                <Plus className="h-6 w-6" />
              </div>
              <h4 className="font-display font-black text-sm text-white group-hover:text-yellow-400 transition-colors uppercase tracking-wide">
                Adicionar {entitySingular} Manualmente
              </h4>
              <p className="text-[11px] text-zinc-500 mt-1 max-w-[200px] leading-relaxed">
                Insira atletas diretamente na tabela da competição.
              </p>
            </div>
          )}
        </div>
        ) : (
          <div className="bg-[#1a1a1a] border border-zinc-800/90 rounded-2xl overflow-hidden shadow-xl w-full">
            <div className="overflow-x-auto whitespace-nowrap w-full">
              <table className="w-full min-w-[1100px] text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-[#121214] border-b border-zinc-800 text-[11px] font-black uppercase tracking-wider text-zinc-400">
                    {/* Bloco da Equipe */}
                    <th className="py-3.5 px-4 whitespace-nowrap">{teamNameCol}</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Categoria</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Nível Técnico</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Status Financeiro</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Data de Inscrição</th>

                    {/* Bloco do Atleta 1 */}
                    <th className="py-3.5 px-4 whitespace-nowrap">Atleta 1 / Capitão</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">E-mail do Capitão</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">CPF do Capitão</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Contato/Telefone</th>

                    {/* Bloco do Atleta 2 */}
                    <th className="py-3.5 px-4 whitespace-nowrap">Atleta 2 (Parceiro)</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">E-mail do Jogador 2</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">CPF do Jogador 2</th>

                    {/* Outros */}
                    {otherCustomColumns.map((colKey) => (
                      <th key={colKey} className="py-3.5 px-4 whitespace-nowrap">
                        {colKey}
                      </th>
                    ))}

                    <th className="py-3.5 px-4 text-right whitespace-nowrap">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70 text-xs">
                  {filteredTeams.length === 0 ? (
                    <tr>
                      <td
                        colSpan={13 + otherCustomColumns.length}
                        className="py-10 px-4 text-center text-zinc-500 font-medium"
                      >
                        Nenhuma inscrição encontrada para o filtro selecionado.
                      </td>
                    </tr>
                  ) : (
                    filteredTeams.map((team) => {
                      const pStatus =
                        team.payment_status ||
                        (team.status === "CONFIRMED" || team.status === "PAID" ? "PAID" : "PENDING");
                      const isApproved =
                        pStatus === "PAID" ||
                        pStatus === "APPROVED" ||
                        team.status === "CONFIRMED" ||
                        team.status === "PAID";
                      const isWaitingApproval =
                        !isApproved && (pStatus === "WAITING_APPROVAL" || Boolean(team.payment_proof_url));
                      const isWaitingPix = !isApproved && !isWaitingApproval && pStatus === "WAITING_PIX";

                      const isRefundRequested = team.cancellation_status === "REFUND_REQUESTED";
                      const isCancellationRequested =
                        team.cancellation_status === "REQUESTED_BY_ATHLETE" || isRefundRequested;

                      const category = team.category || defaultTournamentCategory;
                      const roster = getTeamRosterList(team);
                      const captainMember = roster.find((m) => m.is_captain) || roster[0] || null;
                      const partnerMember = roster.filter((m) => !m.is_captain)[0] || null;
                      const teamCustomResponses = getTeamCustomResponses(team);

                      // Bloco da Equipe
                      const skillLevel =
                        formatSkillLevelLabel(team.declared_skill_level) ||
                        teamCustomResponses["Nível Técnico"] ||
                        "";

                      // Bloco do Atleta 1 (prioriza nome vindo da relação da tabela, fallback responsável)
                      const athlete1Name =
                        captainMember?.name || team.players?.[0] || team.manager_name || "";
                      const captainEmail =
                        captainMember?.email ||
                        teamCustomResponses["E-mail do Capitão"] ||
                        teamCustomResponses["E-mail"] ||
                        teamCustomResponses["E-mail do Responsável"] ||
                        teamCustomResponses["E-mail do Jogador"] ||
                        (team.contact && team.contact.includes("@") ? team.contact : "") ||
                        "";
                      const captainCpf =
                        captainMember?.cpf ||
                        teamCustomResponses["CPF do Capitão"] ||
                        teamCustomResponses["CPF"] ||
                        teamCustomResponses["CPF do Atleta"] ||
                        teamCustomResponses["CPF do Responsável"] ||
                        "";
                      const captainContact =
                        captainMember?.phone ||
                        teamCustomResponses["Contato/Telefone"] ||
                        teamCustomResponses["Contato (WhatsApp)"] ||
                        teamCustomResponses["Contato do Capitão"] ||
                        teamCustomResponses["Contato do Responsável"] ||
                        (team.contact && !team.contact.includes("@") ? team.contact : "") ||
                        team.phone ||
                        team.manager_phone ||
                        "";

                      // Bloco do Atleta 2
                      const athlete2Name =
                        partnerMember?.name ||
                        team.players?.[1] ||
                        teamCustomResponses["Jogador 2 (Parceiro)"] ||
                        "";
                      const partnerEmail =
                        partnerMember?.email ||
                        teamCustomResponses["E-mail do Jogador 2"] ||
                        teamCustomResponses["E-mail do Parceiro (Jogador 2)"] ||
                        "";
                      const partnerCpf =
                        partnerMember?.cpf ||
                        teamCustomResponses["CPF do Jogador 2"] ||
                        "";

                      return (
                        <tr
                          key={team.id}
                          className={`transition-colors ${
                            isCancellationRequested
                              ? "bg-red-950/20 hover:bg-red-950/30"
                              : "hover:bg-zinc-900/60"
                          }`}
                        >
                          {/* 1. Bloco da Equipe */}
                          <td className="py-3.5 px-4 font-bold text-white whitespace-nowrap">
                            <div className="flex items-center gap-2.5">
                              <span className="w-7 h-7 rounded-lg bg-zinc-800/90 border border-zinc-700 flex items-center justify-center text-xs shrink-0">
                                {sportIcon}
                              </span>
                              <span className="truncate max-w-[200px]" title={team.name}>
                                {team.name}
                              </span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-amber-400 font-bold whitespace-nowrap">
                            {category}
                          </td>
                          <td className="py-3.5 px-4 text-zinc-300 font-medium whitespace-nowrap">
                            {skillLevel || "—"}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {isRefundRequested ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-950 border border-red-500 text-red-200 text-[10px] font-black uppercase tracking-wider">
                                <AlertTriangle className="h-3 w-3 text-red-400" />
                                <span>Cancelamento c/ Reembolso</span>
                              </span>
                            ) : team.cancellation_status === "REQUESTED_BY_ATHLETE" ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-950 border border-red-600 text-red-200 text-[10px] font-black uppercase tracking-wider">
                                <AlertTriangle className="h-3 w-3 text-red-400" />
                                <span>Cancelamento Solicitado</span>
                              </span>
                            ) : team.status === "PAID" || pStatus === "PAID" ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400 text-emerald-300 text-[10px] font-black uppercase tracking-wider">
                                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                                <span>Pago (Confirmado)</span>
                              </span>
                            ) : isApproved ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400 text-emerald-300 text-[10px] font-black uppercase tracking-wider">
                                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                                <span>Aprovado</span>
                              </span>
                            ) : isWaitingApproval ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/25 text-blue-400 text-[10px] font-black uppercase tracking-wider">
                                <Clock className="h-3 w-3" />
                                <span>Em Análise</span>
                              </span>
                            ) : isWaitingPix ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-500/10 border border-orange-500/25 text-orange-400 text-[10px] font-black uppercase tracking-wider">
                                <Clock className="h-3 w-3" />
                                <span>Aguardando Pix</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/25 text-yellow-400 text-[10px] font-black uppercase tracking-wider">
                                <AlertCircle className="h-3 w-3" />
                                <span>Pendente</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-zinc-400 font-medium whitespace-nowrap">
                            {formatDate(team.createdAt)}
                          </td>

                          {/* 2. Bloco do Atleta 1 */}
                          <td className="py-3.5 px-4 font-bold text-zinc-100 whitespace-nowrap">
                            {team.user_id ? (
                              <Link
                                href={`/atleta/${team.user_id}`}
                                className="hover:text-amber-400 hover:underline inline-flex items-center gap-1 transition-colors"
                                title="Ver perfil do atleta"
                              >
                                <span>{athlete1Name || "—"}</span>
                                <ExternalLink className="h-3 w-3 text-amber-400/80 shrink-0" />
                              </Link>
                            ) : (
                              <span>{athlete1Name || "—"}</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-zinc-300 font-medium whitespace-nowrap">
                            {captainEmail || "—"}
                          </td>
                          <td className="py-3.5 px-4 text-zinc-300 font-medium whitespace-nowrap">
                            {captainCpf || "—"}
                          </td>
                          <td className="py-3.5 px-4 text-zinc-300 font-medium whitespace-nowrap">
                            {captainContact || "—"}
                          </td>

                          {/* 3. Bloco do Atleta 2 */}
                          <td className="py-3.5 px-4 font-bold text-zinc-100 whitespace-nowrap">
                            {athlete2Name || "—"}
                          </td>
                          <td className="py-3.5 px-4 text-zinc-300 font-medium whitespace-nowrap">
                            {partnerEmail || "—"}
                          </td>
                          <td className="py-3.5 px-4 text-zinc-300 font-medium whitespace-nowrap">
                            {partnerCpf || "—"}
                          </td>

                          {/* 4. Outros */}
                          {otherCustomColumns.map((colKey) => {
                            const rawVal =
                              teamCustomResponses[colKey] ??
                              team.custom_responses?.[colKey] ??
                              team.custom_registration_answers?.[colKey];
                            const displayVal =
                              typeof rawVal === "boolean"
                                ? rawVal
                                  ? "Sim"
                                  : "Não"
                                : Array.isArray(rawVal)
                                ? rawVal.join(", ")
                                : rawVal !== null &&
                                  rawVal !== undefined &&
                                  typeof rawVal !== "object" &&
                                  String(rawVal).trim() !== ""
                                ? String(rawVal)
                                : "—";
                            return (
                              <td
                                key={colKey}
                                className="py-3.5 px-4 text-zinc-300 font-medium whitespace-nowrap"
                              >
                                {displayVal}
                              </td>
                            );
                          })}

                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedTeamDetails(team)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white font-bold text-xs transition-all cursor-pointer"
                              >
                                <Eye className="h-3.5 w-3.5 text-zinc-400" />
                                <span>Detalhes</span>
                              </button>

                              {canRemove && (
                                <button
                                  type="button"
                                  disabled={isDeletingTeamId === team.id}
                                  onClick={() => {
                                    setSelectedTeamDetails(team);
                                    setShowDeleteConfirmModal(true);
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-500/30 hover:border-red-500/60 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 font-bold text-xs transition-all cursor-pointer disabled:opacity-50"
                                  title="Remover / Excluir inscrição"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span>Remover</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {!isReadOnly && (
              <div className="p-3 bg-[#121214] border-t border-zinc-800 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowAddModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-yellow-500/10 hover:bg-yellow-500 text-yellow-400 hover:text-neutral-950 border border-yellow-500/30 text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Adicionar {entitySingular} Manualmente</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL 1: Adicionar Equipe Manualmente (Sincronizado com o Formulário Público e Configurações do Torneio) */}
      {mounted && showAddModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto animate-fadeIn">
          <div className="bg-[#1a1a1a] border border-zinc-800 rounded-3xl p-6 sm:p-8 max-w-xl w-full text-white shadow-2xl relative max-h-[92vh] overflow-y-auto">
            <button
              type="button"
              disabled={isSubmittingManual}
              onClick={() => {
                setShowAddModal(false);
                setFormError("");
              }}
              className="absolute top-5 right-5 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="p-3 rounded-2xl bg-yellow-500/15 border border-yellow-500/25 text-yellow-500">
                <Plus className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-black font-display uppercase tracking-tight">
                  Nov{isSoloFormat ? "o" : "a"} {entitySingular} (Inscrição Manual)
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Modalidade: <strong className="text-zinc-200">{activeSportType}</strong> • Formato:{" "}
                  <strong className="text-yellow-400">{modalityFormat}</strong>
                </p>
              </div>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleManualSubmit} className="space-y-4">
              {/* CASO 1: Formato Individual (Solo 1v1) - Apenas Nome do Jogador e dados exigidos */}
              {isSoloFormat && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase text-zinc-400 block">
                      Nome do Jogador <span className="text-blue-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formPlayer1}
                      onChange={(e) => setFormPlayer1(e.target.value)}
                      placeholder="Ex: Carlos Augusto"
                      className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase text-zinc-400 block">
                        Contato (WhatsApp) <span className="text-blue-500">*</span>
                      </label>
                      <div className="relative">
                        <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                        <input
                          type="text"
                          required
                          maxLength={15}
                          value={formContact}
                          onChange={(e) => setFormContact(formatPhoneMask(e.target.value))}
                          placeholder="(89) 99999-9999"
                          className="w-full pl-10 pr-4 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase text-zinc-400 block">
                        E-mail do Jogador
                      </label>
                      <div className="relative">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                        <input
                          type="email"
                          value={formCaptainEmail}
                          onChange={(e) => setFormCaptainEmail(e.target.value)}
                          placeholder="atleta@exemplo.com"
                          className="w-full pl-10 pr-4 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {requireCpf && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase text-zinc-400 block">
                        CPF do Atleta <span className="text-blue-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={14}
                        value={formCaptainCpf}
                        onChange={(e) => setFormCaptainCpf(formatCpfMask(e.target.value))}
                        placeholder="000.000.000-00"
                        className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* CASO 2: Formato Duplas (2v2 / Duplas) - Nome da Dupla, Capitão e Jogador 2 */}
              {isDuplasFormat && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase text-zinc-400 block">
                      Nome da Dupla <span className="text-blue-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder={
                        isDomino
                          ? "Ex: Os Mestres do Carroça"
                          : "Ex: Dupla Relâmpago"
                      }
                      className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                    />
                  </div>

                  {/* BLOCO 1: Dados do Capitão (Jogador 1 / Responsável) */}
                  <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3">
                    <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/80">
                      <Shield className="h-4 w-4 text-amber-400" />
                      <span className="text-xs font-black uppercase tracking-wider text-amber-400">
                        Jogador 1 (Capitão / Responsável)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase text-zinc-400 block">
                          Nome do Capitão <span className="text-blue-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={formPlayer1}
                          onChange={(e) => setFormPlayer1(e.target.value)}
                          placeholder="Ex: Carlos Silva"
                          className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase text-zinc-400 block">
                          E-mail do Capitão <span className="text-blue-500">*</span>
                        </label>
                        <div className="relative">
                          <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                          <input
                            type="email"
                            required
                            value={formCaptainEmail}
                            onChange={(e) => setFormCaptainEmail(e.target.value)}
                            placeholder="capitao@exemplo.com"
                            className="w-full pl-10 pr-4 py-2.5 bg-zinc-950 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase text-zinc-400 block">
                          Contato (WhatsApp) <span className="text-blue-500">*</span>
                        </label>
                        <div className="relative">
                          <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                          <input
                            type="text"
                            required
                            maxLength={15}
                            value={formContact}
                            onChange={(e) => setFormContact(formatPhoneMask(e.target.value))}
                            placeholder="(89) 99999-9999"
                            className="w-full pl-10 pr-4 py-2.5 bg-zinc-950 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase text-zinc-400 block">
                          CPF do Capitão {requireCpf && <span className="text-blue-500">*</span>}
                        </label>
                        <input
                          type="text"
                          required={requireCpf}
                          maxLength={14}
                          value={formCaptainCpf}
                          onChange={(e) => setFormCaptainCpf(formatCpfMask(e.target.value))}
                          placeholder="000.000.000-00"
                          className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* BLOCO 2: Dados do Parceiro (Jogador 2) */}
                  <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3">
                    <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/80">
                      <Users className="h-4 w-4 text-blue-400" />
                      <span className="text-xs font-black uppercase tracking-wider text-blue-400">
                        Jogador 2 (Parceiro)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase text-zinc-400 block">
                          Nome do Jogador 2 <span className="text-blue-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={formPlayer2}
                          onChange={(e) => setFormPlayer2(e.target.value)}
                          placeholder="Ex: Roberto Souza"
                          className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase text-zinc-400 block">
                          E-mail do Parceiro
                        </label>
                        <div className="relative">
                          <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                          <input
                            type="email"
                            value={formPartnerEmail}
                            onChange={(e) => setFormPartnerEmail(e.target.value)}
                            placeholder="parceiro@exemplo.com"
                            className="w-full pl-10 pr-4 py-2.5 bg-zinc-950 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase text-zinc-400 block">
                          Telefone / WhatsApp do Parceiro {requirePhone && <span className="text-blue-500">*</span>}
                        </label>
                        <div className="relative">
                          <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                          <input
                            type="text"
                            required={requirePhone}
                            maxLength={15}
                            value={formPartnerPhone}
                            onChange={(e) => setFormPartnerPhone(formatPhoneMask(e.target.value))}
                            placeholder="(89) 99999-9999"
                            className="w-full pl-10 pr-4 py-2.5 bg-zinc-950 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase text-zinc-400 block">
                          CPF do Jogador 2 {requireCpf && <span className="text-blue-500">*</span>}
                        </label>
                        <input
                          type="text"
                          required={requireCpf}
                          maxLength={14}
                          value={formPartnerCpf}
                          onChange={(e) => setFormPartnerCpf(formatCpfMask(e.target.value))}
                          placeholder="000.000.000-00"
                          className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* CASO 3: Formato de Equipe (Futsal 5x5 / Vôlei Quadra 6x6 ou Areia 4x4) */}
              {isTeamFormat && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase text-zinc-400 block">
                      Nome da Equipe <span className="text-blue-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="Ex: Falcões F.C."
                      className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase text-zinc-400 block">
                        Capitão / Responsável <span className="text-blue-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formPlayer1}
                        onChange={(e) => setFormPlayer1(e.target.value)}
                        placeholder="Ex: Carlos Silva"
                        className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase text-zinc-400 block">
                        Contato do Responsável (WhatsApp) <span className="text-blue-500">*</span>
                      </label>
                      <div className="relative">
                        <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                        <input
                          type="text"
                          required
                          maxLength={15}
                          value={formContact}
                          onChange={(e) => setFormContact(formatPhoneMask(e.target.value))}
                          placeholder="(89) 99999-9999"
                          className="w-full pl-10 pr-4 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {requireCpf && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase text-zinc-400 block">
                        CPF do Capitão <span className="text-blue-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={14}
                        value={formCaptainCpf}
                        onChange={(e) => setFormCaptainCpf(formatCpfMask(e.target.value))}
                        placeholder="000.000.000-00"
                        className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-sm text-white outline-none"
                      />
                    </div>
                  )}

                  {/* Elenco de Atletas Dinâmico */}
                  <div className="space-y-2 pt-2 border-t border-zinc-800">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-xs font-bold uppercase text-zinc-400 block">
                          Elenco da Equipe ({formRosterMembers.length + 1} no total)
                        </label>
                        <p className="text-[10px] text-zinc-500">
                          Informe nome e dados exigidos para cada atleta do elenco
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddAthleteField}
                        disabled={isMaxPlayersReached}
                        title={
                          isMaxPlayersReached
                            ? `Limite máximo de ${activeTournament?.max_players} atletas atingido`
                            : "Adicionar membro ao elenco"
                        }
                        className="text-xs text-yellow-500 hover:text-yellow-400 font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Adicionar Membro</span>
                      </button>
                    </div>

                    <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                      {formRosterMembers.map((ath, idx) => (
                        <div
                          key={idx}
                          className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2.5 rounded-xl bg-zinc-900/70 border border-zinc-800"
                        >
                          <input
                            type="text"
                            value={ath.name}
                            onChange={(e) => handleUpdateAthlete(idx, "name", e.target.value)}
                            placeholder={`Nome do Membro #${idx + 2}`}
                            className="flex-1 px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-yellow-500 rounded-lg text-xs text-white outline-none"
                          />
                          <input
                            type="email"
                            value={ath.email}
                            onChange={(e) => handleUpdateAthlete(idx, "email", e.target.value)}
                            placeholder="E-mail (opcional)"
                            className="flex-1 px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-yellow-500 rounded-lg text-xs text-white outline-none"
                          />
                          {requireCpf && (
                            <input
                              type="text"
                              required
                              maxLength={14}
                              value={ath.cpf || ""}
                              onChange={(e) =>
                                handleUpdateAthlete(idx, "cpf", formatCpfMask(e.target.value))
                              }
                              placeholder="CPF (000.000.000-00) *"
                              className="flex-1 px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-yellow-500 rounded-lg text-xs text-white outline-none"
                            />
                          )}
                          {requirePhone && (
                            <input
                              type="text"
                              required
                              maxLength={15}
                              value={ath.phone || ""}
                              onChange={(e) =>
                                handleUpdateAthlete(idx, "phone", formatPhoneMask(e.target.value))
                              }
                              placeholder="WhatsApp (00) 00000-0000 *"
                              className="flex-1 px-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-yellow-500 rounded-lg text-xs text-white outline-none"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveAthlete(idx)}
                            className="p-1.5 text-zinc-500 hover:text-red-400 self-end sm:self-center cursor-pointer"
                            title="Remover membro"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Nível Técnico Autodeclarado (quando o torneio está aberto a todos os níveis) */}
              {isAllSkillLevels && (
                <div className="pt-1 space-y-1.5">
                  <label className="text-xs font-bold uppercase text-zinc-400 block">
                    {isSoloFormat
                      ? "Nível de Jogo do Atleta"
                      : "Nível Técnico da Equipe"}{" "}
                    <span className="text-blue-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      required
                      value={formDeclaredSkillLevel}
                      onChange={(e) => setFormDeclaredSkillLevel(e.target.value)}
                      className="w-full pl-3.5 pr-9 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-xs text-white outline-none appearance-none cursor-pointer"
                    >
                      <option value="" className="bg-zinc-900 text-zinc-500">
                        Selecione o nível técnico...
                      </option>
                      <option value="BEGINNER" className="bg-zinc-900 text-white">
                        Iniciante
                      </option>
                      <option value="INTERMEDIATE" className="bg-zinc-900 text-white">
                        Intermediário
                      </option>
                      <option value="ADVANCED" className="bg-zinc-900 text-white">
                        Avançado
                      </option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                  </div>
                </div>
              )}

              {/* Campos Personalizados Configurados pelo Organizador (Mesmo Schema da Inscrição Pública) */}
              {customFields.length > 0 && (
                <div className="pt-2 space-y-3 border-t border-zinc-800">
                  <h4 className="text-xs font-black uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-yellow-500" />
                    <span>Campos Personalizados do Torneio</span>
                  </h4>

                  <div className="space-y-3">
                    {customFields.map((field) => {
                      const value = formCustomAnswers[field.label] ?? "";

                      if (field.type === "text") {
                        return (
                          <div key={field.id} className="space-y-1.5">
                            <label className="text-xs font-bold uppercase text-zinc-400 block">
                              {field.label} {field.required && <span className="text-blue-500">*</span>}
                            </label>
                            <input
                              type="text"
                              required={field.required}
                              value={value}
                              onChange={(e) => handleManualCustomAnswerChange(field.label, e.target.value)}
                              placeholder={`Resposta para ${field.label}`}
                              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-xs text-white outline-none"
                            />
                          </div>
                        );
                      }

                      if (field.type === "textarea") {
                        return (
                          <div key={field.id} className="space-y-1.5">
                            <label className="text-xs font-bold uppercase text-zinc-400 block">
                              {field.label} {field.required && <span className="text-blue-500">*</span>}
                            </label>
                            <textarea
                              rows={3}
                              required={field.required}
                              value={value}
                              onChange={(e) => handleManualCustomAnswerChange(field.label, e.target.value)}
                              placeholder={`Resposta para ${field.label}`}
                              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-xs text-white outline-none resize-y"
                            />
                          </div>
                        );
                      }

                      if (field.type === "select") {
                        return (
                          <div key={field.id} className="space-y-1.5">
                            <label className="text-xs font-bold uppercase text-zinc-400 block">
                              {field.label} {field.required && <span className="text-blue-500">*</span>}
                            </label>
                            <div className="relative">
                              <select
                                required={field.required}
                                value={value}
                                onChange={(e) => handleManualCustomAnswerChange(field.label, e.target.value)}
                                className="w-full pl-3.5 pr-9 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-xs text-white outline-none appearance-none cursor-pointer"
                              >
                                <option value="" className="bg-zinc-900 text-zinc-500">
                                  Selecione uma opção...
                                </option>
                                {(field.options || []).map((opt, i) => (
                                  <option key={i} value={opt} className="bg-zinc-900 text-white">
                                    {opt}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                            </div>
                          </div>
                        );
                      }

                      if (field.type === "checkbox") {
                        const isChecked = Boolean(value === "Sim" || value === true);
                        return (
                          <div
                            key={field.id}
                            onClick={() =>
                              handleManualCustomAnswerChange(field.label, isChecked ? "Não" : "Sim")
                            }
                            className="flex items-center gap-3 p-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl cursor-pointer select-none"
                          >
                            <input
                              type="checkbox"
                              id={`manual-cb-${field.id}`}
                              checked={isChecked}
                              onChange={(e) =>
                                handleManualCustomAnswerChange(
                                  field.label,
                                  e.target.checked ? "Sim" : "Não"
                                )
                              }
                              className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-yellow-500 focus:ring-yellow-500 cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <label
                              htmlFor={`manual-cb-${field.id}`}
                              className="text-xs font-medium text-zinc-200 cursor-pointer flex-1"
                            >
                              {field.label} {field.required && <span className="text-blue-500">*</span>}
                            </label>
                          </div>
                        );
                      }

                      return null;
                    })}
                  </div>
                </div>
              )}

              {/* Categoria (Select Dinâmico do Torneio) e Status Financeiro */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-800">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-zinc-400 block">
                    Categoria
                  </label>
                  <div className="relative">
                    <select
                      value={formCategory || defaultTournamentCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className="w-full pl-3 pr-8 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-xs text-white outline-none appearance-none cursor-pointer"
                    >
                      {availableCategories.map((cat) => (
                        <option key={cat} value={cat} className="bg-zinc-900 text-white">
                          {cat}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-zinc-400 block">
                    Status Financeiro
                  </label>
                  <div className="relative">
                    <select
                      value={formPaymentStatus}
                      onChange={(e) => setFormPaymentStatus(e.target.value as any)}
                      className="w-full pl-3 pr-8 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-yellow-500 rounded-xl text-xs text-white outline-none appearance-none cursor-pointer"
                    >
                      <option value="PAID" className="bg-zinc-900 text-white">
                        Pago (Confirmado)
                      </option>
                      <option value="PENDING" className="bg-zinc-900 text-white">
                        Pendente
                      </option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Botão de Submissão */}
              <div className="pt-4">
                <button
                  type="submit"
                  disabled={isSubmittingManual}
                  className="w-full py-3 px-6 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-neutral-950 font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-yellow-500/20 active:scale-98 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSubmittingManual ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Registrando Inscrição...</span>
                    </>
                  ) : (
                    <span>Confirmar Inscrição</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL 2: Ver Detalhes / Conferir Pix da Equipe */}
      {mounted && selectedTeamDetails && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto animate-fadeIn">
          <div className="bg-[#1a1a1a] border border-zinc-800 rounded-3xl p-6 sm:p-8 max-w-md w-full text-white shadow-2xl relative max-h-[90vh] flex flex-col">
            <button
              type="button"
              disabled={isDeletingTeamId === selectedTeamDetails.id}
              onClick={() => {
                setShowDeleteConfirmModal(false);
                setSelectedTeamDetails(null);
              }}
              className="absolute top-5 right-5 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Cabeçalho Fixo do Modal */}
            <div className="flex items-center gap-3 mb-5 shrink-0 pr-8">
              <div className="w-12 h-12 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xl shrink-0">
                {sportIcon}
              </div>
              <div>
                <h3 className="text-xl font-black font-display text-white">
                  {selectedTeamDetails.name}
                </h3>
                <span className="text-xs text-zinc-400">
                  Categoria: {selectedTeamDetails.category || defaultTournamentCategory}
                </span>
              </div>
            </div>

            {/* Conteúdo com Scroll Interno (overflow-y-auto flex-1 pr-2) */}
            <div className="overflow-y-auto flex-1 pr-2 space-y-4">
              <div className="space-y-3 p-4 bg-[#121214] border border-zinc-800 rounded-2xl text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Responsável:</span>
                  <span className="font-bold text-white">
                    {selectedTeamDetails.manager_name || selectedTeamDetails.players[0] || "Não informado"}
                  </span>
                </div>

                {getTeamRosterList(selectedTeamDetails).filter((m) => !m.is_captain).length > 0 && (
                  <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
                    <span className="text-zinc-500 block">
                      Elenco / Atletas ({getTeamRosterList(selectedTeamDetails).length}):
                    </span>
                    <div className="space-y-1">
                      {getTeamRosterList(selectedTeamDetails).map((member, mIdx) => (
                        <div
                          key={member.id || mIdx}
                          className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800/80 text-xs"
                        >
                          <span className="font-bold text-white truncate">{member.name}</span>
                          {member.is_captain ? (
                            <span className="text-[10px] font-black uppercase text-amber-400">Capitão</span>
                          ) : (
                            <span className="text-[10px] text-zinc-400">{member.email || "Atleta"}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {false && selectedTeamDetails?.players?.[1] && (
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Parceiro/Jogador 2:</span>
                    <span className="font-bold text-white">{selectedTeamDetails?.players?.[1]}</span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Data de Inscrição:</span>
                  <span className="font-bold text-white">{formatDate(selectedTeamDetails.createdAt)}</span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
                  <span className="text-zinc-500">Status da Inscrição:</span>
                  {selectedTeamDetails.cancellation_status === "REQUESTED_BY_ATHLETE" ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-950 border border-red-600 text-red-200 text-[10px] font-black uppercase tracking-wider animate-pulse">
                      <AlertTriangle className="h-3 w-3 text-red-400" />
                      <span>CANCELAMENTO SOLICITADO</span>
                    </span>
                  ) : selectedTeamDetails.cancellation_status === "REFUND_REQUESTED" ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-950 border border-rose-500 text-rose-200 text-[10px] font-black uppercase tracking-wider animate-pulse">
                      <AlertTriangle className="h-3 w-3 text-rose-400" />
                      <span>CANCELAMENTO C/ REEMBOLSO</span>
                    </span>
                  ) : selectedTeamDetails.payment_status === "PAID" ||
                    selectedTeamDetails.payment_status === "APPROVED" ||
                    selectedTeamDetails.status === "PAID" ||
                    selectedTeamDetails.status === "CONFIRMED" ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-[10px] font-black uppercase tracking-wider">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      <span>{selectedTeamDetails.payment_status === "APPROVED" ? "Aprovado" : "Pago (Confirmado)"}</span>
                    </span>
                  ) : (
                    <span className="font-black text-yellow-400">
                      {selectedTeamDetails.payment_status || "PENDING"}
                    </span>
                  )}
                </div>
              </div>

              {/* Alerta de Cancelamento Pós-Pagamento (REFUND_REQUESTED) */}
              {selectedTeamDetails.cancellation_status === "REFUND_REQUESTED" && (() => {
                const phone =
                  selectedTeamDetails.manager_phone ||
                  selectedTeamDetails.phone ||
                  (selectedTeamDetails.custom_registration_answers &&
                    (selectedTeamDetails.custom_registration_answers["Telefone"] ||
                      selectedTeamDetails.custom_registration_answers["WhatsApp"] ||
                      selectedTeamDetails.custom_registration_answers["whatsapp"] ||
                      selectedTeamDetails.custom_registration_answers["telefone"])) ||
                  "";
                return (
                  <div className="p-4 rounded-2xl bg-gradient-to-r from-rose-950/70 via-red-950/40 to-amber-950/40 border border-rose-500/50 space-y-2">
                    <div className="flex items-center gap-2 text-rose-300 font-black text-xs uppercase tracking-wider">
                      <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                      <span>Cancelamento Pós-Pagamento Solicitado</span>
                    </div>
                    <p className="text-zinc-300 text-xs leading-relaxed">
                      O atleta pagou a taxa de inscrição e solicitou o cancelamento. Combine a devolução/estorno diretamente através dos canais de contato.
                    </p>
                    {phone ? (
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs text-zinc-300">
                          Telefone: <strong className="text-white font-mono">{phone}</strong>
                        </span>
                        <a
                          href={`https://wa.me/55${String(phone).replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          <span>Conversar no WhatsApp</span>
                        </a>
                      </div>
                    ) : (
                      <p className="text-[11px] text-zinc-400">Telefone não cadastrado. Verifique o email do atleta.</p>
                    )}
                  </div>
                );
              })()}

              {/* Exibição Dinâmica de Campos Customizados e Metadados da Inscrição (custom_responses) */}
              {(() => {
                const resolvedCustomResponses = getTeamCustomResponses(selectedTeamDetails);
                const validEntries = Object.entries(resolvedCustomResponses).filter(
                  ([question, answer]) => {
                    if (question.startsWith("__")) return false;
                    if (answer !== null && typeof answer === "object" && !Array.isArray(answer))
                      return false;
                    if (Array.isArray(answer) && answer.some((item) => typeof item === "object"))
                      return false;
                    return answer !== null && answer !== undefined && String(answer).trim() !== "";
                  }
                );

                if (validEntries.length === 0) {
                  return null;
                }

                return (
                  <div className="p-4 bg-[#121214] border border-zinc-800 rounded-2xl space-y-2.5">
                    <div className="flex items-center gap-2 pb-2 border-b border-zinc-800">
                      <FileText className="h-4 w-4 text-orange-400" />
                      <span className="text-xs font-black uppercase tracking-wider text-zinc-300">
                        Dados Adicionais & Respostas da Inscrição
                      </span>
                    </div>
                    <div className="space-y-2 text-xs divide-y divide-zinc-800/60">
                      {validEntries.map(([question, answer], idx) => (
                        <div
                          key={idx}
                          className="pt-2 first:pt-0 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1.5"
                        >
                          <span className="text-zinc-400 font-medium sm:max-w-[50%] break-words">
                            {question}:
                          </span>
                          <span className="font-bold text-white sm:text-right bg-zinc-900/90 px-2.5 py-1 rounded-lg border border-zinc-800 break-words">
                            {typeof answer === "boolean"
                              ? answer
                                ? "Sim"
                                : "Não"
                              : Array.isArray(answer)
                              ? answer.join(", ")
                              : answer === null || answer === undefined || answer === ""
                              ? "Não respondido"
                              : String(answer)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Ações Fixas no Rodapé do Modal */}
            <div className="mt-5 pt-3 border-t border-zinc-800/80 space-y-2.5 shrink-0">
              {selectedTeamDetails.payment_proof_url && (
                <button
                  type="button"
                  onClick={() => handleViewReceipt(selectedTeamDetails.payment_proof_url)}
                  className="w-full py-2.5 px-4 rounded-xl border border-zinc-700 hover:border-zinc-500 bg-zinc-900/60 hover:bg-zinc-800 text-xs font-bold text-zinc-200 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Eye className="h-4 w-4 text-blue-400" />
                  <span>Ver Comprovante Anexado</span>
                </button>
              )}

              {/* Botão Excluir / Libertar Vaga para Pendentes */}
              {(selectedTeamDetails.payment_status === "PENDING" ||
                selectedTeamDetails.payment_status === "WAITING_PIX" ||
                selectedTeamDetails.payment_status === "WAITING_APPROVAL" ||
                !selectedTeamDetails.payment_status) &&
                canRemove && (
                  <button
                    type="button"
                    disabled={isDeletingTeamId === selectedTeamDetails.id}
                    onClick={async () => {
                      const teamToDelete = selectedTeamDetails;
                      setSelectedTeamDetails(null);
                      await handleDeleteOrFreeSpot(teamToDelete);
                    }}
                    className="w-full py-2.5 px-4 rounded-xl bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/40 font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isDeletingTeamId === selectedTeamDetails.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    <span>Excluir / Libertar Vaga</span>
                  </button>
                )}

              {selectedTeamDetails.cancellation_status === "REQUESTED_BY_ATHLETE" ||
              selectedTeamDetails.cancellation_status === "REFUND_REQUESTED" ? (
                hasFinancialAccess && !isReadOnly ? (
                  <button
                    type="button"
                    disabled={isRefundingId === selectedTeamDetails.id}
                    onClick={() => handleRefundTeam(selectedTeamDetails.id)}
                    className="w-full py-3.5 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-red-600/30 active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isRefundingId === selectedTeamDetails.id ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Processando Devolução...</span>
                      </>
                    ) : (
                      <>
                        <RotateCcw className="h-4 w-4" />
                        <span>Confirmar Cancelamento e Marcar como Reembolsado</span>
                      </>
                    )}
                  </button>
                ) : (
                  <div className="p-3 rounded-xl bg-red-950/40 border border-red-800/40 text-red-300 text-xs font-medium text-center">
                    Cancelamento solicitado pelo atleta • Requer permissão financeira do organizador.
                  </div>
                )
              ) : (selectedTeamDetails.payment_status !== "APPROVED" && selectedTeamDetails.payment_status !== "PAID") ? (
                hasFinancialAccess && !isReadOnly ? (
                  <button
                    type="button"
                    disabled={isApprovingId === selectedTeamDetails.id}
                    onClick={() => handleApprovePix(selectedTeamDetails.id)}
                    className="w-full py-3 px-4 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-neutral-950 font-black text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isApprovingId === selectedTeamDetails.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    <span>Aprovar Pagamento Pix</span>
                  </button>
                ) : (
                  <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-xs font-medium text-center">
                    Inscrição pendente de aprovação financeira pelo organizador.
                  </div>
                )
              ) : null}

              {canRemove && (
                <button
                  type="button"
                  disabled={isDeletingTeamId === selectedTeamDetails.id}
                  onClick={() => setShowDeleteConfirmModal(true)}
                  className="w-full py-2.5 px-4 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDeletingTeamId === selectedTeamDetails.id ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Excluindo Inscrição...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Excluir Inscrição Definitivamente</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ALERT DIALOG DE CONFIRMAÇÃO DE SEGURANÇA: Exclusão Definitiva de Inscrição */}
      {mounted && showDeleteConfirmModal && selectedTeamDetails && createPortal(
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="alert-dialog-delete-title"
          aria-describedby="alert-dialog-delete-desc"
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fadeIn"
        >
          <div className="bg-[#18181b] border border-red-500/30 rounded-3xl p-6 sm:p-7 max-w-md w-full text-white shadow-2xl relative space-y-5">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-600 via-rose-500 to-amber-500 rounded-t-3xl" />

            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3
                  id="alert-dialog-delete-title"
                  className="text-lg font-black font-display uppercase tracking-tight text-white"
                >
                  Tem certeza absoluta?
                </h3>
                <p className="text-xs font-semibold text-red-400">
                  Equipe: {selectedTeamDetails.name}
                </p>
              </div>
            </div>

            <p
              id="alert-dialog-delete-desc"
              className="text-sm text-zinc-300 leading-relaxed"
            >
              Esta ação não pode ser desfeita. Isso excluirá permanentemente a inscrição e removerá a equipe do torneio.
            </p>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isDeletingTeamId === selectedTeamDetails.id}
                onClick={() => setShowDeleteConfirmModal(false)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-bold text-zinc-300 hover:text-white transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeletingTeamId === selectedTeamDetails.id}
                onClick={() => handleConfirmPermanentDelete(selectedTeamDetails)}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-red-600/30 active:scale-95 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeletingTeamId === selectedTeamDetails.id ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Excluindo...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    <span>Sim, Excluir Definitivamente</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}


      {/* MODAL 3: Conferir Comprovantes (Ação em Massa) */}
      {mounted && showProofReviewModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto animate-fadeIn">
          <div className="bg-[#18181b] border border-zinc-800 rounded-3xl p-6 sm:p-8 max-w-2xl w-full text-white shadow-2xl relative max-h-[90vh] overflow-y-auto">
            {/* Linha decorativa superior */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-500" />

            <button
              type="button"
              onClick={() => setShowProofReviewModal(false)}
              className="absolute top-5 right-5 p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              title="Fechar"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-2xl bg-blue-500/15 border border-blue-500/25 text-blue-400">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-black font-display uppercase tracking-tight">
                    Conferir Comprovantes Pix
                  </h3>
                  <span className="px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-400 text-[10px] font-black">
                    {teamsToReview.length} pendente(s)
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Valide os comprovantes anexados pelos atletas e aprove a inscrição para a chave oficial.
                </p>
              </div>
            </div>

            {teamsToReview.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
                  <CheckCircle2 className="h-7 w-7" />
                </div>
                <h4 className="text-base font-bold text-white">
                  Nenhum comprovante pendente no momento!
                </h4>
                <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                  Todas as equipes com comprovante de pagamento Pix anexado já foram aprovadas.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setShowProofReviewModal(false)}
                    className="py-2.5 px-6 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-white transition-all cursor-pointer"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {teamsToReview.map((team) => (
                  <div
                    key={team.id}
                    className="p-5 rounded-2xl bg-[#121214] border border-zinc-800 space-y-4 shadow-lg"
                  >
                    {/* Cabeçalho da Equipe */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-base font-black text-white font-display tracking-tight">
                            {team.name}
                          </h4>
                          <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-orange-500/10 text-orange-400 border border-orange-500/25">
                            WAITING_PIX
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          Responsável: <strong className="text-zinc-200">{team.manager_name || (Array.isArray(team.players) ? team.players[0] : "") || "Capitão"}</strong>
                          {team.contact ? ` • Contato: ${team.contact}` : ""}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleViewReceipt(team.payment_proof_url)}
                        className="text-xs text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1.5 self-start sm:self-auto cursor-pointer transition-colors"
                        title="Abrir comprovante seguro em nova aba"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Abrir Original</span>
                      </button>
                    </div>

                    {/* Área da Imagem / PDF do Comprovante */}
                    <div className="bg-[#09090b] border border-zinc-800/80 rounded-xl p-3 flex items-center justify-center overflow-hidden min-h-[140px]">
                      {!team.payment_proof_url ? (
                        <div className="py-6 text-center space-y-1.5">
                          <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
                          <p className="text-xs text-zinc-200 font-bold">Nenhum comprovante anexado</p>
                          <p className="text-[11px] text-zinc-500 max-w-xs mx-auto">
                            O atleta ainda não enviou o comprovante de pagamento Pix desta inscrição.
                          </p>
                        </div>
                      ) : team.payment_proof_url?.toLowerCase().endsWith(".pdf") ? (
                        <div className="py-6 text-center space-y-2">
                          <FileText className="w-10 h-10 text-blue-400 mx-auto" />
                          <p className="text-xs text-zinc-300 font-bold">Documento em Formato PDF</p>
                          <button
                            type="button"
                            onClick={() => handleViewReceipt(team.payment_proof_url)}
                            className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-white cursor-pointer"
                          >
                            Visualizar PDF
                          </button>
                        </div>
                      ) : (
                        <img
                          src={proofSignedUrls[team.id] || team.payment_proof_url}
                          alt={`Comprovante da equipe ${team.name}`}
                          className="max-h-64 w-auto object-contain rounded-lg mx-auto select-none shadow-md cursor-pointer hover:opacity-95"
                          onClick={() => handleViewReceipt(team.payment_proof_url)}
                          title="Clique para abrir imagem completa"
                        />
                      )}
                    </div>

                    {/* Botão de Aprovação logo abaixo de cada imagem */}
                    <button
                      type="button"
                      disabled={isApprovingId === team.id || isReadOnly}
                      onClick={() => handleApprovePix(team.id)}
                      className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider transition-all shadow-md shadow-emerald-600/25 active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {isApprovingId === team.id ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Aprovando & Repassando...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Aprovar Inscrição Pix</span>
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* ======================================================== */}
      {/* MODAL INDIVIDUAL: VISUALIZAÇÃO DO COMPROVANTE (RECIBO PIX) */}
      {/* ======================================================== */}
      {mounted && viewingReceiptTeam && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn">
          <div className="bg-[#18181b] border border-zinc-800 rounded-2xl max-w-lg w-full p-6 text-white shadow-2xl relative">
            <button
              onClick={() => setViewingReceiptTeam(null)}
              className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Fechar"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 mb-5 border-b border-zinc-800/80 pb-4">
              <div className="p-3 rounded-2xl bg-blue-500/15 border border-blue-500/25 text-blue-400">
                <Receipt className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-black font-display uppercase tracking-tight">
                  Comprovante de Pagamento
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Equipe: <strong className="text-zinc-200">{viewingReceiptTeam.name}</strong> • Responsável:{" "}
                  <strong className="text-zinc-200">
                    {viewingReceiptTeam.manager_name || viewingReceiptTeam.players?.[0] || "Capitão"}
                  </strong>
                </p>
              </div>
            </div>

            {/* Verificação: Se payment_proof_url estiver vazio */}
            {!viewingReceiptTeam.payment_proof_url ? (
              <div className="py-10 px-4 text-center space-y-3 bg-[#121214] rounded-2xl border border-dashed border-zinc-800 my-4">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-400 flex items-center justify-center mx-auto shadow-md">
                  <AlertCircle className="h-7 w-7" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-white">Nenhum comprovante anexado</h4>
                  <p className="text-xs text-zinc-400 max-w-xs mx-auto leading-relaxed">
                    O atleta ou responsável não enviou uma imagem ou arquivo de comprovante Pix para esta inscrição.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 my-4">
                <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-3 flex items-center justify-center overflow-hidden min-h-[220px]">
                  {loadingReceiptUrl ? (
                    <div className="py-12 flex flex-col items-center gap-2 text-xs text-zinc-400">
                      <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
                      <span>Carregando comprovante seguro...</span>
                    </div>
                  ) : viewingReceiptTeam.payment_proof_url?.toLowerCase().endsWith(".pdf") ? (
                    <div className="py-8 text-center space-y-3">
                      <FileText className="w-12 h-12 text-blue-400 mx-auto" />
                      <p className="text-xs text-zinc-300 font-bold">Comprovante em formato PDF</p>
                      <a
                        href={receiptModalSignedUrl || viewingReceiptTeam.payment_proof_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white shadow-md cursor-pointer"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Abrir Documento PDF</span>
                      </a>
                    </div>
                  ) : (
                    <div className="relative group max-h-[380px] overflow-hidden rounded-lg">
                      <img
                        src={receiptModalSignedUrl || viewingReceiptTeam.payment_proof_url}
                        alt={`Comprovante da equipe ${viewingReceiptTeam.name}`}
                        className="max-h-[360px] w-auto object-contain rounded-lg mx-auto shadow-md select-none"
                      />
                    </div>
                  )}
                </div>

                {receiptModalSignedUrl && !viewingReceiptTeam.payment_proof_url?.toLowerCase().endsWith(".pdf") && (
                  <div className="flex justify-end">
                    <a
                      href={receiptModalSignedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Ver Imagem em Nova Aba</span>
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Ações do Modal */}
            <div className="pt-4 border-t border-zinc-800 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setViewingReceiptTeam(null)}
                className="py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-zinc-300 hover:text-white transition-all cursor-pointer"
              >
                Fechar
              </button>

              {(viewingReceiptTeam.payment_status === "WAITING_PIX" || viewingReceiptTeam.payment_status === "WAITING_APPROVAL" || Boolean(viewingReceiptTeam.payment_proof_url)) && hasFinancialAccess && !isReadOnly && (
                <button
                  type="button"
                  disabled={isApprovingId === viewingReceiptTeam.id}
                  onClick={() => handleApprovePix(viewingReceiptTeam.id)}
                  className="py-2.5 px-5 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-neutral-950 font-black text-xs uppercase tracking-wider transition-all shadow-md shadow-yellow-500/20 active:scale-95 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isApprovingId === viewingReceiptTeam.id ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Aprovando & Repassando...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Aprovar Pix</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
