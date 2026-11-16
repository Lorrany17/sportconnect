"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Trophy,
  MapPin,
  Calendar,
  Clock,
  Users,
  ChevronDown,
  Loader2,
  X,
  AlertCircle, AlertTriangle,
  Plus,
  Minus,
  Sparkles,
  Camera,
  UploadCloud,
  Trash2,
  ImageIcon,
  FileText,
  Building2,
  ArrowLeft,
  ArrowRight,
  Check,
  Layers,
  FileUp,
  ExternalLink,
  CreditCard,
  HelpCircle,
  Timer,
  Award,
  Shield,
} from "lucide-react";
import { SportType, Tournament, CustomFieldType, CustomRegistrationField, Sponsor, MatchRules } from "@/types";
import { useAuth } from "@/context/AuthProvider";
import { useTournament } from "@/context/TournamentContext";
import { supabase } from "@/lib/supabase";
import { notifyNewTournamentRequirements } from "@/app/actions/registration";
import { notifyTournamentRulesChanged } from "@/app/actions/notifications";

export interface CreateTournamentFormProps {
  onClose?: () => void;
  onSuccess?: (tournamentId: string) => void;
  isModal?: boolean;
  initialData?: Tournament | null;
}

export const SPORT_SELECT_OPTIONS: { id: SportType; label: string; icon: string }[] = [
  { id: "DOMINO", label: "Dominó", icon: "🁓" },
  { id: "PING_PONG", label: "Ping Pong", icon: "🏓" },
  { id: "FUTSAL", label: "Futsal", icon: "⚽" },
  { id: "VOLEI", label: "Vôlei", icon: "🏐" },
];

export const DEFAULT_COVERS: Record<SportType, string> = {
  DOMINO: "https://placehold.co/1200x400/18181b/00a2ff?text=Torneio+de+Domino",
  PING_PONG: "https://images.unsplash.com/photo-1534158914592-062992fbe900?auto=format&fit=crop&w=1200&q=80",
  FUTSAL: "https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1200&q=80",
  VOLEI: "https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?auto=format&fit=crop&w=1200&q=80",
};

export const VOLEI_FORMAT_OPTIONS = [
  "Quadra (6x6)",
  "Areia (Duplas)",
  "Areia (4x4)",
];

export const PING_PONG_FORMAT_OPTIONS = [
  "Solo (1v1)",
  "Duplas (2v2)",
];

export const TOURNAMENT_FORMAT_OPTIONS = [
  {
    id: "KNOCKOUT",
    label: "Mata-mata (Eliminatória simples)",
    desc: "Confrontos diretos eliminatórios: quem vence avança de fase, quem perde sai.",
    icon: Trophy,
    badge: "Mais Popular",
  },
  {
    id: "GROUPS",
    label: "Grupos + Eliminatórias",
    desc: "Fase de grupos classificatória com pontos, seguida por chaveamento mata-mata.",
    icon: Layers,
    badge: "Campeonato Longo",
  },
  {
    id: "LEAGUE",
    label: "Pontos Corridos",
    desc: "Todos jogam contra todos em rodadas. O líder com mais pontos no final é o campeão.",
    icon: Sparkles,
    badge: "Formato Liga",
  },
];

export const PIX_KEY_TYPES = [
  { id: "CPF", label: "CPF", placeholder: "000.000.000-00" },
  { id: "CNPJ", label: "CNPJ", placeholder: "00.000.000/0000-00" },
  { id: "CELULAR", label: "Celular (WhatsApp)", placeholder: "(00) 00000-0000" },
  { id: "EMAIL", label: "E-mail", placeholder: "organizador@exemplo.com" },
  { id: "ALEATORIA", label: "Chave Aleatória (EVP)", placeholder: "Ex: 123e4567-e89b-12d3-a456-426614174000" },
];

/**
 * Detecta o tipo da chave Pix a partir do próprio valor caso type não esteja definido ou esteja inconsistente
 */
export function detectPixKeyType(key: string): string {
  if (!key) return "CPF";
  const trimmed = key.trim();
  if (trimmed.includes("@")) return "EMAIL";
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(trimmed)) return "ALEATORIA";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 14) return "CNPJ";
  if (trimmed.startsWith("(") || trimmed.includes(")") || (digits.length === 11 && !trimmed.includes("."))) {
    if (trimmed.includes("(") || trimmed.includes(")")) return "CELULAR";
  }
  return "CPF";
}

/**
 * Máscara dinâmica para formatação da chave Pix
 * - EMAIL / ALEATORIA: Não aplica qualquer formatação ou remoção de letras/caracteres.
 * - CPF / CNPJ / CELULAR: Aplica formatação específica e remoção de não-dígitos (\D).
 */
