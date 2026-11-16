import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function middleware(request: NextRequest) {
  // 1. Tenta recuperar o token de acesso dos cookies
  const accessToken =
    request.cookies.get("sb-access-token")?.value ||
    request.cookies.get("supabase-auth-token")?.value;

  // Verifica cookie de sessão administrativa local (PIN do organizador)
  const adminPinCookie = request.cookies.get("sc_admin_auth")?.value;
  if (adminPinCookie === "true") {
    return NextResponse.next();
  }

  // 2. Verifica cookies nativos do Supabase Auth (ex: sb-<project-ref>-auth-token)
  let sbToken = accessToken;
  if (!sbToken) {
    const allCookies = request.cookies.getAll();
    const sbCookie = allCookies.find(
      (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token")
    );
    if (sbCookie?.value) {
      try {
        const parsed = JSON.parse(sbCookie.value);
        if (Array.isArray(parsed) && parsed[0]) {
          sbToken = parsed[0];
        } else if (parsed?.access_token) {
          sbToken = parsed.access_token;
        }
      } catch {
        sbToken = sbCookie.value;
      }
    }
  }

  // 3. Se houver token, valida a autenticidade da sessão junto ao Supabase
  if (sbToken) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (supabaseUrl && supabaseAnonKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        });

        const {
          data: { user },
          error,
        } = await supabase.auth.getUser(sbToken);

        if (user && !error) {
          // Verifica se há fator MFA verificado pendente de aal2
          const hasVerifiedMfa = Array.isArray((user as any).factors) &&
            (user as any).factors.some((f: any) => f.status === "verified");

          let tokenAal = "aal1";
          try {
            const payloadBase64 = sbToken.split(".")[1];
            if (payloadBase64) {
              const decoded = JSON.parse(
                Buffer.from(payloadBase64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
              );
              if (decoded?.aal) {
                tokenAal = String(decoded.aal);
              }
            }
          } catch {}

          const twoFaCookie = request.cookies.get("sc_2fa_verified")?.value;

          if ((hasVerifiedMfa && tokenAal !== "aal2") || twoFaCookie === "false") {
            const otpUrl = new URL("/login", request.url);
            otpUrl.searchParams.set("redirect", request.nextUrl.pathname);
            otpUrl.searchParams.set("mfa", "required");
            return NextResponse.redirect(otpUrl);
          }

          return NextResponse.next();
        }
      } catch (err) {
        console.error("Erro no middleware ao verificar sessão com Supabase:", err);
      }
    }
  }

  // 4. Usuário não autenticado: redireciona para /login
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

// Configuração do Matcher para as rotas protegidas
export const config = {
  matcher: [
    "/hub/:path*",
    "/hub",
    "/admin/:path*",
    "/admin",
    "/dashboard/:path*",
    "/dashboard",
    "/novo-torneio/:path*",
    "/novo-torneio",
    "/arbitro/:path*",
    "/arbitro",
  ],
};
