"use client";

import { useState } from "react";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, WeeklyHours } from "@/lib/escalas/types";
import { sortEmployees } from "@/lib/escalas/order";
import { buttonClass, Check, controlClass, Field, panelClass, primaryClass } from "./controls";
import { addDate, displayDate, HOURS, newEmployee, replaceAssignment, WEEKDAYS } from "./workspace-model";

function DayChoices({ values, change, label }: { values: number[]; change: (days: number[]) => void; label: string }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-x-4">
        {WEEKDAYS.map((day, index) => (
          <Check
            key={day}
            label={day}
            checked={values.includes(index)}
            onChange={(checked) =>
              change(checked ? [...values, index].sort() : values.filter((value) => value !== index))
            }
          />
        ))}
      </div>
    </fieldset>
  );
}

function HistoryEditor({
  employee,
  input,
  entries,
  onChange,
}: {
  employee: EscalaEmployee;
  input: EscalaInput;
  entries: EscalaAssignment[];
  onChange: (entries: EscalaAssignment[]) => void;
}) {
  const dates = Array.from({ length: 21 }, (_, index) => addDate(input.startDate, index - 21));
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full min-w-96 text-left text-sm">
        <caption className="sr-only">Histórico real dos 21 dias anteriores à proposta</caption>
        <thead>
          <tr>
            <th scope="col" className="p-2">
              Data
            </th>
            <th scope="col" className="p-2">
              Situação real
            </th>
            <th scope="col" className="p-2">
              Turno trabalhado
            </th>
          </tr>
        </thead>
        <tbody>
          {dates.map((date) => {
            const entry = entries.find((item) => item.date === date);
            const outside =
              Boolean(employee.activeFrom && date < employee.activeFrom) ||
              Boolean(employee.activeUntil && date > employee.activeUntil);
            return (
              <tr key={date} className="border-t border-[color:var(--app-border)]">
                <th scope="row" className="p-2 font-normal">
                  {displayDate(date)}
                  {outside && <span className="block text-xs text-[color:var(--app-muted)]">Fora do vínculo</span>}
                </th>
                <td className="p-2">
                  <select
                    aria-label={`Situação real em ${displayDate(date)}`}
                    className={controlClass}
                    value={entry?.kind ?? ""}
                    disabled={outside && !entry}
                    onChange={(event) => {
                      const kind = event.target.value as EscalaAssignment["kind"] | "";
                      if (!kind) {
                        onChange(entries.filter((item) => item.date !== date));
                        return;
                      }
                      onChange(
                        replaceAssignment(entries, {
                          employeeId: employee.id,
                          date,
                          kind,
                          ...(kind === "WORK" ? { shiftId: employee.shiftIds[0] ?? "" } : {}),
                        }),
                      );
                    }}
                  >
                    <option value="">{outside ? "Sem vínculo" : "Não informado"}</option>
                    <option value="WORK">Trabalho</option>
                    <option value="OFF">Folga</option>
                    <option value="ABSENCE">Ausência</option>
                  </select>
                </td>
                <td className="p-2">
                  {entry?.kind === "WORK" ? (
                    <select
                      aria-label={`Turno real em ${displayDate(date)}`}
                      required
                      className={controlClass}
                      value={entry.shiftId ?? ""}
                      onChange={(event) =>
                        onChange(
                          replaceAssignment(entries, {
                            ...entry,
                            shiftId: event.target.value,
                          }),
                        )
                      }
                    >
                      <option value="">Selecione o turno</option>
                      {input.shifts.map((shift) => (
                        <option key={shift.id} value={shift.id}>
                          {shift.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[color:var(--app-muted)]">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmployeeEditor({
  employee,
  input,
  onSave,
  onCancel,
}: {
  employee: EscalaEmployee;
  input: EscalaInput;
  onSave: (employee: EscalaEmployee) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(employee);
  const [history, setHistory] = useState(employee.history);
  const [error, setError] = useState("");
  function change<K extends keyof EscalaEmployee>(field: K, value: EscalaEmployee[K]) {
    setDraft((previous) => ({ ...previous, [field]: value }));
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (
        !draft.name.trim() ||
        !draft.registration.trim() ||
        !draft.sector.trim() ||
        !draft.role.trim() ||
        !draft.activeFrom ||
        !draft.shiftIds.length
      )
        throw new Error("Preencha matrícula, nome, setor, cargo, admissão e ao menos um turno autorizado.");
      if (input.employees.some((item) => item.id !== draft.id && item.registration === draft.registration.trim()))
        throw new Error("Essa matrícula já está cadastrada nesta filial.");
      const expected = draft.offMode === "FIXED" ? 2 : draft.offMode === "MIXED" ? 1 : 0;
      if (draft.fixedOffDays.length !== expected) throw new Error(`Esta modalidade exige ${expected} dia(s) fixo(s).`);
      onSave({
        ...draft,
        name: draft.name.trim(),
        registration: draft.registration.trim(),
        sector: draft.sector.trim(),
        role: draft.role.trim(),
        history,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Confira o cadastro.");
    }
  }
  return (
    <form onSubmit={submit} className={`${panelClass} border-[color:var(--app-teal)]`}>
      <h3 className="font-semibold">
        {input.employees.some((item) => item.id === employee.id) ? "Editar colaborador" : "Novo colaborador"}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Matrícula">
          {(id) => (
            <input
              id={id}
              required
              maxLength={50}
              value={draft.registration}
              onChange={(event) => change("registration", event.target.value)}
              className={controlClass}
            />
          )}
        </Field>
        <Field label="Nome completo">
          {(id) => (
            <input
              id={id}
              required
              maxLength={160}
              value={draft.name}
              onChange={(event) => change("name", event.target.value)}
              className={controlClass}
            />
          )}
        </Field>
        <Field label="Carga semanal">
          {(id) => (
            <select
              id={id}
              value={draft.weeklyHours}
              onChange={(event) => change("weeklyHours", Number(event.target.value) as WeeklyHours)}
              className={controlClass}
            >
              {HOURS.map((hours) => (
                <option key={hours} value={hours}>
                  {hours} horas
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Setor">
          {(id) => (
            <input
              id={id}
              required
              maxLength={100}
              value={draft.sector}
              onChange={(event) => change("sector", event.target.value)}
              className={controlClass}
            />
          )}
        </Field>
        <Field label="Cargo">
          {(id) => (
            <input
              id={id}
              required
              maxLength={100}
              value={draft.role}
              onChange={(event) => change("role", event.target.value)}
              className={controlClass}
            />
          )}
        </Field>
        <Field
          label="Data real de admissão"
          hint="Não use o início da proposta para substituir uma admissão desconhecida."
        >
          {(id) => (
            <input
              id={id}
              required
              type="date"
              value={draft.activeFrom}
              onChange={(event) => change("activeFrom", event.target.value)}
              className={controlClass}
            />
          )}
        </Field>
        <Field label="Fim do vínculo, se aplicável">
          {(id) => (
            <input
              id={id}
              type="date"
              min={draft.activeFrom}
              value={draft.activeUntil ?? ""}
              onChange={(event) => change("activeUntil", event.target.value || undefined)}
              className={controlClass}
            />
          )}
        </Field>
        <Field label="Distribuição das folgas">
          {(id) => (
            <select
              id={id}
              value={draft.offMode}
              onChange={(event) => {
                change("offMode", event.target.value as EscalaEmployee["offMode"]);
                change("fixedOffDays", []);
              }}
              className={controlClass}
            >
              <option value="VARIABLE">Duas variáveis</option>
              <option value="MIXED">Uma fixa e uma variável</option>
              <option value="FIXED">Duas fixas aprovadas</option>
            </select>
          )}
        </Field>
        <Field label="Organização das folgas">
          {(id) => (
            <select
              id={id}
              value={draft.offPattern}
              onChange={(event) => change("offPattern", event.target.value as EscalaEmployee["offPattern"])}
              className={controlClass}
            >
              <option value="ANY">Separadas ou consecutivas</option>
              <option value="PREFER_CONSECUTIVE">Preferir consecutivas</option>
              <option value="CONSECUTIVE">Consecutivas obrigatórias</option>
            </select>
          )}
        </Field>
        <Field label="Máximo de domingos seguidos" hint="Defina pelo enquadramento do colaborador; nunca pelo nome.">
          {(id) => (
            <select
              id={id}
              value={draft.maxConsecutiveSundays}
              onChange={(event) => change("maxConsecutiveSundays", Number(event.target.value) as 1 | 2)}
              className={controlClass}
            >
              <option value={1}>1 domingo</option>
              <option value={2}>2 domingos</option>
            </select>
          )}
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold">Turnos autorizados</legend>
        <div className="flex flex-wrap gap-x-5">
          {input.shifts.map((shift) => (
            <Check
              key={shift.id}
              label={`${shift.name} (${shift.id})`}
              checked={draft.shiftIds.includes(shift.id)}
              onChange={(checked) =>
                change(
                  "shiftIds",
                  checked ? [...draft.shiftIds, shift.id] : draft.shiftIds.filter((value) => value !== shift.id),
                )
              }
            />
          ))}
        </div>
      </fieldset>
      {draft.offMode !== "VARIABLE" && (
        <DayChoices
          label="Dias fixos aprovados"
          values={draft.fixedOffDays}
          change={(values) => change("fixedOffDays", values)}
        />
      )}
      <DayChoices
        label="Preferências de folga (não são bloqueios)"
        values={draft.preferredOffDays}
        change={(values) => change("preferredOffDays", values)}
      />
      <details className="space-y-3 border-t border-[color:var(--app-border)] pt-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
          Histórico anterior e continuidade
        </summary>
        <p className="text-sm text-[color:var(--app-muted)]">
          Informe os 21 dias anteriores a {displayDate(input.startDate)}, ou os dias desde a admissão real quando ela
          for recente. Não preencha folgas por suposição.
        </p>
        <HistoryEditor employee={draft} input={input} entries={history} onChange={setHistory} />
        <Check
          label="Conferi o histórico com os registros reais do colaborador"
          checked={draft.historyKnown}
          onChange={(value) => change("historyKnown", value)}
        />
      </details>
      {error && (
        <p role="alert" className="text-sm text-[color:var(--app-coral)]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button className={primaryClass} type="submit">
          Aplicar cadastro à proposta
        </button>
        <button className={buttonClass} type="button" onClick={onCancel}>
          Cancelar edição
        </button>
      </div>
    </form>
  );
}

export function Employees({
  input,
  disabled,
  onChange,
}: {
  input: EscalaInput;
  disabled: boolean;
  onChange: (input: EscalaInput) => void;
}) {
  const [editing, setEditing] = useState<EscalaEmployee | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const employees = sortEmployees(input.employees).filter((employee) =>
    `${employee.name} ${employee.registration} ${employee.sector} ${employee.role}`
      .toLocaleLowerCase("pt-BR")
      .includes(search.toLocaleLowerCase("pt-BR")),
  );
  return (
    <section className={panelClass} aria-labelledby="escala-employees-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="escala-employees-title" className="text-lg font-bold">
          1. Equipe da filial
        </h2>
        <button
          type="button"
          className={buttonClass}
          disabled={disabled || input.employees.length >= 150}
          onClick={() => setEditing(newEmployee(input.defaultWeeklyHours, input.shifts[0]?.id))}
        >
          Adicionar colaborador
        </button>
      </div>
      <p className="text-sm text-[color:var(--app-muted)]">
        Cadastros e alterações ficam na proposta até salvar a revisão. Setor e cargo são informações distintas.
      </p>
      <Field label="Localizar colaborador, matrícula, setor ou cargo">
        {(id) => (
          <input
            id={id}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={controlClass}
          />
        )}
      </Field>
      {!input.employees.length && (
        <p className="text-sm">Nenhum colaborador cadastrado. Adicione a equipe ou importe o modelo abaixo.</p>
      )}
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {employees.map((employee) => (
          <div
            key={employee.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--app-border)] py-2"
          >
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold">
                {employee.name} · {employee.registration}
              </p>
              <p className="text-xs text-[color:var(--app-muted)]">
                {employee.sector} / {employee.role} · {employee.weeklyHours}h
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass} disabled={disabled} onClick={() => setEditing(employee)}>
                Editar<span className="sr-only"> {employee.name}</span>
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={
                  disabled ||
                  input.assignments.some((assignment) => assignment.employeeId === employee.id && assignment.locked)
                }
                onClick={() => setRemoving(employee.id)}
              >
                Remover
                <span className="sr-only"> {employee.name} da proposta</span>
              </button>
            </div>
            {removing === employee.id && (
              <div className="w-full space-y-2 p-2 text-sm" role="alert">
                <p>Remover {employee.name} e suas atribuições desta proposta? Revisões já salvas serão preservadas.</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={disabled}
                    onClick={() => {
                      onChange({
                        ...input,
                        employees: input.employees.filter((item) => item.id !== employee.id),
                        assignments: input.assignments.filter((assignment) => assignment.employeeId !== employee.id),
                      });
                      if (editing?.id === employee.id) setEditing(null);
                      setRemoving(null);
                    }}
                  >
                    Confirmar remoção da proposta
                  </button>
                  <button type="button" className={buttonClass} onClick={() => setRemoving(null)}>
                    Manter colaborador
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <fieldset disabled={disabled}>
          <EmployeeEditor
            key={editing.id}
            employee={editing}
            input={input}
            onCancel={() => setEditing(null)}
            onSave={(employee) => {
              onChange({
                ...input,
                employees: [...input.employees.filter((item) => item.id !== employee.id), employee],
              });
              setEditing(null);
            }}
          />
        </fieldset>
      )}
    </section>
  );
}
