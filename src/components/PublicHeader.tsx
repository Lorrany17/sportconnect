"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Compass,
  Sparkles,
  LogIn,
  LogOut,
  User,
  Menu,
  X,
  ChevronDown,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/context/AuthProvider";
import { useTournament } from "@/context/TournamentContext";
import { supabase } from "@/lib/supabase";
import NotificationBell from "@/components/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";

interface PublicHeaderProps {
  activePage?: "hub" | "explorar" | "torneio" | "chaveamento";
}

export default function PublicHeader({ activePage }: PublicHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, profile, isAdmin, signOut } = useAuth();
  const { logout } = useTournament();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url || null);

  // Sincronização do avatar do perfil do usuário ativo
  useEffect(() => {
    let mounted = true;

    async function fetchUserAvatar() {
      if (!user) {
        setAvatarUrl(null);
        return;
      }

      if (profile?.avatar_url) {
        setAvatarUrl(profile.avatar_url);
      }

      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("avatar_url")
          .eq("id", user.id)
          .maybeSingle();

        if (!error && data?.avatar_url && mounted) {
          setAvatarUrl(data.avatar_url);
        }
      } catch (err) {
        console.warn("Aviso ao sincronizar avatar no header:", err);
      }
    }

    fetchUserAvatar();

    return () => {
      mounted = false;
    };
  }, [user, profile?.avatar_url]);

  const userName =
    profile?.full_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Atleta";

  const handleLogout = async () => {
    logout();
    await signOut();
    router.push("/login");
  };

  const isExplorarActive = pathname === "/explorar" || activePage === "explorar";
  const isHubActive = pathname === "/hub" || pathname === "/HubCentral" || activePage === "hub";
  const isEmoji = Boolean(
    avatarUrl && !avatarUrl.startsWith("http") && !avatarUrl.startsWith("data:")
  );

  return (
    <header className="w-full border-b border-zinc-200 dark:border-[#27272a] bg-white/90 dark:bg-[#141416]/95 backdrop-blur-md sticky top-0 z-40 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-4">
        {/* Lado Esquerdo: Logotipo + Tipografia SportConnect */}
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href={user ? "/hub" : "/explorar"}
            className="flex items-center gap-2.5 group transition-transform active:scale-95"
          >
            <Image
              src="/logo.png"
              alt="SportConnect Logo"
              width={40}
              height={40}
              priority
              className="h-9 w-auto object-contain group-hover:opacity-90 transition-opacity"
            />
            <span className="font-display font-black text-lg sm:text-xl tracking-tight text-zinc-900 dark:text-white">
              Sport<span className="text-[#00a2ff]">Connect</span>
            </span>
          </Link>
        </div>

        {/* Centro: Navegação Ordenada (1º Hub Central, 2º Explorar Torneios) */}
        <nav className="hidden md:flex items-center gap-2">
          {user && (
            <Link
              href="/hub"
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                isHubActive
                  ? "bg-zinc-100 dark:bg-[#1e1e1e] text-zinc-900 dark:text-white border border-zinc-200 dark:border-[#27272a] shadow-sm"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-[#1a1a1a]"
              }`}
            >
              <Sparkles className="h-4 w-4 text-[#00a2ff]" />
              <span>Hub Central</span>
            </Link>
          )}

          <Link
            href="/explorar"
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              isExplorarActive
                ? "bg-zinc-100 dark:bg-[#1e1e1e] text-zinc-900 dark:text-white border border-zinc-200 dark:border-[#27272a] shadow-sm"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-[#1a1a1a]"
            }`}
          >
            <Compass className="h-4 w-4 text-[#00a2ff]" />
            <span>Explorar Torneios</span>
          </Link>
        </nav>

        {/* Lado Direito: Alternador de Tema + Ações de Usuário / Menu Drop-down */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          <ThemeToggle />
          {user && <NotificationBell />}
          {!user ? (
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#00a2ff] to-blue-600 hover:from-blue-500 hover:to-blue-600 text-white font-bold text-xs uppercase tracking-wider shadow-md shadow-blue-500/20 active:scale-95 transition-all cursor-pointer"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Entrar / Criar Conta</span>
            </Link>
          ) : (
            <div className="relative">
              {/* Botão de Trigger do Dropdown */}
              <button
                type="button"
                onClick={() => setUserDropdownOpen((prev) => !prev)}
                className="flex items-center gap-2.5 p-1.5 pr-2.5 rounded-2xl hover:bg-zinc-100 dark:hover:bg-zinc-800/80 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700/60 transition-all cursor-pointer group"
                title="Menu do usuário"
              >
                <div className="w-8 h-8 rounded-full overflow-hidden border border-zinc-700/80 shadow-inner shrink-0 flex items-center justify-center">
                  {avatarUrl ? (
                    isEmoji ? (
                      <div className="w-full h-full bg-gradient-to-tr from-amber-500/25 via-[#1c1c20] to-zinc-800 flex items-center justify-center text-sm select-none">
                        <span>{avatarUrl}</span>
                      </div>
                    ) : (
                      <Image
                        src={avatarUrl}
                        alt="Perfil"
                        width={32}
                        height={32}
                        className="w-full h-full object-cover rounded-full"
                        unoptimized={avatarUrl.startsWith("data:") || avatarUrl.startsWith("blob:")}
                      />
                    )
                  ) : (
                    <div className="w-full h-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-black text-xs flex items-center justify-center uppercase shadow-inner">
                      {userName.charAt(0)}
                    </div>
                  )}
                </div>
                <div className="hidden lg:flex flex-col text-left">
                  <span className="text-xs font-bold text-zinc-900 dark:text-white group-hover:text-[#00a2ff] transition-colors truncate max-w-[120px] leading-tight">
                    {userName}
                  </span>
                  <span className="text-[10px] text-zinc-500 truncate max-w-[120px]">
                    {user.email}
                  </span>
                </div>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-white transition-transform ${
                    userDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* Menu Dropdown do Usuário */}
              {userDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setUserDropdownOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-2 shadow-xl z-50 animate-fadeIn space-y-1">
                    {/* Header do Menu */}
                    <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800/80">
                      <p className="text-xs font-bold text-zinc-900 dark:text-white truncate">{userName}</p>
                      <p className="text-[11px] text-zinc-500 truncate">{user.email}</p>
                    </div>

                    {/* Opção Meu Perfil */}
                    <Link
                      href="/perfil"
                      onClick={() => setUserDropdownOpen(false)}
                      className="w-full px-3 py-2 rounded-xl text-left text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800/80 flex items-center gap-2.5 transition-all cursor-pointer"
                    >
                      <User className="h-4 w-4 text-[#00a2ff]" />
                      <span>Meu Perfil</span>
                    </Link>

                    {/* Atalho Super Admin: Central do Sistema */}
                    {isAdmin && (
                      <Link
                        href="/admin"
                        onClick={() => setUserDropdownOpen(false)}
                        className="w-full px-3 py-2 rounded-xl text-left text-xs font-bold text-purple-700 dark:text-purple-300 hover:text-purple-900 dark:hover:text-purple-200 hover:bg-purple-50 dark:hover:bg-purple-600/15 border border-purple-200 dark:border-purple-500/25 flex items-center gap-2.5 transition-all cursor-pointer shadow-sm"
                      >
                        <ShieldCheck className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                        <span>⚙️ Central do Sistema</span>
                      </Link>
                    )}

                    <div className="border-t border-zinc-100 dark:border-zinc-800/80 my-1" />

                    {/* Opção Sair */}
                    <button
                      type="button"
                      onClick={() => {
                        setUserDropdownOpen(false);
                        handleLogout();
                      }}
                      className="w-full px-3 py-2 rounded-xl text-left text-xs font-bold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2.5 transition-all cursor-pointer"
                    >
                      <LogOut className="h-4 w-4 text-red-500 dark:text-red-400" />
                      <span>Sair</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Toggle Menu Mobile */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="md:hidden p-2 rounded-xl bg-zinc-100 dark:bg-[#1e1e1e] hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-[#27272a] text-zinc-700 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors cursor-pointer"
            title="Menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Menu Gaveta Mobile */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-zinc-200 dark:border-[#27272a] bg-white dark:bg-[#141416] p-4 space-y-2 animate-fadeIn">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-100 dark:border-zinc-800">
            <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">Modo de Exibição</span>
            <ThemeToggle />
          </div>
          {user && (
            <Link
              href="/hub"
              onClick={() => setMobileMenuOpen(false)}
              className={`w-full px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2.5 ${
                isHubActive
                  ? "bg-zinc-100 dark:bg-[#1e1e1e] text-zinc-900 dark:text-white border border-zinc-200 dark:border-[#27272a]"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-[#1a1a1a]"
              }`}
            >
              <Sparkles className="h-4 w-4 text-[#00a2ff]" />
              <span>Hub Central</span>
            </Link>
          )}

          <Link
            href="/explorar"
            onClick={() => setMobileMenuOpen(false)}
            className={`w-full px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2.5 ${
              isExplorarActive
                ? "bg-zinc-100 dark:bg-[#1e1e1e] text-zinc-900 dark:text-white border border-zinc-200 dark:border-[#27272a]"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-[#1a1a1a]"
            }`}
          >
            <Compass className="h-4 w-4 text-[#00a2ff]" />
            <span>Explorar Torneios</span>
          </Link>

          {user && (
            <>
              <Link
                href="/perfil"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full px-4 py-2.5 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800/80 flex items-center gap-2.5 transition-all"
              >
                <User className="h-4 w-4 text-[#00a2ff]" />
                <span>Meu Perfil</span>
              </Link>

              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full px-4 py-2.5 rounded-xl text-xs font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/25 flex items-center gap-2.5 transition-all"
                >
                  <ShieldCheck className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  <span>⚙️ Central do Sistema</span>
                </Link>
              )}

              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleLogout();
                }}
                className="w-full px-4 py-2.5 rounded-xl text-xs font-bold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2.5 transition-all text-left cursor-pointer"
              >
                <LogOut className="h-4 w-4 text-red-500 dark:text-red-400" />
                <span>Sair</span>
              </button>
            </>
          )}

          {!user && (
            <Link
              href="/login"
              onClick={() => setMobileMenuOpen(false)}
              className="w-full px-4 py-2.5 rounded-xl text-xs font-bold bg-[#00a2ff] text-white flex items-center justify-center gap-2 uppercase tracking-wider"
            >
              <LogIn className="h-4 w-4" />
              <span>Entrar / Criar Conta</span>
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
