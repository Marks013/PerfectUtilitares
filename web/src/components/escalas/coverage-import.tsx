"use client";

import { isAdministrativeEscalaSector } from "@/lib/escalas/eligibility";
import { useEffect, useState } from "react";
import type { EscalaInput } from "@/lib/escalas/types";
import { compareSectors } from "@/lib/escalas/order";
import { ImportReplacement, type ImportReplacementProps } from "./import-replacement";
import { MovementPriorities } from "./movement-priorities";
import { matchesCoverageBasis, proposeAutomaticCoverage, summarizeAutomaticCoverage } from "@/lib/escalas/automatic-coverage";
import { isDecember2026Cutover } from "@/lib/escalas/planning-calendar";
import { buttonClass, Check, controlClass, Field, panelClass, primaryClass } from "./controls";
import {
  clock,
  datesBetween,
  displayDate,
  errorMessage,
  parseClock,
  WEEKDAYS,
} from "./workspace-model";

/** Bind both parsing context and the registrations/references the user reviewed. */
export function employeeImportScenarioKey(input: EscalaInput) {
  return JSON.stringify([input.branchCode, input.startDate, input.endDate, input.visibleMonth,
    input.planningWeekStartsOn, input.defaultWeeklyHours, input.employees, input.shifts]);
}

export function ImportEmployees(props: ImportReplacementProps) {
  return <ImportReplacement {...props} purpose="EMPLOYEES" />;
}

