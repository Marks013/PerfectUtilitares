"use client";

import { LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearUnimedOfflineData } from "@/lib/unimed/offline-store";

export function UnimedAccessLogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function lockModule() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/unimed/access/session", { method: "DELETE" });
    } finally {
      await clearUnimedOfflineData().catch(() => undefined);
      router.replace("/unimed/acesso");
      router.refresh();
    }
  }

  return (
    <button
      className="app-icon-button"
      disabled={busy}
      onClick={lockModule}
      title="Bloquear módulo Unimed"
      type="button"
    >
      <LockKeyhole className="size-4" aria-hidden="true" />
      <span className="sr-only">Bloquear módulo Unimed</span>
    </button>
  );
}
