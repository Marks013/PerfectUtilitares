"use client";

import { useState } from "react";
import type { EscalaEmployee, EscalaInput, EscalaShift } from "@/lib/escalas/types";
import { sortEmployees } from "@/lib/escalas/order";
import { buttonClass, Check, controlClass, Field, panelClass, primaryClass } from "./controls";
import {
  clock,
  datesBetween,
  displayDate,
  errorMessage,
  mergeImport,
  parseClock,
  responseMessage,
  WEEKDAYS,
} from "./workspace-model";

type ImportPreview = {
  employees: EscalaEmployee[];
  shifts: EscalaShift[];
  issues: { line: number; message: string }[];
  totalRows: number;
};

export function ImportEmployees({
  input,
  disabled,
  onChange,
}: {
  input: EscalaInput;
  disabled: boolean;
  onChange: (input: EscalaInput) => void;
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  async function analyze() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("branchCode", input.branchCode);
      form.set("startDate", input.startDate);
      form.set("defaultWeeklyHours", String(input.defaultWeeklyHours));
      const response = await fetch("/api/escalas/import", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(responseMessage(body));
      setPreview(body.preview);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className={panelClass}>
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">Importar equipe com prévia</summary>
      <p className="text-sm text-[color:var(--app-muted)]">
        Use o modelo de Escalas. O FPRE131 não substitui os dados de horários, setores e histórico. A importação não
        remove matrículas ausentes nem publica a escala.
      </p>
      <a href="/api/escalas/import?template=csv" download className={buttonClass}>
        Baixar modelo CSV
      </a>
      <Field label="Arquivo CSV ou XLSX">
        {(id) => (
          <input
            id={id}
            type="file"
            accept=".csv,.xlsx"
            disabled={disabled || busy}
            className={controlClass}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setError("");
            }}
          />
        )}
      </Field>
      <button type="button" className={buttonClass} disabled={disabled || busy || !file} onClick={() => void analyze()}>
        {busy ? "Conferindo arquivo…" : "Conferir arquivo"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-[color:var(--app-coral)]">
          {error}
        </p>
      )}
      {preview && (
        <div className="space-y-3">
          <p className="font-semibold">
            Prévia: {preview.employees.length} colaboradores aceitos de {preview.totalRows} linhas.
          </p>
          <p className="text-sm">
            Confira a admissão real, o enquadramento de domingos e o histórico de cada pessoa após aplicar a prévia. Os
            dados importados continuam pendentes dessa conferência.
          </p>
          {preview.issues.length > 0 && (
            <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-sm">
              {preview.issues.map((issue) => (
                <li key={`${issue.line}-${issue.message}`}>
                  Linha {issue.line}: {issue.message}
                </li>
              ))}
            </ul>
          )}
          <div className="max-h-48 overflow-auto text-sm">
            <table className="w-full text-left">
              <caption className="sr-only">Colaboradores da prévia de importação</caption>
              <thead>
                <tr>
                  <th scope="col" className="p-2">
                    Matrícula
                  </th>
                  <th scope="col" className="p-2">
                    Nome
                  </th>
                  <th scope="col" className="p-2">
                    Setor / cargo
                  </th>
                  <th scope="col" className="p-2">
                    Carga
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortEmployees(preview.employees).map((employee) => (
                  <tr key={employee.id}>
                    <td className="p-2">{employee.registration}</td>
                    <td className="p-2">{employee.name}</td>
                    <td className="p-2">
                      {employee.sector} / {employee.role}
                    </td>
                    <td className="p-2">{employee.weeklyHours}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            disabled={disabled || busy || preview.employees.length === 0}
            className={primaryClass}
            onClick={() => {
              try {
                onChange(mergeImport(input, preview.employees, preview.shifts));
                setPreview(null);
                setFile(null);
              } catch (cause) {
                setError(errorMessage(cause));
              }
            }}
          >
            Aplicar registros aceitos à proposta
          </button>
        </div>
      )}
    </details>
  );
}