export function Coverage({
  input,
  disabled,
  onChange,
  review,
}: {
  input: EscalaInput;
  disabled: boolean;
  onChange: (input: EscalaInput) => void;
  review?: { sector?: string; date?: string };
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
  const [filterSector, setFilterSector] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [resetRequested, setResetRequested] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!review) return;
    setFilterSector(review.sector ?? "");
    setFilterDate(review.date ?? "");
    setPage(0);
  }, [review]);
  const demands = input.demands.filter(demand => !isAdministrativeEscalaSector(demand.sector)).sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      compareSectors(a.sector, b.sector) ||
      (a.role ?? "").localeCompare(b.role ?? "", "pt-BR") ||
      a.start - b.start,
  );
  const filtered = demands.filter((demand) => (!filterSector || demand.sector === filterSector) && (!filterDate || demand.date === filterDate));
  const pages = Math.max(1, Math.ceil(filtered.length / 15));
  const currentPage = Math.min(page, pages - 1);
  const summary = summarizeAutomaticCoverage(input);
  const explicitCount = demands.filter((demand) => demand.estimated !== true).length;
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (isAdministrativeEscalaSector(sector)) throw new Error("Afastados não é um setor da escala. Escolha um setor de trabalho.");
      const from = parseClock(start);
      const until = parseClock(end);
      if (
        !sector.trim() ||
        !weekdays.length ||
        until <= from ||
        from >= 1440 ||
        until > 1440 ||
        minimum < 0 ||
        minimum > 250 ||
        !Number.isInteger(minimum)
      )
        throw new Error(
          "Informe setor, dias, faixa dentro do dia civil e mínimo inteiro entre zero e 250. Zero deve ser uma decisão operacional explícita.",
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
        estimated: false,
      }));
      const duplicates = additions.some((next) =>
        input.demands.some(
          (item) =>
            item.estimated !== true && item.date === next.date &&
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
      onChange(proposeAutomaticCoverage({ ...input, demands: [...input.demands, ...additions] }));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  return (
    <section className={panelClass} aria-labelledby="escala-coverage-title">
      <h2 id="escala-coverage-title" className="text-lg font-bold">Cobertura automática por setor</h2>
      <p className="text-sm text-[color:var(--app-muted)]">
        As metas são definidas ao gerar a proposta, usando equipe, cargos, horários e os dias de trabalho previstos para cada semana.
        Mudanças na equipe ou na carga horária recalculam as estimativas. Você não precisa cadastrar faixas nem aprovar estimativas para simular.
      </p>
      <p className="text-sm">Pausas não contam como atendimento. Pessoas sem horário participam do revezamento, mas não viram cobertura horária fictícia. Uma meta automática é uma referência de equilíbrio, não uma garantia de atendimento.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Equipe e metas automáticas de cobertura por setor e cargo</caption>
          <thead><tr>
            <th scope="col" className="p-2">Setor / cargo</th>
            <th scope="col" className="p-2">Com horário</th>
            <th scope="col" className="p-2">Sem horário</th>
            <th scope="col" className="p-2">Meta por faixa</th>
          </tr></thead>
          <tbody>{summary.map((group) => <tr key={JSON.stringify([group.sector, group.role])}>
            <th scope="row" className="p-2 font-medium">{group.sector || "Sem setor"}<span className="block font-normal text-[color:var(--app-muted)]">{group.role || "Cargo não informado"}</span></th>
            <td className="p-2 tabular-nums">{group.timed}</td>
            <td className="p-2 tabular-nums">{group.missing}</td>
            <td className="p-2">{group.minimum === null ? (group.timed ? "Automática ao gerar" : "Apenas presença e folgas") : group.minimum === group.maximum ? `${group.minimum} pessoa(s)` : `${group.minimum}–${group.maximum} pessoa(s)`}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {!summary.length && <p className="text-sm">Importe a equipe para o algoritmo dimensionar a cobertura.</p>}
      <p className="text-sm">{explicitCount} faixa(s) marcada(s) como mínimo obrigatório. Esses valores são preservados; só a estimativa automática se ajusta.</p>
      {isDecember2026Cutover(input) && input.demands.some(demand => demand.estimated === true) && !matchesCoverageBasis(input) && <div className="space-y-2">
        <p className="text-sm">A referência salva não corresponde ao cálculo atual. Recalcular atualiza só as estimativas do rascunho; os mínimos e os dias da grade não mudam.</p>
        <button type="button" disabled={disabled} className={buttonClass} onClick={() => {
          setError("");
          try {
            onChange(proposeAutomaticCoverage({ ...input, coverageBasis: undefined, demands: input.demands.filter(demand => demand.estimated !== true) }));
            setNotice("Estimativas recalculadas no rascunho. Confira a cobertura antes de gerar uma proposta.");
          } catch (cause) { setError(errorMessage(cause)); }
        }}>Recalcular apenas estimativas</button>
      </div>}
      {explicitCount > 0 && <div className="space-y-3 rounded-md border border-[color:var(--app-border)] p-3">
        {!resetRequested ? <button type="button" disabled={disabled} className={buttonClass} onClick={() => setResetRequested(true)}>Voltar à cobertura automática</button> : <fieldset className="space-y-3" disabled={disabled} aria-label="Confirmar volta à cobertura automática">
          <p className="text-sm">Isso retira os {explicitCount} mínimos obrigatórios deste rascunho. Ao gerar novamente, o algoritmo recalcula estimativas. Equipe, jornada, dias bloqueados e ausências não mudam. A revisão anterior permanece no histórico após salvar.</p>
          <div className="flex flex-wrap gap-3"><button type="button" disabled={disabled} className={primaryClass} onClick={() => {
            onChange({ ...input, demands: [], policy: { ...input.policy, coverageReview: "SUGGESTED" } });
            setResetRequested(false); setNotice("Cobertura automática selecionada no rascunho. Gere novamente para recalcular as estimativas, depois revise a proposta.");
          }}>Confirmar uso de cobertura automática</button><button type="button" className={buttonClass} onClick={() => setResetRequested(false)}>Manter mínimos atuais</button></div>
        </fieldset>}
      </div>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <MovementPriorities key={`${input.branchCode}:${input.startDate}:${input.endDate}`} input={input} disabled={disabled} onChange={onChange} />
      <details className="space-y-3">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">Mínimos obrigatórios (opcional)</summary>
      <p className="text-sm text-[color:var(--app-muted)]">Use somente quando houver uma necessidade operacional conhecida. O algoritmo respeita esse mínimo como obrigatório; um valor impossível será informado, não reduzido silenciosamente.</p>
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
                  max={250}
                  required
                  value={minimum}
                  onChange={(event) => setMinimum(Number(event.target.value))}
                  className={controlClass}
                />
              )}
            </Field>
          </div>
          <datalist id="escala-sectors">
            {[...new Set(input.employees.filter(person => !isAdministrativeEscalaSector(person.sector)).map(person => person.sector))]
              .sort(compareSectors)
              .map((value) => (
                <option key={value} value={value} />
              ))}
          </datalist>
          <datalist id="escala-roles">
            {[...new Set(input.employees.filter(person => !isAdministrativeEscalaSector(person.sector)).map(person => person.role))]
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
      </details>
      <details id="escala-coverage-required" className="space-y-3">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          Conferir faixas cadastradas ({demands.length})
        </summary>
        {!demands.length && (
          <p className="text-sm">As metas automáticas serão criadas ao gerar a proposta. Não é necessário preencher este cadastro para simular.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Filtrar setor da cobertura">{(id) => <select id={id} className={controlClass} value={filterSector} onChange={(event) => { setFilterSector(event.target.value); setPage(0); }}><option value="">Todos os setores</option>{[...new Set(demands.map(demand => demand.sector))].sort(compareSectors).map(value => <option key={value} value={value}>{value}</option>)}</select>}</Field>
          <Field label="Filtrar dia da cobertura">{(id) => <input id={id} className={controlClass} type="date" min={input.startDate} max={input.endDate} value={filterDate} onChange={(event) => { setFilterDate(event.target.value); setPage(0); }} />}</Field>
        </div>
        <p className="text-sm">{filtered.length} faixas na seleção. Confira setor, dia, horário e mínimo; nenhuma faixa é alterada apenas por abrir a lista.</p>
        <div className="space-y-2">
          {filtered.slice(currentPage * 15, currentPage * 15 + 15).map((demand) => (
            <div
              key={demand.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--app-border)] py-2 text-sm"
            >
              <p>
                {displayDate(demand.date)} · {demand.sector} / {demand.role || "Todos os cargos"} ·{" "}
                {clock(demand.start)}–{clock(demand.end)} · {demand.estimated ? "meta automática" : "mínimo obrigatório"} {demand.minimum}
              </p>
              {!demand.estimated && <button
                type="button"
                className={buttonClass}
                disabled={disabled}
                onClick={() => onChange(proposeAutomaticCoverage({ ...input, demands: input.demands.filter((item) => item.id !== demand.id) }))}
              >
                Remover
                <span className="sr-only">
                  {" "}
                  faixa de {displayDate(demand.date)} às {clock(demand.start)}
                </span>
              </button>}
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
