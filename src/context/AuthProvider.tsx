"use client";

import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { User, Session, AuthError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { Profile } from "@/types";

export interface AuthResultWithOtp {
  data: { user: User | null; session: Session | null } | null;
  error: AuthError | null;
  requiresOtp?: boolean;
  otpType?: "email" | "signup";
  requiresMfa?: boolean;
  factorId?: string;
  challengeId?: string;
}

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<AuthResultWithOtp>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    phone?: string
  ) => Promise<AuthResultWithOtp>;
  verifyEmailOtp: (
    email: string,
    token: string,
    type?: "email" | "signup"
  ) => Promise<{ data: { user: User | null; session: Session | null } | null; error: AuthError | null }>;
  verifyMfaCode: (
    factorId: string,
    challengeId: string,
    code: string
  ) => Promise<{ data: any; error: AuthError | null }>;
  sendEmailOtp: (email: string) => Promise<{ error: AuthError | null }>;
  cancelOtp: () => void;
  signOut: () => Promise<{ error: AuthError | null }>;
  resetPassword: (email: string) => Promise<{ data: any; error: AuthError | null }>;
  updatePassword: (
    newPassword: string
  ) => Promise<{ data: { user: User | null } | null; error: AuthError | null }>;
  isRecoveringPassword: boolean;
  setIsRecoveringPassword: (val: boolean) => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRecoveringPassword, setIsRecoveringPassword] = useState<boolean>(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  // Bloqueia autenticação prematura enquanto o código OTP (2FA) não for verificado
  const isPending2faRef = useRef<boolean>(false);

  // Consulta e sincroniza dados do perfil (incluindo flag is_admin)
  const fetchProfile = async (currentUser: User | null) => {
    if (!currentUser) {
      setProfile(null);
      setIsAdmin(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", currentUser.id)
        .maybeSingle();

      if (!error && data) {
        setProfile(data);
        setIsAdmin(Boolean(data.is_admin === true));
      } else {
        setIsAdmin(false);
        setProfile(null);
      }
    } catch (err) {
      console.warn("Aviso ao carregar perfil do usuário:", err);
      setIsAdmin(false);
      setProfile(null);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user);
    }
  };

  // Sincroniza cookies para leitura no middleware de rotas protegidas
  const syncAuthCookies = (
    sessionToSync: Session | null,
    twoFaVerified?: boolean
  ) => {
    if (typeof document === "undefined") return;
    if (sessionToSync?.access_token) {
      document.cookie = `sb-access-token=${sessionToSync.access_token}; path=/; max-age=604800; SameSite=Lax`;
    } else {
      document.cookie = `sb-access-token=; path=/; max-age=0; SameSite=Lax`;
    }
    if (twoFaVerified === true) {
      document.cookie = `sc_2fa_verified=true; path=/; max-age=604800; SameSite=Lax`;
    } else if (twoFaVerified === false) {
      document.cookie = `sc_2fa_verified=; path=/; max-age=0; SameSite=Lax`;
    }
  };

  useEffect(() => {
    let mounted = true;

    // 1. Obtém sessão inicial ativa do Supabase e valida o nível de garantia de autenticação (MFA AAL)
    supabase.auth
      .getSession()
      .then(async ({ data: { session } }) => {
        if (!mounted) return;

        if (session?.user) {
          // BUG-04: Se o usuário tem 2FA/MFA cadastrado, garante que a sessão atingiu aal2
          try {
            const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
            if (aalData && aalData.nextLevel === "aal2" && aalData.currentLevel !== "aal2") {
              await supabase.auth.signOut();
              setUser(null);
              setSession(null);
              syncAuthCookies(null);
              fetchProfile(null);
              return;
            }
          } catch (mfaCheckErr) {
            console.warn("[AuthProvider] Erro ao verificar AAL na inicialização:", mfaCheckErr);
          }

          setSession(session);
          setUser(session.user);
          syncAuthCookies(session);
          fetchProfile(session.user);
        } else {
          setUser(null);
          setSession(null);
          syncAuthCookies(null);
          fetchProfile(null);
        }
      })
      .catch((err) => {
        console.error("Erro ao obter sessão Supabase:", err);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    // 2. Escuta mudanças contínuas de autenticação (LOGIN, LOGOUT, TOKEN_REFRESHED, PASSWORD_RECOVERY)
    if (typeof window !== "undefined" && window.location.hash.includes("type=recovery")) {
      setIsRecoveringPassword(true);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;
      if (isPending2faRef.current) return;

      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveringPassword(true);
      }

      if (newSession?.user) {
        try {
          const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
          if (aalData && aalData.nextLevel === "aal2" && aalData.currentLevel !== "aal2") {
            await supabase.auth.signOut();
            setUser(null);
            setSession(null);
            syncAuthCookies(null);
            fetchProfile(null);
            setLoading(false);
            return;
          }
        } catch {
          // ignore
        }

        setSession(newSession);
        setUser(newSession.user);
        syncAuthCookies(newSession);
        fetchProfile(newSession.user);
      } else {
        setSession(null);
        setUser(null);
        syncAuthCookies(null);
        fetchProfile(null);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string): Promise<AuthResultWithOtp> => {
    isPending2faRef.current = true;
    syncAuthCookies(null, false);
    try {
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error || !result.data?.user) {
        isPending2faRef.current = false;
        return { data: null, error: result.error, requiresOtp: false, requiresMfa: false };
      }

      // 1. Verifica se o usuário possui MFA (TOTP) ativado no Supabase Auth
      try {
        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aalData && aalData.nextLevel === "aal2" && aalData.currentLevel !== "aal2") {
          const { data: factorsData } = await supabase.auth.mfa.listFactors();
          const verifiedTotp = (factorsData?.totp || []).find(
            (f: any) => f.status === "verified"
          );

          if (verifiedTotp) {
            const { data: challengeData, error: challengeErr } =
              await supabase.auth.mfa.challenge({ factorId: verifiedTotp.id });

            if (challengeErr) {
              isPending2faRef.current = false;
              return { data: null, error: challengeErr, requiresMfa: false };
            }

            return {
              data: { user: null, session: null },
              error: null,
              requiresMfa: true,
              factorId: verifiedTotp.id,
              challengeId: challengeData?.id,
            };
          }
        }
      } catch (mfaErr) {
        console.warn("[AuthProvider] Aviso ao checar MFA:", mfaErr);
      }

      // 2. Senha validada: dispara obrigatoriamente o 2º fator (Email OTP) e NÃO efetiva a sessão no contexto
      const otpRes = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });

      if (otpRes.error) {
        isPending2faRef.current = false;
        return { data: null, error: otpRes.error, requiresOtp: false, requiresMfa: false };
      }

      return {
        data: { user: null, session: null },
        error: null,
        requiresOtp: true,
        otpType: "email",
        requiresMfa: false,
      };
    } catch (err: any) {
      isPending2faRef.current = false;
      return {
        data: null,
        error: err,
        requiresOtp: false,
        requiresMfa: false,
      };
    }
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    phone?: string
  ): Promise<AuthResultWithOtp> => {
    isPending2faRef.current = true;
    try {
      // Envia full_name e phone dentro de options.data para o Trigger da tabela profiles do Supabase
      const result = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone: phone || null,
          },
        },
      });

      if (result.error) {
        isPending2faRef.current = false;
        return { data: null, error: result.error, requiresOtp: false };
      }

      // Se o Supabase auto-confirmou a sessão no signUp, efetiva a sessão e atualiza o perfil
      if (result.data?.session && result.data?.user) {
        if (phone) {
          try {
            await supabase
              .from("profiles")
              .update({ phone, show_phone: true })
              .eq("id", result.data.user.id);
          } catch (err) {
            console.warn("Aviso ao atualizar telefone no perfil recém-criado:", err);
          }
        }
        isPending2faRef.current = false;
        setUser(result.data.user);
        setSession(result.data.session);
        syncAuthCookies(result.data.session);
        await fetchProfile(result.data.user);

        return {
          data: result.data,
          error: null,
          requiresOtp: false,
        };
      }

      // Fluxo com confirmação de cadastro por código OTP (6 dígitos)
      return {
        data: result.data,
        error: null,
        requiresOtp: true,
        otpType: "signup",
      };
    } catch (err: any) {
      isPending2faRef.current = false;
      return {
        data: null,
        error: err,
        requiresOtp: false,
      };
    }
  };

  const sendEmailOtp = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    return { error };
  };

  const verifyEmailOtp = async (
    email: string,
    token: string,
    type: "email" | "signup" = "email"
  ) => {
    const result = await supabase.auth.verifyOtp({
      email,
      token: token.trim(),
      type,
    });

    if (!result.error && result.data?.user && result.data?.session) {
      isPending2faRef.current = false;
      setUser(result.data.user);
      setSession(result.data.session);
      syncAuthCookies(result.data.session, true);
      await fetchProfile(result.data.user);
    }

    return result;
  };

  const verifyMfaCode = async (factorId: string, challengeId: string, code: string) => {
    const result = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code: code.trim(),
    });

    if (!result.error) {
      isPending2faRef.current = false;
      const { data: sessData } = await supabase.auth.getSession();
      if (sessData?.session?.user) {
        setUser(sessData.session.user);
        setSession(sessData.session);
        syncAuthCookies(sessData.session, true);
        await fetchProfile(sessData.session.user);
      }
    }

    return result;
  };

  const cancelOtp = () => {
    isPending2faRef.current = false;
    syncAuthCookies(null, false);
  };

  const signOut = async () => {
    setLoading(true);
    const result = await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setIsAdmin(false);
    syncAuthCookies(null, false);
    setLoading(false);
    return result;
  };

  const resetPassword = async (email: string) => {
    return await supabase.auth.resetPasswordForEmail(email);
  };

  const updatePassword = async (newPassword: string) => {
    setLoading(true);
    const result = await supabase.auth.updateUser({ password: newPassword });
    if (!result.error) {
      setIsRecoveringPassword(false);
      if (typeof window !== "undefined" && window.location.hash.includes("type=recovery")) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
    setLoading(false);
    return result;
  };

  // Renderiza um loader/spinner moderno caso o estado inicial de autenticação ainda esteja carregando
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center gap-4 text-[#e4e4e7] select-none">
        <div className="relative flex items-center justify-center">
          <div className="w-12 h-12 rounded-full border-2 border-zinc-800 border-t-[#00a2ff] animate-spin" />
          <div className="absolute w-6 h-6 rounded-full bg-[#00a2ff]/10 blur-sm" />
        </div>
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-xs font-black tracking-widest uppercase text-zinc-300">
            SportConnect
          </span>
          <span className="text-[11px] text-zinc-500 font-medium">
            Carregando autenticação...
          </span>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        profile,
        isAdmin,
        refreshProfile,
        isRecoveringPassword,
        setIsRecoveringPassword,
        signIn,
        signUp,
        verifyEmailOtp,
        verifyMfaCode,
        sendEmailOtp,
        cancelOtp,
        signOut,
        resetPassword,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
