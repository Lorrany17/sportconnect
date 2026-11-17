"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthProvider";
import ResetPasswordModal from "@/components/ResetPasswordModal";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading, isRecoveringPassword } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user && !isRecoveringPassword) {
      router.push("/login");
    }
  }, [user, loading, isRecoveringPassword, router]);

  // Se o usuário estiver no fluxo de recuperação de senha, bloqueia a interface normal e exibe o formulário de Nova Senha
  if (isRecoveringPassword) {
    return <ResetPasswordModal />;
  }

  // Enquanto loading for true, exibe tela de carregamento com estética SportConnect Dark
  if (loading) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-4 text-primary select-none">
        <div className="relative flex items-center justify-center">
          <div className="w-12 h-12 rounded-full border-2 border-subtle border-t-[#00a2ff] animate-spin" />
          <div className="absolute w-6 h-6 rounded-full bg-[#00a2ff]/10 blur-sm" />
        </div>
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-xs font-black tracking-widest uppercase text-primary">
            SportConnect
          </span>
          <span className="text-[11px] text-muted font-medium">
            Verificando permissões de acesso...
          </span>
        </div>
      </div>
    );
  }

  // Se não estiver autenticado após terminar de carregar, não renderiza conteúdo antes do redirecionamento
  if (!user) {
    return null;
  }

  // Usuário autenticado com sucesso
  return <>{children}</>;
}
