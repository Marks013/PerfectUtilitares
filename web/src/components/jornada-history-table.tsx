"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type JornadaHistoryItem = {
  id: string;
  createdAt: string;
  horariosNormalizado: string;
  mensagem: string;
  valido: boolean;
  codigo: string | null;
  user: { name: string | null; email: string | null } | null;
};

type JornadaHistoryTableProps = {
  items: JornadaHistoryItem[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

async function clearAllHistory() {
  const response = await fetch("/api/jornada/historico?scope=all", {
    method: "DELETE",
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as
      | { error?: string | { message?: string } }
      | null;
    const message =
      typeof data?.error === "string"
        ? data.error
        : data?.error?.message ?? "Falha ao limpar histórico";
    throw new Error(message);
  }

  return (await response.json()) as { deletedCount: number };
}

export function JornadaHistoryTable({ items }: JornadaHistoryTableProps) {
  const router = useRouter();
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function clearEverything() {
    const confirmed = window.confirm(
      "Limpar todo o histórico de validações de todos os usuários? Esta ação não pode ser desfeita.",
    );
    if (!confirmed) return;

    setError(null);
    setNotice(null);
    setIsClearingAll(true);
    try {
      const result = await clearAllHistory();
      setNotice(`Histórico global limpo. Registros removidos: ${result.deletedCount}.`);
      router.refresh();
    } catch (exception) {
      setError(
        exception instanceof Error ? exception.message : "Falha ao limpar histórico",
      );
    } finally {
      setIsClearingAll(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-neutral-600">
          {items.length} validação(ões) exibida(s)
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={clearEverything}
            disabled={items.length === 0 || isClearingAll}
            className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {isClearingAll ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="size-4" aria-hidden="true" />
            )}
            Limpar tudo
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {notice}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Horários</th>
              <th className="px-4 py-3">Resultado</th>
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Usuário</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-neutral-100">
                <td className="px-4 py-3">{formatDate(item.createdAt)}</td>
                <td className="px-4 py-3">{item.horariosNormalizado}</td>
                <td className="px-4 py-3">
                  <span
                    className={item.valido ? "text-green-700" : "text-red-700"}
                  >
                    {item.mensagem}
                  </span>
                  {!item.valido ? (
                    <div className="mt-1 text-xs text-neutral-500">
                      Jornada inválida não pode ser exportada.
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3">{item.codigo ?? "-"}</td>
                <td className="px-4 py-3">
                  {item.user?.name ?? item.user?.email ?? "-"}
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-neutral-500" colSpan={5}>
                  Nenhuma validação encontrada.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
