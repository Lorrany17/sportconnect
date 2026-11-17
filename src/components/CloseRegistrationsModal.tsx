"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Lock, Loader2 } from "lucide-react";

export interface CloseRegistrationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
  confirmedTeamsCount?: number;
  maxSpots?: number;
}

export default function CloseRegistrationsModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading = false,
  confirmedTeamsCount = 0,
  maxSpots = 16,
}: CloseRegistrationsModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
      <div className="bg-surface border border-subtle rounded-3xl p-6 sm:p-7 max-w-md w-full text-primary shadow-2xl relative space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center shrink-0">
            <Lock className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-black font-display uppercase tracking-tight text-primary">
              Encerrar Inscrições
            </h3>
            <p className="text-xs text-secondary">
              Bloqueio manual de novas participações
            </p>
          </div>
        </div>

        <p className="text-sm text-secondary leading-relaxed">
          Tem certeza que deseja encerrar as inscrições? Nenhuma nova equipe poderá registar-se ou pagar.
        </p>

        <div className="p-3.5 rounded-xl bg-surface-elevated border border-subtle text-xs text-secondary flex items-center justify-between">
          <span>Equipes confirmadas:</span>
          <strong className="text-emerald-500 dark:text-emerald-400 font-bold">
            {confirmedTeamsCount} de {maxSpots} vagas
          </strong>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2.5 rounded-xl bg-surface-elevated hover:bg-surface border border-subtle text-xs font-bold text-secondary hover:text-primary transition-all cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-red-600/30 active:scale-95 cursor-pointer flex items-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Encerrando...</span>
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5" />
                <span>Sim, Encerrar Inscrições</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

