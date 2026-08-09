"use client";

import { Laptop, Loader2, RefreshCw, ShieldX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type OfflineDevice = {
  deviceKey: string;
  label: string;
  registeredBy: string;
  lastSeenAt: string;
  offlineExpiresAt: string;
  revokedAt: string | null;
};

function dateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function UnimedOfflineDevicesManager() {
  const [devices, setDevices] = useState<OfflineDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/unimed/offline/devices", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Não foi possível listar os dispositivos.");
      const body = (await response.json()) as { devices?: OfflineDevice[] };
      setDevices(Array.isArray(body.devices) ? body.devices : []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível listar os dispositivos.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  async function revoke(device: OfflineDevice) {
    if (
      !window.confirm(
        `Revogar o acesso offline de “${device.label}”? Os dados locais expiram automaticamente e não poderão ser renovados.`,
      )
    ) {
      return;
    }
    setRevoking(device.deviceKey);
    setError(null);
    try {
      const response = await fetch("/api/unimed/offline/devices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceKey: device.deviceKey }),
      });
      if (!response.ok) throw new Error("Não foi possível revogar o dispositivo.");
      await load();
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : "Não foi possível revogar o dispositivo.",
      );
    } finally {
      setRevoking(null);
    }
  }

  return (
    <section className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[color:var(--app-teal)]">
            <Laptop className="size-5" aria-hidden="true" />
            <h2 className="text-lg font-black text-[color:var(--app-fg)]">
              Dispositivos offline
            </h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--app-muted)]">
            Cada navegador autorizado recebe uma cópia criptografada da base por
            até 7 dias. Revogue equipamentos perdidos ou que não são mais usados.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[color:var(--app-border)] px-3 text-sm font-bold disabled:opacity-50"
        >
          <RefreshCw
            className={`size-4 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Atualizar
        </button>
      </div>

      {error ? (
        <p className="mt-4 text-sm font-bold text-[color:var(--app-coral)]" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-3">
        {!loading && devices.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[color:var(--app-border)] p-4 text-sm text-[color:var(--app-muted)]">
            Nenhum dispositivo sincronizou a base offline ainda.
          </p>
        ) : null}
        {devices.map((device) => (
          <article
            key={device.deviceKey}
            className="flex flex-col gap-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-black text-[color:var(--app-fg)]">
                {device.label}
                {device.revokedAt ? " · revogado" : ""}
              </p>
              <p className="mt-1 text-xs leading-5 text-[color:var(--app-muted)]">
                Autorizado por {device.registeredBy} · visto em {dateTime(device.lastSeenAt)}
                {device.revokedAt
                  ? ` · revogado em ${dateTime(device.revokedAt)}`
                  : ` · validade local até ${dateTime(device.offlineExpiresAt)}`}
              </p>
            </div>
            {!device.revokedAt ? (
              <button
                type="button"
                onClick={() => void revoke(device)}
                disabled={revoking === device.deviceKey}
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-coral)] px-3 text-sm font-black text-[color:var(--app-coral)] disabled:opacity-50"
              >
                {revoking === device.deviceKey ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldX className="size-4" aria-hidden="true" />
                )}
                Revogar
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
