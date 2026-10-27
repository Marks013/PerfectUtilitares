"use client";

import { useMemo, useState } from "react";
import { sortEmployees } from "@/lib/escalas/order";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaValidation } from "@/lib/escalas/types";
import { buttonClass, Check, controlClass, Field, panelClass, primaryClass } from "./controls";
import { datesBetween, displayDate, replaceAssignment, WEEKDAYS } from "./workspace-model";

function assignmentLabel(assignment: EscalaAssignment | undefined, input: EscalaInput) {
  if (!assignment) return "Pendente";
  if (assignment.kind === "OFF") return "Folga";
  if (assignment.kind === "ABSENCE") return "Ausência";
  if (assignment.kind === "DUTY") return "Trabalho sem horário fixo";
  return input.shifts.find((shift) => shift.id === assignment.shiftId)?.name ?? "Turno não encontrado";
}

export function CellEditor({
  employee,
  date,
  assignment,
  input,
  canUnlock,
  onApply,
  onCancel,
}: {
  employee: EscalaEmployee;
  date: string;
  assignment?: EscalaAssignment;
  input: EscalaInput;
  canUnlock: boolean;
  onApply: (assignment: EscalaAssignment) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<EscalaAssignment["kind"]>(
    assignment?.kind ?? (employee.scheduleMode === "UNTIMED" ? "DUTY" : "WORK"),
  );
  const [shiftId, setShiftId] = useState(assignment?.shiftId ?? employee.shiftIds[0] ?? "");
  const [locked, setLocked] = useState(assignment?.locked ?? false);
  const wasLocked = Boolean(assignment?.locked);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onApply({
          employeeId: employee.id,
          date,
          kind,
          ...(kind === "WORK" ? { shiftId } : {}),
          locked,
        });
      }}
      className="space-y-4 app-radius-lg border border-[color:var(--app-teal)] p-4"
    >
      <h3 className="font-semibold">
        {employee.name} · {displayDate(date)}
      </h3>
      {wasLocked && (
        <p className="text-sm">
          Esta decisão está bloqueada. Um aprovador pode desmarcar o bloqueio e salvar a revisão. Só depois poderá
          alterar a jornada.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Situação do dia">
          {(id) => (
            <select
              id={id}
              disabled={wasLocked}
              value={kind}
              onChange={(event) => setKind(event.target.value as EscalaAssignment["kind"])}
              className={controlClass}
            >
              {employee.scheduleMode === "UNTIMED"
                ? <option value="DUTY">Trabalho sem horário fixo</option>
                : <option value="WORK">Trabalho</option>}
              <option value="OFF">Folga</option>
              <option value="ABSENCE">Ausência</option>
            </select>
          )}
        </Field>
        {kind === "WORK" && employee.scheduleMode !== "UNTIMED" && (
          <Field label="Turno autorizado">
            {(id) => (
              <select
                id={id}
                required
                disabled={wasLocked}
                value={shiftId}
                onChange={(event) => setShiftId(event.target.value)}
                className={controlClass}
              >
                <option value="">Selecione</option>
                {input.shifts
                  .filter((shift) => employee.shiftIds.includes(shift.id))
                  .map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {shift.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
        )}
      </div>
      <Check
        label="Bloquear esta decisão nas gerações e sugestões"
        checked={locked}
        disabled={wasLocked && !canUnlock}
        onChange={setLocked}
      />
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primaryClass} disabled={wasLocked && (!canUnlock || locked)}>
          Aplicar à proposta
        </button>
        <button type="button" className={buttonClass} onClick={onCancel}>
          Cancelar edição
        </button>
      </div>
    </form>
  );
}

export function Roster({
  input,
  validation,
  disabled,
  canUnlock,
  canSuggest,
  onChange,
  onSuggest,
}: {
  input: EscalaInput;
  validation: EscalaValidation | null;
  disabled: boolean;
  canUnlock: boolean;
  canSuggest: boolean;
  onChange: (input: EscalaInput) => void;
  onSuggest: (employeeId: string, weekStart: string) => void;
}) {
  const [week, setWeek] = useState(input.startDate);
  const [filter, setFilter] = useState("");
  const [sector, setSector] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<{
    employeeId: string;
    date: string;
  } | null>(null);
  const allDates = datesBetween(input.startDate, input.endDate);
  const weeks = allDates.filter((_, index) => index % 7 === 0);
  const dates = allDates.slice(allDates.indexOf(week), allDates.indexOf(week) + 7);
  const assignments = useMemo(
    () => new Map(input.assignments.map((assignment) => [`${assignment.employeeId}:${assignment.date}`, assignment])),
    [input.assignments],
  );
  const employees = sortEmployees(input.employees).filter(
    (employee) =>
      (!sector || employee.sector === sector) &&
      `${employee.name} ${employee.registration} ${employee.role}`
        .toLocaleLowerCase("pt-BR")
        .includes(filter.toLocaleLowerCase("pt-BR")),
  );
  const pages = Math.max(1, Math.ceil(employees.length / 20));
  const currentPage = Math.min(page, pages - 1);
  const displayed = employees.slice(currentPage * 20, currentPage * 20 + 20);
  const selectedEmployee = selected
    ? input.employees.find((employee) => employee.id === selected.employeeId)
    : undefined;
  let lastGroup = "";
  return (
    <section className={panelClass} aria-labelledby="escala-roster-title">
      <h2 id="escala-roster-title" className="text-lg font-bold">
        4. Proposta da equipe
      </h2>
      <p className="text-sm text-[color:var(--app-muted)]">
        Filial {input.branchCode} · {input.branchName}. Organização: setor, cargo e nome A–Z. Selecione um dia para
        editar; “Pendente” não equivale a folga.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Semana exibida">
          {(id) => (
            <select
              id={id}
              value={week}
              onChange={(event) => {
                setWeek(event.target.value);
                setSelected(null);
              }}
              className={controlClass}
            >
              {weeks.map((date) => (
                <option key={date} value={date}>
                  {displayDate(date)} a {displayDate(allDates[allDates.indexOf(date) + 6])}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Filtrar setor">
          {(id) => (
            <select
              id={id}
              value={sector}
              onChange={(event) => {
                setSector(event.target.value);
                setPage(0);
              }}
              className={controlClass}
            >
              <option value="">Todos os setores</option>
              {[...new Set(input.employees.map((employee) => employee.sector))]
                .sort((a, b) => a.localeCompare(b, "pt-BR"))
                .map((value) => (
                  <option key={value} value={value}>
                    {value || "Sem setor informado"}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <Field label="Buscar nome, matrícula ou cargo">
          {(id) => (
            <input
              id={id}
              type="search"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(0);
              }}
              className={controlClass}
            />
          )}
        </Field>
      </div>
      <section
        className="max-w-full overflow-x-auto app-radius-lg border border-[color:var(--app-border)]"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the wide roster in read-only mode.
        tabIndex={0}
        aria-label="Grade semanal da equipe, com rolagem horizontal"
      >
        <table className="w-full min-w-[58rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            Filial {input.branchCode}. Semana de {displayDate(week)}. Colaboradores por setor, cargo e nome.
          </caption>
          <thead>
            <tr className="bg-[color:var(--app-input)]">
              <th scope="col" className="sticky left-0 z-10 min-w-56 bg-[color:var(--app-input)] p-3">
                Colaborador / contrato
              </th>
              {dates.map((date, index) => (
                <th key={date} scope="col" className="min-w-28 p-3">
                  {WEEKDAYS[index]}
                  <span className="block text-xs font-normal">{displayDate(date).slice(0, 5)}</span>
                  {input.policy.holidayDates.includes(date) && <span className="block text-xs">Feriado</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.flatMap((employee) => {
              const group = `${employee.sector}\0${employee.role}`;
              const heading = group !== lastGroup;
              lastGroup = group;
              const summary = validation?.summaries.find((item) => item.employeeId === employee.id);
              return [
                ...(heading
                  ? [
                      <tr key={`group-${group}`}>
                        <th
                          scope="rowgroup"
                          colSpan={8}
                          className="bg-[color:var(--app-input)] px-3 py-2 font-semibold"
                        >
                          {employee.sector || "Sem setor informado"} / {employee.role || "Sem cargo informado"}
                        </th>
                      </tr>,
                    ]
                  : []),
                <tr key={employee.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3 align-top"
                  >
                    <span className="block break-words">{employee.name}</span>
                    <span className="block text-xs font-normal text-[color:var(--app-muted)]">
                      {employee.registration} · {employee.scheduleMode === "UNTIMED"
                        ? "Sem horário fixo · horas não apuradas"
                        : `${employee.weeklyHours}h por semana`}
                    </span>
                    {summary && (
                      <span className="block text-xs font-normal">
                        {summary.workDays} dias trabalhados · {summary.offDays} folgas
                      </span>
                    )}
                    <button
                      type="button"
                      className={`${buttonClass} mt-2 w-full px-2 text-xs`}
                      disabled={!canSuggest}
                      onClick={() => onSuggest(employee.id, week)}
                    >
                      Sugerir folgas
                      <span className="sr-only"> para {employee.name}</span>
                    </button>
                  </th>
                  {dates.map((date) => {
                    const assignment = assignments.get(`${employee.id}:${date}`);
                    const inactive =
                      Boolean(employee.activeFrom && date < employee.activeFrom) || Boolean(employee.activeUntil && date > employee.activeUntil);
                    return (
                      <td key={date} className="border-b border-[color:var(--app-border)] p-1.5 align-top">
                        {inactive ? (
                          <span className="block p-2 text-xs text-[color:var(--app-muted)]">Fora do vínculo</span>
                        ) : (
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => setSelected({ employeeId: employee.id, date })}
                            className="min-h-16 w-full app-radius-lg border border-[color:var(--app-border)] px-2 py-2 text-left text-xs leading-relaxed focus-visible:outline-2 focus-visible:outline-[color:var(--app-teal)] disabled:cursor-default"
                            aria-label={`${employee.name}, ${displayDate(date)}: ${assignmentLabel(assignment, input)}${assignment?.locked ? ", bloqueado" : ""}. Editar`}
                          >
                            <span
                              className={
                                assignment?.kind === "OFF" ? "font-bold text-[color:var(--app-teal)]" : undefined
                              }
                            >
                              {assignmentLabel(assignment, input)}
                            </span>
                            {assignment?.locked && <span className="block font-semibold">Bloqueado</span>}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </section>
      {!employees.length && <p className="text-sm">Nenhum colaborador corresponde aos filtros.</p>}
      {pages > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={buttonClass}
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Anterior
          </button>
          <span className="text-sm">
            Página {currentPage + 1} de {pages} · {employees.length} colaboradores
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
      <p className="text-xs text-[color:var(--app-muted)]">
        A análise e a geração consideram toda a filial, inclusive pessoas ocultas pelos filtros. Sugestões só ficam
        disponíveis após salvar a revisão.
      </p>
      {selected && selectedEmployee && (
        <fieldset disabled={disabled}>
          <CellEditor
            key={`${selected.employeeId}:${selected.date}`}
            employee={selectedEmployee}
            date={selected.date}
            assignment={assignments.get(`${selected.employeeId}:${selected.date}`)}
            input={input}
            canUnlock={canUnlock}
            onCancel={() => setSelected(null)}
            onApply={(assignment) => {
              onChange({
                ...input,
                assignments: replaceAssignment(input.assignments, assignment),
              });
              setSelected(null);
            }}
          />
        </fieldset>
      )}
    </section>
  );
}
