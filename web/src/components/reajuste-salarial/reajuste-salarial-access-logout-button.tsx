"use client";

import { LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReajusteSalarialAccessLogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function lockModule() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/reajuste-salarial/access/session", {
        method: "DELETE",
      });
    } finally {
      router.replace("/reajuste-salarial/acesso");
      router.refresh();
    }
  }

  return (
    <button
      className="app-icon-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)]"
      disabled={busy}
      onClick={lockModule}
      title="Bloquear módulo de reajuste salarial"
      type="button"
    >
      <LockKeyhole className="size-4" aria-hidden="true" />
      <span className="sr-only">Bloquear módulo de reajuste salarial</span>
    </button>
  );
}
