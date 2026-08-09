"use client";

import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  flushUnimedOfflineOutbox,
  loadUnimedOfflineBundle,
  syncUnimedOfflineBundle,
} from "@/lib/unimed/offline-store";

type OfflineState = "expired" | "offline" | "ready" | "syncing" | "unavailable";

export function UnimedOfflineStatus() {
  const [state, setState] = useState<OfflineState>("unavailable");

  const sync = useCallback(async () => {
    if (!navigator.onLine) {
      const cached = await loadUnimedOfflineBundle().catch(() => null);
      setState(
        cached && Date.now() <= Date.parse(cached.expiresAt)
          ? "offline"
          : "expired",
      );
      return;
    }
    setState("syncing");
    try {
      await syncUnimedOfflineBundle();
      await flushUnimedOfflineOutbox();
      setState("ready");
    } catch {
      const cached = await loadUnimedOfflineBundle().catch(() => null);
      setState(
        cached && Date.now() <= Date.parse(cached.expiresAt)
          ? "offline"
          : "unavailable",
      );
    }
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/unimed-sw.js", { scope: "/unimed/" });
    }
    void sync();
    const online = () => void sync();
    const offline = () => void sync();
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [sync]);

  const label =
    state === "ready"
      ? "Offline atualizado"
      : state === "syncing"
        ? "Sincronizando"
        : state === "offline"
          ? "Usando dados offline"
          : state === "expired"
            ? "Offline expirado"
            : "Offline indisponível";
  const Icon = state === "offline" || state === "expired" ? CloudOff : Cloud;

  return (
    <button
      type="button"
      onClick={() => void sync()}
      disabled={state === "syncing"}
      className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] px-3 text-xs font-bold text-[color:var(--app-muted)] disabled:opacity-60"
      title="Atualizar dados disponíveis sem internet"
    >
      {state === "syncing" ? (
        <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Icon className="size-3.5" aria-hidden="true" />
      )}
      {label}
    </button>
  );
}
