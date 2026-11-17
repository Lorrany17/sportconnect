import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cria e retorna uma instância do Supabase Admin para operações de backend.
 * 
 * Requer a chave SUPABASE_SERVICE_ROLE_KEY (Service Role) estritamente no servidor
 * para operações que exigem bypass de RLS com segurança.
 */
export function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
