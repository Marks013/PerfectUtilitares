"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarDays, FileText, ImageIcon, TimerReset } from "lucide-react";
import { useState } from "react";

type UsagePeriod = "day" | "month" | "year";
type UserStatus = "ACTIVE" | "BLOCKED" | "BANNED";

type UsageResponse = {
  period: UsagePeriod;
  start: string;
  endExclusive: string;
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: "ADMIN" | "OPERATOR";
    status: UserStatus;
    tenant: { name: string } | null;
    total: number;
    modules: { JORNADA: number; FOTOS: number; PDF: number };
    inputBytes: string;
    outputBytes: string;
  }>;
};

const periods: Array<{ value: UsagePeriod; label: string }> = [
  { value: "day", label: "Hoje" },
  { value: "month", label: "Este mês" },
  { value: "year", label: "Este ano" },
];

function formatBytes(value: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const amount = bytes / 1024 ** index;
  return `${amount.toLocaleString("pt-BR", {
    maximumFractionDigits: index === 0 ? 0 : 1,
  })} ${units[index]}`;
}

function statusLabel(status: UserStatus) {
  return {
    ACTIVE: "Ativo",
    BLOCKED: "Bloqueado",
    BANNED: "Banido",
  }[status];
}

async function loadUsage(period: UsagePeriod): Promise<UsageResponse> {
  const response = await fetch(`/api/admin/usage?period=${period}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Não foi possível carregar o uso agora.");
  return response.json() as Promise<UsageResponse>;
}

export function UserUsagePanel() {
  const [period, setPeriod] = useState<UsagePeriod>("day");
  const usage = useQuery({
    queryKey: ["admin", "usage", period],
    queryFn: () => loadUsage(period),
    staleTime: 30_000,
  });

  const totalOperations =
    usage.data?.users.reduce((total, user) => total + user.total, 0) ?? 0;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-neutral-200 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="size-5 text-blue-600" aria-hidden="true" />
            <h2 className="font-semibold text-neutral-950">Uso por usuário</h2>
          </div>
          <p className="mt-1 text-sm text-neutral-600">
            Contagem de operações concluídas, sem armazenar o conteúdo dos arquivos.
          </p>
        </div>

        <fieldset className="inline-flex w-fit rounded-md border border-neutral-300 bg-neutral-50 p-1">
          <legend className="sr-only">Período de uso</legend>
          {periods.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setPeriod(item.value)}
              aria-pressed={period === item.value}
              className={`rounded px-3 py-1.5 text-sm font-medium transition ${
                period === item.value
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-neutral-600 hover:bg-neutral-200 hover:text-neutral-950"
              }`}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-neutral-200 px-4 py-3 text-sm text-neutral-600">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="size-4" aria-hidden="true" />
          {periods.find((item) => item.value === period)?.label}
        </span>
        <span className="font-medium text-neutral-900">
          {totalOperations.toLocaleString("pt-BR")} operações
        </span>
      </div>

      {usage.isPending ? (
        <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-neutral-600">
          <TimerReset className="size-4 animate-spin" aria-hidden="true" />
          Atualizando os números...
        </div>
      ) : usage.isError ? (
        <div className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {usage.error.message}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-neutral-50 text-neutral-600">
              <tr>
                <th className="px-4 py-3">Usuário</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Jornadas</th>
                <th className="px-4 py-3 text-right">Fotos</th>
                <th className="px-4 py-3 text-right">PDFs</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Dados processados</th>
              </tr>
            </thead>
            <tbody>
              {usage.data.users.map((user) => (
                <tr key={user.id} className="border-t border-neutral-100">
                  <td className="px-4 py-3">
                    <div className="font-medium text-neutral-900">{user.name}</div>
                    <div className="text-xs text-neutral-500">
                      {user.email} · {user.tenant?.name ?? "Sem empresa"}
                    </div>
                  </td>
                  <td className="px-4 py-3">{statusLabel(user.status)}</td>
                  <td className="px-4 py-3 text-right">
                    {user.modules.JORNADA.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {user.modules.FOTOS.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {user.modules.PDF.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-neutral-950">
                    {user.total.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-600">
                    <span className="inline-flex items-center justify-end gap-1">
                      {user.modules.PDF > 0 ? (
                        <FileText className="size-3.5" aria-hidden="true" />
                      ) : (
                        <ImageIcon className="size-3.5" aria-hidden="true" />
                      )}
                      {formatBytes(
                        (
                          BigInt(user.inputBytes) + BigInt(user.outputBytes)
                        ).toString(),
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

