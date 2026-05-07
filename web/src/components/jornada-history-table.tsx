"use client";

import { Download, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

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

async function downloadPdf(ids: string[]) {
  const response = await fetch("/api/jornada/historico/exportar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as
      | { error?: string | { message?: string } }
      | null;
    const message =
      typeof data?.error === "string"
        ? data.error
        : data?.error?.message ?? "Falha ao exportar PDF";
    throw new Error(message);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "historico-jornadas.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function JornadaHistoryTable({ items }: JornadaHistoryTableProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allSelected = items.length > 0 && selected.length === items.length;
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggleAll() {
    setSelected(allSelected ? [] : items.map((item) => item.id));
  }

  function toggleOne(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function exportSelected() {
    setError(null);
    setIsExporting(true);
    try {
      await downloadPdf(selected);
    } catch (exception) {
      setError(
        exception instanceof Error ? exception.message : "Falha ao exportar PDF",
      );
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-neutral-600">
          {selected.length} jornada(s) selecionada(s)
        </div>
        <button
          type="button"
          onClick={exportSelected}
          disabled={selected.length === 0 || isExporting}
          className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
        >
          {isExporting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          Exportar PDF
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Selecionar todas as jornadas exibidas"
                  className="size-4 rounded border-neutral-300"
                />
              </th>
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
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(item.id)}
                    onChange={() => toggleOne(item.id)}
                    aria-label={`Selecionar jornada ${item.horariosNormalizado}`}
                    className="size-4 rounded border-neutral-300"
                  />
                </td>
                <td className="px-4 py-3">{formatDate(item.createdAt)}</td>
                <td className="px-4 py-3">{item.horariosNormalizado}</td>
                <td className="px-4 py-3">
                  <span
                    className={item.valido ? "text-green-700" : "text-red-700"}
                  >
                    {item.mensagem}
                  </span>
                </td>
                <td className="px-4 py-3">{item.codigo ?? "-"}</td>
                <td className="px-4 py-3">
                  {item.user?.name ?? item.user?.email ?? "-"}
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-neutral-500" colSpan={6}>
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
