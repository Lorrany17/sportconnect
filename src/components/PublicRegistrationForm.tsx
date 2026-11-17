"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  X,
  Users,
  Trophy,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Sparkles,
  Phone,
  Shield,
  Plus,
  Trash2,
  ChevronDown,
  FileText,
  Mail,
  Upload,
} from "lucide-react";
import { Tournament, SportType, Team } from "@/types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthProvider";
import { useTournament } from "@/context/TournamentContext";
import PixCheckoutForm from "@/components/PixCheckoutForm";
import { updateRegistration, deleteOrphanTeam } from "@/app/actions/registration";
import { notifyNewRegistration } from "@/app/actions/notifications";
import { extractModalityFormat } from "@/components/CreateTournamentForm";

export interface PublicRegistrationFormProps {
  tournament: Tournament;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialData?: any;
  defaultValues?: any;
}

export default function PublicRegistrationForm({
  tournament,
  isOpen,
  onClose,
  onSuccess,
  initialData,
  defaultValues,
}: PublicRegistrationFormProps) {
  const activeInitialData = initialData || defaultValues || null;
  const isEditMode = Boolean(activeInitialData?.id);
  const { user } = useAuth();
  const { setTeams } = useTournament();

  const sportType: SportType = tournament.sport_type || "DOMINO";
  const modalityFormat = extractModalityFormat(tournament);
  const format = modalityFormat.toLowerCase();
  const entryFee = tournament.entry_fee ? Number(tournament.entry_fee) : 0;

  // Lógica de adaptação estrita do formato do esporte
  const isPingPongSolo =
    format.includes("solo") ||
    format.includes("1v1") ||
    format.includes("1x1") ||
    format.includes("individual") ||
    Number((tournament as any)?.team_size) === 1;

  const isDuplasSport =
    !isPingPongSolo &&
    (format.includes("dupla") ||
      format.includes("2v2") ||
      format.includes("2x2") ||
      sportType === "DOMINO" ||
      Number((tournament as any)?.team_size) === 2);

  const isTeamSport =
    !isPingPongSolo &&
    !isDuplasSport &&
    (sportType === "FUTSAL" ||
      sportType === "VOLEI" ||
      Number((tournament as any)?.team_size) > 2);

  // Restrições de Inscrição da Competição
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
        return `Exatamente ${min} atletas por equipe`;
      }
      return `De ${min} a ${max} atletas por equipe`;
    }
    if (min !== null && min !== undefined) {
      return `Mínimo de ${min} atletas por equipe`;
    }
    if (max !== null && max !== undefined) {
      return `Até ${max} atletas por equipe`;
    }
    return null;
  };
  const squadRestrictionText = getSquadRestrictionText();
  const hasRestrictions = Boolean(ageRestrictionText || squadRestrictionText);

  // Fluxo de Etapas (form -> checkout pix)
  const [step, setStep] = useState<"form" | "checkout">("form");
  const [createdTeam, setCreatedTeam] = useState<Team | null>(null);

  // Estados dos campos do formulário
  const [teamName, setTeamName] = useState("");
  const [captainName, setCaptainName] = useState(
    user?.user_metadata?.full_name || user?.user_metadata?.name || ""
  );
  const [partnerName, setPartnerName] = useState("");
  const [partnerEmail, setPartnerEmail] = useState("");
  const [contact, setContact] = useState("");
  const requireCpf = Boolean(tournament.require_cpf);
  const requirePhone = Boolean(tournament.require_phone);
  const isAllSkillLevels =
    !tournament.skill_level ||
    tournament.skill_level.toUpperCase() === "ALL" ||
    tournament.skill_level.toUpperCase() === "LIVRE";
  const [declaredSkillLevel, setDeclaredSkillLevel] = useState<string>(
    activeInitialData?.declared_skill_level || ""
  );
  const [captainCpf, setCaptainCpf] = useState("");
  const [partnerCpf, setPartnerCpf] = useState("");
  const [partnerPhone, setPartnerPhone] = useState("");
  const [athletes, setAthletes] = useState<
    { name: string; email: string; cpf?: string; phone?: string }[]
  >([]);

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
  const [customAnswers, setCustomAnswers] = useState<Record<string, any>>({});
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const customFields = tournament.custom_registration_fields || [];

  // Preenche o formulário quando aberto em modo de edição (initialData / defaultValues)
  useEffect(() => {
    if (!isOpen) return;
    setErrorMessage("");
    setIsSuccess(false);

    if (activeInitialData) {
      setTeamName(activeInitialData.name || "");
      const cap =
        activeInitialData.player1 ||
        activeInitialData.manager_name ||
        (Array.isArray(activeInitialData.players) ? activeInitialData.players[0] : "") ||
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name ||
        "";
      setCaptainName(cap);

      const p2 =
        activeInitialData.player2 ||
        (Array.isArray(activeInitialData.players) ? activeInitialData.players[1] : "") ||
        "";
      setPartnerName(p2);

      if (activeInitialData.partnerEmail !== undefined) {
        setPartnerEmail(activeInitialData.partnerEmail || "");
      } else if (Array.isArray(activeInitialData.members)) {
        const nonCaptain = activeInitialData.members.find((m: any) => !m.is_captain);
        setPartnerEmail(nonCaptain?.email || "");
      }

      setContact(activeInitialData.contact || activeInitialData.manager_phone || activeInitialData.phone || "");
      setCustomAnswers(activeInitialData.custom_registration_answers || {});
      if (activeInitialData.declared_skill_level !== undefined) {
        setDeclaredSkillLevel(activeInitialData.declared_skill_level || "");
      }

      if (Array.isArray(activeInitialData.members) && activeInitialData.members.length > 0) {
        const nonCapMembers = activeInitialData.members
          .filter((m: any) => !m.is_captain)
          .map((m: any) => ({
            name: m.name || "",
            email: m.email || "",
            cpf: m.cpf || "",
            phone: m.phone || "",
          }));
        const capMember = activeInitialData.members.find((m: any) => m.is_captain);
        if (capMember?.cpf) setCaptainCpf(capMember.cpf);
        if (capMember?.phone && !activeInitialData.contact) setContact(capMember.phone);
        const firstNonCap = activeInitialData.members.find((m: any) => !m.is_captain);
        if (firstNonCap?.cpf) setPartnerCpf(firstNonCap.cpf);
        if (firstNonCap?.phone) setPartnerPhone(firstNonCap.phone);
        setAthletes(nonCapMembers);
      } else if (Array.isArray(activeInitialData.roster) && activeInitialData.roster.length > 1) {
        setAthletes(
          activeInitialData.roster.slice(1).map((rName: string) => ({
            name: rName,
            email: "",
          }))
        );
      } else {
        setAthletes([]);
      }
    }
  }, [isOpen, activeInitialData, user?.user_metadata?.full_name, user?.user_metadata?.name]);

  // 1. Chave Única de Armazenamento para Auto-Save no LocalStorage
  const storageKey = `sportconnect_draft_${tournament.id}`;
  const isHydratedRef = useRef<boolean>(false);
  const [hasRestoredDraft, setHasRestoredDraft] = useState<boolean>(false);

  // 2. Recuperação de Dados (On Mount / On Open)
  useEffect(() => {
    // Não carrega rascunho se estiver em modo de edição de uma inscrição existente
    if (isEditMode || !isOpen || typeof window === "undefined") {
      isHydratedRef.current = true;
      return;
    }

    try {
      const savedRaw = localStorage.getItem(storageKey);
      if (savedRaw) {
        const draft = JSON.parse(savedRaw);
        if (draft && typeof draft === "object") {
          if (draft.teamName !== undefined) setTeamName(draft.teamName);
          if (draft.captainName !== undefined) setCaptainName(draft.captainName);
          if (draft.partnerName !== undefined) setPartnerName(draft.partnerName);
          if (draft.partnerEmail !== undefined) setPartnerEmail(draft.partnerEmail);
          if (draft.partnerCpf !== undefined) setPartnerCpf(draft.partnerCpf);
          if (draft.partnerPhone !== undefined) setPartnerPhone(draft.partnerPhone);
          if (draft.contact !== undefined) setContact(draft.contact);
          if (draft.captainCpf !== undefined) setCaptainCpf(draft.captainCpf);
          if (Array.isArray(draft.athletes)) setAthletes(draft.athletes);
          if (draft.declaredSkillLevel !== undefined) setDeclaredSkillLevel(draft.declaredSkillLevel);
          if (draft.customAnswers && typeof draft.customAnswers === "object") {
            setCustomAnswers(draft.customAnswers);
          }
          setHasRestoredDraft(true);
        }
      }
    } catch (draftErr) {
      console.warn("Aviso ao recuperar rascunho do formulário de inscrição:", draftErr);
    } finally {
      isHydratedRef.current = true;
    }
  }, [isOpen, isEditMode, storageKey]);

  // 3. Salvamento Automático (Auto-Save com Debounce de 500ms)
  useEffect(() => {
    // Apenas salva após hidratação e quando não está editando inscrição já existente
    if (!isHydratedRef.current || isEditMode || !isOpen || typeof window === "undefined") {
      return;
    }

    const hasAnyContent =
      Boolean(teamName.trim()) ||
      Boolean(partnerName.trim()) ||
      Boolean(partnerEmail.trim()) ||
      Boolean(contact.trim()) ||
      Boolean(captainCpf.trim()) ||
      Boolean(partnerCpf.trim()) ||
      athletes.length > 0 ||
      Object.keys(customAnswers).length > 0;

    const timeoutId = setTimeout(() => {
      try {
        if (!hasAnyContent) {
          localStorage.removeItem(storageKey);
          return;
        }

        const draftData = {
          teamName,
          captainName,
          partnerName,
          partnerEmail,
          partnerCpf,
          partnerPhone,
          contact,
          captainCpf,
          athletes,
          declaredSkillLevel,
          customAnswers,
          savedAt: new Date().toISOString(),
        };

        localStorage.setItem(storageKey, JSON.stringify(draftData));
      } catch (saveErr) {
        console.warn("Aviso ao salvar rascunho no localStorage:", saveErr);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [
    teamName,
    captainName,
    partnerName,
    partnerEmail,
    partnerCpf,
    partnerPhone,
    contact,
    captainCpf,
    athletes,
    declaredSkillLevel,
    customAnswers,
    isEditMode,
    isOpen,
    storageKey,
  ]);

  // Função para limpar rascunho manualmente
  const handleClearDraft = () => {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem(storageKey);
      }
      setTeamName("");
      setPartnerName("");
      setPartnerEmail("");
      setPartnerCpf("");
      setPartnerPhone("");
      setContact("");
      setCaptainCpf("");
      setAthletes([]);
      setCustomAnswers({});
      setHasRestoredDraft(false);
    } catch (err) {
      console.warn("Aviso ao limpar rascunho:", err);
    }
  };

  const handleCustomAnswerChange = (fieldLabel: string, value: any) => {
    setCustomAnswers((prev) => ({
      ...prev,
      [fieldLabel]: value,
    }));
  };

  // Estados de upload de comprovante de pagamento
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Limpa o preview de imagem do comprovante ao desmontar
  useEffect(() => {
    return () => {
      if (receiptPreview) {
        URL.revokeObjectURL(receiptPreview);
      }
    };
  }, [receiptPreview]);

  // Manipulador de seleção do arquivo de comprovante
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage("Erro ao enviar o comprovante. O arquivo deve ter no máximo 5MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setReceiptFile(file);
    setErrorMessage("");

    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setReceiptPreview(url);
    } else {
      setReceiptPreview(null);
    }
  };

  // Remove o comprovante selecionado
  const handleRemoveReceipt = () => {
    setReceiptFile(null);
    if (receiptPreview) {
      URL.revokeObjectURL(receiptPreview);
      setReceiptPreview(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Estados de submissão e feedback
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);

  // Estado para armazenar os dados validados antes da gravação definitiva no Supabase (Delayed DB Insert)
  const [pendingRegistrationData, setPendingRegistrationData] = useState<{
    finalName: string;
    p1: string;
    p2: string;
    compiledRoster: string[];
    captainCpf: string;
    contact: string;
    partnerName: string;
    partnerEmail: string;
    partnerCpf: string;
    partnerPhone: string;
    athletes: { name: string; email: string; cpf?: string; phone?: string }[];
    formattedCustomAnswers: Record<string, any>;
    declaredSkillLevel: string;
  } | null>(null);

  // Função centralizada para gravação no banco da equipe e dos membros
  const executeTeamAndMembersInsert = async (params: {
    finalName: string;
    p1: string;
    p2: string;
    compiledRoster: string[];
    captainCpf: string;
    contact: string;
    partnerName: string;
    partnerEmail: string;
    partnerCpf: string;
    partnerPhone: string;
    athletes: { name: string; email: string; cpf?: string; phone?: string }[];
    formattedCustomAnswers: Record<string, any>;
    declaredSkillLevel: string;
    uploadedReceiptPath: string | null;
    isPayLater?: boolean;
  }): Promise<Team> => {
    if (!user || !user.id) {
      throw new Error("Usuário não autenticado. Faça login para continuar.");
    }

    const {
      finalName,
      p1,
      p2,
      compiledRoster,
      captainCpf,
      contact,
      partnerName,
      partnerEmail,
      partnerCpf,
      partnerPhone,
      athletes,
      formattedCustomAnswers,
      declaredSkillLevel,
      uploadedReceiptPath,
    } = params;

    let newlyCreatedTeamId: string | null = null;

    const isDuplicateConflictError = (err: unknown): boolean => {
      if (!err || typeof err !== "object") {
        const str = String(err || "").toLowerCase();
        return (
          str.includes("409") ||
          str.includes("23505") ||
          str.includes("team_members_user_id_email_key") ||
          str.includes("duplicate key") ||
          str.includes("unique constraint")
        );
      }
      const e = err as { code?: unknown; status?: unknown; message?: unknown; details?: unknown };
      const code = String(e.code || "");
      const status = Number(e.status || 0);
      const msg = `${String(e.message || "")} ${String(e.details || "")}`.toLowerCase();
      return (
        status === 409 ||
        code === "23505" ||
        code === "409" ||
        msg.includes("409") ||
        msg.includes("23505") ||
        msg.includes("team_members_user_id_email_key") ||
        msg.includes("duplicate key") ||
        msg.includes("unique constraint")
      );
    };

    const mapDbTeamRow = (row: any): Team => ({
      id: row.id,
      name: row.name,
      user_id: row.user_id,
      players: [row.player1, row.player2],
      roster: row.roster,
      createdAt: row.created_at || new Date().toISOString(),
      status: row.status,
      tournamentId: row.tournament_id,
      payment_status: row.payment_status,
      payment_proof_url: row.payment_proof_url,
      manager_name: row.manager_name,
      category: row.category,
      contact: row.contact,
      custom_registration_answers: row.custom_registration_answers || formattedCustomAnswers,
    });

    const rollbackCreatedTeam = async (teamIdToRollback: string) => {
      try {
        await supabase.from("team_members").delete().eq("team_id", teamIdToRollback);
      } catch { }
      try {
        await supabase.from("teams").delete().eq("id", teamIdToRollback);
      } catch { }
      try {
        await deleteOrphanTeam(teamIdToRollback);
      } catch { }
    };

    try {
      // 0. Idempotência: verifica se o usuário já possui inscrição ativa/pendente neste torneio
      let targetTeamIdToReuse: string | null = createdTeam?.id || null;
      if (!targetTeamIdToReuse && user?.id) {
        const { data: existingRows } = await supabase
          .from("teams")
          .select("*")
          .eq("tournament_id", tournament.id)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        const activeExisting = (existingRows || []).find(
          (row: any) =>
            row.status !== "CANCELED" &&
            row.status !== "CANCELLED" &&
            row.payment_status !== "CANCELED" &&
            row.payment_status !== "CANCELLED" &&
            row.cancellation_status !== "REFUNDED"
        );

        if (activeExisting) {
          const alreadyConfirmed =
            activeExisting.status === "PAID" ||
            activeExisting.status === "CONFIRMED" ||
            activeExisting.payment_status === "PAID" ||
            activeExisting.payment_status === "APPROVED";

          if (alreadyConfirmed) {
            throw new Error("Esta equipa ou e-mail já está registada neste torneio.");
          }

          targetTeamIdToReuse = activeExisting.id;
        }
      }
      // 1. Prepara dados detalhados dos integrantes para persistência em 'teams'
      const rosterDetails = [
        {
          name: p1,
          email: user.email || "",
          is_captain: true,
          cpf: captainCpf.trim() || null,
          phone: contact.trim() || null,
        },
        ...(isDuplasSport && partnerName.trim()
          ? [
            {
              name: partnerName.trim(),
              email: partnerEmail.trim().toLowerCase(),
              is_captain: false,
              cpf: partnerCpf.trim() || null,
              phone: partnerPhone.trim() || null,
            },
          ]
          : isTeamSport
            ? athletes
              .filter((ath) => ath.name.trim())
              .map((ath) => ({
                name: ath.name.trim(),
                email: ath.email.trim().toLowerCase(),
                is_captain: false,
                cpf: ath.cpf?.trim() || null,
                phone: ath.phone?.trim() || null,
              }))
            : []),
      ];

      const skillLevelLabelMap: Record<string, string> = {
        BEGINNER: "Iniciante",
        INTERMEDIATE: "Intermediário",
        ADVANCED: "Avançado",
      };
      const resolvedSkillRaw = isAllSkillLevels ? declaredSkillLevel : (tournament.skill_level || "");
      const resolvedSkillDisplay =
        skillLevelLabelMap[String(resolvedSkillRaw || "").toUpperCase()] ||
        (resolvedSkillRaw && String(resolvedSkillRaw).toUpperCase() !== "ALL" && String(resolvedSkillRaw).toUpperCase() !== "LIVRE"
          ? String(resolvedSkillRaw)
          : "");

      const enrichedCustomAnswers: Record<string, any> = {
        ...(contact.trim() ? { "Contato (WhatsApp)": contact.trim() } : {}),
        ...(user.email ? { "E-mail": user.email } : {}),
        ...(captainCpf.trim() ? { [!isDuplasSport && !isTeamSport ? "CPF" : "CPF do Capitão"]: captainCpf.trim() } : {}),
        ...(isDuplasSport && partnerName.trim() ? { "Jogador 2 (Parceiro)": partnerName.trim() } : {}),
        ...(isDuplasSport && partnerEmail.trim() ? { "E-mail do Jogador 2": partnerEmail.trim().toLowerCase() } : {}),
        ...(isDuplasSport && partnerCpf.trim() ? { "CPF do Jogador 2": partnerCpf.trim() } : {}),
        ...(isDuplasSport && partnerPhone.trim() ? { "Telefone do Jogador 2": partnerPhone.trim() } : {}),
        ...(resolvedSkillDisplay ? { "Nível Técnico": resolvedSkillDisplay } : {}),
        ...formattedCustomAnswers,
        __athlete_members: rosterDetails,
      };

      const payload: any = {
        name: finalName,
        manager_name: p1,
        player1: p1,
        player2: p2 || "",
        roster: compiledRoster,
        contact: contact.trim(),
        tournament_id: tournament.id,
        user_id: user.id,
        payment_status: uploadedReceiptPath
          ? "WAITING_APPROVAL"
          : (entryFee > 0 ? "WAITING_PIX" : "APPROVED"),
        payment_proof_url: uploadedReceiptPath || null,
        status: entryFee > 0 ? "PENDING" : "CONFIRMED",
        amount_paid: entryFee > 0 ? entryFee : 0,
        category:
          String(tournament.gender_category || "").toUpperCase() === "MASCULINO"
            ? "Masculino"
            : String(tournament.gender_category || "").toUpperCase() === "FEMININO"
              ? "Feminino"
              : "Misto",
        custom_registration_answers: enrichedCustomAnswers,
        declared_skill_level: isAllSkillLevels ? declaredSkillLevel : null,
      };

      let { data: insertedTeam, error: insertError } = targetTeamIdToReuse
        ? await supabase
          .from("teams")
          .update(payload)
          .eq("id", targetTeamIdToReuse)
          .select()
          .single()
        : await supabase
          .from("teams")
          .insert(payload)
          .select()
          .single();

      if (
        insertError &&
        (insertError.code === "42703" ||
          insertError.code === "PGRST204" ||
          String(insertError.message).toLowerCase().includes("amount_paid")) &&
        "amount_paid" in payload
      ) {
        const safePayload = { ...payload };
        delete safePayload.amount_paid;
        const retryRes = targetTeamIdToReuse
          ? await supabase
            .from("teams")
            .update(safePayload)
            .eq("id", targetTeamIdToReuse)
            .select()
            .single()
          : await supabase
            .from("teams")
            .insert(safePayload)
            .select()
            .single();
        insertedTeam = retryRes.data;
        insertError = retryRes.error;
      }

      if (insertError || !insertedTeam) {
        console.error("ERRO COMPLETO AO INSERIR EQUIPE:", insertError);
        if (isDuplicateConflictError(insertError)) {
          throw new Error("Esta equipa ou e-mail já está registada neste torneio.");
        }
        throw insertError || new Error("Falha ao registrar equipe.");
      }

      if (!targetTeamIdToReuse && insertedTeam?.id) {
        newlyCreatedTeamId = insertedTeam.id;
      }

      // 2. Inserção estrita de membros na tabela team_members
      const teamMembersToInsert: {
        team_id: string;
        user_id: string | null;
        name: string;
        email: string;
        is_captain: boolean;
        cpf?: string | null;
        phone?: string | null;
      }[] = [];

      // A. Capitão informado no formulário (único com is_captain: true)
      teamMembersToInsert.push({
        team_id: insertedTeam.id,
        user_id: user.id,
        name: p1,
        email: user.email || "",
        is_captain: true,
        cpf: captainCpf.trim() || null,
        phone: contact.trim() || null,
      });

      // B. Parceiro informado no formulário (no caso de duplas, exatamente 1 atleta com is_captain: false)
      const otherMembers: {
        name: string;
        email: string;
        cpf?: string | null;
        phone?: string | null;
      }[] = [];

      if (isDuplasSport && partnerName.trim()) {
        otherMembers.push({
          name: partnerName.trim(),
          email: partnerEmail.trim().toLowerCase(),
          cpf: partnerCpf.trim() || null,
          phone: partnerPhone.trim() || null,
        });
      } else if (isTeamSport) {
        athletes.forEach((ath) => {
          if (ath.name.trim()) {
            otherMembers.push({
              name: ath.name.trim(),
              email: ath.email.trim().toLowerCase(),
              cpf: ath.cpf?.trim() || null,
              phone: ath.phone?.trim() || null,
            });
          }
        });
      }

      for (const member of otherMembers) {
        let matchedUserId: string | null = null;
        if (member.email) {
          try {
            const { data: profileFound } = await supabase
              .from("profiles")
              .select("id")
              .eq("email", member.email)
              .maybeSingle();

            if (profileFound?.id) {
              matchedUserId = profileFound.id;
            }
          } catch (pErr) {
            console.warn("Aviso ao buscar perfil por email:", pErr);
          }
        }

        teamMembersToInsert.push({
          team_id: insertedTeam.id,
          user_id: matchedUserId,
          name: member.name,
          email: member.email,
          is_captain: false,
          cpf: member.cpf || null,
          phone: member.phone || null,
        });
      }

      const sanitizedMembers = teamMembersToInsert.map((m) => ({
        team_id: m.team_id,
        user_id: m.user_id,
        email: m.email,
        is_captain: m.is_captain,
        ...(m.cpf ? { cpf: m.cpf } : {}),
        ...(m.phone ? { phone: m.phone } : {}),
      }));

      if (sanitizedMembers.length > 0) {
        if (targetTeamIdToReuse) {
          await supabase.from("team_members").delete().eq("team_id", targetTeamIdToReuse);
        }

        const { error: tmError } = await supabase
          .from("team_members")
          .insert(sanitizedMembers);

        if (tmError) {
          console.error("ERRO CRÍTICO AO INSERIR MEMBROS DA EQUIPE (ROLLBACK OBRIGATÓRIO):", tmError);
          if (newlyCreatedTeamId) {
            await rollbackCreatedTeam(newlyCreatedTeamId);
            newlyCreatedTeamId = null;
          }
          if (isDuplicateConflictError(tmError)) {
            throw new Error("Esta equipa ou e-mail já está registada neste torneio.");
          }
          throw tmError;
        }
      }

      const mappedTeam: Team = mapDbTeamRow(insertedTeam);

      setTeams((prev: Team[]) =>
        targetTeamIdToReuse
          ? prev.map((t) => (t.id === mappedTeam.id ? mappedTeam : t))
          : [...prev, mappedTeam]
      );
      setCreatedTeam(mappedTeam);

      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem(storageKey);
        } catch { }
      }

      try {
        await notifyNewRegistration({
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          teamName: finalName,
        });
      } catch { }

      return mappedTeam;
    } catch (err) {
      if (newlyCreatedTeamId) {
        await rollbackCreatedTeam(newlyCreatedTeamId);
      }
      if (isDuplicateConflictError(err)) {
        throw new Error("Esta equipa ou e-mail já está registada neste torneio.");
      }
      throw err;
    }
  };

  // Callback de persistência atrasada acionada a partir do checkout (Anexar Comprovante ou Pagar Mais Tarde)
  const commitDelayedRegistration = async (options: {
    receiptFile?: File | null;
    isPayLater?: boolean;
  }): Promise<{ success: boolean; teamId?: string; error?: string }> => {
    if (!pendingRegistrationData && !createdTeam?.id) {
      return { success: false, error: "Dados da inscrição pendente não encontrados." };
    }

    if (createdTeam?.id) {
      return { success: true, teamId: createdTeam.id };
    }

    try {
      let uploadedReceiptPath: string | null = null;

      if (options.receiptFile) {
        const file = options.receiptFile;
        const fileExt = file.name.split(".").pop() || "png";
        const filePath = `${user!.id}-${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("receipts")
          .upload(filePath, file, {
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) {
          console.error("Erro no upload do comprovante no checkout:", uploadError);
          return { success: false, error: "Erro ao fazer upload do comprovante." };
        }
        uploadedReceiptPath = filePath;
      }

      const team = await executeTeamAndMembersInsert({
        ...pendingRegistrationData!,
        uploadedReceiptPath,
        isPayLater: options.isPayLater,
      });

      return { success: true, teamId: team.id };
    } catch (err: unknown) {
      console.error("Erro em commitDelayedRegistration:", err);
      const msg = err instanceof Error ? err.message : "Erro ao salvar inscrição.";
      return { success: false, error: msg };
    }
  };

  if (!isOpen) return null;

  // Se já preencheu e houver taxa, renderiza a tela de checkout Pix dinâmico
  if (step === "checkout") {
    const activeTeam = createdTeam || activeInitialData;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto animate-fadeIn">
        <PixCheckoutForm
          tournamentId={tournament.id}
          tournamentName={tournament.name}
          teamId={activeTeam?.id || ""}
          teamName={
            pendingRegistrationData?.finalName ||
            activeTeam?.name ||
            teamName
          }
          captainName={
            pendingRegistrationData?.p1 ||
            activeTeam?.manager_name ||
            (Array.isArray(activeTeam?.players) ? activeTeam?.players[0] : "") ||
            captainName ||
            "Capitão"
          }
          totalAmount={entryFee}
          sportType={sportType}
          email={user?.email || undefined}
          initialReceiptUrl={activeTeam?.payment_proof_url || undefined}
          onBack={() => setStep("form")}
          onClose={onClose}
          onSuccess={() => {
            onSuccess?.();
            onClose();
          }}
          onCommitRegistration={commitDelayedRegistration}
        />
      </div>
    );
  }

  // Manipuladores de atletas adicionais (Futsal / Vôlei)
  const maxPlayersLimit =
    tournament.max_players !== null && tournament.max_players !== undefined && Number(tournament.max_players) > 0
      ? Number(tournament.max_players)
      : null;
  const isMaxPlayersReached = Boolean(maxPlayersLimit !== null && athletes.length + 1 >= maxPlayersLimit);

  // Manipuladores de atletas adicionais (Futsal / Vôlei)
  const handleAddAthlete = () => {
    if (isMaxPlayersReached) return;
    setAthletes((prev) => [...prev, { name: "", email: "", cpf: "", phone: "" }]);
  };

  const handleUpdateAthlete = (
    index: number,
    field: "name" | "email" | "cpf" | "phone",
    val: string
  ) => {
    setAthletes((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  };

  const handleRemoveAthlete = (index: number) => {
    setAthletes((prev) => prev.filter((_, i) => i !== index));
  };

  // Submissão do Formulário de Inscrição
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    // 1. Validação de Campos
    if (isPingPongSolo) {
      if (!captainName.trim()) {
        setErrorMessage("Por favor, preencha o Nome do Jogador.");
        return;
      }
      if (!contact.trim()) {
        setErrorMessage("Por favor, informe seu Contato (WhatsApp).");
        return;
      }
    } else if (isDuplasSport) {
      if (!teamName.trim() || !captainName.trim() || !partnerName.trim()) {
        setErrorMessage("Por favor, preencha o Nome da Dupla, Capitão e Parceiro.");
        return;
      }
      if (!contact.trim()) {
        setErrorMessage("Por favor, informe o Contato do Capitão.");
        return;
      }
    } else {
      // Esporte coletivo (Futsal / Vôlei)
      if (!teamName.trim() || !captainName.trim()) {
        setErrorMessage("Por favor, preencha o Nome da Equipe e do Responsável.");
        return;
      }
      if (!contact.trim()) {
        setErrorMessage("Por favor, informe o Contato do Responsável.");
        return;
      }
    }

    // 1.05 Validação de Dados Exigidos dos Atletas (CPF e Telefone/WhatsApp) e Nível Técnico Autodeclarado
    if (isAllSkillLevels && !declaredSkillLevel) {
      setErrorMessage(
        isPingPongSolo
          ? "Por favor, selecione o seu nível de jogo."
          : "Por favor, selecione o nível técnico da equipe."
      );
      return;
    }
    if (requireCpf) {
      if (!captainCpf.trim() || captainCpf.replace(/\D/g, "").length < 11) {
        setErrorMessage("Por favor, informe um CPF válido (11 dígitos) para o Capitão / Responsável.");
        return;
      }
      if (isDuplasSport && (!partnerCpf.trim() || partnerCpf.replace(/\D/g, "").length < 11)) {
        setErrorMessage("Por favor, informe um CPF válido (11 dígitos) para o Parceiro.");
        return;
      }
      if (isTeamSport) {
        for (let i = 0; i < athletes.length; i++) {
          const ath = athletes[i];
          if (ath.name.trim() && (!ath.cpf?.trim() || ath.cpf.replace(/\D/g, "").length < 11)) {
            setErrorMessage(`Por favor, informe um CPF válido para o atleta "${ath.name.trim()}".`);
            return;
          }
        }
      }
    }

    if (requirePhone) {
      if (!contact.trim()) {
        setErrorMessage("Por favor, informe o Telefone/WhatsApp do Capitão / Responsável.");
        return;
      }
      if (isDuplasSport && !partnerPhone.trim()) {
        setErrorMessage("Por favor, informe o Telefone/WhatsApp do Parceiro.");
        return;
      }
      if (isTeamSport) {
        for (let i = 0; i < athletes.length; i++) {
          const ath = athletes[i];
          if (ath.name.trim() && !ath.phone?.trim()) {
            setErrorMessage(`Por favor, informe o Telefone/WhatsApp do atleta "${ath.name.trim()}".`);
            return;
          }
        }
      }
    }

    // 1.1 Validação de Campos Personalizados Obrigatórios
    for (const field of customFields) {
      if (field.required) {
        const val = customAnswers[field.label];
        if (field.type === "checkbox") {
          if (!val || val === "Não" || val === false) {
            setErrorMessage(`Por favor, responda/marque o campo obrigatório: "${field.label}".`);
            return;
          }
        } else {
          if (val === undefined || val === null || String(val).trim() === "") {
            setErrorMessage(`Por favor, preencha o campo obrigatório: "${field.label}".`);
            return;
          }
        }
      }
    }

    // 1.2 Validação de Status do Torneio
    if (tournament.status && tournament.status !== "OPEN") {
      setErrorMessage(
        isEditMode
          ? "Não é possível editar a inscrição: o chaveamento do torneio já foi gerado."
          : "As inscrições para este torneio estão encerradas."
      );
      setIsSubmitting(false);
      return;
    }

    // 1.3 Validação Obrigatória de Autenticação para Inscrição
    if (!user || !user.id) {
      const authErrorMsg = "Usuário não autenticado. Faça login para se inscrever.";
      setErrorMessage(authErrorMsg);
      setIsSubmitting(false);
      throw new Error(authErrorMsg);
    }

    setIsSubmitting(true);
    let newlyCreatedTeamId: string | null = null;

    try {
      // 2. Compilação do Elenco (Roster)
      let compiledRoster: string[] = [];
      let finalName = "";
      let p1 = "";
      let p2 = "";

      if (isPingPongSolo) {
        finalName = teamName.trim() || captainName.trim();
        p1 = captainName.trim();
        p2 = "";
        compiledRoster = [p1];
      } else if (isDuplasSport) {
        finalName = teamName.trim();
        p1 = captainName.trim();
        p2 = partnerName.trim();
        compiledRoster = [p1, p2];
      } else {
        finalName = teamName.trim();
        p1 = captainName.trim();
        p2 = "";
        const validAthletes = athletes.map((a) => a.name.trim()).filter(Boolean);
        compiledRoster = [p1, ...validAthletes];
      }

      // Validação de Tamanho do Elenco (se configurado pelo organizador)
      if (tournament.min_players && compiledRoster.length < tournament.min_players) {
        setErrorMessage(
          `A sua equipa precisa ter no mínimo ${tournament.min_players} atletas.`
        );
        setIsSubmitting(false);
        return;
      }
      if (
        tournament.max_players &&
        (compiledRoster.length > Number(tournament.max_players) ||
          (isTeamSport && athletes.length + 1 > Number(tournament.max_players)))
      ) {
        setErrorMessage(
          `A sua equipa ultrapassou o limite de ${tournament.max_players} atletas.`
        );
        setIsSubmitting(false);
        return;
      }

      // 3. Upload Obrigatório do Comprovante (se anexado pelo atleta) ANTES do INSERT na tabela teams
      let uploadedReceiptPath: string | null = null;

      if (receiptFile) {
        if (receiptFile.size > 5 * 1024 * 1024) {
          setErrorMessage("Erro ao enviar o comprovante. O arquivo deve ter no máximo 5MB.");
          setIsSubmitting(false);
          return;
        }

        try {
          const fileExt = receiptFile.name.split(".").pop() || "png";
          const cleanFileName = `${user.id}-${Date.now()}.${fileExt}`;
          const filePath = `${cleanFileName}`;

          const { error: uploadError } = await supabase.storage
            .from("receipts")
            .upload(filePath, receiptFile, {
              cacheControl: "3600",
              upsert: false,
            });

          if (uploadError) {
            console.error("Erro ao enviar comprovante no Supabase Storage:", uploadError);
            setErrorMessage("Erro ao enviar o comprovante. Verifique sua conexão e tente novamente.");
            setIsSubmitting(false);
            return;
          }

          uploadedReceiptPath = filePath;
        } catch (uploadCatchErr) {
          console.error("Exceção ao fazer upload do comprovante:", uploadCatchErr);
          setErrorMessage("Erro ao enviar o comprovante. Verifique sua conexão e tente novamente.");
          setIsSubmitting(false);
          return;
        }
      }

      // 4. Montagem do payload e Insert na tabela teams (user_id obrigatório)
      const formattedCustomAnswers: Record<string, any> = {};
      for (const field of customFields) {
        const val = customAnswers[field.label];
        if (field.type === "checkbox") {
          formattedCustomAnswers[field.label] = val === true || val === "Sim" ? "Sim" : "Não";
        } else if (val !== undefined && val !== null && String(val).trim() !== "") {
          formattedCustomAnswers[field.label] = String(val).trim();
        }
      }

      // Se estiver em modo de edição de inscrição existente, chama a Server Action com trava de chaveamento
      if (isEditMode && activeInitialData?.id) {
        const otherEditMembers: {
          name: string;
          email: string;
          cpf?: string | null;
          phone?: string | null;
        }[] = [];
        if (isDuplasSport && partnerName.trim()) {
          otherEditMembers.push({
            name: partnerName.trim(),
            email: partnerEmail.trim().toLowerCase(),
            cpf: partnerCpf.trim() || null,
            phone: partnerPhone.trim() || null,
          });
        } else if (isTeamSport) {
          athletes.forEach((ath) => {
            if (ath.name.trim()) {
              otherEditMembers.push({
                name: ath.name.trim(),
                email: ath.email.trim().toLowerCase(),
                cpf: ath.cpf?.trim() || null,
                phone: ath.phone?.trim() || null,
              });
            }
          });
        }

        const editMembersPayload: {
          user_id?: string | null;
          name: string;
          email: string;
          is_captain: boolean;
          cpf?: string | null;
          phone?: string | null;
        }[] = [
            {
              user_id: user.id,
              name: p1,
              email: user.email || "",
              is_captain: true,
              cpf: captainCpf.trim() || null,
              phone: contact.trim() || null,
            },
          ];

        for (const member of otherEditMembers) {
          let matchedUserId: string | null = null;
          if (member.email) {
            try {
              const { data: profileFound } = await supabase
                .from("profiles")
                .select("id")
                .eq("email", member.email)
                .maybeSingle();
              if (profileFound?.id) matchedUserId = profileFound.id;
            } catch {
              // ignore
            }
          }
          editMembersPayload.push({
            user_id: matchedUserId,
            name: member.name,
            email: member.email,
            is_captain: false,
            cpf: member.cpf || null,
            phone: member.phone || null,
          });
        }

        const res = await updateRegistration(activeInitialData.id, {
          name: finalName,
          manager_name: p1,
          player1: p1,
          player2: p2 || "",
          roster: compiledRoster,
          contact: contact.trim(),
          custom_registration_answers: formattedCustomAnswers,
          declared_skill_level: isAllSkillLevels ? declaredSkillLevel : null,
          members: editMembersPayload,
        });

        if (!res.success) {
          setErrorMessage(
            res.error || "Não é possível editar a inscrição: o chaveamento do torneio já foi gerado."
          );
          setIsSubmitting(false);
          return;
        }

        const updatedTeamData = res.data || activeInitialData;
        const updatedMappedTeam: Team = {
          id: activeInitialData.id,
          name: finalName,
          user_id: user.id,
          players: [p1, p2 || ""],
          roster: compiledRoster,
          createdAt: updatedTeamData.created_at || activeInitialData.createdAt || new Date().toISOString(),
          status: updatedTeamData.status || activeInitialData.status,
          tournamentId: tournament.id,
          payment_status: updatedTeamData.payment_status || activeInitialData.payment_status,
          payment_proof_url: updatedTeamData.payment_proof_url || activeInitialData.payment_proof_url,
          manager_name: p1,
          category: updatedTeamData.category || "Geral",
          contact: contact.trim(),
          custom_registration_answers: formattedCustomAnswers,
          declared_skill_level: isAllSkillLevels ? declaredSkillLevel : null,
        };

        setTeams((prev: Team[]) =>
          prev.map((t) => (t.id === updatedMappedTeam.id ? updatedMappedTeam : t))
        );

        if (typeof window !== "undefined") {
          try {
            localStorage.removeItem(storageKey);
          } catch { }
        }

        onSuccess?.();
        onClose();
        return;
      }

      // Se houver taxa de inscrição e o atleta NÃO anexou comprovante prévio nesta etapa inicial:
      // Verifica antes se já existe inscrição pendente (idempotência) para retomar o pagamento sem duplicar
      if (!isEditMode && !createdTeam?.id && user?.id) {
        const { data: existingTeams } = await supabase
          .from("teams")
          .select("*")
          .eq("tournament_id", tournament.id)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        const activeExisting = (existingTeams || []).find(
          (row: any) =>
            row.status !== "CANCELED" &&
            row.status !== "CANCELLED" &&
            row.payment_status !== "CANCELED" &&
            row.payment_status !== "CANCELLED" &&
            row.cancellation_status !== "REFUNDED"
        );

        if (activeExisting) {
          const isAlreadyConfirmed =
            activeExisting.status === "PAID" ||
            activeExisting.status === "CONFIRMED" ||
            activeExisting.payment_status === "PAID" ||
            activeExisting.payment_status === "APPROVED";

          if (isAlreadyConfirmed) {
            const msg = "Esta equipa ou e-mail já está registada neste torneio.";
            setErrorMessage(msg);
            setToast({ message: msg, type: "error" });
            setIsSubmitting(false);
            return;
          }

          if (entryFee > 0) {
            const existingMappedTeam: Team = {
              id: activeExisting.id,
              name: activeExisting.name,
              user_id: activeExisting.user_id,
              players: [activeExisting.player1, activeExisting.player2],
              roster: activeExisting.roster,
              createdAt: activeExisting.created_at || new Date().toISOString(),
              status: activeExisting.status,
              tournamentId: activeExisting.tournament_id,
              payment_status: activeExisting.payment_status,
              payment_proof_url: activeExisting.payment_proof_url,
              manager_name: activeExisting.manager_name,
              category: activeExisting.category,
              contact: activeExisting.contact,
              custom_registration_answers:
                activeExisting.custom_registration_answers || formattedCustomAnswers,
            };
            setCreatedTeam(existingMappedTeam);
            setIsSubmitting(false);
            setStep("checkout");
            return;
          }
        }
      }

      // Aplica o atraso na inserção (Delayed DB Insert). Os dados validados são mantidos no estado local
      // e nenhuma gravação ocorre no Supabase até que o comprovante seja anexado ou o pagamento postergado no checkout.
      if (entryFee > 0 && !uploadedReceiptPath && !isEditMode) {
        setPendingRegistrationData({
          finalName,
          p1,
          p2,
          compiledRoster,
          captainCpf,
          contact,
          partnerName,
          partnerEmail,
          partnerCpf,
          partnerPhone,
          athletes,
          formattedCustomAnswers,
          declaredSkillLevel,
        });
        setIsSubmitting(false);
        setStep("checkout");
        return;
      }

      // Torneio gratuito ou inscrição com comprovante já anexado na tela inicial
      const mappedTeam = await executeTeamAndMembersInsert({
        finalName,
        p1,
        p2,
        compiledRoster,
        captainCpf,
        contact,
        partnerName,
        partnerEmail,
        partnerCpf,
        partnerPhone,
        athletes,
        formattedCustomAnswers,
        declaredSkillLevel,
        uploadedReceiptPath,
      });

      // Se houver taxa de inscrição, transiciona para o Checkout Pix Dinâmico
      if (entryFee > 0) {
        setCreatedTeam(mappedTeam);
        setStep("checkout");
      } else {
        // Se for gratuito, conclui com sucesso direto
        setIsSuccess(true);
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 2500);
      }
    } catch (err: unknown) {
      console.error("ERRO COMPLETO NA INSCRIÇÃO:", err);
      const rawErr = err as { code?: unknown; status?: unknown; message?: unknown; details?: unknown } | null;
      const errText = `${String(rawErr?.message || "")} ${String(rawErr?.details || "")}`.toLowerCase();
      const isConflict =
        Number(rawErr?.status || 0) === 409 ||
        String(rawErr?.code || "") === "23505" ||
        errText.includes("409") ||
        errText.includes("23505") ||
        errText.includes("team_members_user_id_email_key") ||
        errText.includes("duplicate key") ||
        errText.includes("já está registada");

      const userMessage = isConflict
        ? "Esta equipa ou e-mail já está registada neste torneio."
        : (err instanceof Error && err.message
            ? err.message
            : "Erro ao registar equipa. Por favor, tente novamente.");
      setErrorMessage(userMessage);
      setToast({ message: userMessage, type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto animate-fadeIn">
      {/* Toast Notificação de Erro / Sucesso */}
      {toast && (
        <div className="fixed top-6 right-6 z-[9999] animate-fadeIn max-w-sm w-full px-4 pointer-events-none">
          <div
            className={`flex items-center justify-between gap-3 p-4 rounded-2xl shadow-2xl border backdrop-blur-md pointer-events-auto ${toast.type === "error"
              ? "bg-red-950/95 border-red-500/40 text-red-100 shadow-red-500/10"
              : "bg-emerald-950/95 border-emerald-500/40 text-emerald-100 shadow-emerald-500/10"
              }`}
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
              <span className="text-xs font-bold leading-relaxed">{toast.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-zinc-400 hover:text-white transition-colors cursor-pointer p-0.5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="bg-[#121214] border border-[#27272a] rounded-3xl p-6 sm:p-8 max-w-xl w-full text-white shadow-2xl relative max-h-[92vh] overflow-y-auto selection:bg-orange-500/30 selection:text-white">
        {/* Linha superior decorativa */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-500 via-amber-400 to-yellow-500" />

        {/* Botão de Fechar */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          title="Fechar"
        >
          <X className="h-5 w-5" />
        </button>

        {isSuccess ? (
          /* Feedback de Sucesso para Inscrição Gratuita */
          <div className="py-8 text-center space-y-4 animate-fadeIn">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
              <CheckCircle2 className="h-10 w-10 animate-bounce" />
            </div>
            <h3 className="text-2xl font-black font-display uppercase tracking-tight text-white">
              Inscrição Concluída com Sucesso!
            </h3>
            <p className="text-sm text-zinc-300 max-w-md mx-auto leading-relaxed">
              Sua equipe foi confirmada na competição oficial. Boa sorte!
            </p>
            <div className="pt-4">
              <button
                type="button"
                onClick={() => {
                  onSuccess?.();
                  onClose();
                }}
                className="py-3 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer"
              >
                Concluir
              </button>
            </div>
          </div>
        ) : (
          /* Formulário de Inscrição */
          <div className="space-y-6">
            {/* Cabeçalho */}
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[11px] font-black uppercase tracking-wider mb-2">
                <Sparkles className="h-3 w-3" />
                <span>{isEditMode ? "Editar Inscrição" : "Inscrição Oficial"}</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black font-display tracking-tight text-white">
                {tournament.name}
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Modalidade: <strong className="text-zinc-200">{sportType}</strong>
                {tournament.format ? ` • Formato: ${tournament.format}` : ""}
              </p>
            </div>

            {/* Aviso Visual de Restrições da Competição (Idade e Elenco) */}
            {hasRestrictions && (
              <div className="p-4 rounded-2xl bg-purple-500/10 border border-purple-500/30 text-purple-200 text-xs space-y-2 animate-fadeIn shadow-lg shadow-purple-500/5">
                <div className="flex items-center gap-2 font-black uppercase tracking-wider text-purple-400 text-[11px]">
                  <Shield className="h-4 w-4 shrink-0 text-purple-400" />
                  <span>Aviso de Restrições Oficiais da Competição</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
                  {ageRestrictionText && (
                    <div className="flex items-center gap-2.5 bg-[#18181b] p-2.5 rounded-xl border border-purple-500/25">
                      <span className="text-base select-none">🎂</span>
                      <div>
                        <span className="text-[10px] text-zinc-500 font-bold uppercase block">Idade Permitida</span>
                        <span className="font-bold text-zinc-100">{ageRestrictionText}</span>
                      </div>
                    </div>
                  )}
                  {squadRestrictionText && (
                    <div className="flex items-center gap-2.5 bg-[#18181b] p-2.5 rounded-xl border border-cyan-500/25">
                      <span className="text-base select-none">👥</span>
                      <div>
                        <span className="text-[10px] text-zinc-500 font-bold uppercase block">Tamanho do Elenco</span>
                        <span className="font-bold text-zinc-100">{squadRestrictionText}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Aviso de Rascunho Recuperado do LocalStorage */}
            {hasRestoredDraft && !isEditMode && (
              <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs flex items-center justify-between gap-2 animate-fadeIn">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 shrink-0 text-orange-400" />
                  <span>Rascunho recuperado automaticamente.</span>
                </div>
                <button
                  type="button"
                  onClick={handleClearDraft}
                  className="text-[11px] font-bold underline hover:text-white transition-colors cursor-pointer"
                >
                  Limpar
                </button>
              </div>
            )}

            {/* Mensagem de Erro Visual */}
            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* 1. Campos Dinâmicos (Adaptação ao Esporte) */}
              <div className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-wider text-zinc-300 flex items-center gap-2 border-b border-[#27272a] pb-2">
                  <Users className="h-4 w-4 text-orange-500" />
                  <span>Dados dos Participantes</span>
                </h3>

                {/* Caso 1: Ping Pong Solo */}
                {isPingPongSolo && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Nome do Jogador <span className="text-orange-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={captainName}
                        onChange={(e) => setCaptainName(e.target.value)}
                        placeholder="Ex: Carlos Augusto"
                        className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                      />
                    </div>

                    <div className={requireCpf ? "space-y-1.5" : "hidden"}>
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        CPF do Atleta <span className="text-orange-500">*</span>
                      </label>
                      <input
                        type="text"
                        required={requireCpf}
                        maxLength={14}
                        value={captainCpf}
                        onChange={(e) => setCaptainCpf(formatCpfMask(e.target.value))}
                        placeholder="000.000.000-00"
                        className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Contato (WhatsApp) <span className="text-orange-500">*</span>
                      </label>
                      <div className="relative">
                        <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                        <input
                          type="text"
                          required
                          value={contact}
                          onChange={(e) => setContact(e.target.value)}
                          placeholder="(89) 99999-9999"
                          className="w-full pl-10 pr-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Caso 2: Dominó, Ping Pong Duplas ou Vôlei de Areia Duplas */}
                {isDuplasSport && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Nome da Dupla <span className="text-orange-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value)}
                        placeholder="Ex: Os Carrascos do Carroça"
                        className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                          Nome Completo do Capitão <span className="text-orange-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={captainName}
                          onChange={(e) => setCaptainName(e.target.value)}
                          placeholder="Capitão da Dupla"
                          className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                          Nome Completo do Parceiro <span className="text-orange-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={partnerName}
                          onChange={(e) => setPartnerName(e.target.value)}
                          placeholder="Jogador 2"
                          className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                        />
                      </div>
                    </div>

                    {/* E-mail do Parceiro para vínculo automático de perfil */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                          E-mail do Parceiro
                        </label>
                        <span className="text-[10px] text-zinc-500">
                          Vincula estatísticas automaticamente
                        </span>
                      </div>
                      <div className="relative">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                        <input
                          type="email"
                          value={partnerEmail}
                          onChange={(e) => setPartnerEmail(e.target.value)}
                          placeholder="parceiro@exemplo.com (caso possua conta)"
                          className="w-full pl-10 pr-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                        />
                      </div>
                    </div>

                    {requireCpf && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                            CPF do Capitão <span className="text-orange-500">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            maxLength={14}
                            value={captainCpf}
                            onChange={(e) => setCaptainCpf(formatCpfMask(e.target.value))}
                            placeholder="000.000.000-00"
                            className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                            CPF do Parceiro <span className="text-orange-500">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            maxLength={14}
                            value={partnerCpf}
                            onChange={(e) => setPartnerCpf(formatCpfMask(e.target.value))}
                            placeholder="000.000.000-00"
                            className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                          />
                        </div>
                      </div>
                    )}

                    <div className={requirePhone ? "space-y-1.5" : "hidden"}>
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Telefone / WhatsApp do Parceiro <span className="text-orange-500">*</span>
                      </label>
                      <div className="relative">
                        <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                        <input
                          type="text"
                          required={requirePhone}
                          maxLength={15}
                          value={partnerPhone}
                          onChange={(e) => setPartnerPhone(formatPhoneMask(e.target.value))}
                          placeholder="(89) 99999-9999"
                          className="w-full pl-10 pr-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Contato do Capitão (WhatsApp) <span className="text-orange-500">*</span>
                      </label>
                      <div className="relative">
                        <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                        <input
                          type="text"
                          required
                          value={contact}
                          onChange={(e) => setContact(e.target.value)}
                          placeholder="(89) 99999-9999"
                          className="w-full pl-10 pr-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Caso 3: Futsal ou Vôlei Quadra / 4x4 */}
                {isTeamSport && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Nome da Equipe <span className="text-orange-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value)}
                        placeholder="Ex: Falcões Futsal Clube"
                        className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                          Nome do Responsável / Capitão <span className="text-orange-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={captainName}
                          onChange={(e) => setCaptainName(e.target.value)}
                          placeholder="Responsável pelo time"
                          className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                          Contato do Responsável (WhatsApp) <span className="text-orange-500">*</span>
                        </label>
                        <div className="relative">
                          <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                          <input
                            type="text"
                            required
                            value={contact}
                            onChange={(e) => setContact(e.target.value)}
                            placeholder="(89) 99999-9999"
                            className="w-full pl-10 pr-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Secção de Elenco (Array Dinâmico de Membros com Nome e E-mail) */}
                    <div className="pt-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                            Elenco da Equipe ({athletes.length + 1} no total)
                          </label>
                          <p className="text-[10px] text-zinc-500">
                            Informe os e-mails para vincular automaticamente às contas dos atletas
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleAddAthlete}
                          disabled={isMaxPlayersReached}
                          title={
                            isMaxPlayersReached
                              ? `Limite máximo de ${tournament.max_players} atletas atingido`
                              : "Adicionar membro ao elenco"
                          }
                          className="text-xs text-orange-400 hover:text-orange-300 font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:text-zinc-500 disabled:hover:text-zinc-500 disabled:cursor-not-allowed transition-opacity"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Adicionar Membro</span>
                        </button>
                      </div>

                      <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2.5 rounded-xl bg-zinc-900/60 border border-zinc-800">
                          <input
                            type="text"
                            disabled
                            value={`Capitão: ${captainName || "Responsável"}`}
                            className="flex-1 px-3 py-1.5 bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 rounded-lg cursor-not-allowed"
                          />
                          <input
                            type="text"
                            disabled
                            value={user?.email || "Email autenticado"}
                            className="flex-1 px-3 py-1.5 bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 rounded-lg cursor-not-allowed"
                          />
                          {requireCpf && (
                            <input
                              type="text"
                              required
                              maxLength={14}
                              value={captainCpf}
                              onChange={(e) => setCaptainCpf(formatCpfMask(e.target.value))}
                              placeholder="CPF do Capitão (000.000.000-00) *"
                              className="flex-1 px-3 py-1.5 bg-[#141416] border border-[#27272a] focus:border-orange-500 text-xs text-zinc-100 placeholder:text-zinc-500 rounded-lg outline-none"
                            />
                          )}
                          {requirePhone && (
                            <input
                              type="text"
                              required
                              maxLength={15}
                              value={contact}
                              onChange={(e) => setContact(formatPhoneMask(e.target.value))}
                              placeholder="WhatsApp (00) 00000-0000 *"
                              className="flex-1 px-3 py-1.5 bg-[#141416] border border-[#27272a] focus:border-orange-500 text-xs text-zinc-100 placeholder:text-zinc-500 rounded-lg outline-none"
                            />
                          )}
                          <input
                            type="hidden"
                            className="flex-1 px-3 py-1.5 bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 rounded-lg cursor-not-allowed"
                          />
                          <span className="text-[10px] text-orange-400 font-bold px-2 py-1 bg-orange-500/10 border border-orange-500/20 rounded-lg self-start sm:self-center">
                            Capitão
                          </span>
                        </div>

                        {athletes.map((ath, idx) => (
                          <div key={idx} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2.5 rounded-xl bg-[#0f0f0f] border border-[#27272a] animate-fadeIn">
                            <input
                              type="text"
                              value={ath.name}
                              onChange={(e) => handleUpdateAthlete(idx, "name", e.target.value)}
                              placeholder={`Nome do Membro #${idx + 2}`}
                              className="flex-1 px-3 py-1.5 bg-[#141416] border border-[#27272a] focus:border-orange-500 text-xs text-zinc-100 placeholder:text-zinc-600 rounded-lg outline-none"
                            />
                            <input
                              type="email"
                              value={ath.email}
                              onChange={(e) => handleUpdateAthlete(idx, "email", e.target.value)}
                              placeholder="E-mail (para vincular perfil)"
                              className="flex-1 px-3 py-1.5 bg-[#141416] border border-[#27272a] focus:border-orange-500 text-xs text-zinc-100 placeholder:text-zinc-600 rounded-lg outline-none"
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
                                className="flex-1 px-3 py-1.5 bg-[#141416] border border-[#27272a] focus:border-orange-500 text-xs text-zinc-100 placeholder:text-zinc-600 rounded-lg outline-none"
                              />
                            )}
                            <input
                              type={requirePhone ? "text" : "hidden"}
                              required={requirePhone}
                              maxLength={15}
                              value={ath.phone || ""}
                              onChange={(e) =>
                                handleUpdateAthlete(idx, "phone", formatPhoneMask(e.target.value))
                              }
                              placeholder="WhatsApp (00) 00000-0000 *"
                              className="flex-1 px-3 py-1.5 bg-[#141416] border border-[#27272a] focus:border-orange-500 text-xs text-zinc-100 placeholder:text-zinc-600 rounded-lg outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleRemoveAthlete(idx)}
                              className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors cursor-pointer self-end sm:self-center"
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
              </div>

              {/* Renderização Dinâmica dos Campos Personalizados (Configurados pelo Organizador) */}
              {isAllSkillLevels && (
                <div className="pt-1 space-y-1.5">
                  <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                    {isPingPongSolo
                      ? "Qual o seu nível de jogo?"
                      : "Qual o nível técnico da equipe?"}{" "}
                    <span className="text-orange-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      required
                      value={declaredSkillLevel}
                      onChange={(e) => setDeclaredSkillLevel(e.target.value)}
                      className="w-full pl-4 pr-10 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 outline-none transition-all appearance-none cursor-pointer shadow-inner"
                    >
                      <option value="" className="bg-[#121214] text-zinc-500">
                        Selecione o nível técnico...
                      </option>
                      <option value="BEGINNER" className="bg-[#121214] text-zinc-100">
                        Iniciante
                      </option>
                      <option value="INTERMEDIATE" className="bg-[#121214] text-zinc-100">
                        Intermediário
                      </option>
                      <option value="ADVANCED" className="bg-[#121214] text-zinc-100">
                        Avançado
                      </option>
                    </select>
                    <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                  </div>
                </div>
              )}

              {/* Renderização Dinâmica dos Campos Personalizados (Configurados pelo Organizador) */}
              {customFields.length > 0 && (
                <div className="pt-2 space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-wider text-zinc-300 flex items-center gap-2 border-b border-[#27272a] pb-2">
                    <FileText className="h-4 w-4 text-orange-400" />
                    <span>Perguntas da Inscrição</span>
                  </h3>

                  <div className="space-y-3">
                    {customFields.map((field) => {
                      const value = customAnswers[field.label] ?? "";

                      if (field.type === "text") {
                        return (
                          <div key={field.id} className="space-y-1.5">
                            <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                              {field.label} {field.required && <span className="text-orange-500">*</span>}
                            </label>
                            <input
                              type="text"
                              required={field.required}
                              value={value}
                              onChange={(e) => handleCustomAnswerChange(field.label, e.target.value)}
                              placeholder={`Sua resposta para ${field.label}`}
                              className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                            />
                          </div>
                        );
                      }

                      if (field.type === "textarea") {
                        return (
                          <div key={field.id} className="space-y-1.5">
                            <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                              {field.label} {field.required && <span className="text-orange-500">*</span>}
                            </label>
                            <textarea
                              rows={3}
                              required={field.required}
                              value={value}
                              onChange={(e) => handleCustomAnswerChange(field.label, e.target.value)}
                              placeholder={`Sua resposta para ${field.label}`}
                              className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all resize-y shadow-inner"
                            />
                          </div>
                        );
                      }

                      if (field.type === "select") {
                        return (
                          <div key={field.id} className="space-y-1.5">
                            <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                              {field.label} {field.required && <span className="text-orange-500">*</span>}
                            </label>
                            <div className="relative">
                              <select
                                required={field.required}
                                value={value}
                                onChange={(e) => handleCustomAnswerChange(field.label, e.target.value)}
                                className="w-full pl-4 pr-10 py-3 bg-[#0f0f0f] border border-[#27272a] focus:border-orange-500 rounded-xl text-sm text-zinc-100 outline-none transition-all appearance-none cursor-pointer"
                              >
                                <option value="" className="bg-[#121214] text-zinc-500">
                                  Selecione uma opção...
                                </option>
                                {(field.options || []).map((opt, i) => (
                                  <option key={i} value={opt} className="bg-[#121214] text-zinc-100">
                                    {opt}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                            </div>
                          </div>
                        );
                      }

                      if (field.type === "checkbox") {
                        const isChecked = Boolean(value === "Sim" || value === true);
                        return (
                          <div
                            key={field.id}
                            onClick={() => handleCustomAnswerChange(field.label, isChecked ? "Não" : "Sim")}
                            className="flex items-center gap-3 p-3.5 bg-[#0f0f0f] border border-[#27272a] hover:border-zinc-700 rounded-xl cursor-pointer transition-all select-none"
                          >
                            <input
                              type="checkbox"
                              id={`cb-${field.id}`}
                              checked={isChecked}
                              onChange={(e) => handleCustomAnswerChange(field.label, e.target.checked ? "Sim" : "Não")}
                              className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-orange-500 focus:ring-orange-500 cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <label
                              htmlFor={`cb-${field.id}`}
                              className="text-sm font-medium text-zinc-200 cursor-pointer flex-1"
                            >
                              {field.label} {field.required && <span className="text-orange-500">*</span>}
                            </label>
                          </div>
                        );
                      }

                      return null;
                    })}
                  </div>
                </div>
              )}

              {/* 2. Informações de Pagamento e Taxa Oficial */}
              <div className="pt-2 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-zinc-300 flex items-center gap-2 border-b border-[#27272a] pb-2">
                  <Shield className="h-4 w-4 text-orange-400" />
                  <span>Taxa de Inscrição</span>
                </h3>

                {entryFee > 0 ? (
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-[#18181b] via-[#121214] to-zinc-900 border border-orange-500/25 space-y-3 shadow-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-orange-500/15 border border-orange-500/30 text-orange-400 text-[10px] font-black uppercase tracking-wider">
                          Pix Dinâmico
                        </span>
                        <span className="text-xs text-zinc-400">Pagamento Automatizado</span>
                      </div>
                      <div className="text-lg font-black text-white font-display">
                        R$ {entryFee.toFixed(2).replace(".", ",")}
                      </div>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      Ao prosseguir, você visualizará o <strong>QR Code Pix Oficial</strong> e a chave <strong>Pix Copia e Cola</strong> com confirmação integrada.
                    </p>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>Inscrição Gratuita • Não há cobrança financeira para este torneio.</span>
                  </div>
                )}
              </div>

              {/* 3. Seção de Comprovante de Pagamento (Anexo Opcional/Recomendado para Torneios Pagos) */}
              {entryFee > 0 && (
                <div className="pt-2 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#27272a] pb-2">
                    <h3 className="text-xs font-black uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                      <Upload className="h-4 w-4 text-orange-400" />
                      <span>Comprovante de Pagamento</span>
                    </h3>
                    <span className="text-[10px] text-zinc-400">
                      PNG, JPG ou PDF (máx. 5MB)
                    </span>
                  </div>

                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*,application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                    id="registration-receipt-upload"
                  />

                  {!receiptFile ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center justify-center p-5 border-2 border-dashed border-[#27272a] hover:border-orange-500/50 rounded-2xl cursor-pointer bg-zinc-900/30 hover:bg-zinc-900/60 transition-all group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                        <Upload className="h-5 w-5" />
                      </div>
                      <p className="text-xs font-bold text-zinc-200 text-center">
                        Anexar Comprovante de Pagamento Pix
                      </p>
                      <p className="text-[10px] text-zinc-500 text-center mt-1">
                        Se você já efetuou o pagamento, anexe o comprovante aqui antes de concluir.
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-zinc-900/80 border border-zinc-800">
                      <div className="flex items-center gap-3 min-w-0">
                        {receiptPreview ? (
                          <img
                            src={receiptPreview}
                            alt="Pré-visualização do comprovante"
                            className="w-10 h-10 rounded-lg object-cover border border-zinc-700 shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 flex items-center justify-center shrink-0">
                            <FileText className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-zinc-200 truncate">
                            {receiptFile.name}
                          </p>
                          <p className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Comprovante pronto para envio ({(receiptFile.size / 1024 / 1024).toFixed(2)} MB)</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition-colors cursor-pointer"
                        >
                          Trocar
                        </button>
                        <button
                          type="button"
                          onClick={handleRemoveReceipt}
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                          title="Remover comprovante"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Botão de Envio / Prosseguir para Checkout Pix */}
              <div className="pt-3">
                {errorMessage && (
                  <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold flex items-center gap-2 animate-fadeIn mb-3">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-orange-500 via-amber-400 to-yellow-500 hover:from-orange-400 hover:to-amber-300 text-neutral-950 font-black text-sm uppercase tracking-wider transition-all shadow-lg shadow-orange-500/20 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>
                        {isEditMode
                          ? "Salvando Alterações..."
                          : receiptFile
                            ? "Enviando Comprovante e Registrando..."
                            : "Registrando Equipe..."}
                      </span>
                    </>
                  ) : isEditMode ? (
                    <span>Salvar Alterações</span>
                  ) : receiptFile ? (
                    <span>Confirmar Inscrição com Comprovante 🚀</span>
                  ) : entryFee > 0 ? (
                    <span>Prosseguir para Pagamento Pix (R$ {entryFee.toFixed(2).replace(".", ",")}) 🚀</span>
                  ) : (
                    <span>Confirmar Inscrição Gratuita 🚀</span>
                  )}
                </button>

                <p className="text-[11px] text-zinc-500 text-center mt-3">
                  Ao se inscrever, você declara concordar com o regulamento do campeonato.
                </p>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
