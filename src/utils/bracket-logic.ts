/**
 * Funções utilitárias puras para geração de confrontos e grupos de torneios.
 * Isoladas de Server Actions para evitar overhead de serialização e cumprir a
 * regra do Next.js onde Server Actions ("use server") devem ser estritamente assíncronas.
 */

/**
 * Gera os confrontos em formato Round-Robin (Tabela de Berger / Método do Círculo)
 * para uma lista de equipes, retornando os pares organizados por rodada.
 */
export function buildRoundRobinPairs(teams: Array<{ id: string; name: string }>) {
  const rotation: ({ id: string; name: string } | null)[] = [...teams];
  if (rotation.length % 2 !== 0) {
    rotation.push(null); // Folga (BYE) na rodada se número ímpar
  }

  const totalSlots = rotation.length;
  const totalRounds = totalSlots - 1;
  const matchesPerRound = totalSlots / 2;
  const currentRotation = [...rotation];

  const rounds: Array<{
    round: number;
    byeTeam: { id: string; name: string } | null;
    pairs: Array<{ team1: { id: string; name: string }; team2: { id: string; name: string } }>;
  }> = [];

  for (let round = 1; round <= totalRounds; round++) {
    const pairs: Array<{ team1: { id: string; name: string }; team2: { id: string; name: string } }> = [];
    let byeTeam: { id: string; name: string } | null = null;

    for (let i = 0; i < matchesPerRound; i++) {
      const home = currentRotation[i];
      const away = currentRotation[totalSlots - 1 - i];

      if (home && away) {
        const team1 = i === 0 && round % 2 === 0 ? away : home;
        const team2 = i === 0 && round % 2 === 0 ? home : away;
        pairs.push({ team1, team2 });
      } else if (home && !away) {
        byeTeam = home;
      } else if (!home && away) {
        byeTeam = away;
      }
    }
    rounds.push({ round, byeTeam, pairs });

    const last = currentRotation.pop()!;
    currentRotation.splice(1, 0, last);
  }

  return rounds;
}

/**
 * Determina o número ideal de grupos para uma dada quantidade de equipes em torneios amadores.
 * O tamanho ideal de um grupo é de 3 ou 4 equipes.
 * Exemplos:
 * - 6 equipes -> 2 grupos de 3 (Grupo A e Grupo B)
 * - 8 equipes -> 2 grupos de 4 (Grupo A e Grupo B)
 * - Se configuredNumGroups for informado (ex: 2, 4), respeita a configuração do organizador.
 */
export function calculateOptimalGroupCount(
  totalTeams: number,
  configuredNumGroups?: number
): number {
  if (configuredNumGroups && configuredNumGroups >= 2) {
    const maxPossibleGroups = Math.max(2, Math.floor(totalTeams / 2));
    return Math.min(configuredNumGroups, maxPossibleGroups);
  }

  if (totalTeams < 4) return 1;

  // 4 a 8 equipes -> 2 grupos (ex: 6 equipes = 2 de 3; 8 equipes = 2 de 4)
  if (totalTeams <= 8) return 2;

  // 9 a 11 equipes -> 3 grupos (ex: 9 equipes = 3 de 3; 10 = 4, 3, 3)
  if (totalTeams <= 11) return 3;

  // 12 a 16 equipes -> 4 grupos (ex: 12 equipes = 4 de 3; 16 = 4 de 4)
  if (totalTeams <= 16) return 4;

  // Para 17+ equipes: grupos de aproximadamente 4 equipes
  const targetGroups = Math.round(totalTeams / 4);
  const maxGroups = Math.floor(totalTeams / 3);
  return Math.min(Math.max(2, targetGroups), Math.max(2, maxGroups));
}

/**
 * Divide o array de equipes em N grupos equilibrados (chunks).
 * Garante que a diferença entre o maior e o menor grupo seja no máximo 1 equipe.
 * Exemplo: 8 equipes em 2 grupos -> [4, 4]
 *          6 equipes em 2 grupos -> [3, 3]
 *          7 equipes em 2 grupos -> [4, 3]
 */
export function chunkBalancedGroups<T>(items: T[], numGroups: number): T[][] {
  if (numGroups <= 1) return [items];

  const chunks: T[][] = Array.from({ length: numGroups }, () => []);

  items.forEach((item, index) => {
    chunks[index % numGroups].push(item);
  });

  return chunks;
}

/**
 * Gera todos os confrontos em formato Round-Robin simples (todos contra todos)
 * para um grupo de tamanho N.
 * Garante matematicamente exatamente N * (N - 1) / 2 partidas únicas,
 * organizadas por rodadas equilibradas (sem limitadores fixos que quebrem a matemática).
 */
export function generateGroupRoundRobinMatches(
  groupTeams: Array<{ id: string; name: string }>
): Array<{
  round: number;
  team1: { id: string; name: string };
  team2: { id: string; name: string };
}> {
  const n = groupTeams.length;
  if (n < 2) return [];

  const expectedMatchCount = (n * (n - 1)) / 2;
  const schedule = buildRoundRobinPairs(groupTeams);

  const directPairs: Array<{
    round: number;
    team1: { id: string; name: string };
    team2: { id: string; name: string };
  }> = [];

  const seenPairKeys = new Set<string>();

  for (const roundObj of schedule) {
    for (const pair of roundObj.pairs) {
      if (pair.team1 && pair.team2 && pair.team1.id !== pair.team2.id) {
        const key = [pair.team1.id, pair.team2.id].sort().join("___");
        if (!seenPairKeys.has(key)) {
          seenPairKeys.add(key);
          directPairs.push({
            round: roundObj.round,
            team1: pair.team1,
            team2: pair.team2,
          });
        }
      }
    }
  }

  // Garantia matemática estrita: se por qualquer razão faltou algum confronto,
  // preenche todas as combinações faltantes
  if (directPairs.length < expectedMatchCount) {
    let nextRound = schedule.length + 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = [groupTeams[i].id, groupTeams[j].id].sort().join("___");
        if (!seenPairKeys.has(key)) {
          seenPairKeys.add(key);
          directPairs.push({
            round: nextRound++,
            team1: groupTeams[i],
            team2: groupTeams[j],
          });
        }
      }
    }
  }

  return directPairs;
}

