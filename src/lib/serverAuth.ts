import { cookies } from "next/headers";
import { createClient, User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Extrai o access token do Supabase a partir do argumento explícito ou dos cookies da requisição.
 */
async function extractAccessToken(explicitToken?: string): Promise<string | undefined> {
  if (explicitToken && explicitToken.trim()) {
    return explicitToken.trim();
  }

  try {
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    const tokenCookie =
      cookieStore.get("sb-access-token") ||
      cookieStore.get("supabase-auth-token") ||
      allCookies.find((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"));

    if (!tokenCookie?.value) return undefined;

    try {
      const parsed = JSON.parse(tokenCookie.value);
      if (Array.isArray(parsed) && parsed[0]) {
        return String(parsed[0]);
      }
      if (parsed?.access_token) {
        return String(parsed.access_token);
      }
    } catch {
      return tokenCookie.value;
    }

    return tokenCookie.value;
  } catch {
    return undefined;
  }
}

/**
 * Barreira de autenticação estrita para Server Actions.
 * Invoca `supabase.auth.getUser()` no servidor e lança `401 Unauthorized` se inválido.
 */
export async function requireAuthenticatedUser(explicitToken?: string): Promise<User> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Configuração do Supabase ausente no servidor.");
  }

  const accessToken = await extractAccessToken(explicitToken);
  if (!accessToken) {
    throw new Error("401 Unauthorized: Usuário não autenticado.");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data?.user) {
    throw new Error("401 Unauthorized: Sessão inválida ou expirada.");
  }

  return data.user;
}

/**
 * Valida se o usuário autenticado é o proprietário do torneio (owner_id),
 * um Super Admin ou um membro de staff autorizado para o torneio.
 * Lança `401 Unauthorized` caso não possua permissão.
 */
export async function requireTournamentAccess(
  user: User,
  tournamentId: string,
  allowedStaffRoles: string[] = ["ADMIN"]
): Promise<void> {
  if (!user?.id || !tournamentId) {
    throw new Error("401 Unauthorized: Dados insuficientes para validar permissão.");
  }

  const adminClient = getSupabaseAdmin();

  // 1. Verifica se é proprietário do torneio
  const { data: tournament, error: tourErr } = await adminClient
    .from("tournaments")
    .select("id, owner_id")
    .eq("id", tournamentId)
    .maybeSingle();

  if (tourErr || !tournament) {
    throw new Error("Torneio não encontrado.");
  }

  if (tournament.owner_id === user.id) {
    return;
  }

  // 2. Verifica se é Super Admin no perfil
  const { data: profile } = await adminClient
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.is_admin === true) {
    return;
  }

  // 3. Verifica se possui papel autorizado em tournament_staff
  if (allowedStaffRoles.length > 0) {
    const userEmail = (user.email || "").toLowerCase().trim();
    const orFilter = userEmail
      ? `user_id.eq.${user.id},email.ilike.${userEmail}`
      : `user_id.eq.${user.id}`;

    const { data: staffRows } = await adminClient
      .from("tournament_staff")
      .select("role")
      .eq("tournament_id", tournamentId)
      .or(orFilter);

    const hasAllowedRole = (staffRows || []).some((row: any) =>
      allowedStaffRoles.includes(String(row.role || "").toUpperCase().trim())
    );

    if (hasAllowedRole) {
      return;
    }
  }

  throw new Error("401 Unauthorized: Você não tem permissão para modificar este torneio.");
}

