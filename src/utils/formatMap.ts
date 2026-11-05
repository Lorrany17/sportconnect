export const formatMap: Record<string, string> = {
  KNOCKOUT: "Mata-Mata",
  LEAGUE: "Pontos Corridos",
  GROUPS: "Grupos + Eliminatórias",
  GROUPS_KNOCKOUT: "Grupos + Eliminatórias",
  ROUND_ROBIN: "Pontos Corridos",
};

/**
 * Traduz o formato do torneio vindo do banco de dados (ex: 'KNOCKOUT', 'LEAGUE', 'GROUPS')
 * para uma label amigável em português para a interface do usuário.
 */
export function translateTournamentFormat(rawFormat?: string | null): string {
  if (!rawFormat) return "Mata-Mata";
  const trimmed = String(rawFormat).trim();
  const upper = trimmed.toUpperCase();

  if (formatMap[upper]) {
    return formatMap[upper];
  }

  if (upper.includes("GRUPO") || upper.includes("GROUP")) {
    return "Grupos + Eliminatórias";
  }

  if (
    upper.includes("PONTOS") ||
    upper.includes("CORRIDO") ||
    upper.includes("LIGA") ||
    upper.includes("ROUND_ROBIN")
  ) {
    return "Pontos Corridos";
  }

  if (
    upper.includes("MATA") ||
    upper.includes("KNOCKOUT") ||
    upper.includes("ELIMINAT")
  ) {
    return "Mata-Mata";
  }

  return trimmed;
}

