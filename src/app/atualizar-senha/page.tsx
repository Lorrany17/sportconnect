"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthProvider";
import ResetPasswordModal from "@/components/ResetPasswordModal";

export default function AtualizarSenhaPage() {
  const { isRecoveringPassword, setIsRecoveringPassword, user, loading } = useAuth();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [checkingToken, setCheckingToken] = useState(true);

  useEffect(() => {
    let mounted = true;

    const hashHasRecovery =
      typeof window !== "undefined" && window.location.hash.includes("type=recovery");
    const searchParams =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const codeParam = searchParams?.get("code");

    if (hashHasRecovery || isRecoveringPassword) {
      setIsRecoveringPassword(true);
      setRecoveryReady(true);
      setCheckingToken(false);
    }

    // Suporte a fluxo PKCE caso o Supabase redirecione com ?code=...
    if (codeParam) {
      supabase.auth
        .exchangeCodeForSession(codeParam)
        .then(({ data, error }) => {
          if (!mounted) return;
          if (!error && data?.session) {
            setIsRecoveringPassword(true);
            setRecoveryReady(true);
          }
        })
        .finally(() => {
          if (mounted) setCheckingToken(false);
        });
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && (hashHasRecovery || Boolean(codeParam)))) {
        setIsRecoveringPassword(true);
        setRecoveryReady(true);
        setCheckingToken(false);
      } else if (session?.user && isRecoveringPassword) {
        setRecoveryReady(true);
        setCheckingToken(false);
      }
    });

    const fallbackTimer = setTimeout(() => {
      if (mounted) {
        setCheckingToken(false);
      }
    }, 1500);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      clearTimeout(fallbackTimer);
    };
  }, [isRecoveringPassword, setIsRecoveringPassword]);

  if (loading || (checkingToken && !recoveryReady && !isRecoveringPassword)) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center p-4 text-zinc-300 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-[#00a2ff]" />
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
          Validando link de recuperação...
        </span>
      </div>
    );
  }

  if (recoveryReady || isRecoveringPassword || user) {
    return <ResetPasswordModal />;
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center p-4 text-[#e4e4e7]">
      <div className="bg-[#1e1e1e] border border-[#27272a] rounded-2xl max-w-md w-full p-6 sm:p-8 text-center space-y-4 shadow-2xl">
        <div className="w-12 h-12 rounded-2xl bg-[#00a2ff]/10 border border-[#00a2ff]/30 text-[#00a2ff] flex items-center justify-center mx-auto">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-black text-white">Link inválido ou expirado</h1>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Não foi possível validar sua sessão de recuperação de senha. Solicite um novo link na tela de login.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-[#00a2ff] hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Voltar para o Login</span>
        </Link>
      </div>
    </div>
  );
}