export function Coverage({
  input,
  disabled,
  onChange,
}: {
  input: EscalaInput;
  disabled: boolean;
  onChange: (input: EscalaInput) => void;
}) {
  const [startDate, setStartDate] = useState(input.startDate);
  const [endDate, setEndDate] = useState(input.endDate);
  const [weekdays, setWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [sector, setSector] = useState("");
  const [role, setRole] = useState("");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("18:00");
  const [minimum, setMinimum] = useState(1);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const demands = [...input.demands].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.sector.localeCompare(b.sector, "pt-BR") ||
      (a.role ?? "").localeCompare(b.role ?? "", "pt-BR") ||
      a.start - b.start,
  );
  const pages = Math.max(1, Math.ceil(demands.length / 15));
  const currentPage = Math.min(page, pages - 1);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const from = parseClock(start);
      const until = parseClock(end);
      if (
        !sector.trim() ||
        !weekdays.length ||
        until <= from ||
        from >= 1440 ||
        until > 1440 ||
        minimum < 0 ||
        minimum > 150 ||
        !Number.isInteger(minimum)
      )
        throw new Error(
          "Informe setor, dias, faixa dentro do dia civil e mínimo inteiro entre zero e 150. Zero deve ser uma decisão operacional explícita.",
        );
      if (startDate < input.startDate || endDate > input.endDate || endDate < startDate)
        throw new Error("As datas precisam estar dentro do período da proposta.");
      const selectedDates = datesBetween(startDate, endDate).filter((date) =>
        weekdays.includes((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7),
      );
      const additions = selectedDates.map((date) => ({
        id: crypto.randomUUID(),
        date,
        sector: sector.trim(),
        ...(role.trim() ? { role: role.trim() } : {}),
        start: from,
        end: until,
        minimum,
      }));
      const duplicates = additions.some((next) =>
        input.demands.some(
          (item) =>
            item.date === next.date &&
            item.sector === next.sector &&
            (item.role ?? "") === (next.role ?? "") &&
            item.start === next.start &&
            item.end === next.end,
        ),
      );
      if (duplicates)
        throw new Error(
          "Já existe cobertura com essas datas e faixas. Remova a configuração anterior ou ajuste a faixa.",
        );
      onChange({ ...input, demands: [...input.demands, ...additions] });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  return (
    <section className={panelClass} aria-labelledby="escala-coverage-title">
      <h2 id="escala-coverage-title" className="text-lg font-bold">
        3. Cobertura mínima
      </h2>
      <p className="text-sm text-[color:var(--app-muted)]">
        Defina quem precisa estar trabalhando em cada faixa. Refeições e pausas não contam como atendimento. Faixas sem
        demanda não têm mínimo operacional conferido.
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={disabled} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="A partir de">
              {(id) => (
                <input
                  id={id}
                  required
                  type="date"
                  min={input.startDate}
                  max={input.endDate}
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className={controlClass}
                />
              )}
            </Field>
            <Field label="Até">
              {(id) => (
                <input
                  id={id}
                  required
                  type="date"
                  min={startDate}
                  max={input.endDate}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className={controlClass}
                />
              )}
            </Field>
            <Field label="Setor da cobertura">
              {(id) => (
                <input
                  id={id}
                  required
                  maxLength={100}
                  value={sector}
                  onChange={(event) => setSector(event.target.value)}
                  className={controlClass}
                  list="escala-sectors"
                />
              )}
            </Field>
            <Field label="Cargo necessário, se específico">
              {(id) => (
                <input
                  id={id}
                  maxLength={100}
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  className={controlClass}
                  list="escala-roles"
                />
              )}
            </Field>
            <Field label="Início da faixa (HH:MM)">
              {(id) => (
                <input
                  id={id}
                  required
                  maxLength={5}
                  inputMode="numeric"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  className={controlClass}
                />
              )}
            </Field>
            <Field label="Fim da faixa (HH:MM)">
              {(id) => (
                <input
                  id={id}
                  required
                  maxLength={5}
                  inputMode="numeric"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  className={controlClass}
                />
              )}
            </Field>
            <Field
              label="Mínimo de pessoas trabalhando"
              hint="Zero declara expressamente que não há mínimo nessa faixa; não significa que ela foi esquecida."
            >
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={0}
                  max={150}
                  required
                  value={minimum}
                  onChange={(event) => setMinimum(Number(event.target.value))}
                  className={controlClass}
                />
              )}
            </Field>
          </div>
          <datalist id="escala-sectors">
            {[...new Set(input.employees.map((employee) => employee.sector))]
              .sort((a, b) => a.localeCompare(b, "pt-BR"))
              .map((value) => (
                <option key={value} value={value} />
              ))}
          </datalist>
          <datalist id="escala-roles">
            {[...new Set(input.employees.map((employee) => employee.role))]
              .sort((a, b) => a.localeCompare(b, "pt-BR"))
              .map((value) => (
                <option key={value} value={value} />
              ))}
          </datalist>
          <fieldset>
            <legend className="text-sm font-semibold">Dias da semana</legend>
            <div className="flex flex-wrap gap-x-5">
              {WEEKDAYS.map((day, index) => (
                <Check
                  key={day}
                  label={day}
                  checked={weekdays.includes(index)}
                  onChange={(checked) =>
                    setWeekdays((previous) =>
                      checked ? [...previous, index] : previous.filter((value) => value !== index),
                    )
                  }
                />
              ))}
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-[color:var(--app-coral)]">
              {error}
            </p>
          )}
          <button className={buttonClass} type="submit">
            Adicionar cobertura nas datas selecionadas
          </button>
        </fieldset>
      </form>
      <details className="space-y-3">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          Conferir faixas cadastradas ({demands.length})
        </summary>
        {!demands.length && (
          <p className="text-sm">Nenhuma faixa cadastrada. A publicação exige conferir a cobertura operacional.</p>
        )}
        <div className="space-y-2">
          {demands.slice(currentPage * 15, currentPage * 15 + 15).map((demand) => (
            <div
              key={demand.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--app-border)] py-2 text-sm"
            >
              <p>
                {displayDate(demand.date)} · {demand.sector} / {demand.role || "Todos os cargos"} ·{" "}
                {clock(demand.start)}–{clock(demand.end)} · mínimo {demand.minimum}
              </p>
              <button
                type="button"
                className={buttonClass}
                disabled={disabled}
                onClick={() =>
                  onChange({
                    ...input,
                    demands: input.demands.filter((item) => item.id !== demand.id),
                  })
                }
              >
                Remover
                <span className="sr-only">
                  {" "}
                  faixa de {displayDate(demand.date)} às {clock(demand.start)}
                </span>
              </button>
            </div>
          ))}
        </div>
        {pages > 1 && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={buttonClass}
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Anterior
            </button>
            <span className="text-sm">
              Página {currentPage + 1} de {pages}
            </span>
            <button
              type="button"
              className={buttonClass}
              disabled={currentPage + 1 === pages}
              onClick={() => setPage(currentPage + 1)}
            >
              Próxima
            </button>
          </div>
        )}
      </details>
    </section>
  );
}
