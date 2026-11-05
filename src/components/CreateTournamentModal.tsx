"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Tournament } from "@/types";
import CreateTournamentForm from "@/components/CreateTournamentForm";

export interface CreateTournamentModalProps {
  isOpen: boolean;
  onClose: () => void;
  tournamentToEdit?: Tournament | null;
  onTournamentUpdated?: () => void;
}

export default function CreateTournamentModal({
  isOpen,
  onClose,
  tournamentToEdit,
  onTournamentUpdated,
}: CreateTournamentModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto animate-fadeIn">
      <div className="w-full max-w-2xl my-8">
        <CreateTournamentForm
          isModal={true}
          initialData={tournamentToEdit}
          onClose={onClose}
          onSuccess={() => {
            onTournamentUpdated?.();
            onClose();
          }}
        />
      </div>
    </div>,
    document.body
  );
}
