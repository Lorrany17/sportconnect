"use client";

import React from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import OrganizerDashboard from "@/components/OrganizerDashboard";

export default function DashboardPage() {
  const router = useRouter();

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-[var(--color-canvas)] text-[var(--color-text-primary)] py-6 sm:py-8 px-4 sm:px-6 lg:px-8 flex flex-col transition-colors print:bg-white print:text-black print:p-0">
        <OrganizerDashboard
          onBack={() => router.push("/hub")}
        />
      </div>
    </ProtectedRoute>
  );
}