export function formatPixKey(value: string, type: string): string {
  if (!value) return "";

  // 1. E-mail e Chave Aleatória: NÃO aplicar nenhuma formatação, remoção de caracteres ou bloqueio de letras
  if (type === "EMAIL" || type === "ALEATORIA") {
    return value;
  }

  // 2. Proteção preventiva: se o valor contiver '@', trata-se de um e-mail; nunca aplicar máscara numérica
  if (value.includes("@")) {
    return value;
  }

  // 3. CPF: apenas dígitos formatados 000.000.000-00
  if (type === "CPF") {
    const raw = value.replace(/\D/g, "").slice(0, 11);
    if (raw.length <= 3) return raw;
    if (raw.length <= 6) return `${raw.slice(0, 3)}.${raw.slice(3)}`;
    if (raw.length <= 9) return `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6)}`;
    return `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9, 11)}`;
  }

  // 4. CNPJ: apenas dígitos formatados 00.000.000/0000-00
  if (type === "CNPJ") {
    const raw = value.replace(/\D/g, "").slice(0, 14);
    if (raw.length <= 2) return raw;
    if (raw.length <= 5) return `${raw.slice(0, 2)}.${raw.slice(2)}`;
    if (raw.length <= 8) return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5)}`;
    if (raw.length <= 12) return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8)}`;
    return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12, 14)}`;
  }

  // 5. Celular: apenas dígitos formatados (00) 00000-0000
  if (type === "CELULAR") {
    const raw = value.replace(/\D/g, "").slice(0, 11);
    if (raw.length <= 2) return raw ? `(${raw}` : "";
    if (raw.length <= 7) return `(${raw.slice(0, 2)}) ${raw.slice(2)}`;
    return `(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7, 11)}`;
  }

  return value;
}

/**
 * Faz o parse seguro do objeto match_rules (JSONB ou string)
 */
export function parseMatchRulesObject(rawRules: any): Record<string, any> {
  if (!rawRules) return {};
  if (typeof rawRules === "object") return rawRules;
  if (typeof rawRules === "string") {
    try {
      return JSON.parse(rawRules);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Extrai o formato da modalidade (ex: 'solo', 'duplas', '5x5') a partir do torneio e de match_rules
 */
export function extractModalityFormat(tournament?: any): string {
  if (!tournament) return "duplas";
  const rules = parseMatchRulesObject(tournament.match_rules);
  const modFmt = rules?.modality_format || tournament.format || "";
  const sport = String(tournament.sport_type || "").toUpperCase();

  if (modFmt) {
    const lower = String(modFmt).toLowerCase();
    if (lower.includes("solo") || lower.includes("individual") || lower.includes("1x1")) return "solo";
    if (lower.includes("dupla") || lower.includes("2x2")) return "duplas";
    if (lower.includes("5x5") || lower.includes("equipe") || lower.includes("time")) return "equipe";
    return String(modFmt);
  }

  if (sport === "DOMINO") return "duplas";
  if (sport === "PING_PONG" || sport === "TENIS") return "solo";
  if (sport === "FUTSAL" || sport === "FUTEBOL" || sport === "VOLEI") return "equipe";
  return "duplas";
}

export default function CreateTournamentForm({
  onClose,
  onSuccess,
  isModal = false,
  initialData,
}: CreateTournamentFormProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { setCurrentTournamentId, setTournaments, setCurrentSportType } = useTournament();

  const isEditing = Boolean(initialData?.id);

  // Controle de Etapas do Wizard (1: Geral, 2: Local e Data, 3: Formato e Valores, 4: Extras)
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Estados locais do formulário - Etapa 1: Geral
  const [name, setName] = useState(initialData?.name || "");
  const [sportType, setSportType] = useState<SportType>((initialData?.sport_type as SportType) || "DOMINO");
  const [format, setFormat] = useState<string>(initialData?.format || "Duplas");
  const [genderCategory, setGenderCategory] = useState<string>(
    initialData?.gender_category ? initialData.gender_category.toUpperCase() : "MISTO"
  );

  // Estados locais do formulário - Etapa 2: Local e Data
  const [startDate, setStartDate] = useState(initialData?.start_date ? initialData.start_date.split("T")[0] : "");
  const [endDate, setEndDate] = useState(initialData?.end_date ? initialData.end_date.split("T")[0] : "");
  const [startTime, setStartTime] = useState(initialData?.start_time || "");
  const [noTimeSet, setNoTimeSet] = useState<boolean>(isEditing ? !initialData?.start_time : false);
  const [address, setAddress] = useState(initialData?.location || "");
  const [debouncedAddress, setDebouncedAddress] = useState(initialData?.location || "");

  // Estados locais do formulário - Etapa 3: Formato e Valores
  const [tournamentFormat, setTournamentFormat] = useState<string>(
    initialData?.tournament_format || "KNOCKOUT"
  );
  const [numGroups, setNumGroups] = useState<number>(() => {
    const r =
      typeof initialData?.match_rules === "string"
        ? (() => {
          try {
            return JSON.parse(initialData.match_rules);
          } catch {
            return {};
          }
        })()
        : initialData?.match_rules;
    return Number(r?.num_groups || (initialData as any)?.num_groups || 2);
  });
  const [qualifiersPerGroup, setQualifiersPerGroup] = useState<number>(() => {
    const r =
      typeof initialData?.match_rules === "string"
        ? (() => {
          try {
            return JSON.parse(initialData.match_rules);
          } catch {
            return {};
          }
        })()
        : initialData?.match_rules;
    return Number(r?.qualifiers_per_group || (initialData as any)?.qualifiers_per_group || 2);
  });
  const [hasThirdPlaceMatch, setHasThirdPlaceMatch] = useState<boolean>(() => {
    return Boolean(
      initialData?.has_third_place_match ??
      (initialData?.match_rules as any)?.has_third_place_match ??
      false
    );
  });
  const [maxTeams, setMaxTeams] = useState<number>(initialData?.max_teams ? Number(initialData.max_teams) : 16);
  const [entryFee, setEntryFee] = useState<string>(() => {
    if (initialData?.entry_fee !== undefined && initialData?.entry_fee !== null) {
      const num = Number(initialData.entry_fee);
      return !isNaN(num) ? num.toFixed(2) : "0.00";
    }
    return "100.00";
  });
  const [registeredTeamsCount, setRegisteredTeamsCount] = useState<number>(0);
  const [hasPaidRegistrations, setHasPaidRegistrations] = useState<boolean>(false);
  const initialPixKeyType =
    initialData?.pix_key_type ||
    (initialData?.organizer_pix_key ? detectPixKeyType(initialData.organizer_pix_key) : "CPF");
  const [pixKeyType, setPixKeyType] = useState<string>(initialPixKeyType);
  const [organizerPixKey, setOrganizerPixKey] = useState<string>(
    initialData?.organizer_pix_key || ""
  );

  // Estados locais da Vitrine de Premiação (1º, 2º e 3º Lugar)
  const [prizeFirst, setPrizeFirst] = useState(initialData?.prize_first || "");
  const [prizeSecond, setPrizeSecond] = useState(initialData?.prize_second || "");
  const [prizeThird, setPrizeThird] = useState(initialData?.prize_third || "");

  // Estados locais de Restrições de Inscrição (Idade, Elenco e Nível Técnico)
  const [skillLevel, setSkillLevel] = useState<string>(initialData?.skill_level || "ALL");
  const [requireCpf, setRequireCpf] = useState<boolean>(Boolean(initialData?.require_cpf));
  const [requirePhone, setRequirePhone] = useState<boolean>(Boolean(initialData?.require_phone));
  const [minAge, setMinAge] = useState<string>(
    initialData?.min_age !== undefined && initialData?.min_age !== null ? String(initialData.min_age) : ""
  );
  const [maxAge, setMaxAge] = useState<string>(
    initialData?.max_age !== undefined && initialData?.max_age !== null ? String(initialData.max_age) : ""
  );
  const [minPlayers, setMinPlayers] = useState<string>(
    initialData?.min_players !== undefined && initialData?.min_players !== null ? String(initialData.min_players) : ""
  );
  const [maxPlayers, setMaxPlayers] = useState<string>(
    initialData?.max_players !== undefined && initialData?.max_players !== null ? String(initialData.max_players) : ""
  );

  // Estados locais das Regras Dinâmicas de Partida (JSONB match_rules)
  // Cenário A: Futsal ou Futebol (Regras de Tempo)
  const [halvesCount, setHalvesCount] = useState<number>(() => {
    const r = typeof initialData?.match_rules === "string" ? JSON.parse(initialData.match_rules) : initialData?.match_rules;
    return r?.halves_count ?? 2;
  });
  const [halfDurationMinutes, setHalfDurationMinutes] = useState<number>(() => {
    const r = typeof initialData?.match_rules === "string" ? JSON.parse(initialData.match_rules) : initialData?.match_rules;
    return r?.half_duration_minutes ?? 20;
  });
  const [hasExtraTime, setHasExtraTime] = useState<boolean>(() => {
    const r = typeof initialData?.match_rules === "string" ? JSON.parse(initialData.match_rules) : initialData?.match_rules;
    return Boolean(r?.has_extra_time ?? false);
  });
  const [extraTimeDuration, setExtraTimeDuration] = useState<number>(() => {
    const r = typeof initialData?.match_rules === "string" ? JSON.parse(initialData.match_rules) : initialData?.match_rules;
    return r?.extra_time_duration ?? 5;
  });
  const [hasPenalties, setHasPenalties] = useState<boolean>(() => {
    const r = typeof initialData?.match_rules === "string" ? JSON.parse(initialData.match_rules) : initialData?.match_rules;
    return r?.has_penalties ?? true;
  });

  // Regras Dinâmicas por Fase (phase_exceptions)
  type PhaseKey = "group_stage" | "round_of_16" | "quarter_finals" | "semi_finals" | "final" | "third_place";
  interface PhaseExceptionItem {
    id: string;
    phase: PhaseKey;
    bestOf: number;
    pointsPerSet: number;
    tieBreakPoints: number;
    halfDurationMinutes: number;
    targetScore: number;
  }

  const PHASE_EXCEPTION_OPTIONS: { value: PhaseKey; label: string }[] = [
    { value: "round_of_16", label: "Oitavas de Final" },
    { value: "quarter_finals", label: "Quartas de Final" },
    { value: "semi_finals", label: "Semifinal" },
    { value: "final", label: "Grande Final" },
    { value: "third_place", label: "Disputa de 3º Lugar" },
    { value: "group_stage", label: "Fase de Grupos" },
  ];

  const [phaseExceptions, setPhaseExceptions] = useState<PhaseExceptionItem[]>(() => {
    const mr =
      typeof initialData?.match_rules === "string"
        ? JSON.parse(initialData.match_rules)
        : initialData?.match_rules;
    const rawMap = initialData?.phase_exceptions || mr?.phase_exceptions || {};
    if (!rawMap || typeof rawMap !== "object") return [];

    return Object.entries(rawMap).map(([phaseKey, val]: [string, any], idx) => ({
      id: `phase-ex-${idx}-${phaseKey}`,
      phase: (phaseKey as PhaseKey) || "final",
      bestOf: Number(val?.bestOf ?? val?.best_of_sets ?? 5),
      pointsPerSet: Number(val?.pointsPerSet ?? val?.points_per_set ?? (initialData?.sport_type === "VOLEI" ? 25 : 11)),
      tieBreakPoints: Number(val?.tieBreakPoints ?? val?.tie_break_points ?? 15),
      halfDurationMinutes: Number(val?.halfDurationMinutes ?? val?.half_duration_minutes ?? 25),
      targetScore: Number(val?.targetScore ?? val?.target_score ?? 200),
    }));
  });

  // Cenário B: Ping Pong, Vôlei ou Tênis (Regras de Sets)
  const [bestOfSets, setBestOfSets] = useState<number>(() => {
    const r = typeof initialData?.match_rules === "string" ? JSON.parse(initialData.match_rules) : initialData?.match_rules;
    return r?.best_of_sets ?? 3;
  });
  const [pointsPerSet, setPointsPerSet] = useState<number>(() => {
    const r = typeof initialData?.match_rules === "string" ? JSON.parse(initialData.match_rules) : initialData?.match_rules;
    if (r?.points_per_set !== undefined) return r.points_per_set;
    return initialData?.sport_type === "VOLEI" ? 25 : 21;
  });
  const [requiresTwoPointAdvantage, setRequiresTwoPointAdvantage] = useState<boolean>(() => {
    const r = typeof initialData?.match_rules === "string" ? JSON.parse(initialData.match_rules) : initialData?.match_rules;
    return r?.requires_two_point_advantage ?? true;
  });
  const [tieBreakPoints, setTieBreakPoints] = useState<number>(() => {
    const r = typeof initialData?.match_rules === "string" ? JSON.parse(initialData.match_rules) : initialData?.match_rules;
    return r?.tie_break_points ?? 15;
  });

  // Cenário C: Dominó (Regras de Pontuação Acumulada)
  const [targetScore, setTargetScore] = useState<number>(() => {
    const r = typeof initialData?.match_rules === "string" ? JSON.parse(initialData.match_rules) : initialData?.match_rules;
    return r?.target_score ?? 200;
  });
  const [maxRounds, setMaxRounds] = useState<number>(() => {
    const r = typeof initialData?.match_rules === "string" ? JSON.parse(initialData.match_rules) : initialData?.match_rules;
    return r?.max_rounds ?? 10;
  });

  // Estados locais do formulário - Etapa 4: Extras (Regulamento, Patrocinadores e Campos Personalizados)
  const [rules, setRules] = useState(initialData?.rules || "");
  const [rulebookFile, setRulebookFile] = useState<File | null>(null);
  const [rulebookUrl, setRulebookUrl] = useState<string | null>(initialData?.rulebook_url || null);
  const rulebookInputRef = useRef<HTMLInputElement>(null);

  // Interface para Patrocinador no Formulário
  interface FormSponsor {
    id: string;
    name: string;
    logo_url: string | null;
    link: string | null;
    file?: File | null;
    previewUrl?: string | null;
  }

  // Helpers de parsing robusto (suporta array ou JSON em formato de string da base de dados)
  const parseCustomFields = (raw: any): CustomRegistrationField[] => {
    if (!raw) return [];
    let fields = raw;
    if (typeof raw === "string") {
      try {
        fields = JSON.parse(raw);
      } catch {
        return [];
      }
    }
    if (Array.isArray(fields)) {
      return fields.map((f: any) => ({
        id: f.id || `field_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        label: f.label || "",
        type: f.type || "text",
        required: Boolean(f.required),
        options: Array.isArray(f.options) ? f.options : [],
        optionsString: Array.isArray(f.options)
          ? f.options.join(", ")
          : typeof f.options === "string"
            ? f.options
            : "",
      }));
    }
    return [];
  };

  const parseSponsors = (raw: any): FormSponsor[] => {
    if (!raw) return [];
    let sps = raw;
    if (typeof raw === "string") {
      try {
        sps = JSON.parse(raw);
      } catch {
        return [];
      }
    }
    if (Array.isArray(sps)) {
      return sps.map((s: any) => ({
        id: s.id || `sp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: s.name || "",
        logo_url: s.logo_url || null,
        link: s.link || null,
        previewUrl: s.logo_url || null,
      }));
    }
    return [];
  };

  // Estado para Campos Personalizados de Inscrição (Estilo Google Forms) - MANTIDO 100% INTACTO
  const [customFields, setCustomFields] = useState<CustomRegistrationField[]>(() =>
    parseCustomFields(initialData?.custom_registration_fields)
  );

  // Estado para Patrocinadores do Evento - MANTIDO 100% INTACTO
  const [sponsors, setSponsors] = useState<FormSponsor[]>(() =>
    parseSponsors(initialData?.sponsors)
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showDraftToast, setShowDraftToast] = useState(false);
  const isDraftHydratedRef = useRef(false);
  const skipInitialSaveRef = useRef(true);
  const isDraftClearedRef = useRef(false);

  // Recuperar o Rascunho na Inicialização (apenas no mount do lado do cliente e em modo de criação)
  useEffect(() => {
    if (isEditing || typeof window === "undefined") {
      isDraftHydratedRef.current = true;
      return;
    }

    try {
      const savedDraft = localStorage.getItem("sportconnect_tournament_draft");
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);
        const fd = parsed?.formData || parsed;

        if (fd && typeof fd === "object") {
          if (typeof parsed.currentStep === "number" && parsed.currentStep >= 1 && parsed.currentStep <= 4) {
            setCurrentStep(parsed.currentStep);
          }
          if (fd.name !== undefined) setName(fd.name);
          if (fd.sportType !== undefined) setSportType(fd.sportType as SportType);
          if (fd.format !== undefined) setFormat(fd.format);
          if (fd.genderCategory !== undefined) setGenderCategory(fd.genderCategory);
          if (fd.startDate !== undefined) setStartDate(fd.startDate);
          if (fd.endDate !== undefined) setEndDate(fd.endDate);
          if (fd.startTime !== undefined) setStartTime(fd.startTime);
          if (fd.noTimeSet !== undefined) setNoTimeSet(Boolean(fd.noTimeSet));
          if (fd.address !== undefined) {
            setAddress(fd.address);
            setDebouncedAddress(fd.address);
          }
          if (fd.tournamentFormat !== undefined) setTournamentFormat(fd.tournamentFormat);
          if (fd.maxTeams !== undefined) setMaxTeams(Number(fd.maxTeams));
          if (fd.entryFee !== undefined) setEntryFee(String(fd.entryFee));
          if (fd.pixKeyType !== undefined) setPixKeyType(fd.pixKeyType);
          if (fd.organizerPixKey !== undefined) setOrganizerPixKey(fd.organizerPixKey);
          if (fd.prizeFirst !== undefined) setPrizeFirst(fd.prizeFirst);
          if (fd.prizeSecond !== undefined) setPrizeSecond(fd.prizeSecond);
          if (fd.prizeThird !== undefined) setPrizeThird(fd.prizeThird);
          if (fd.minAge !== undefined) setMinAge(String(fd.minAge));
          if (fd.maxAge !== undefined) setMaxAge(String(fd.maxAge));
          if (fd.minPlayers !== undefined) setMinPlayers(String(fd.minPlayers));
          if (fd.maxPlayers !== undefined) setMaxPlayers(String(fd.maxPlayers));
          if (fd.skillLevel !== undefined) setSkillLevel(String(fd.skillLevel));
          if (fd.requireCpf !== undefined) setRequireCpf(Boolean(fd.requireCpf));
          if (fd.requirePhone !== undefined) setRequirePhone(Boolean(fd.requirePhone));
          if (fd.halvesCount !== undefined) setHalvesCount(Number(fd.halvesCount));
          if (fd.halfDurationMinutes !== undefined) setHalfDurationMinutes(Number(fd.halfDurationMinutes));
          if (fd.hasExtraTime !== undefined) setHasExtraTime(Boolean(fd.hasExtraTime));
          if (fd.extraTimeDuration !== undefined) setExtraTimeDuration(Number(fd.extraTimeDuration));
          if (fd.hasPenalties !== undefined) setHasPenalties(Boolean(fd.hasPenalties));
          if (fd.bestOfSets !== undefined) setBestOfSets(Number(fd.bestOfSets));
          if (fd.pointsPerSet !== undefined) setPointsPerSet(Number(fd.pointsPerSet));
          if (fd.requiresTwoPointAdvantage !== undefined) setRequiresTwoPointAdvantage(Boolean(fd.requiresTwoPointAdvantage));
          if (fd.tieBreakPoints !== undefined) setTieBreakPoints(Number(fd.tieBreakPoints));
          if (fd.targetScore !== undefined) setTargetScore(Number(fd.targetScore));
          if (fd.maxRounds !== undefined) setMaxRounds(Number(fd.maxRounds));
          if (fd.rules !== undefined) setRules(fd.rules);
          if (fd.customFields !== undefined) setCustomFields(parseCustomFields(fd.customFields));
          if (fd.sponsors !== undefined) setSponsors(parseSponsors(fd.sponsors));

          setShowDraftToast(true);
        }
      }
    } catch (err) {
      console.warn("Erro ao recuperar rascunho do torneio:", err);
    } finally {
      isDraftHydratedRef.current = true;
    }
  }, []);

  // Auto-ocultar toast de rascunho recuperado após 5 segundos
  useEffect(() => {
    if (!showDraftToast) return;
    const timer = setTimeout(() => {
      setShowDraftToast(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, [showDraftToast]);

  // Salvar o Progresso em Tempo Real no localStorage com debounce de 500ms
  useEffect(() => {
    if (
      isEditing ||
      typeof window === "undefined" ||
      !isDraftHydratedRef.current ||
      isDraftClearedRef.current
    ) {
      return;
    }

    if (skipInitialSaveRef.current) {
      skipInitialSaveRef.current = false;
      return;
    }

    const handler = setTimeout(() => {
      if (isDraftClearedRef.current) return;
      try {
        const formData = {
          name,
          sportType,
          format,
          genderCategory,
          startDate,
          endDate,
          startTime,
          noTimeSet,
          address,
          tournamentFormat,
          maxTeams,
          entryFee,
          pixKeyType,
          organizerPixKey,
          prizeFirst,
          prizeSecond,
          prizeThird,
          minAge,
          maxAge,
          minPlayers,
          maxPlayers,
          skillLevel,
          requireCpf,
          requirePhone,
          halvesCount,
          halfDurationMinutes,
          hasExtraTime,
          extraTimeDuration,
          hasPenalties,
          bestOfSets,
          pointsPerSet,
          requiresTwoPointAdvantage,
          tieBreakPoints,
          targetScore,
          maxRounds,
          rules,
          customFields,
          sponsors: sponsors.map((s) => ({
            id: s.id,
            name: s.name,
            logo_url: s.logo_url,
            link: s.link,
          })),
        };

        localStorage.setItem(
          "sportconnect_tournament_draft",
          JSON.stringify({
            currentStep,
            formData,
            updatedAt: new Date().toISOString(),
          })
        );
      } catch (err) {
        console.warn("Erro ao salvar rascunho do torneio:", err);
      }
    }, 500);

    return () => clearTimeout(handler);
  }, [
    isEditing,
    currentStep,
    name,
    sportType,
    format,
    genderCategory,
    startDate,
    startTime,
    noTimeSet,
    address,
    tournamentFormat,
    maxTeams,
    entryFee,
    pixKeyType,
    organizerPixKey,
    prizeFirst,
    prizeSecond,
    prizeThird,
    minAge,
    maxAge,
    minPlayers,
    maxPlayers,
    skillLevel,
    requireCpf,
    requirePhone,
    halvesCount,
    halfDurationMinutes,
    hasExtraTime,
    extraTimeDuration,
    hasPenalties,
    bestOfSets,
    pointsPerSet,
    requiresTwoPointAdvantage,
    tieBreakPoints,
    targetScore,
    maxRounds,
    rules,
    customFields,
    sponsors,
  ]);

  // Estados para foto de capa (Upload / Padrão / Existente)
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(initialData?.cover_url || null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manipuladores de Campos Personalizados - MANTIDOS 100% INTACTOS
  const handleAddCustomField = () => {
    const newField: CustomRegistrationField = {
      id: `field_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      label: "",
      type: "text",
      required: false,
      options: [],
      optionsString: "",
    };
    setCustomFields((prev) => [...prev, newField]);
  };

  const handleRemoveCustomField = (id: string) => {
    setCustomFields((prev) => prev.filter((f) => f.id !== id));
  };

  const handleUpdateCustomField = (id: string, updates: Partial<CustomRegistrationField>) => {
    setCustomFields((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const updated = { ...f, ...updates };
        if (updates.optionsString !== undefined) {
          updated.options = updates.optionsString
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
        return updated;
      })
    );
  };

  // Manipuladores de Patrocinadores - MANTIDOS 100% INTACTOS
  const handleAddSponsor = () => {
    const newSponsor: FormSponsor = {
      id: `sp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: "",
      logo_url: null,
      link: null,
      file: null,
      previewUrl: null,
    };
    setSponsors((prev) => [...prev, newSponsor]);
  };

  const handleRemoveSponsor = (id: string) => {
    setSponsors((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target?.previewUrl && target.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((s) => s.id !== id);
    });
  };

  const handleUpdateSponsor = (id: string, updates: Partial<FormSponsor>) => {
    setSponsors((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        return { ...s, ...updates };
      })
    );
  };

  const handleSponsorLogoSelect = (id: string, file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Por favor, selecione um arquivo de imagem válido (PNG, JPG, SVG, WEBP).");
      return;
    }
    const preview = URL.createObjectURL(file);
    setSponsors((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        if (s.previewUrl && s.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(s.previewUrl);
        }
        return { ...s, file, previewUrl: preview };
      })
    );
  };

  // Manipulador de upload de regulamento em PDF
  const handleRulebookFileSelect = (file: File) => {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      alert("Por favor, selecione um arquivo de documento no formato PDF.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      alert("O arquivo PDF deve ter no máximo 15MB.");
      return;
    }
    setRulebookFile(file);
    if (errorMessage) setErrorMessage("");
  };

  const handleRemoveRulebook = () => {
    setRulebookFile(null);
    setRulebookUrl(null);
    if (rulebookInputRef.current) {
      rulebookInputRef.current.value = "";
    }
  };

  // Atualiza estados caso initialData mude
  useEffect(() => {
    if (initialData) {
      setName(initialData.name || "");
      if (initialData.sport_type) {
        setSportType(initialData.sport_type as SportType);
      }
      if (initialData.format) {
        setFormat(initialData.format);
      }
      if (initialData.gender_category) {
        setGenderCategory(initialData.gender_category.toUpperCase());
      }
      if (initialData.start_date) {
        setStartDate(initialData.start_date.split("T")[0]);
      }
      if (initialData.end_date) {
        setEndDate(initialData.end_date.split("T")[0]);
      }
      if (initialData.start_time !== undefined) {
        setStartTime(initialData.start_time || "");
        setNoTimeSet(!initialData.start_time);
      }
      if (initialData.location) {
        setAddress(initialData.location);
        setDebouncedAddress(initialData.location);
      }
      if (initialData.tournament_format) {
        setTournamentFormat(initialData.tournament_format);
      }
      if (initialData.has_third_place_match !== undefined) {
        setHasThirdPlaceMatch(Boolean(initialData.has_third_place_match));
      } else if ((initialData.match_rules as any)?.has_third_place_match !== undefined) {
        setHasThirdPlaceMatch(Boolean((initialData.match_rules as any).has_third_place_match));
      }
      if (initialData.max_teams) {
        setMaxTeams(Number(initialData.max_teams));
      }
      if (initialData.entry_fee !== undefined && initialData.entry_fee !== null) {
        const num = Number(initialData.entry_fee);
        setEntryFee(!isNaN(num) ? num.toFixed(2) : "0.00");
      }
      // Sincronização atômica e simultânea de Chave Pix (sem aplicação de máscaras destrutivas durante a hidratação)
      const effectivePixType =
        initialData.pix_key_type ||
        (initialData.organizer_pix_key ? detectPixKeyType(initialData.organizer_pix_key) : undefined);
      if (effectivePixType) {
        setPixKeyType(effectivePixType);
      }
      if (initialData.organizer_pix_key !== undefined && initialData.organizer_pix_key !== null) {
        setOrganizerPixKey(initialData.organizer_pix_key);
      }
      if (initialData.rules) {
        setRules(initialData.rules);
      }
      if (initialData.rulebook_url) {
        setRulebookUrl(initialData.rulebook_url);
      }
      if (initialData.cover_url) {
        setCoverPreviewUrl(initialData.cover_url);
      }

      if (initialData.match_rules) {
        try {
          const r = typeof initialData.match_rules === "string"
            ? JSON.parse(initialData.match_rules)
            : initialData.match_rules;
          if (r.halves_count !== undefined) setHalvesCount(Number(r.halves_count));
          if (r.half_duration_minutes !== undefined) setHalfDurationMinutes(Number(r.half_duration_minutes));
          if (r.has_extra_time !== undefined) setHasExtraTime(Boolean(r.has_extra_time));
          if (r.extra_time_duration !== undefined) setExtraTimeDuration(Number(r.extra_time_duration));
          if (r.has_penalties !== undefined) setHasPenalties(Boolean(r.has_penalties));

          if (r.best_of_sets !== undefined) setBestOfSets(Number(r.best_of_sets));
          if (r.points_per_set !== undefined) setPointsPerSet(Number(r.points_per_set));
          if (r.requires_two_point_advantage !== undefined) setRequiresTwoPointAdvantage(Boolean(r.requires_two_point_advantage));
          if (r.tie_break_points !== undefined) setTieBreakPoints(Number(r.tie_break_points));

          if (r.target_score !== undefined) setTargetScore(Number(r.target_score));
          if (r.max_rounds !== undefined) setMaxRounds(Number(r.max_rounds));
        } catch (e) {
          console.warn("Erro ao fazer parse de match_rules:", e);
        }
      }

      if (initialData.custom_registration_fields !== undefined) {
        setCustomFields(parseCustomFields(initialData.custom_registration_fields));
      }
      if (initialData.sponsors !== undefined) {
        setSponsors(parseSponsors(initialData.sponsors));
      }

      if (initialData.prize_first !== undefined) {
        setPrizeFirst(initialData.prize_first || "");
      }
      if (initialData.prize_second !== undefined) {
        setPrizeSecond(initialData.prize_second || "");
      }
      if (initialData.prize_third !== undefined) {
        setPrizeThird(initialData.prize_third || "");
      }
      if (initialData.min_age !== undefined) {
        setMinAge(initialData.min_age !== null ? String(initialData.min_age) : "");
      }
      if (initialData.max_age !== undefined) {
        setMaxAge(initialData.max_age !== null ? String(initialData.max_age) : "");
      }
      if (initialData.min_players !== undefined) {
        setMinPlayers(initialData.min_players !== null ? String(initialData.min_players) : "");
      }
      if (initialData.skill_level !== undefined) {
        setSkillLevel(initialData.skill_level || "ALL");
      }
      if (initialData.max_players !== undefined) {
        setMaxPlayers(initialData.max_players !== null ? String(initialData.max_players) : "");
      }

      // Se estiver em modo edição (initialData.id existe) e os campos/patrocinadores não vieram ou estão ausentes,
      // busca diretamente da tabela tournaments no Supabase para garantir persistência total!
      if (
        initialData.id &&
        (initialData.custom_registration_fields === undefined ||
          initialData.sponsors === undefined ||
          initialData.start_time === undefined ||
          initialData.match_rules === undefined ||
          initialData.prize_first === undefined ||
          initialData.min_age === undefined ||
          initialData.pix_key_type === undefined)
      ) {
        supabase
          .from("tournaments")
          .select("custom_registration_fields, sponsors, start_time, gender_category, tournament_format, pix_key_type, organizer_pix_key, rulebook_url, match_rules, prize_first, prize_second, prize_third, min_age, max_age, min_players, max_players")
          .eq("id", initialData.id)
          .maybeSingle()
          .then(({ data, error }) => {
            if (!error && data) {
              if (
                data.custom_registration_fields &&
                (initialData.custom_registration_fields === undefined ||
                  !Array.isArray(initialData.custom_registration_fields) ||
                  initialData.custom_registration_fields.length === 0)
              ) {
                setCustomFields(parseCustomFields(data.custom_registration_fields));
              }
              if (
                data.sponsors &&
                (initialData.sponsors === undefined ||
                  !Array.isArray(initialData.sponsors) ||
                  initialData.sponsors.length === 0)
              ) {
                setSponsors(parseSponsors(data.sponsors));
              }
              if (data.start_time && !initialData.start_time) {
                setStartTime(data.start_time);
                setNoTimeSet(false);
              }
              if (data.gender_category && !initialData.gender_category) {
                setGenderCategory(data.gender_category.toUpperCase());
              }
              if (data.tournament_format && !initialData.tournament_format) {
                setTournamentFormat(data.tournament_format);
              }
              if (data.pix_key_type && !initialData.pix_key_type) {
                setPixKeyType(data.pix_key_type);
              }
              if (data.organizer_pix_key && !initialData.organizer_pix_key) {
                setOrganizerPixKey(data.organizer_pix_key);
              }
              if (data.rulebook_url && !initialData.rulebook_url) {
                setRulebookUrl(data.rulebook_url);
              }
              if (data.prize_first && !initialData.prize_first) {
                setPrizeFirst(data.prize_first);
              }
              if (data.prize_second && !initialData.prize_second) {
                setPrizeSecond(data.prize_second);
              }
              if (data.prize_third && !initialData.prize_third) {
                setPrizeThird(data.prize_third);
              }
              if (data.min_age !== undefined && initialData.min_age === undefined) {
                setMinAge(data.min_age !== null ? String(data.min_age) : "");
              }
              if (data.max_age !== undefined && initialData.max_age === undefined) {
                setMaxAge(data.max_age !== null ? String(data.max_age) : "");
              }
              if (data.min_players !== undefined && initialData.min_players === undefined) {
                setMinPlayers(data.min_players !== null ? String(data.min_players) : "");
              }
              if (data.max_players !== undefined && initialData.max_players === undefined) {
                setMaxPlayers(data.max_players !== null ? String(data.max_players) : "");
              }
              if (data.match_rules && !initialData.match_rules) {
                try {
                  const r = typeof data.match_rules === "string" ? JSON.parse(data.match_rules) : data.match_rules;
                  if (r.halves_count !== undefined) setHalvesCount(Number(r.halves_count));
                  if (r.half_duration_minutes !== undefined) setHalfDurationMinutes(Number(r.half_duration_minutes));
                  if (r.has_extra_time !== undefined) setHasExtraTime(Boolean(r.has_extra_time));
                  if (r.extra_time_duration !== undefined) setExtraTimeDuration(Number(r.extra_time_duration));
                  if (r.has_penalties !== undefined) setHasPenalties(Boolean(r.has_penalties));

                  if (r.best_of_sets !== undefined) setBestOfSets(Number(r.best_of_sets));
                  if (r.points_per_set !== undefined) setPointsPerSet(Number(r.points_per_set));
                  if (r.requires_two_point_advantage !== undefined) setRequiresTwoPointAdvantage(Boolean(r.requires_two_point_advantage));
                  if (r.tie_break_points !== undefined) setTieBreakPoints(Number(r.tie_break_points));

                  if (r.target_score !== undefined) setTargetScore(Number(r.target_score));
                  if (r.max_rounds !== undefined) setMaxRounds(Number(r.max_rounds));
                } catch (e) {
                  console.warn("Erro ao fazer parse de match_rules do Supabase:", e);
                }
              }
            }
          });
      }
    }
  }, [initialData]);

  // Verificação dinâmica de inscritos para bloqueio do valor de inscrição baseado em pagamento
  useEffect(() => {
    if (!initialData?.id) {
      setRegisteredTeamsCount(0);
      setHasPaidRegistrations(false);
      return;
    }

    const tournamentId = initialData.id;

    async function checkRegistrations() {
      try {
        const { data: teams, error } = await supabase
          .from("teams")
          .select("status, payment_status")
          .eq("tournament_id", tournamentId);

        if (!error && teams) {
          setRegisteredTeamsCount(teams.length);
          const hasPaid = teams.some((team) =>
            ["PAID", "APPROVED"].includes(team.status) ||
            ["PAID", "APPROVED"].includes(team.payment_status)
          );
          setHasPaidRegistrations(hasPaid);
        }
      } catch (err) {
        console.warn("Aviso ao checar inscritos do torneio:", err);
      }
    }

    checkRegistrations();
  }, [initialData?.id]);

  // Limpa o ObjectURL de preview para evitar vazamento de memória
  useEffect(() => {
    return () => {
      if (coverPreviewUrl && !coverPreviewUrl.startsWith("http")) {
        URL.revokeObjectURL(coverPreviewUrl);
      }
    };
  }, [coverPreviewUrl]);

  // Manipulador de seleção de arquivo de capa
  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setErrorMessage("Por favor, selecione um arquivo de imagem válido (PNG, JPG, WEBP).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage("A imagem deve ter no máximo 5MB.");
      return;
    }
    if (coverPreviewUrl) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverFile(file);
    const preview = URL.createObjectURL(file);
    setCoverPreviewUrl(preview);
    if (errorMessage) setErrorMessage("");
  };

  // Remover imagem personalizada e voltar para o padrão do esporte
  const handleRemoveCover = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (coverPreviewUrl) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverFile(null);
    setCoverPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Preview ativo: se o usuário selecionou imagem, usa o preview local; caso contrário, a capa padrão da modalidade
  const activeCoverUrl = coverPreviewUrl || DEFAULT_COVERS[sportType];

  // 1. Debounce de 800ms para o endereço do mapa
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedAddress(address.trim());
    }, 800);

    return () => {
      clearTimeout(handler);
    };
  }, [address]);

  // 2. Adaptação do campo Formato ao mudar a Modalidade
  const handleSportChange = (newSport: SportType) => {
    setSportType(newSport);
    if (newSport === "VOLEI") {
      setFormat("Quadra (6x6)");
      if (pointsPerSet === 21) setPointsPerSet(25);
    } else if (newSport === "PING_PONG") {
      setFormat("Solo (1v1)");
      if (pointsPerSet === 25) setPointsPerSet(21);
      setMinPlayers("");
      setMaxPlayers("");
    } else if (newSport === "DOMINO") {
      setFormat("Duplas");
      setMinPlayers("");
      setMaxPlayers("");
    } else if (newSport === "FUTSAL") {
      setFormat("5x5");
    }
  };

  const isFormatVisible = sportType === "VOLEI" || sportType === "PING_PONG";

  const category = format || "";
  const isSolo =
    ["solo", "1v1"].includes(category.toLowerCase()) ||
    ["solo", "1v1"].some((keyword) => category.toLowerCase().includes(keyword));

  // Identificação de modalidade estritamente coletiva (equipes com mais de 2 jogadores).
  // Esconde o bloco de elenco se for Solo (1v1) ou Duplas (2v2).
  const isTeamFormat = (() => {
    const fmt = (format || "").toLowerCase();
    const isExcluded = ["solo", "1v1", "duplas", "2v2", "individual"].some((keyword) =>
      fmt.includes(keyword)
    );
    if (isExcluded || sportType === "DOMINO") return false;
    return true;
  })();

  // Limpeza automática dos campos de elenco ao trocar para modalidades que não sejam de equipe (Solo ou Duplas)
  useEffect(() => {
    if (!isTeamFormat) {
      if (minPlayers) setMinPlayers("");
      if (maxPlayers) setMaxPlayers("");
    }
  }, [isTeamFormat, minPlayers, maxPlayers]);

  // Tratamento de Horário Opcional ("Definir horário depois")
  const handleToggleNoTimeSet = (checked: boolean) => {
    setNoTimeSet(checked);
    if (checked) {
      setStartTime("");
    }
  };

  // Manipulador de tipo de chave Pix com re-máscara condicional segura
  const handlePixKeyTypeChange = (newType: string) => {
    setPixKeyType(newType);
    if (organizerPixKey) {
      if (newType === "EMAIL" || newType === "ALEATORIA") {
        setOrganizerPixKey(organizerPixKey);
      } else if (!organizerPixKey.includes("@")) {
        setOrganizerPixKey(formatPixKey(organizerPixKey, newType));
      }
    }
  };

  // Limpeza automática dos dados PIX quando o valor da inscrição for 0 (torneio gratuito)
  const handleEntryFeeChange = (value: string) => {
    setEntryFee(value);
    const fee = parseFloat(value) || 0;
    if (fee <= 0) {
      setOrganizerPixKey("");
    }
  };

  useEffect(() => {
    const fee = parseFloat(entryFee) || 0;
    if (fee <= 0 && organizerPixKey) {
      setOrganizerPixKey("");
    }
  }, [entryFee]);

  const isPaidTournament = (parseFloat(entryFee) || 0) > 0;

  // Rótulos Dinâmicos para o Contador de Vagas (Número de X) e Valor da Inscrição
  const getCounterMeta = () => {
    if (sportType === "DOMINO") {
      return {
        label: "Número de Duplas",
        unit: "duplas",
        singular: "dupla",
      };
    }
    if (sportType === "PING_PONG") {
      if (format === "Duplas (2v2)") {
        return {
          label: "Número de Duplas",
          unit: "duplas",
          singular: "dupla",
        };
      }
      return {
        label: "Número de Jogadores",
        unit: "jogadores",
        singular: "jogador",
      };
    }
    if (sportType === "VOLEI") {
      if (format === "Areia (Duplas)") {
        return {
          label: "Número de Duplas",
          unit: "duplas",
          singular: "dupla",
        };
      }
      return {
        label: "Número de Equipes",
        unit: "equipes",
        singular: "equipe",
      };
    }
    // Futsal ou Padrão
    return {
      label: "Número de Equipes",
      unit: "equipes",
      singular: "equipe",
    };
  };

  const counterMeta = getCounterMeta();

  // Manipulador do contador de times (- e +)
  const handleDecrementTeams = () => {
    setMaxTeams((prev) => Math.max(prev - 2, 2));
  };

  const handleIncrementTeams = () => {
    setMaxTeams((prev) => Math.min(prev + 2, 64));
  };

  // Validação por Etapa do Wizard
  const validateStep = (stepNumber: number): boolean => {
    if (stepNumber === 1) {
      const trimmedName = name.trim();
      if (!trimmedName) {
        setErrorMessage("Por favor, informe o Nome do Torneio.");
        return false;
      }
      if (!sportType) {
        setErrorMessage("Por favor, selecione a Modalidade esportiva.");
        return false;
      }
    }
    if (stepNumber === 3) {
      if (!tournamentFormat) {
        setErrorMessage("Por favor, selecione o Formato do Torneio.");
        return false;
      }
      const fee = parseFloat(entryFee) || 0;
      if (fee > 0 && !organizerPixKey.trim()) {
        setErrorMessage("Para torneios com taxa de inscrição, informe a Chave PIX do organizador para repasse.");
        return false;
      }
    }
    setErrorMessage("");
    return true;
  };

  const handleNextStep = (e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!validateStep(currentStep)) return;
    setErrorMessage("");
    setCurrentStep((prev) => Math.min(prev + 1, 4));
  };

  const handlePrevStep = (e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setErrorMessage("");
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleStepClick = (targetStep: number) => {
    if (targetStep > currentStep) {
      for (let s = currentStep; s < targetStep; s++) {
        if (!validateStep(s)) return;
      }
    }
    setErrorMessage("");
    setCurrentStep(targetStep);
  };

  // Submissão do Formulário
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    // SEGURANÇA CRÍTICA: Bloqueia qualquer submit prematuro se não estiver na Etapa 4 (Extras)
    if (currentStep !== 4) {
      if (currentStep < 4) {
        handleNextStep();
      }
      return;
    }

    // Validações
    if (!validateStep(1) || !validateStep(3)) {
      return;
    }

    if (startDate && endDate && endDate < startDate) {
      setErrorMessage("A data de término não pode ser anterior à data de início.");
      setCurrentStep(2);
      return;
    }

    setIsSubmitting(true);

    try {
      const parsedEntryFee = parseFloat(entryFee) || 0;
      const isPaid = parsedEntryFee > 0;
      const formattedStartDate = startDate ? new Date(startDate).toISOString() : null;
      const effectiveEndDate = endDate || startDate;
      const formattedEndDate = effectiveEndDate ? new Date(effectiveEndDate).toISOString() : null;
      const finalStartTime = noTimeSet || !startTime.trim() ? null : startTime.trim();
      const ownerId =
        user?.id && user.id !== "organizer-admin-session" ? user.id : null;

      // Sanitização dos campos personalizados
      const sanitizedCustomFields = customFields
        .map((f) => {
          const opts = f.optionsString
            ? f.optionsString.split(",").map((s) => s.trim()).filter(Boolean)
            : Array.isArray(f.options)
              ? f.options
              : [];
          return {
            id: f.id,
            label: f.label.trim(),
            type: f.type,
            required: Boolean(f.required),
            ...(f.type === "select" ? { options: opts } : {}),
          };
        })
        .filter((f) => f.label.length > 0);

      // Processamento e Upload das Logos de Patrocinadores
      const processedSponsors: Sponsor[] = [];
      for (const sp of sponsors) {
        const trimmedSpName = sp.name.trim();
        if (!trimmedSpName) continue; // Pula patrocinadores sem nome

        let finalLogoUrl = sp.logo_url || null;
        if (sp.file) {
          try {
            const cleanFileName = sp.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const uniqueFileName = `${Date.now()}_${cleanFileName}`;

            const { error: spUploadError } = await supabase.storage
              .from("sponsors")
              .upload(uniqueFileName, sp.file, {
                cacheControl: "3600",
                upsert: true,
              });

            if (!spUploadError) {
              const { data: pubData } = supabase.storage
                .from("sponsors")
                .getPublicUrl(uniqueFileName);

              if (pubData?.publicUrl) {
                finalLogoUrl = pubData.publicUrl;
              }
            } else {
              console.warn("Aviso no upload da logo do patrocinador:", spUploadError);
            }
          } catch (spErr) {
            console.warn("Exceção ao enviar logo:", spErr);
          }
        }

        processedSponsors.push({
          id: sp.id,
          name: trimmedSpName,
          logo_url: finalLogoUrl,
          link: sp.link ? sp.link.trim() : null,
        });
      }

      // Processamento e Upload do Regulamento em PDF se fornecido
      let finalRulebookUrl = rulebookUrl || null;
      if (rulebookFile) {
        try {
          const cleanDocName = rulebookFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const uniqueDocName = `${Date.now()}_${cleanDocName}`;

          const { error: docUploadError } = await supabase.storage
            .from("tournament-documents")
            .upload(uniqueDocName, rulebookFile, {
              cacheControl: "3600",
              upsert: true,
            });

          if (!docUploadError) {
            const { data: docData } = supabase.storage
              .from("tournament-documents")
              .getPublicUrl(uniqueDocName);

            if (docData?.publicUrl) {
              finalRulebookUrl = docData.publicUrl;
            }
          } else {
            console.warn("Aviso no upload do regulamento em PDF:", docUploadError);
          }
        } catch (docErr) {
          console.warn("Exceção ao fazer upload do regulamento em PDF:", docErr);
        }
      }

      // Encapsulamento das Regras Dinâmicas por Modalidade (JSONB)
      let compiledMatchRules: Record<string, any> = {};

      if (sportType === "FUTSAL" || (sportType as string) === "FUTEBOL") {
        compiledMatchRules = {
          type: "TIME",
          halves_count: Number(halvesCount) || 2,
          half_duration_minutes: Number(halfDurationMinutes) || 20,
          has_extra_time: Boolean(hasExtraTime),
          ...(hasExtraTime ? { extra_time_duration: Number(extraTimeDuration) || 5 } : {}),
          has_penalties: Boolean(hasPenalties),
        };
      } else if (sportType === "PING_PONG" || sportType === "VOLEI" || (sportType as string) === "TENIS") {
        compiledMatchRules = {
          type: "SETS",
          best_of_sets: Number(bestOfSets) || 3,
          points_per_set: Number(pointsPerSet) || (sportType === "VOLEI" ? 25 : 21),
          requires_two_point_advantage: Boolean(requiresTwoPointAdvantage),
          tie_break_points: Number(tieBreakPoints) || 15,
        };
      } else if (sportType === "DOMINO") {
        compiledMatchRules = {
          type: "SCORE",
          target_score: Number(targetScore) || 200,
          max_rounds: Number(maxRounds) || 10,
        };
      } else {
        compiledMatchRules = {
          target_score: Number(targetScore) || 200,
          max_rounds: Number(maxRounds) || 10,
        };
      }

      // Processamento e Validação de Restrições de Inscrição
      const parsedMinAge = minAge.trim() ? parseInt(minAge.trim(), 10) : null;
      const parsedMaxAge = maxAge.trim() ? parseInt(maxAge.trim(), 10) : null;
      const parsedMinPlayers = isTeamFormat && minPlayers.trim() ? parseInt(minPlayers.trim(), 10) : null;
      const parsedMaxPlayers = isTeamFormat && maxPlayers.trim() ? parseInt(maxPlayers.trim(), 10) : null;

      if (parsedMinAge !== null && parsedMaxAge !== null && parsedMinAge > parsedMaxAge) {
        setErrorMessage("A Idade Mínima não pode ser superior à Idade Máxima.");
        setIsSubmitting(false);
        return;
      }
      if (isTeamFormat && parsedMinPlayers !== null && parsedMaxPlayers !== null && parsedMinPlayers > parsedMaxPlayers) {
        setErrorMessage("O número Mínimo de Jogadores por equipe não pode ser superior ao Máximo.");
        setIsSubmitting(false);
        return;
      }

      // Compilação dinâmica das exceções/regras por fase (multi-fase)
      const compiledPhaseExceptions: Record<string, any> = {};
      phaseExceptions.forEach((ex) => {
        if (sportType === "FUTSAL" || (sportType as string) === "FUTEBOL") {
          compiledPhaseExceptions[ex.phase] = {
            halfDurationMinutes: Number(ex.halfDurationMinutes) || halfDurationMinutes,
            half_duration_minutes: Number(ex.halfDurationMinutes) || halfDurationMinutes,
          };
        } else if (
          sportType === "PING_PONG" ||
          sportType === "VOLEI" ||
          (sportType as string) === "TENIS"
        ) {
          compiledPhaseExceptions[ex.phase] = {
            bestOf: Number(ex.bestOf) || bestOfSets,
            best_of_sets: Number(ex.bestOf) || bestOfSets,
            pointsPerSet: Number(ex.pointsPerSet) || pointsPerSet,
            points_per_set: Number(ex.pointsPerSet) || pointsPerSet,
            tieBreakPoints: Number(ex.tieBreakPoints) || tieBreakPoints,
            tie_break_points: Number(ex.tieBreakPoints) || tieBreakPoints,
          };
        } else {
          compiledPhaseExceptions[ex.phase] = {
            bestOf: Number(ex.bestOf) || 3,
            best_of_sets: Number(ex.bestOf) || 3,
            targetScore: Number(ex.targetScore) || targetScore,
            target_score: Number(ex.targetScore) || targetScore,
          };
        }
      });

      // Montagem da base do payload
      const payload: any = {
        name: name.trim(),
        sport_type: sportType,
        gender_category: (genderCategory || "MISTO").toUpperCase(),
        format:
          tournamentFormat === "ROUND_ROBIN" || tournamentFormat === "LEAGUE"
            ? "LEAGUE"
            : tournamentFormat === "GROUPS_KNOCKOUT" || tournamentFormat === "GROUPS"
            ? "GROUPS"
            : "KNOCKOUT",
        tournament_format:
          tournamentFormat === "ROUND_ROBIN" || tournamentFormat === "LEAGUE"
            ? "LEAGUE"
            : tournamentFormat === "GROUPS_KNOCKOUT" || tournamentFormat === "GROUPS"
            ? "GROUPS"
            : "KNOCKOUT",
        has_third_place_match: Boolean(hasThirdPlaceMatch),
        phase_exceptions: compiledPhaseExceptions,
        match_rules: {
          ...compiledMatchRules,
          phase_exceptions: compiledPhaseExceptions,
          num_groups: Number(numGroups) || 2,
          qualifiers_per_group: Number(qualifiersPerGroup) || 2,
          has_third_place_match: Boolean(hasThirdPlaceMatch),
          modality_format: format || (sportType === "DOMINO" ? "Duplas" : sportType === "FUTSAL" ? "5x5" : null),
          tournament_format:
            tournamentFormat === "ROUND_ROBIN" || tournamentFormat === "LEAGUE"
              ? "LEAGUE"
              : tournamentFormat === "GROUPS_KNOCKOUT" || tournamentFormat === "GROUPS"
              ? "GROUPS"
              : "KNOCKOUT",
        },
        // tournament_format normalized above
        // match_rules enriched above
        start_date: formattedStartDate,
        end_date: formattedEndDate,
        start_time: finalStartTime,
        location: address.trim() || null,
        max_teams: maxTeams,
        entry_fee: parsedEntryFee,
        rules: rules.trim() || null,
        rulebook_url: finalRulebookUrl,
        pix_key_type: isPaid ? (pixKeyType || "CPF") : null,
        organizer_pix_key: isPaid && organizerPixKey.trim() ? organizerPixKey.trim() : null,
        custom_registration_fields: sanitizedCustomFields,
        sponsors: processedSponsors,
        prize_first: prizeFirst.trim() || null,
        prize_second: prizeSecond.trim() || null,
        prize_third: prizeThird.trim() || null,
        min_age: parsedMinAge,
        max_age: parsedMaxAge,
        min_players: parsedMinPlayers,
        max_players: parsedMaxPlayers,
        skill_level: skillLevel || "ALL",
        require_cpf: Boolean(requireCpf),
        require_phone: Boolean(requirePhone),
      };

      if (isEditing) {
        // MODO DE EDIÇÃO: UPDATE na tabela tournaments
        const tournamentIdToUpdate = initialData!.id;

        // Se já existem inscrições registradas, impede qualquer alteração no valor da taxa
        if (hasPaidRegistrations && initialData?.entry_fee !== undefined) {
          payload.entry_fee = Number(initialData.entry_fee);
        }

        // 1. Verificar se o utilizador anexou um NOVO ficheiro de imagem no campo de capa
        if (coverFile) {
          try {
            const cleanFileName = coverFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const uniqueFileName = `${Date.now()}_${cleanFileName}`;

            const { error: uploadError } = await supabase.storage
              .from("covers")
              .upload(uniqueFileName, coverFile, {
                cacheControl: "3600",
                upsert: true,
              });

            if (uploadError) {
              console.error("Erro no upload da foto de capa (modo edição):", uploadError);
              alert(`Erro no upload da foto de capa: ${uploadError.message}`);
              setIsSubmitting(false);
              return;
            }

            const { data: publicData } = supabase.storage
              .from("covers")
              .getPublicUrl(uniqueFileName);

            if (publicData?.publicUrl) {
              payload.cover_url = publicData.publicUrl;
            }
          } catch (storageErr: any) {
            console.error("Exceção ao fazer upload da capa:", storageErr);
            alert(`Falha no upload da foto de capa: ${storageErr?.message || storageErr}`);
            setIsSubmitting(false);
            return;
          }
        } else {
          if (initialData?.cover_url) {
            payload.cover_url = initialData.cover_url;
          } else if (coverPreviewUrl) {
            payload.cover_url = coverPreviewUrl;
          }
        }

        // 2. Executar o UPDATE
        try {
          const { data, error } = await supabase
            .from("tournaments")
            .update(payload)
            .eq("id", tournamentIdToUpdate)
            .select()
            .single();

          if (error) {
            console.error("Erro Supabase ao atualizar torneio:", error);
            alert(`Erro ao salvar alterações do torneio: ${error.message}`);
            setIsSubmitting(false);
            return;
          }

          setCurrentSportType(sportType);

          // 3. Notificação de Nova Exigência para atletas inscritos
          try {
            const hadCpf = Boolean(initialData?.require_cpf);
            const nowCpf = Boolean(payload.require_cpf);
            const hadPhone = Boolean(initialData?.require_phone);
            const nowPhone = Boolean(payload.require_phone);
            const hadSkill =
              Boolean((initialData as any)?.require_skill_level) ||
              (Boolean(initialData?.skill_level) && initialData?.skill_level !== "ALL");
            const nowSkill =
              Boolean((payload as any)?.require_skill_level) ||
              (Boolean(skillLevel) && skillLevel !== "ALL");

            const isNewRequirement =
              (!hadCpf && nowCpf) || (!hadPhone && nowPhone) || (!hadSkill && nowSkill);

            const hadRules = (initialData?.rules || '').trim();
            const nowRules = (payload.rules || '').trim();
            const rulesChanged = Boolean(nowRules) && hadRules !== nowRules;

            if (isNewRequirement || rulesChanged) {
              await notifyTournamentRulesChanged({
                tournamentId: tournamentIdToUpdate,
                tournamentName: payload.name || initialData?.name,
              });
            }
          } catch (notifErr: any) {
            console.warn("Aviso ao enviar notificações de novas exigências:", notifErr);
          }

          setTournaments((prev: Tournament[]) =>
            prev.map((t) =>
              t.id === tournamentIdToUpdate
                ? {
                  ...t,
                  ...payload,
                  id: tournamentIdToUpdate,
                  cover_url: data?.cover_url || payload.cover_url || t.cover_url,
                }
                : t
            )
          );

          if (onSuccess) {
            onSuccess(tournamentIdToUpdate);
          } else if (onClose) {
            onClose();
          }
        } catch (updateErr: any) {
          console.error("Falha ao atualizar torneio no banco de dados:", updateErr);
          alert(`Erro ao atualizar torneio: ${updateErr?.message || updateErr}`);
          setIsSubmitting(false);
          return;
        }
      } else {
        // MODO CRIAÇÃO (INSERT)
        let finalCoverUrl = DEFAULT_COVERS[sportType];

        if (coverFile) {
          try {
            const cleanFileName = coverFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const uniqueFileName = `${Date.now()}_${cleanFileName}`;

            const { error: uploadError } = await supabase.storage
              .from("covers")
              .upload(uniqueFileName, coverFile, {
                cacheControl: "3600",
                upsert: true,
              });

            if (uploadError) {
              console.warn("Aviso no upload da capa na criação:", uploadError);
            } else {
              const { data: publicData } = supabase.storage
                .from("covers")
                .getPublicUrl(uniqueFileName);
              if (publicData?.publicUrl) {
                finalCoverUrl = publicData.publicUrl;
              }
            }
          } catch (storageErr) {
            console.warn("Exceção no upload da capa na criação:", storageErr);
          }
        } else if (coverPreviewUrl) {
          finalCoverUrl = coverPreviewUrl;
        }

        payload.cover_url = finalCoverUrl;
        payload.status = "OPEN";
        payload.owner_id = ownerId;

        const { data, error } = await supabase
          .from("tournaments")
          .insert(payload)
          .select()
          .single();

        if (error) {
          console.error("Erro Supabase ao criar torneio:", error);
          throw error;
        }

        const createdTournamentId = data?.id;

        isDraftClearedRef.current = true;
        if (typeof window !== "undefined") {
          localStorage.removeItem("sportconnect_tournament_draft");
        }

        if (createdTournamentId) {
          setCurrentTournamentId(createdTournamentId);
          setCurrentSportType(sportType);

          if (typeof window !== "undefined") {
            localStorage.setItem("sc_current_tournament_id", createdTournamentId);
          }

          const mappedNewTour: Tournament = {
            id: createdTournamentId,
            name: data.name,
            status: data.status,
            createdAt: data.created_at,
            sport_type: data.sport_type,
            format: data.format,
            tournament_format: data.tournament_format || tournamentFormat,
            gender_category: (data.gender_category || genderCategory || "MISTO").toUpperCase(),
            owner_id: data.owner_id,
            max_teams: data.max_teams ? Number(data.max_teams) : maxTeams,
            entry_fee: data.entry_fee ? Number(data.entry_fee) : parsedEntryFee,
            location: data.location,
            start_date: data.start_date,
            start_time: data.start_time || payload.start_time,
            rules: data.rules,
            rulebook_url: data.rulebook_url || finalRulebookUrl,
            cover_url: data.cover_url || finalCoverUrl,
            pix_key_type: isPaid ? (data.pix_key_type || pixKeyType) : undefined,
            organizer_pix_key: isPaid ? (data.organizer_pix_key || organizerPixKey.trim() || undefined) : undefined,
            match_rules: data.match_rules || compiledMatchRules,
            custom_registration_fields: data.custom_registration_fields || sanitizedCustomFields,
            sponsors: data.sponsors || processedSponsors,
            prize_first: data.prize_first || payload.prize_first,
            prize_second: data.prize_second || payload.prize_second,
            prize_third: data.prize_third || payload.prize_third,
            min_age: data.min_age !== undefined ? data.min_age : payload.min_age,
            max_age: data.max_age !== undefined ? data.max_age : payload.max_age,
            min_players: data.min_players !== undefined ? data.min_players : payload.min_players,
            max_players: data.max_players !== undefined ? data.max_players : payload.max_players,
            skill_level: data.skill_level || payload.skill_level,
          };

          setTournaments((prev: Tournament[]) => [mappedNewTour, ...prev]);
        }

        // Redirecionamento para o Dashboard
        if (onSuccess && createdTournamentId) {
          onSuccess(createdTournamentId);
        } else {
          router.push("/dashboard");
        }
      }
    } catch (err: unknown) {
      console.error("Erro ao salvar campeonato:", err);

      let msg = "Ocorreu um erro ao salvar o campeonato no banco de dados.";
      if (err instanceof Error) {
        msg = err.message;
      } else if (typeof err === "object" && err !== null && "message" in err) {
        msg = String((err as { message: string }).message);
      }

      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const STEPS = [
    { number: 1, title: "Geral", subtitle: "Nome, esporte e categoria", icon: Trophy },
    { number: 2, title: "Local e Data", subtitle: "Localização e horários", icon: Calendar },
    { number: 3, title: "Formato & Valores", subtitle: "Chaves, vagas e Pix", icon: Layers },
    { number: 4, title: "Extras", subtitle: "Regras e patrocinadores", icon: Sparkles },
  ];

  return (
    <div
      className={`bg-[#1a1a1a] border border-[#333] rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-2xl relative text-white w-full max-h-[90vh] overflow-y-auto selection:bg-blue-600/30 selection:text-white ${isModal ? "max-w-2xl mx-auto" : "max-w-3xl mx-auto"
        }`}
    >
      {/* Faixa decorativa superior em gradiente azul SportConnect */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 via-[#00a2ff] to-cyan-500" />

      {/* Botão de Fechar Modal (se fornecido) */}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          title="Fechar"
        >
          <X className="h-5 w-5" />
        </button>
      )}

      {/* Cabeçalho */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-blue-600/15 border border-blue-500/25 text-blue-400">
            <Trophy className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white font-display tracking-tight uppercase">
              {isEditing ? "Editar Configurações do Torneio" : "Configurar Novo Torneio"}
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400">
              {isEditing
                ? "Atualize as informações, regras e patrocinadores do evento."
                : "Preencha as informações essenciais para abrir as inscrições e gerenciar sua competição."}
            </p>
          </div>
        </div>
      </div>

      {/* 1. BARRA DE PROGRESSO MULTI-STEP (WIZARD) */}
      <div className="mb-6 space-y-3">
        {/* Barra horizontal animada */}
        <div className="w-full h-1.5 bg-[#27272a] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-600 via-[#00a2ff] to-cyan-400 transition-all duration-300 rounded-full"
            style={{ width: `${(currentStep / 4) * 100}%` }}
          />
        </div>

        {/* Pílulas dos 4 Steps com navegação direta */}
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
          {STEPS.map((step) => {
            const isCurrent = step.number === currentStep;
            const isPast = step.number < currentStep;

            return (
              <button
                key={step.number}
                type="button"
                onClick={() => handleStepClick(step.number)}
                className={`flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 p-2 sm:px-3 sm:py-2.5 rounded-xl border text-left transition-all cursor-pointer ${isCurrent
                    ? "bg-blue-600/20 border-blue-500/60 text-white shadow-lg shadow-blue-600/10 ring-1 ring-blue-500/30"
                    : isPast
                      ? "bg-[#18181b] border-zinc-800 text-blue-400 hover:border-zinc-700"
                      : "bg-[#121214] border-zinc-900 text-zinc-500 hover:border-zinc-800"
                  }`}
              >
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 text-xs font-black transition-colors ${isCurrent
                      ? "bg-blue-600 text-white"
                      : isPast
                        ? "bg-blue-500/20 text-blue-400"
                        : "bg-zinc-800 text-zinc-500"
                    }`}
                >
                  {isPast ? <Check className="h-3.5 w-3.5" /> : step.number}
                </div>
                <div className="hidden sm:block truncate">
                  <span className="text-[11px] font-black uppercase tracking-wider block leading-tight truncate">
                    {step.title}
                  </span>
                  <span className="text-[10px] text-zinc-500 block truncate">
                    {step.subtitle}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Toast de Rascunho Recuperado */}
      {showDraftToast && (
        <div className="mb-5 p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-semibold flex items-center justify-between gap-2 animate-fadeIn">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-400 shrink-0" />
            <span>Rascunho recuperado. Você continuou de onde parou.</span>
          </div>
          <button
            type="button"
            onClick={() => setShowDraftToast(false)}
            className="p-1 rounded-lg text-blue-400/70 hover:text-blue-200 hover:bg-blue-500/20 transition-colors cursor-pointer"
            title="Fechar aviso"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Alerta de Erro Visual */}
      {errorMessage && (
        <div className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Formulário com Grelha Responsiva Multi-Step */}
      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          // Bloqueia submit nativo acidental ao pressionar Enter em inputs nas etapas anteriores à 4
          if (e.key === "Enter" && currentStep < 4) {
            const target = e.target as HTMLElement;
            if (target.tagName.toLowerCase() !== "textarea") {
              e.preventDefault();
              e.stopPropagation();
              handleNextStep(e);
            }
          }
        }}
        className="space-y-6"
      >
        {/* ======================================================== */}
        {/* ETAPA 1: GERAL (Nome, Modalidade, Categoria e Capa) */}
        {/* ======================================================== */}
        {currentStep === 1 && (
          <div className="space-y-5 animate-fadeIn">
            {/* Upload da Foto de Capa (Drag & Drop + Botão + Live Preview Padrão/Custom) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                  Foto de Capa do Torneio
                </label>
                <span className="text-[11px] text-zinc-400 font-medium">
                  {coverFile ? "Arquivo selecionado" : `Padrão: ${SPORT_SELECT_OPTIONS.find((s) => s.id === sportType)?.label}`}
                </span>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileSelect(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`relative w-full h-44 sm:h-52 rounded-2xl overflow-hidden border-2 border-dashed transition-all cursor-pointer group flex flex-col justify-between p-4 ${isDragging
                    ? "border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/30"
                    : coverFile
                      ? "border-blue-500/60 bg-[#18181b]"
                      : "border-[#3f3f46] hover:border-zinc-500 bg-[#18181b]"
                  }`}
              >
                {/* Imagem de Fundo (Preview Ao Vivo: Usuário ou Padrão) */}
                <img
                  src={activeCoverUrl}
                  alt="Capa do Torneio"
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />

                {/* Gradiente Escuro Sobreposto para contraste e legibilidade */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/30 group-hover:from-black/95 transition-all" />

                {/* Input de arquivo invisível */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                />

                {/* Badges superiores na imagem */}
                <div className="relative z-10 flex items-center justify-between w-full">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 text-[11px] font-bold text-white shadow-md">
                    {coverFile ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Capa Personalizada</span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-blue-400" />
                        <span>Capa Padrão ({SPORT_SELECT_OPTIONS.find((s) => s.id === sportType)?.label})</span>
                      </>
                    )}
                  </div>

                  {coverFile && (
                    <button
                      type="button"
                      onClick={handleRemoveCover}
                      className="p-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white transition-all shadow-md active:scale-95 cursor-pointer"
                      title="Remover foto personalizada e restaurar padrão"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Conteúdo inferior e instruções de upload */}
                <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-600/90 group-hover:bg-blue-600 border border-blue-400/30 flex items-center justify-center text-white shadow-lg shrink-0 transition-transform group-hover:scale-110">
                      <Camera className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs sm:text-sm font-bold text-white group-hover:text-blue-300 transition-colors">
                        {coverFile ? "Clique ou arraste para trocar a capa" : "Arraste uma foto ou clique para escolher"}
                      </p>
                      <p className="text-[11px] text-zinc-300">
                        PNG, JPG ou WEBP (máximo 5MB)
                      </p>
                    </div>
                  </div>

                  <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 group-hover:bg-white/20 backdrop-blur-md border border-white/15 text-xs font-bold text-white transition-all shadow-md">
                    <UploadCloud className="h-3.5 w-3.5 text-blue-400" />
                    <span>{coverFile ? "Alterar foto" : "Upload"}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Nome do Torneio */}
            <div className="space-y-1.5">
              <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                Nome do Torneio <span className="text-blue-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errorMessage) setErrorMessage("");
                }}
                placeholder="Ex: Copa Picos de Dominó 2026"
                className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
              />
            </div>

            {/* Grid: Modalidade e Categoria */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Modalidade */}
              <div className="space-y-1.5">
                <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                  Modalidade <span className="text-blue-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={sportType}
                    onChange={(e) => handleSportChange(e.target.value as SportType)}
                    className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 outline-none transition-all appearance-none cursor-pointer pr-10"
                  >
                    {SPORT_SELECT_OPTIONS.map((sport) => (
                      <option key={sport.id} value={sport.id} className="bg-[#1a1a1a] text-white">
                        {sport.icon} {sport.label}
                      </option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-zinc-400">
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </div>
              </div>

              {/* Categoria de Gênero */}
              <div className="space-y-1.5">
                <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                  Categoria <span className="text-blue-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={genderCategory}
                    onChange={(e) => setGenderCategory(e.target.value.toUpperCase())}
                    className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 outline-none transition-all appearance-none cursor-pointer pr-10"
                  >
                    <option value="MASCULINO" className="bg-[#1a1a1a] text-white">Masculino</option>
                    <option value="FEMININO" className="bg-[#1a1a1a] text-white">Feminino</option>
                    <option value="MISTO" className="bg-[#1a1a1a] text-white">Misto</option>
                  </select>
                  <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-zinc-400">
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </div>
              </div>
            </div>

            {/* Formato da Modalidade (Individual, Duplas, etc. - movido para Etapa 1) */}
            {isFormatVisible && (
              <div className="space-y-1.5 animate-fadeIn">
                <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                  Formato da Modalidade <span className="text-blue-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={format}
                    onChange={(e) => {
                      const newFormat = e.target.value;
                      setFormat(newFormat);
                      const isStillTeam = !["solo", "1v1", "duplas", "2v2", "individual"].some((keyword) =>
                        newFormat.toLowerCase().includes(keyword)
                      );
                      if (!isStillTeam) {
                        setMinPlayers("");
                        setMaxPlayers("");
                      }
                    }}
                    className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 outline-none transition-all appearance-none cursor-pointer pr-10"
                  >
                    {sportType === "VOLEI" &&
                      VOLEI_FORMAT_OPTIONS.map((fmt) => (
                        <option key={fmt} value={fmt} className="bg-[#1a1a1a] text-white">
                          {fmt}
                        </option>
                      ))}
                    {sportType === "PING_PONG" &&
                      PING_PONG_FORMAT_OPTIONS.map((fmt) => (
                        <option key={fmt} value={fmt} className="bg-[#1a1a1a] text-white">
                          {fmt}
                        </option>
                      ))}
                  </select>
                  <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-zinc-400">
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* ETAPA 2: LOCAL E DATA (Endereço, Mapa, Data e Horário) */}
        {/* ======================================================== */}
        {currentStep === 2 && (
          <div className="space-y-5 animate-fadeIn">
            {/* Local do Evento & Mapa Funcional com Iframe */}
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                Local do Evento
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-blue-500">
                  <MapPin className="h-4 w-4" />
                </div>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Digite o endereço do ginásio, quadra ou clube..."
                  className="w-full pl-10 pr-4 py-3 bg-[#0f0f0f] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                />
              </div>

              {/* Renderização Condicional do Mapa Google Maps */}
              <div className="mt-2">
                {!debouncedAddress ? (
                  <div className="h-[150px] w-full rounded-xl border border-[#333] bg-[#0c0c0c] flex flex-col items-center justify-center p-4 text-center">
                    <div className="w-10 h-10 rounded-full bg-zinc-900 border border-[#333] flex items-center justify-center text-zinc-500 mb-2">
                      <MapPin className="h-5 w-5 text-blue-500/70" />
                    </div>
                    <p className="text-xs text-zinc-400 font-medium">
                      Digite o endereço para carregar o mapa
                    </p>
                    <span className="text-[11px] text-zinc-600 mt-0.5">
                      O mapa interativo será carregado automaticamente
                    </span>
                  </div>
                ) : (
                  <div className="relative rounded-xl overflow-hidden border border-zinc-700 bg-zinc-900 shadow-md animate-fadeIn">
                    <iframe
                      width="100%"
                      height="150"
                      className="rounded-md border border-zinc-700 w-full block"
                      src={`https://maps.google.com/maps?q=${encodeURIComponent(
                        debouncedAddress
                      )}&t=&z=15&ie=UTF8&iwloc=&output=embed`}
                      frameBorder="0"
                      scrolling="no"
                      title="Localização do Torneio"
                      loading="lazy"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Grid: Data de Início, Data de Término e Horário com Checkbox de Horário Opcional */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Data de Início */}
              <div className="space-y-1.5">
                <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                  Data de Início
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      const nextStart = e.target.value;
                      setStartDate(nextStart);
                      if (endDate && nextStart && endDate < nextStart) {
                        setEndDate(nextStart);
                      }
                    }}
                    className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 outline-none transition-all [color-scheme:dark]"
                  />
                </div>
              </div>

              {/* Data de Término */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                    Data de Término
                  </label>
                  <span className="text-[10px] text-zinc-500">Opcional</span>
                </div>
                <div className="relative">
                  <input
                    type="date"
                    min={startDate || undefined}
                    value={endDate}
                    onChange={(e) => {
                      const nextEnd = e.target.value;
                      setEndDate(nextEnd);
                      if (startDate && nextEnd && nextEnd < startDate) {
                        setErrorMessage("A data de término não pode ser anterior à data de início.");
                      } else if (errorMessage.includes("data de término")) {
                        setErrorMessage("");
                      }
                    }}
                    className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 outline-none transition-all [color-scheme:dark]"
                  />
                </div>
              </div>

              {/* Horário (com tratamento de horário opcional) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                    Horário
                  </label>
                  <span className="text-[10px] text-zinc-500">
                    {noTimeSet ? "Horário indefinido" : "Opcional"}
                  </span>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-400">
                    <Clock className={`h-4 w-4 ${noTimeSet ? "text-zinc-600" : "text-blue-500"}`} />
                  </div>
                  <input
                    type="time"
                    disabled={noTimeSet}
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className={`w-full pl-10 pr-4 py-3 bg-[#0f0f0f] border rounded-xl text-sm outline-none transition-all [color-scheme:dark] ${noTimeSet
                        ? "border-zinc-800 text-zinc-600 cursor-not-allowed opacity-50 bg-[#121214]"
                        : "border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-zinc-100"
                      }`}
                  />
                </div>

                {/* Checkbox "Definir horário depois" */}
                <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={noTimeSet}
                    onChange={(e) => handleToggleNoTimeSet(e.target.checked)}
                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                  <span className="text-xs font-semibold text-zinc-300">
                    Definir horário depois
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* ETAPA 3: FORMATO E VALORES (Formato, Vagas, Taxa e Pix) */}
        {/* ======================================================== */}
        {currentStep === 3 && (
          <div className="space-y-5 animate-fadeIn">
            {/* NOVO CAMPO OBRIGATÓRIO: Formato do Torneio (tournament_format) */}
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                Formato do Torneio <span className="text-blue-500">*</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {TOURNAMENT_FORMAT_OPTIONS.map((opt) => {
                  const isSelected = tournamentFormat === opt.id;
                  const Icon = opt.icon;

                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setTournamentFormat(opt.id);
                        if (errorMessage) setErrorMessage("");
                      }}
                      className={`p-3.5 rounded-2xl border text-left transition-all relative flex flex-col justify-between cursor-pointer group ${isSelected
                          ? "bg-blue-600/15 border-blue-500 text-white shadow-lg shadow-blue-600/15 ring-1 ring-blue-500/40"
                          : "bg-[#0f0f0f] border-[#27272a] hover:border-zinc-700 text-zinc-400 hover:text-zinc-200"
                        }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div
                            className={`p-2 rounded-xl transition-colors ${isSelected
                                ? "bg-blue-600 text-white"
                                : "bg-zinc-800/80 text-zinc-400 group-hover:text-white"
                              }`}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <span
                            className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${isSelected
                                ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                                : "bg-zinc-800/60 border-zinc-700/60 text-zinc-400"
                              }`}
                          >
                            {opt.badge}
                          </span>
                        </div>

                        <div>
                          <h4 className="text-xs font-black text-white font-display uppercase tracking-tight">
                            {opt.label}
                          </h4>
                          <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                            {opt.desc}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 pt-2 border-t border-zinc-800/60 flex items-center justify-between text-[10px] font-bold">
                        <span className={isSelected ? "text-blue-400" : "text-zinc-500"}>
                          {isSelected ? "Selecionado" : "Clique para selecionar"}
                        </span>
                        <div
                          className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${isSelected
                              ? "border-blue-500 bg-blue-600 text-white"
                              : "border-zinc-700 bg-zinc-900"
                            }`}
                        >
                          {isSelected && <Check className="h-2.5 w-2.5" />}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* BLOCO ESPECÍFICO DO FORMATO FASE DE GRUPOS + ELIMINATÓRIAS */}
              {(tournamentFormat === "GROUPS" || tournamentFormat === "GROUPS_KNOCKOUT") && (
                <div className="p-4 sm:p-5 rounded-2xl bg-[#0d0d0d] border border-blue-500/30 shadow-lg space-y-4 animate-fadeIn mt-3">
                  <div className="flex items-center gap-2.5 pb-2 border-b border-zinc-800">
                    <div className="p-2 rounded-xl bg-blue-600/15 border border-blue-500/30 text-blue-400">
                      <Layers className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase tracking-wider font-display">
                        Configuração da Fase de Grupos
                      </h4>
                      <p className="text-[11px] text-zinc-400">
                        Divisão matemática equilibrada e cruzamento olímpico automático no mata-mata
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Quantidade de Grupos <span className="text-blue-500">*</span>
                      </label>
                      <select
                        value={numGroups}
                        onChange={(e) => setNumGroups(Number(e.target.value))}
                        className="w-full bg-[#18181b] border border-zinc-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        <option value={2}>2 Grupos (Grupo A e Grupo B)</option>
                        <option value={3}>3 Grupos (A, B e C)</option>
                        <option value={4}>4 Grupos (A, B, C e D)</option>
                        <option value={6}>6 Grupos (A até F)</option>
                        <option value={8}>8 Grupos (A até H)</option>
                      </select>
                      <p className="text-[10px] text-zinc-500">
                        {maxTeams
                          ? `Para ${maxTeams} equipes: ~${Math.round(maxTeams / numGroups)} participantes por grupo.`
                          : "Tamanho ideal: 3 ou 4 equipes por grupo."}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Classificados por Grupo <span className="text-blue-500">*</span>
                      </label>
                      <select
                        value={qualifiersPerGroup}
                        onChange={(e) => setQualifiersPerGroup(Number(e.target.value))}
                        className="w-full bg-[#18181b] border border-zinc-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        <option value={2}>2 melhores de cada grupo (Cruzamento Olímpico 1º A vs 2º B)</option>
                        <option value={1}>Apenas o 1º colocado de cada grupo</option>
                        <option value={3}>3 melhores colocados de cada grupo</option>
                        <option value={4}>4 melhores colocados de cada grupo</option>
                      </select>
                      <p className="text-[10px] text-zinc-500">
                        Os 2 primeiros se enfrentam em cruzamento olímpico nas eliminatórias.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Opção de Disputa de 3º Lugar para formatos com eliminatórias */}
              {(tournamentFormat === "KNOCKOUT" ||
                tournamentFormat === "GROUPS" ||
                tournamentFormat === "GROUPS_KNOCKOUT") && (
                <div className="flex items-start gap-3 p-3.5 sm:p-4 rounded-xl bg-[#0d0d0d] border border-blue-500/20 hover:border-blue-500/40 transition-colors mt-3">
                  <input
                    type="checkbox"
                    id="has_third_place_match"
                    checked={hasThirdPlaceMatch}
                    onChange={(e) => setHasThirdPlaceMatch(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-zinc-900 cursor-pointer"
                  />
                  <label htmlFor="has_third_place_match" className="text-xs cursor-pointer select-none space-y-0.5">
                    <span className="font-bold text-white block">
                      Habilitar disputa de 3º lugar?
                    </span>
                    <span className="text-[11px] text-zinc-400 block leading-relaxed">
                      Se ativado, cria automaticamente uma partida extra entre os perdedores das semifinais para definir o 3º colocado do torneio.
                    </span>
                  </label>
                </div>
              )}
            </div>

            {/* ======================================================== */}
            {/* BLOCO DINÂMICO: REGRAS DA PARTIDA POR MODALIDADE (JSONB) */}
            {/* ======================================================== */}
            <div className="space-y-4 p-4 sm:p-5 rounded-2xl bg-[#0d0d0d] border border-blue-500/25 shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 w-36 h-36 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-zinc-800/80">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-blue-600/15 border border-blue-500/25 text-blue-400 shrink-0">
                    <Timer className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-white uppercase tracking-wider font-display">
                      Regras da Partida & Pontuação
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      Critérios específicos para disputas de{" "}
                      <span className="text-blue-400 font-bold">
                        {SPORT_SELECT_OPTIONS.find((s) => s.id === sportType)?.label || sportType}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="self-start sm:self-auto">
                  <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 inline-flex items-center gap-1.5">
                    {sportType === "FUTSAL" || (sportType as string) === "FUTEBOL" ? (
                      <>
                        <span>⏱️</span> Regras de Tempo
                      </>
                    ) : sportType === "PING_PONG" || sportType === "VOLEI" || (sportType as string) === "TENIS" ? (
                      <>
                        <span>🎯</span> Regras de Sets
                      </>
                    ) : (
                      <>
                        <span>🁓</span> Pontuação Acumulada
                      </>
                    )}
                  </span>
                </div>
              </div>

              {/* CENÁRIO A: Futsal ou Futebol (Regras de Tempo) */}
              {(sportType === "FUTSAL" || (sportType as string) === "FUTEBOL") && (
                <div className="space-y-4 pt-1 animate-fadeIn">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* halves_count */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Número de Tempos <span className="text-blue-500">*</span>
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="4"
                        value={halvesCount}
                        onChange={(e) => setHalvesCount(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full px-4 py-2.5 bg-[#080808] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 outline-none transition-all shadow-inner"
                        placeholder="2"
                      />
                      <span className="text-[10px] text-zinc-500 block">
                        Padrão: 2 tempos (1º e 2º tempo)
                      </span>
                    </div>

                    {/* half_duration_minutes */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Duração de Cada Tempo (minutos) <span className="text-blue-500">*</span>
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="60"
                        value={halfDurationMinutes}
                        onChange={(e) => setHalfDurationMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full px-4 py-2.5 bg-[#080808] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 outline-none transition-all shadow-inner"
                        placeholder="20"
                      />
                      <span className="text-[10px] text-zinc-500 block">
                        Minutos de bola rolando por tempo (ex: 20 min)
                      </span>
                    </div>
                  </div>

                  {/* Radios / Checkboxes: has_extra_time & has_penalties */}
                  <div className="space-y-3 pt-1">
                    {/* has_extra_time */}
                    <div className="p-3.5 rounded-xl bg-[#080808] border border-[#27272a] space-y-2.5 transition-all">
                      <label className="flex items-center justify-between cursor-pointer select-none">
                        <div className="flex items-center gap-2.5 pr-2">
                          <input
                            type="checkbox"
                            checked={hasExtraTime}
                            onChange={(e) => setHasExtraTime(e.target.checked)}
                            className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <div>
                            <span className="text-xs font-bold text-zinc-200 block">
                              Prever Prorrogação em caso de empate
                            </span>
                            <span className="text-[10px] text-zinc-500 block">
                              Adiciona tempo extra antes de eventual decisão por pênaltis
                            </span>
                          </div>
                        </div>
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded shrink-0 ${hasExtraTime ? "bg-blue-500/20 text-blue-400" : "bg-zinc-800 text-zinc-500"}`}>
                          {hasExtraTime ? "Ativo" : "Não"}
                        </span>
                      </label>

                      {/* extra_time_duration (renderizado se true) */}
                      {hasExtraTime && (
                        <div className="pt-2.5 border-t border-zinc-800/80 animate-fadeIn pl-6">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-300 block mb-1">
                            Duração da Prorrogação (minutos por tempo)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="30"
                            value={extraTimeDuration}
                            onChange={(e) => setExtraTimeDuration(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-full sm:w-48 px-3.5 py-2 bg-[#121214] border border-blue-500/40 focus:border-blue-500 rounded-lg text-xs text-zinc-100 outline-none"
                            placeholder="5"
                          />
                        </div>
                      )}
                    </div>

                    {/* has_penalties */}
                    <div className="p-3.5 rounded-xl bg-[#080808] border border-[#27272a] transition-all">
                      <label className="flex items-center justify-between cursor-pointer select-none">
                        <div className="flex items-center gap-2.5 pr-2">
                          <input
                            type="checkbox"
                            checked={hasPenalties}
                            onChange={(e) => setHasPenalties(e.target.checked)}
                            className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <div>
                            <span className="text-xs font-bold text-zinc-200 block">
                              Decisão por Pênaltis
                            </span>
                            <span className="text-[10px] text-zinc-500 block">
                              Permite cobranças de penalidades para definir o vencedor se persistir empate
                            </span>
                          </div>
                        </div>
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded shrink-0 ${hasPenalties ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-500"}`}>
                          {hasPenalties ? "Sim" : "Não"}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* CENÁRIO B: Ping Pong, Vôlei ou Tênis (Regras de Sets) */}
              {(sportType === "PING_PONG" || sportType === "VOLEI" || (sportType as string) === "TENIS") && (
                <div className="space-y-4 pt-1 animate-fadeIn">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* best_of_sets */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Disputa de Sets <span className="text-blue-500">*</span>
                      </label>
                      <div className="relative">
                        <select
                          value={bestOfSets}
                          onChange={(e) => setBestOfSets(parseInt(e.target.value) || 3)}
                          className="w-full px-4 py-2.5 bg-[#080808] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 outline-none transition-all appearance-none cursor-pointer pr-10 shadow-inner"
                        >
                          <option value={3} className="bg-[#1a1a1a] text-white">
                            Melhor de 3 Sets (Vence quem fizer 2)
                          </option>
                          <option value={5} className="bg-[#1a1a1a] text-white">
                            Melhor de 5 Sets (Vence quem fizer 3)
                          </option>
                        </select>
                        <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                      </div>
                      <span className="text-[10px] text-zinc-500 block">
                        Quantidade de sets para determinar a vitória no confronto
                      </span>
                    </div>

                    {/* points_per_set */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Pontos por Set Regular <span className="text-blue-500">*</span>
                      </label>
                      <input
                        type="number"
                        min="5"
                        max="50"
                        value={pointsPerSet}
                        onChange={(e) => setPointsPerSet(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full px-4 py-2.5 bg-[#080808] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 outline-none transition-all shadow-inner"
                        placeholder={sportType === "VOLEI" ? "25" : "21"}
                      />
                      <span className="text-[10px] text-zinc-500 block">
                        {sportType === "VOLEI"
                          ? "Padrão de Vôlei: 25 pontos"
                          : "Padrão: 21 pontos (ou 11 oficial ITTF)"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* tie_break_points */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Pontos no Tie-Break (Set Desempate) <span className="text-blue-500">*</span>
                      </label>
                      <input
                        type="number"
                        min="5"
                        max="30"
                        value={tieBreakPoints}
                        onChange={(e) => setTieBreakPoints(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full px-4 py-2.5 bg-[#080808] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 outline-none transition-all shadow-inner"
                        placeholder="15"
                      />
                      <span className="text-[10px] text-zinc-500 block">
                        Pontuação alvo no set decisivo final (padrão: 15)
                      </span>
                    </div>

                    {/* requires_two_point_advantage */}
                    <div className="p-3.5 rounded-xl bg-[#080808] border border-[#27272a] flex flex-col justify-center">
                      <label className="flex items-center justify-between cursor-pointer select-none">
                        <div className="flex items-center gap-2.5 pr-2">
                          <input
                            type="checkbox"
                            checked={requiresTwoPointAdvantage}
                            onChange={(e) => setRequiresTwoPointAdvantage(e.target.checked)}
                            className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <div>
                            <span className="text-xs font-bold text-zinc-200 block">
                              Vantagem de 2 Pontos
                            </span>
                            <span className="text-[10px] text-zinc-500 block leading-tight">
                              O set só finaliza com diferença mínima de 2 pontos (ex: 22x20)
                            </span>
                          </div>
                        </div>
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded shrink-0 ${requiresTwoPointAdvantage ? "bg-blue-500/20 text-blue-400" : "bg-zinc-800 text-zinc-500"}`}>
                          {requiresTwoPointAdvantage ? "Sim" : "Não"}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* CENÁRIO C: Dominó (Regras de Pontuação Acumulada) */}
              {sportType === "DOMINO" && (
                <div className="space-y-4 pt-1 animate-fadeIn">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* target_score */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Pontuação Alvo (Meta para Vencer) <span className="text-blue-500">*</span>
                      </label>
                      <input
                        type="number"
                        min="50"
                        max="1000"
                        step="10"
                        value={targetScore}
                        onChange={(e) => setTargetScore(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full px-4 py-2.5 bg-[#080808] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 outline-none transition-all shadow-inner"
                        placeholder="200"
                      />
                      <span className="text-[10px] text-zinc-500 block">
                        Pontos acumulados necessários para fechar a partida (ex: 200 pts)
                      </span>
                    </div>

                    {/* max_rounds */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                        Limite Máximo de Rodadas / Mãos <span className="text-blue-500">*</span>
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={maxRounds}
                        onChange={(e) => setMaxRounds(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full px-4 py-2.5 bg-[#080808] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 outline-none transition-all shadow-inner"
                        placeholder="10"
                      />
                      <span className="text-[10px] text-zinc-500 block">
                        Número limite de mãos caso nenhuma dupla atinja a pontuação alvo
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Exceções / Regras Dinâmicas por Fase (Oitavas, Quartas, Semifinal, Final, etc.) */}
              <div className="pt-4 mt-3 border-t border-[#27272a] space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                      <span>Regras Dinâmicas por Fase (Exceções)</span>
                    </h4>
                    <p className="text-[11px] text-zinc-400">
                      Defina regras específicas para fases avançadas (ex: Semifinal ou Final em Melhor de 5).
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={phaseExceptions.length >= PHASE_EXCEPTION_OPTIONS.length}
                    onClick={() => {
                      const usedPhases = new Set(phaseExceptions.map((p) => p.phase));
                      const preferredOrder: PhaseKey[] = [
                        "final",
                        "semi_finals",
                        "quarter_finals",
                        "round_of_16",
                        "third_place",
                        "group_stage",
                      ];
                      const nextPhase =
                        preferredOrder.find((p) => !usedPhases.has(p)) || "final";
                      setPhaseExceptions((prev) => [
                        ...prev,
                        {
                          id: `phase-ex-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                          phase: nextPhase,
                          bestOf: 5,
                          pointsPerSet: pointsPerSet || (sportType === "VOLEI" ? 25 : 11),
                          tieBreakPoints: tieBreakPoints || 15,
                          halfDurationMinutes: halfDurationMinutes || 25,
                          targetScore: targetScore || 200,
                        },
                      ]);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 hover:text-amber-200 text-xs font-black uppercase tracking-wider transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 self-start sm:self-auto"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Adicionar exceção/regra por fase</span>
                  </button>
                </div>

                {phaseExceptions.length > 0 && (
                  <div className="space-y-3">
                    {phaseExceptions.map((item) => (
                      <div
                        key={item.id}
                        className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/30 space-y-3 animate-fadeIn"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex-1 max-w-xs space-y-1">
                            <label className="text-[11px] font-black uppercase tracking-wider text-amber-300 block">
                              Fase do Torneio
                            </label>
                            <select
                              value={item.phase}
                              onChange={(e) => {
                                const newPhase = e.target.value as PhaseKey;
                                setPhaseExceptions((prev) =>
                                  prev.map((row) =>
                                    row.id === item.id ? { ...row, phase: newPhase } : row
                                  )
                                );
                              }}
                              className="w-full px-3 py-2 bg-[#080808] border border-[#333] focus:border-amber-500 rounded-xl text-sm font-bold text-white outline-none cursor-pointer"
                            >
                              {PHASE_EXCEPTION_OPTIONS.map((opt) => (
                                <option
                                  key={opt.value}
                                  value={opt.value}
                                  disabled={
                                    opt.value !== item.phase &&
                                    phaseExceptions.some((other) => other.phase === opt.value)
                                  }
                                  className="bg-[#1a1a1a] text-white"
                                >
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setPhaseExceptions((prev) =>
                                prev.filter((row) => row.id !== item.id)
                              )
                            }
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-bold transition-all cursor-pointer self-end sm:self-center"
                            title="Remover regra desta fase"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Remover</span>
                          </button>
                        </div>

                        {sportType === "FUTSAL" || (sportType as string) === "FUTEBOL" ? (
                          <div className="space-y-1 max-w-xs">
                            <label className="text-xs font-bold text-zinc-300 block">
                              Duração de cada tempo nesta fase (min)
                            </label>
                            <input
                              type="number"
                              min="1"
                              max="60"
                              value={item.halfDurationMinutes}
                              onChange={(e) => {
                                const val = Math.max(1, parseInt(e.target.value) || 1);
                                setPhaseExceptions((prev) =>
                                  prev.map((row) =>
                                    row.id === item.id ? { ...row, halfDurationMinutes: val } : row
                                  )
                                );
                              }}
                              className="w-full px-3.5 py-2 bg-[#080808] border border-[#333] focus:border-amber-500 rounded-xl text-sm text-zinc-100 outline-none"
                            />
                          </div>
                        ) : sportType === "PING_PONG" || sportType === "VOLEI" || (sportType as string) === "TENIS" ? (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="space-y-1">
                              <label className="text-xs font-bold text-zinc-300 block">
                                Melhor de (Sets)
                              </label>
                              <select
                                value={item.bestOf}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setPhaseExceptions((prev) =>
                                    prev.map((row) =>
                                      row.id === item.id ? { ...row, bestOf: val } : row
                                    )
                                  );
                                }}
                                className="w-full px-3 py-2 bg-[#080808] border border-[#333] focus:border-amber-500 rounded-xl text-sm text-zinc-100 outline-none cursor-pointer"
                              >
                                <option value={1}>1 Set Único</option>
                                <option value={3}>Melhor de 3 Sets</option>
                                <option value={5}>Melhor de 5 Sets</option>
                                <option value={7}>Melhor de 7 Sets</option>
                              </select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-bold text-zinc-300 block">
                                Pontos por Set
                              </label>
                              <input
                                type="number"
                                min="1"
                                max="50"
                                value={item.pointsPerSet}
                                onChange={(e) => {
                                  const val = Math.max(1, parseInt(e.target.value) || 1);
                                  setPhaseExceptions((prev) =>
                                    prev.map((row) =>
                                      row.id === item.id ? { ...row, pointsPerSet: val } : row
                                    )
                                  );
                                }}
                                className="w-full px-3 py-2 bg-[#080808] border border-[#333] focus:border-amber-500 rounded-xl text-sm text-zinc-100 outline-none"
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-bold text-zinc-300 block">
                                Set Decisivo (Tie-break)
                              </label>
                              <input
                                type="number"
                                min="1"
                                max="50"
                                value={item.tieBreakPoints}
                                onChange={(e) => {
                                  const val = Math.max(1, parseInt(e.target.value) || 1);
                                  setPhaseExceptions((prev) =>
                                    prev.map((row) =>
                                      row.id === item.id ? { ...row, tieBreakPoints: val } : row
                                    )
                                  );
                                }}
                                className="w-full px-3 py-2 bg-[#080808] border border-[#333] focus:border-amber-500 rounded-xl text-sm text-zinc-100 outline-none"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-xs font-bold text-zinc-300 block">
                                Formato da Fase (Dominó)
                              </label>
                              <select
                                value={item.bestOf}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setPhaseExceptions((prev) =>
                                    prev.map((row) =>
                                      row.id === item.id ? { ...row, bestOf: val } : row
                                    )
                                  );
                                }}
                                className="w-full px-3 py-2 bg-[#080808] border border-[#333] focus:border-amber-500 rounded-xl text-sm text-zinc-100 outline-none cursor-pointer"
                              >
                                <option value={1}>Set Único</option>
                                <option value={3}>Melhor de 3</option>
                                <option value={5}>Melhor de 5</option>
                              </select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-bold text-zinc-300 block">
                                Pontuação Alvo nesta Fase
                              </label>
                              <input
                                type="number"
                                min="1"
                                max="1000"
                                value={item.targetScore}
                                onChange={(e) => {
                                  const val = Math.max(1, parseInt(e.target.value) || 1);
                                  setPhaseExceptions((prev) =>
                                    prev.map((row) =>
                                      row.id === item.id ? { ...row, targetScore: val } : row
                                    )
                                  );
                                }}
                                className="w-full px-3 py-2 bg-[#080808] border border-[#333] focus:border-amber-500 rounded-xl text-sm text-zinc-100 outline-none"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Grid: Contador de Vagas e Valor da Inscrição */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Número de Vagas com Rótulo e Unidade Dinâmicos */}
              <div className="space-y-1.5">
                <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                  {counterMeta.label}
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDecrementTeams}
                    disabled={maxTeams <= 2}
                    className="w-12 h-11 rounded-xl bg-[#0f0f0f] border border-[#333] hover:border-blue-500 text-zinc-300 hover:text-white flex items-center justify-center transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Diminuir vagas"
                  >
                    <Minus className="h-4 w-4" />
                  </button>

                  <div className="flex-1 h-11 bg-[#0f0f0f] border border-[#333] rounded-xl flex items-center justify-center px-3 shadow-inner">
                    <Users className="h-4 w-4 text-blue-500 mr-2 shrink-0" />
                    <span className="text-base font-black text-white font-display">
                      {maxTeams}
                    </span>
                    <span className="text-xs text-zinc-500 font-bold ml-1.5 truncate">
                      {counterMeta.unit}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleIncrementTeams}
                    disabled={maxTeams >= 64}
                    className="w-12 h-11 rounded-xl bg-[#0f0f0f] border border-[#333] hover:border-blue-500 text-zinc-300 hover:text-white flex items-center justify-center transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Aumentar vagas"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Valor da Inscrição (por time/dupla/jogador) */}
              <div className="space-y-1.5">
                <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                  VALOR DA INSCRIÇÃO (POR {counterMeta.singular.toUpperCase()})
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-blue-500 font-bold text-xs">
                    R$
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={entryFee}
                    disabled={hasPaidRegistrations}
                    readOnly={hasPaidRegistrations}
                    onChange={(e) => handleEntryFeeChange(e.target.value)}
                    placeholder="100.00"
                    className={`w-full pl-11 pr-4 py-3 rounded-xl text-sm outline-none transition-all shadow-inner ${
                      hasPaidRegistrations
                        ? "opacity-60 cursor-not-allowed border-zinc-800 bg-zinc-950 text-zinc-400"
                        : "bg-[#0f0f0f] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-zinc-100 placeholder:text-zinc-600"
                    }`}
                  />
                </div>
                <span className="text-[10px] text-zinc-500 block">
                  {hasPaidRegistrations ? (
                    <span className="text-red-500 text-sm flex items-center gap-1.5 font-medium mt-1">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
                      <span>O valor não pode ser alterado após a confirmação do primeiro pagamento.</span>
                    </span>
                  ) : (
                    "Defina 0.00 para criar um torneio gratuito (sem cobrança de inscrição)."
                  )}
                </span>
              </div>
            </div>

            {/* ÁREA DE RECEBIMENTO: Dropdown de Tipo de Chave Pix + Máscara Dinâmica */}
            {isPaidTournament ? (
              <div className="space-y-2 pt-2 border-t border-[#27272a]/60 animate-fadeIn">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-emerald-400" />
                  <label className="text-xs font-black uppercase tracking-wider text-zinc-200 block">
                    Dados PIX para Repasse (Organizador) <span className="text-blue-500">*</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  {/* Dropdown Tipo de Chave Pix */}
                  <div className="sm:col-span-4 space-y-1">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block">
                      Tipo de Chave <span className="text-blue-500">*</span>
                    </label>
                    <div className="relative">
                      <select
                        value={pixKeyType}
                        onChange={(e) => handlePixKeyTypeChange(e.target.value)}
                        className="w-full pl-3 pr-8 py-3 bg-[#0f0f0f] border border-[#333] focus:border-blue-500 rounded-xl text-xs text-zinc-100 outline-none transition-all appearance-none cursor-pointer"
                      >
                        {PIX_KEY_TYPES.map((t) => (
                          <option key={t.id} value={t.id} className="bg-[#1a1a1a] text-white">
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                    </div>
                  </div>

                  {/* Campo de Chave com Máscara Dinâmica */}
                  <div className="sm:col-span-8 space-y-1">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block">
                      Chave PIX <span className="text-blue-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={organizerPixKey}
                        onChange={(e) => setOrganizerPixKey(formatPixKey(e.target.value, pixKeyType))}
                        placeholder={PIX_KEY_TYPES.find((t) => t.id === pixKeyType)?.placeholder || "Digite a chave PIX"}
                        className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner font-mono"
                      />
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  O valor arrecadado das inscrições aprovadas (após taxas) será transferido pelo sistema para esta chave PIX.
                </p>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2.5 animate-fadeIn">
                <Check className="h-4 w-4 shrink-0" />
                <span>
                  <strong>Torneio Gratuito:</strong> Inscrições livres de taxa. Dados PIX para repasse não são necessários.
                </span>
              </div>
            )}

            {/* BLOCO DE PREMIAÇÃO (OPCIONAL) */}
            <div className="space-y-3 pt-4 border-t border-[#27272a]/60 animate-fadeIn">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-amber-400" />
                  <label className="text-xs font-black uppercase tracking-wider text-zinc-200 block">
                    Premiação (Opcional)
                  </label>
                </div>
                <span className="text-[10px] font-bold text-amber-500/80 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                  Pódio do Torneio
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Descreva os prêmios oferecidos para os melhores colocados (troféus, medalhas, dinheiro ou brindes). Apenas os prêmios preenchidos serão exibidos na página pública do torneio.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* 1º Lugar */}
                <div className="space-y-1.5 p-3 rounded-xl bg-[#0a0a0a] border border-amber-500/30 focus-within:border-amber-500/70 transition-colors">
                  <label className="text-[11px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                    <span className="text-base leading-none" role="img" aria-label="1º Lugar">🥇</span>
                    <span>1º Lugar</span>
                  </label>
                  <input
                    type="text"
                    value={prizeFirst}
                    onChange={(e) => setPrizeFirst(e.target.value)}
                    placeholder="Ex: R$ 500,00 + Troféu"
                    className="w-full px-3 py-2 bg-[#121214] border border-[#27272a] focus:border-amber-500 focus:ring-1 focus:ring-amber-500/50 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                  />
                </div>

                {/* 2º Lugar */}
                <div className="space-y-1.5 p-3 rounded-xl bg-[#0a0a0a] border border-slate-400/30 focus-within:border-slate-400/70 transition-colors">
                  <label className="text-[11px] font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <span className="text-base leading-none" role="img" aria-label="2º Lugar">🥈</span>
                    <span>2º Lugar</span>
                  </label>
                  <input
                    type="text"
                    value={prizeSecond}
                    onChange={(e) => setPrizeSecond(e.target.value)}
                    placeholder="Ex: R$ 250,00 + Medalha"
                    className="w-full px-3 py-2 bg-[#121214] border border-[#27272a] focus:border-slate-400 focus:ring-1 focus:ring-slate-400/50 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                  />
                </div>

                {/* 3º Lugar */}
                <div className="space-y-1.5 p-3 rounded-xl bg-[#0a0a0a] border border-amber-700/30 focus-within:border-amber-700/70 transition-colors">
                  <label className="text-[11px] font-black uppercase tracking-wider text-amber-600 flex items-center gap-1.5">
                    <span className="text-base leading-none" role="img" aria-label="3º Lugar">🥉</span>
                    <span>3º Lugar</span>
                  </label>
                  <input
                    type="text"
                    value={prizeThird}
                    onChange={(e) => setPrizeThird(e.target.value)}
                    placeholder="Ex: Medalha"
                    className="w-full px-3 py-2 bg-[#121214] border border-[#27272a] focus:border-amber-700 focus:ring-1 focus:ring-amber-700/50 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                  />
                </div>
              </div>
            </div>

            {/* BLOCO DE RESTRIÇÕES DE INSCRIÇÃO (OPCIONAL) */}
            <div className="space-y-4 pt-4 border-t border-[#27272a]/60 animate-fadeIn">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-purple-400" />
                  <label className="text-xs font-black uppercase tracking-wider text-zinc-200 block">
                    Restrições de Inscrição (Opcional)
                  </label>
                </div>
                <span className="text-[10px] font-bold text-purple-400/80 bg-purple-500/10 px-2.5 py-0.5 rounded-full border border-purple-500/20">
                  Regras de Elegibilidade
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Configure restrições de faixa etária e limites de atletas no elenco. Se deixados em branco, o torneio aceitará qualquer idade e elenco padrão.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* 1. Nível Técnico / Rank */}
                <div className={`p-3.5 rounded-xl bg-[#0a0a0a] border border-blue-500/20 space-y-2 flex flex-col justify-between ${isTeamFormat ? "sm:col-span-2" : ""}`}>
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
                      <span role="img" aria-label="Nível Técnico">🎯</span>
                      <span>Nível Técnico / Rank</span>
                    </label>
                    <div className="relative">
                      <select
                        value={skillLevel}
                        onChange={(e) => setSkillLevel(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-[#121214] border border-[#27272a] focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 rounded-lg text-xs text-zinc-100 outline-none transition-all appearance-none cursor-pointer pr-9 shadow-inner"
                      >
                        <option value="ALL" className="bg-[#1a1a1a] text-white">
                          Livre (Todos os Níveis)
                        </option>
                        <option value="BEGINNER" className="bg-[#1a1a1a] text-white">
                          Iniciante / Amador
                        </option>
                        <option value="INTERMEDIATE" className="bg-[#1a1a1a] text-white">
                          Intermediário
                        </option>
                        <option value="ADVANCED" className="bg-[#1a1a1a] text-white">
                          Avançado / Pro
                        </option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                    </div>
                  </div>
                  <span className="text-[10px] text-zinc-500 block leading-tight">
                    Define o nível de experiência recomendado ou exigido para os atletas participantes.
                  </span>
                </div>
                {/* 1. Restrição de Idade */}
                <div className="p-3.5 rounded-xl bg-[#0a0a0a] border border-purple-500/20 space-y-2">
                  <label className="text-[11px] font-black uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-purple-400" />
                    <span>Faixa Etária dos Atletas</span>
                  </label>
                  <div className={`grid grid-cols-2 gap-2.5 ${!isTeamFormat ? "sm:max-w-md" : ""}`}>
                    <div>
                      <span className="text-[10px] text-zinc-500 block mb-1">Idade Mínima</span>
                      <input
                        type="number"
                        min="5"
                        max="120"
                        value={minAge}
                        onChange={(e) => setMinAge(e.target.value)}
                        placeholder="Ex: 16"
                        className="w-full px-3 py-2 bg-[#121214] border border-[#27272a] focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500 block mb-1">Idade Máxima</span>
                      <input
                        type="number"
                        min="5"
                        max="120"
                        value={maxAge}
                        onChange={(e) => setMaxAge(e.target.value)}
                        placeholder="Ex: 40"
                        className="w-full px-3 py-2 bg-[#121214] border border-[#27272a] focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                      />
                    </div>
                  </div>
                  <span className="text-[10px] text-zinc-500 block leading-tight">
                    Deixe vazio se a competição for livre para todas as idades.
                  </span>
                </div>

                {/* 2. Tamanho do Elenco (Mín. e Máx. de Jogadores) - Apenas para modalidades de equipe */}
                {isTeamFormat && (
                  <div className="p-3.5 rounded-xl bg-[#0a0a0a] border border-cyan-500/20 space-y-2 flex flex-col justify-between animate-fadeIn">
                    <div className="space-y-2">
                      <label className="text-[11px] font-black uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-cyan-400" />
                        <span>Tamanho do Elenco (Atletas por Equipe)</span>
                      </label>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <span className="text-[10px] text-zinc-500 block mb-1">Mín. de Jogadores</span>
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={minPlayers}
                            onChange={(e) => setMinPlayers(e.target.value)}
                            placeholder="5"
                            className="w-full px-3 py-2 bg-[#121214] border border-[#27272a] focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                          />
                        </div>
                        <div>
                          <span className="text-[10px] text-zinc-500 block mb-1">Máx. de Jogadores</span>
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={maxPlayers}
                            onChange={(e) => setMaxPlayers(e.target.value)}
                            placeholder="12"
                            className="w-full px-3 py-2 bg-[#121214] border border-[#27272a] focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-all shadow-inner"
                          />
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] text-zinc-500 block leading-tight">
                      Controla a quantidade mínima e máxima de atletas (titulares e reservas).
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* ETAPA 4: EXTRAS (Regulamento, Campos e Patrocinadores) */}
        {/* ======================================================== */}
        {currentStep === 4 && (
          <div className="space-y-6 animate-fadeIn">
            {/* Regras e Regulamento em Texto */}
            <div className="space-y-1.5">
              <label className="text-xs font-black uppercase tracking-wider text-zinc-300 block">
                Regras e Regulamento em Texto (Opcional)
              </label>
              <textarea
                rows={3}
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder="Descreva pontuação máxima, critérios de desempate, tolerância para atrasos (W.O.) e diretrizes gerais..."
                className="w-full px-4 py-3 bg-[#0f0f0f] border border-[#333] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-all resize-y shadow-inner"
              />
            </div>

            {/* NOVO CAMPO: Upload de Regulamento em PDF com Integração ao Supabase Storage */}
            <div className="space-y-2 p-4 rounded-2xl bg-[#0f0f0f] border border-[#27272a]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-red-400" />
                  <label className="text-xs font-black uppercase tracking-wider text-zinc-200 block">
                    Regulamento Oficial em PDF (Opcional)
                  </label>
                </div>
                <span className="text-[10px] text-zinc-500">PDF até 15MB</span>
              </div>

              <input
                ref={rulebookInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleRulebookFileSelect(file);
                }}
              />

              {rulebookFile ? (
                <div className="flex items-center justify-between p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs">
                  <div className="flex items-center gap-2.5 truncate">
                    <FileText className="h-5 w-5 text-red-400 shrink-0" />
                    <div className="truncate">
                      <p className="font-bold truncate text-zinc-100">{rulebookFile.name}</p>
                      <p className="text-[10px] text-zinc-400">
                        {(rulebookFile.size / (1024 * 1024)).toFixed(2)} MB • Pronto para envio
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveRulebook}
                    className="p-1 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                    title="Remover arquivo PDF"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : rulebookUrl ? (
                <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                  <div className="flex items-center gap-2.5 truncate">
                    <FileText className="h-5 w-5 text-red-400 shrink-0" />
                    <div className="truncate">
                      <p className="font-bold truncate text-zinc-100">Regulamento Oficial Vinculado</p>
                      <a
                        href={rulebookUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-blue-400 hover:underline flex items-center gap-1 mt-0.5"
                      >
                        <span>Visualizar PDF Atual</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => rulebookInputRef.current?.click()}
                      className="px-2.5 py-1 text-[11px] rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors cursor-pointer"
                    >
                      Trocar
                    </button>
                    <button
                      type="button"
                      onClick={handleRemoveRulebook}
                      className="p-1 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                      title="Remover regulamento"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => rulebookInputRef.current?.click()}
                  className="p-4 rounded-xl border border-dashed border-[#333] hover:border-blue-500/50 bg-[#141416] hover:bg-[#18181b] flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all text-center group"
                >
                  <FileUp className="h-6 w-6 text-zinc-500 group-hover:text-blue-400 transition-colors" />
                  <p className="text-xs font-bold text-zinc-300 group-hover:text-white transition-colors">
                    Clique para anexar o Regulamento em PDF
                  </p>
                  <span className="text-[10px] text-zinc-500">
                    O documento ficará disponível para download público pelos atletas
                  </span>
                </div>
              )}
            </div>

            {/* BLOCO: Dados Exigidos dos Atletas (CPF e Telefone/WhatsApp por membro) */}
            <div className="space-y-3 pt-2 border-t border-[#27272a]/60">
              <div>
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-emerald-400" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-zinc-200">
                    Dados Exigidos dos Atletas
                  </h3>
                </div>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {`Defina quais documentos ou contatos obrigatórios devem ser informados ${isSolo ? "pelo atleta" : "para cada integrante do elenco"} (o e-mail já é padrão para vinculação de contas).`}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Toggle 1: Exigir CPF de cada atleta */}
                <label className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-[#0f0f0f] border border-[#27272a] hover:border-zinc-700 transition-all cursor-pointer select-none">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-zinc-200 block">
                      Exigir CPF de cada atleta
                    </span>
                    <span className="text-[10px] text-zinc-500 block">
                      {`Torna o CPF obrigatório ${isSolo ? "para o atleta" : "em cada linha de membro e capitão"}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={requireCpf}
                    onClick={() => setRequireCpf((prev) => !prev)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                      requireCpf ? "bg-emerald-500" : "bg-zinc-700"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        requireCpf ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </label>

                {/* Toggle 2: Exigir Telefone/WhatsApp de cada atleta */}
                <label className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-[#0f0f0f] border border-[#27272a] hover:border-zinc-700 transition-all cursor-pointer select-none">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-zinc-200 block">
                      Exigir Telefone/WhatsApp de cada atleta
                    </span>
                    <span className="text-[10px] text-zinc-500 block">
                      {`Torna o WhatsApp obrigatório ${isSolo ? "para o atleta" : "para todos os membros da equipe"}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={requirePhone}
                    onClick={() => setRequirePhone((prev) => !prev)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                      requirePhone ? "bg-emerald-500" : "bg-zinc-700"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        requirePhone ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </label>
              </div>
            </div>

            {/* SEÇÃO INTACTA: Campos Personalizados de Inscrição (Estilo Google Forms) */}
            <div className="space-y-3 pt-2 border-t border-[#27272a]/60">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-400" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-zinc-200">
                      Campos Personalizados de Inscrição
                    </h3>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Crie perguntas personalizadas para os atletas responderem no formulário de inscrição.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleAddCustomField}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 hover:border-blue-500/50 text-blue-400 hover:text-blue-300 text-xs font-black uppercase tracking-wider transition-all cursor-pointer self-start sm:self-auto"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Adicionar Pergunta</span>
                </button>
              </div>

              {customFields.length === 0 ? (
                <div className="p-4 rounded-2xl bg-[#0f0f0f] border border-dashed border-[#27272a] text-center space-y-1">
                  <p className="text-xs text-zinc-400 font-medium">
                    Nenhuma pergunta personalizada adicionada.
                  </p>
                  <p className="text-[11px] text-zinc-600">
                    Os atletas responderão apenas aos campos padrão (Nome, Contato/WhatsApp).
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {customFields.map((field, index) => {
                    const parsedOptions = field.optionsString
                      ? field.optionsString.split(",").map((s) => s.trim()).filter(Boolean)
                      : Array.isArray(field.options)
                        ? field.options
                        : [];

                    return (
                      <div
                        key={field.id}
                        className="p-4 rounded-2xl bg-[#0f0f0f] border border-[#27272a] hover:border-zinc-700 transition-all space-y-3 shadow-inner"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-black flex items-center justify-center">
                              {index + 1}
                            </span>
                            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wide">
                              Pergunta #{index + 1}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveCustomField(field.id)}
                            className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                            title="Remover pergunta"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                          {/* Texto da Pergunta (label) */}
                          <div className="sm:col-span-7 space-y-1">
                            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block">
                              Texto da Pergunta <span className="text-red-400">*</span>
                            </label>
                            <input
                              type="text"
                              value={field.label}
                              onChange={(e) => handleUpdateCustomField(field.id, { label: e.target.value })}
                              placeholder="Ex: Tamanho da Camisa, Traz Raquete?"
                              className="w-full px-3.5 py-2.5 bg-[#141416] border border-[#27272a] focus:border-blue-500 rounded-xl text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-all"
                            />
                          </div>

                          {/* Tipo da Pergunta (type) */}
                          <div className="sm:col-span-5 space-y-1">
                            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block">
                              Tipo de Resposta
                            </label>
                            <div className="relative">
                              <select
                                value={field.type}
                                onChange={(e) =>
                                  handleUpdateCustomField(field.id, {
                                    type: e.target.value as CustomFieldType,
                                  })
                                }
                                className="w-full pl-3.5 pr-8 py-2.5 bg-[#141416] border border-[#27272a] focus:border-blue-500 rounded-xl text-xs text-zinc-200 outline-none transition-all appearance-none cursor-pointer"
                              >
                                <option value="text">Texto Curto</option>
                                <option value="textarea">Texto Longo</option>
                                <option value="select">Múltipla Escolha</option>
                                <option value="checkbox">Caixa de Seleção / Checkbox</option>
                              </select>
                              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                            </div>
                          </div>
                        </div>

                        {/* Opções de Múltipla Escolha (se o tipo for select) */}
                        {field.type === "select" && (
                          <div className="space-y-1.5 pt-1 border-t border-[#27272a]/40">
                            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block">
                              Opções de Escolha (separadas por vírgula)
                            </label>
                            <input
                              type="text"
                              value={field.optionsString ?? ""}
                              onChange={(e) =>
                                handleUpdateCustomField(field.id, { optionsString: e.target.value })
                              }
                              placeholder="Ex: P, M, G, GG ou Canhoto, Destro"
                              className="w-full px-3.5 py-2.5 bg-[#141416] border border-[#27272a] focus:border-blue-500 rounded-xl text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-all"
                            />
                            {parsedOptions.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                <span className="text-[10px] text-zinc-500 font-bold">Prévia:</span>
                                {parsedOptions.map((opt, i) => (
                                  <span
                                    key={i}
                                    className="px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[10px] font-medium"
                                  >
                                    {opt}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Toggle / Checkbox de Obrigatório (required) */}
                        <div className="flex items-center justify-between pt-1 border-t border-[#27272a]/40">
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(e) =>
                                handleUpdateCustomField(field.id, { required: e.target.checked })
                              }
                              className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                            <span className="text-xs font-semibold text-zinc-300">
                              Resposta Obrigatória
                            </span>
                          </label>
                          <span className="text-[10px] text-zinc-500">
                            {field.required ? "Atleta deve responder para se inscrever" : "Opcional"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* SEÇÃO INTACTA: Patrocinadores do Evento */}
            <div className="space-y-3 pt-2 border-t border-[#27272a]/60">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-amber-400" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-zinc-200">
                      Patrocinadores do Evento
                    </h3>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Adicione marcas e apoiadores oficiais para exibir na vitrine do torneio e no chaveamento.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleAddSponsor}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600/15 hover:bg-amber-600/25 border border-amber-500/30 hover:border-amber-500/50 text-amber-400 hover:text-amber-300 text-xs font-black uppercase tracking-wider transition-all cursor-pointer self-start sm:self-auto"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Adicionar Patrocinador</span>
                </button>
              </div>

              {sponsors.length === 0 ? (
                <div className="p-4 rounded-2xl bg-[#0f0f0f] border border-dashed border-[#27272a] text-center space-y-1">
                  <p className="text-xs text-zinc-400 font-medium">
                    Nenhum patrocinador cadastrado.
                  </p>
                  <p className="text-[11px] text-zinc-600">
                    Torneios com patrocinadores ganham mais visibilidade e credibilidade.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sponsors.map((sponsor, index) => (
                    <div
                      key={sponsor.id}
                      className="p-4 rounded-2xl bg-[#0f0f0f] border border-[#27272a] hover:border-zinc-700 transition-all space-y-3 shadow-inner"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-black flex items-center justify-center">
                            {index + 1}
                          </span>
                          <span className="text-xs font-bold text-zinc-300 uppercase tracking-wide">
                            Patrocinador #{index + 1}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveSponsor(sponsor.id)}
                          className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                          title="Remover patrocinador"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                        {/* Nome da Empresa/Marca */}
                        <div className="sm:col-span-6 space-y-1">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block">
                            Nome da Empresa/Marca <span className="text-red-400">*</span>
                          </label>
                          <input
                            type="text"
                            value={sponsor.name}
                            onChange={(e) => handleUpdateSponsor(sponsor.id, { name: e.target.value })}
                            placeholder="Ex: Auto Posto Central, Red Bull"
                            className="w-full px-3.5 py-2.5 bg-[#141416] border border-[#27272a] focus:border-amber-500 rounded-xl text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-all"
                          />
                        </div>

                        {/* Link / Instagram */}
                        <div className="sm:col-span-6 space-y-1">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block">
                            Link / Instagram (Opcional)
                          </label>
                          <input
                            type="text"
                            value={sponsor.link || ""}
                            onChange={(e) => handleUpdateSponsor(sponsor.id, { link: e.target.value })}
                            placeholder="https://instagram.com/marca ou site"
                            className="w-full px-3.5 py-2.5 bg-[#141416] border border-[#27272a] focus:border-amber-500 rounded-xl text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-all"
                          />
                        </div>
                      </div>

                      {/* Upload da Logo */}
                      <div className="space-y-1.5 pt-1 border-t border-[#27272a]/40">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block">
                          Logo da Marca (Opcional)
                        </label>
                        <div className="flex items-center gap-3">
                          {sponsor.previewUrl ? (
                            <div className="relative w-14 h-14 rounded-xl bg-zinc-900 border border-zinc-700 flex items-center justify-center p-1 overflow-hidden shrink-0">
                              <img
                                src={sponsor.previewUrl}
                                alt={sponsor.name || "Logo"}
                                className="w-full h-full object-contain"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateSponsor(sponsor.id, {
                                    logo_url: null,
                                    file: null,
                                    previewUrl: null,
                                  })
                                }
                                className="absolute -top-1 -right-1 p-0.5 bg-red-600 text-white rounded-full hover:bg-red-500 transition-colors"
                                title="Remover imagem"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="w-14 h-14 rounded-xl bg-[#141416] border border-dashed border-[#27272a] flex items-center justify-center text-zinc-600 shrink-0">
                              <ImageIcon className="h-5 w-5" />
                            </div>
                          )}

                          <div className="flex-1">
                            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-semibold cursor-pointer transition-colors border border-zinc-700">
                              <UploadCloud className="h-3.5 w-3.5 text-amber-400" />
                              <span>{sponsor.previewUrl ? "Alterar Logo" : "Escolher Logo (PNG, JPG, SVG)"}</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleSponsorLogoSelect(sponsor.id, file);
                                }}
                              />
                            </label>
                            <p className="text-[10px] text-zinc-500 mt-1">
                              Recomendado: imagem transparente (PNG ou SVG) até 3MB.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* NAVEGAÇÃO MULTI-STEP (Anterior / Próximo / Salvar) */}
        {/* ======================================================== */}
        <div className="pt-4 border-t border-[#27272a]/80 flex items-center justify-between gap-3">
          {currentStep > 1 ? (
            <button
              key="wizard-prev-button"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handlePrevStep(e);
              }}
              className="px-4 sm:px-5 py-3 rounded-xl border border-zinc-700 hover:border-zinc-500 bg-zinc-900 hover:bg-zinc-800 text-xs sm:text-sm font-bold text-zinc-200 hover:text-white transition-all flex items-center gap-2 cursor-pointer active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Anterior</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-3">
            {currentStep < 4 ? (
              <button
                key="wizard-next-button"
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleNextStep(e);
                }}
                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs sm:text-sm uppercase tracking-wider transition-all shadow-lg shadow-blue-600/30 flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <span>Próximo</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                key="wizard-submit-button"
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 via-[#00a2ff] to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-black text-xs sm:text-sm uppercase tracking-wider transition-all shadow-lg shadow-blue-600/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{isEditing ? "Salvando Alterações..." : "Criando Torneio..."}</span>
                  </>
                ) : (
                  <span>{isEditing ? "Salvar Alterações 💾" : "Criar Torneio 🚀"}</span>
                )}
              </button>
            )}
          </div>
        </div>

        <p className="text-[11px] text-zinc-500 text-center leading-relaxed">
          {isEditing
            ? "As alterações serão refletidas imediatamente na vitrine pública e no painel do torneio."
            : "Ao criar este torneio, você concorda com as diretrizes e regras esportivas da SportConnect."}
        </p>
      </form>
    </div>
  );
}
