import { createClient } from "@supabase/supabase-js";

/**
 * Cria e retorna uma instância do Supabase Admin para operações de backend.
 * 
 * Requer a chave SUPABASE_SERVICE_ROLE_KEY (Service Role) para conseguir fazer
 * o bypass total das políticas de RLS (Row Level Security), permitindo que ações
 * de sistema e do organizador gerem notificações para terceiros (atletas e organizadores).
 */
export function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL não configurada no ambiente.");
  }

  if (!serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable.");
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
