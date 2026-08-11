"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Clipboard,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

type Device = {
  id: string;
  label: string;
  tokenPrefix: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type Feedback = { tone: "success" | "error"; message: string } | null;

function dateTime(value: string | null) {
  if (!value) return "Ainda não sincronizou";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

async function responseMessage(response: Response) {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
    };
    return body.error?.message ?? "Não foi possível concluir esta ação.";
  } catch {
    return "Não foi possível concluir esta ação.";
  }
}

export function UnimedExcelDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [label, setLabel] = useState("Planilha de apoio");
  const [expiresInDays, setExpiresInDays] = useState(180);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/unimed/excel/devices", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const body = (await response.json()) as { devices: Device[] };
      setDevices(body.devices);
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar as autorizações.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  async function createDevice() {
    setSaving(true);
    setToken(null);
    setCopied(false);
    setFeedback(null);
    try {
      const response = await fetch("/api/unimed/excel/devices", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, expiresInDays }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const body = (await response.json()) as { device: Device; token: string };
      setDevices((current) => [body.device, ...current]);
      setToken(body.token);
      setFeedback({
        tone: "success",
        message: "Autorização criada. Use o código abaixo na planilha.",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível criar a autorização.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function revokeDevice(id: string) {
    setRevokingId(id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/unimed/excel/devices/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const revokedAt = new Date().toISOString();
      setDevices((current) =>
        current.map((device) =>
          device.id === id ? { ...device, revokedAt } : device,
        ),
      );
      setFeedback({ tone: "success", message: "Autorização revogada." });
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível revogar a autorização.",
      });
    } finally {
      setRevokingId(null);
    }
  }

  async function copyToken() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
  }

  return (
    <section
      id="config-excel-section"
      className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-6"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-teal-soft)] text-[color:var(--app-teal)]">
            <FileSpreadsheet className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-black text-[color:var(--app-fg)]">
              Planilha de apoio offline
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[color:var(--app-muted)]">
              Autorize uma cópia da planilha a baixar beneficiários, faturas,
              endereços, preços e consignados. A autorização permite somente
              leitura e pode ser revogada a qualquer momento.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadDevices()}
          disabled={loading}
          title="Atualizar autorizações"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] text-[color:var(--app-fg)] transition hover:border-[color:var(--app-teal)] disabled:opacity-50"
        >
          <RefreshCw
            className={`size-4 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span className="sr-only">Atualizar autorizações</span>
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_11rem_auto] md:items-end">
        <label className="block">
          <span className="text-sm font-black text-[color:var(--app-fg)]">
            Nome desta planilha
          </span>
          <input
            value={label}
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
            className="mt-2 min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 text-sm font-semibold text-[color:var(--app-fg)] outline-none focus:border-[color:var(--app-teal)]"
          />
        </label>
        <label className="block">
          <span className="text-sm font-black text-[color:var(--app-fg)]">
            Validade em dias
          </span>
          <input
            type="number"
            min={7}
            max={365}
            value={expiresInDays}
            onChange={(event) => setExpiresInDays(Number(event.target.value))}
            className="mt-2 min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 text-sm font-semibold text-[color:var(--app-fg)] outline-none focus:border-[color:var(--app-teal)]"
          />
        </label>
        <button
          type="button"
          onClick={() => void createDevice()}
          disabled={saving || label.trim().length < 2}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[color:var(--app-action-blue)] px-4 text-sm font-black text-[color:var(--app-action-text)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="size-4" aria-hidden="true" />
          )}
          Autorizar planilha
        </button>
      </div>

      {feedback ? (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          className={`mt-4 rounded-xl px-4 py-3 text-sm font-bold ${feedback.tone === "error" ? "bg-[color:var(--app-danger-soft)] text-[color:var(--app-coral)]" : "bg-[color:var(--app-success-soft)] text-[color:var(--app-success)]"}`}
        >
          {feedback.message}
        </p>
      ) : null}

      {token ? (
        <div className="mt-4 rounded-xl border border-[color:var(--app-teal)] bg-[color:var(--app-teal-soft)] p-4">
          <div className="flex items-center gap-2 text-sm font-black text-[color:var(--app-fg)]">
            <KeyRound className="size-4" aria-hidden="true" />
            Código exibido somente agora
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-[color:var(--app-input)] px-3 py-2.5 text-xs text-[color:var(--app-fg)]">
              {token}
            </code>
            <button
              type="button"
              onClick={() => void copyToken()}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[color:var(--app-action-green)] px-4 text-sm font-black text-[color:var(--app-action-text)]"
            >
              {copied ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Clipboard className="size-4" aria-hidden="true" />
              )}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
          <p className="mt-2 text-xs leading-5 text-[color:var(--app-muted)]">
            Depois de fechar esta página, o código não poderá ser recuperado.
            Uma nova autorização pode ser criada sem afetar as anteriores.
          </p>
        </div>
      ) : null}

      <div className="mt-6 divide-y divide-[color:var(--app-border)] border-y border-[color:var(--app-border)]">
        {loading ? (
          <div className="flex min-h-24 items-center justify-center gap-2 text-sm font-bold text-[color:var(--app-muted)]">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Carregando autorizações…
          </div>
        ) : devices.length === 0 ? (
          <p className="py-6 text-sm text-[color:var(--app-muted)]">
            Nenhuma planilha foi autorizada ainda.
          </p>
        ) : (
          devices.map((device) => {
            const active = !device.revokedAt && new Date(device.expiresAt) > new Date();
            return (
              <div
                key={device.id}
                className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_minmax(11rem,auto)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-black text-[color:var(--app-fg)]">
                      {device.label}
                    </p>
                    <span
                      className={`rounded-full px-2 py-1 text-[0.68rem] font-black uppercase ${active ? "bg-[color:var(--app-success-soft)] text-[color:var(--app-success)]" : "bg-[color:var(--app-danger-soft)] text-[color:var(--app-coral)]"}`}
                    >
                      {active ? "Ativa" : device.revokedAt ? "Revogada" : "Expirada"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[color:var(--app-muted)]">
                    {device.tokenPrefix} · validade até {dateTime(device.expiresAt)}
                  </p>
                </div>
                <p className="text-xs text-[color:var(--app-muted)]">
                  Última sincronização
                  <span className="mt-1 block font-bold text-[color:var(--app-fg)]">
                    {dateTime(device.lastUsedAt)}
                  </span>
                </p>
                {active ? (
                  <button
                    type="button"
                    title="Revogar autorização"
                    onClick={() => void revokeDevice(device.id)}
                    disabled={revokingId === device.id}
                    className="inline-flex size-10 items-center justify-center rounded-xl bg-[color:var(--app-danger)] text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    {revokingId === device.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="size-4" aria-hidden="true" />
                    )}
                    <span className="sr-only">Revogar autorização</span>
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
