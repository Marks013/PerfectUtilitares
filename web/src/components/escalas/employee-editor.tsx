"use client";

import { isAdministrativeEscalaSector } from "@/lib/escalas/eligibility";
import styles from "./escalas.module.css";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, WeeklyHours } from "@/lib/escalas/types";
import { hasEmployeeDraftChanges } from "./employee-draft";
import { validateEmployeeForm } from "./employee-form";
import { canDisplayEscalaAction, useEscalaClientAccess } from "./access-context";
import { FixedRestFields } from "./fixed-rest-fields";
import { LeadershipFields } from "./leadership-fields";
import { buttonClass, Check, controlClass, Field, panelClass, primaryClass } from "./controls";
import { addDate, displayDate, HOURS, replaceAssignment, WEEKDAYS } from "./workspace-model";

function DayChoices({ values, change, label }: { values: number[]; change: (days: number[]) => void; label: string }) {
  const hint = useId();
  return (
    <fieldset className="min-w-0" aria-describedby={hint}>
      <legend className="text-sm font-semibold">{label}</legend>
      <p id={hint} className={styles.fieldHint}>Marque os dias preferidos para as próximas escalas. Para mudar uma folga já marcada, abra a grade.</p>
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
                    {(employee.scheduleMode === "UNTIMED" || employee.scheduleMode === "MISSING")
                      ? <option value="DUTY">Trabalho sem horário fixo</option>
                      : <option value="WORK">Trabalho</option>}
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

export function EmployeeEditor({
  employee,
  input,
  managedTeam = false,
  onSave,
  onCancel,
  onDirtyChange,
}: {
  employee: EscalaEmployee;
  input: EscalaInput;
  managedTeam?: boolean;
  onSave: (employee: EscalaEmployee) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const access = useEscalaClientAccess();
  const administrative = canDisplayEscalaAction(access, "settings.manage", input.branchCode);
  const canManage = canDisplayEscalaAction(access, "employee.manage", input.branchCode)
    && canDisplayEscalaAction(access, "workspace.save", input.branchCode);
  const existing = input.employees.find((item) => item.id === employee.id);
  const [draft, setDraft] = useState(employee);
  const [history, setHistory] = useState(employee.history);
  const baseline = useRef(employee);
  const dirty = hasEmployeeDraftChanges(baseline.current, draft, history);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
  const [error, setError] = useState("");
  function change<K extends keyof EscalaEmployee>(field: K, value: EscalaEmployee[K]) {
    setDraft((previous) => ({ ...previous, ...(field === "weeklyHours" ? { weeklyHoursMode: "INDIVIDUAL" as const } : {}), [field]: value }));
  }
  const [attempt, setAttempt] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const checked = useMemo(() => validateEmployeeForm({ ...draft, history }, input.employees), [draft, history, input.employees]);
  const fieldErrors = attempt ? checked.errors : {};
  useEffect(() => {
    if (attempt) form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [attempt]);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setAttempt(previous => previous + 1);
    if (!canManage || !administrative || !checked.employee) return;
    try { onSave(checked.employee); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Confira o cadastro."); }
  }
  if (!canManage) return null;
  if (!administrative) {
    if (!existing) return null;
    const canEditRests = input.generationMode !== "HOURS_ONLY";
    return (
      <form id="escala-employee-editor" tabIndex={-1} aria-labelledby="escala-employee-editor-title"
        className={panelClass} onSubmit={(event) => {
          event.preventDefault();
          const name = draft.name.trim();
          if (!name) { setError("Informe o nome do colaborador."); return; }
          setError("");
          try {
            onSave({
              ...existing,
              name,
              ...(canEditRests ? {
                preferredOffDays: draft.preferredOffDays,
                offMode: draft.offMode,
                fixedOffDays: draft.fixedOffDays,
                fixedRestSlots: draft.fixedRestSlots,
              } : {}),
            });
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Não foi possível aplicar o cadastro. Confira os dados e tente novamente.");
          }
        }}>
        <h3 id="escala-employee-editor-title" className="font-semibold">Editar colaborador</h3>
        <p className={styles.muted}>Matrícula {existing.registration} · {existing.sector} · {existing.role}</p>
        {!managedTeam && <Field label="Nome completo">
          {(id, accessibility) => <input id={id} {...accessibility} className={controlClass} required maxLength={160}
            value={draft.name} onChange={(event) => change("name", event.target.value)} />}
        </Field>}
        <FixedRestFields employee={draft} input={input} onChange={setDraft} />
        {canEditRests && <DayChoices label="Dias de folga preferidos (não obrigatórios)"
          values={draft.preferredOffDays} change={(days) => change("preferredOffDays", days)} />}
        {error && <p role="alert" className={styles.errorText}>{error}</p>}
        <div className={styles.actions}>
          <button type="submit" className={primaryClass}>Aplicar cadastro à proposta</button>
          <button type="button" className={buttonClass} onClick={onCancel}>Cancelar edição</button>
        </div>
      </form>
    );
  }
  return (
    <form ref={form} noValidate id="escala-employee-editor" tabIndex={-1} aria-labelledby="escala-employee-editor-title" onSubmit={submit} className={`${panelClass} border-[color:var(--app-teal)] focus:outline-2 focus:outline-[color:var(--app-action-blue)]`}>
      <h3 id="escala-employee-editor-title" className="font-semibold">
        {input.employees.some((item) => item.id === employee.id) ? "Editar colaborador" : "Novo colaborador"}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Matrícula" error={fieldErrors.registration}>
          {(id, accessibility) => (
            <input
              id={id} {...accessibility}
              required
              maxLength={50}
              readOnly={managedTeam}
              value={draft.registration}
              onChange={(event) => change("registration", event.target.value)}
              className={controlClass}
            />
          )}
        </Field>
        <Field label="Nome completo" error={fieldErrors.name}>
          {(id, accessibility) => (
            <input
              id={id} {...accessibility}
              required
              maxLength={160}
              readOnly={managedTeam}
              value={draft.name}
              onChange={(event) => change("name", event.target.value)}
              className={controlClass}
            />
          )}
        </Field>
        <Field
          label="Carga semanal de referência"
          hint="O cálculo respeita o teto legal vigente em cada semana; uma carga menor é preservada."
        >
          {(id, accessibility) => (
            <select
              id={id} {...accessibility}
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
        <Field label="Setor" error={fieldErrors.sector}>
          {(id, accessibility) => (
            <input
              id={id} {...accessibility}
              required
              maxLength={100}
              value={draft.sector}
              readOnly={managedTeam}
              onChange={(event) => change("sector", event.target.value)}
              className={controlClass}
            />
          )}
        </Field>
        <Field label="Cargo" error={fieldErrors.role}>
          {(id, accessibility) => (
            <input
              id={id} {...accessibility}
              required
              maxLength={100}
              value={draft.role}
              readOnly={managedTeam}
              onChange={(event) => change("role", event.target.value)}
              className={controlClass}
            />
          )}
        </Field>
        <Field
          label="Data real de admissão (opcional)"
          error={fieldErrors.activeFrom}
          hint="Deixe em branco quando desconhecida. Não substitua pelo início da proposta."
        >
          {(id, accessibility) => (
            <input
              id={id} {...accessibility}
              type="date"
              max="2099-12-31"
              min="1900-01-01"
              value={draft.activeFrom}
              readOnly={managedTeam}
              onChange={(event) => change("activeFrom", event.target.value)}
              className={controlClass}
            />
          )}
        </Field>
        <Field label="Fim do vínculo, se aplicável" error={fieldErrors.activeUntil}>
          {(id, accessibility) => (
            <input
              id={id} {...accessibility}
              type="date"
              max="2099-12-31"
              min={draft.activeFrom || "1900-01-01"}
              value={draft.activeUntil ?? ""}
              readOnly={managedTeam}
              onChange={(event) => change("activeUntil", event.target.value || undefined)}
              className={controlClass}
            />
          )}
        </Field>
        {input.generationMode === "HOURS_ONLY" && <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Consultar regras dos dias já registrados</summary>
          <p className="text-sm text-[color:var(--app-muted)]">Neste modo, os dias já registrados são preservados. A organização das folgas não será recalculada.</p>
          <p className="text-sm">Organização registrada: {draft.offMode === "VARIABLE" ? "variável" : draft.offMode === "MIXED" ? "uma folga fixa" : "duas folgas fixas"}. Dias fixos: {draft.fixedOffDays.map(day => ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][day]).join(", ") || "nenhum"}. Limite de domingos seguidos: {draft.maxConsecutiveSundays}.</p>
        </details>}
        {input.generationMode !== "HOURS_ONLY" && <>
        <FixedRestFields employee={draft} input={input} onChange={setDraft} />
        <Field label="Organização das folgas">
          {(id, accessibility) => (
            <select
              id={id} {...accessibility}
              value={draft.offPattern}
              onChange={(event) => change("offPattern", event.target.value as EscalaEmployee["offPattern"])}
              className={controlClass}
            >
              <option value="ANY">Priorizar folgas separadas (padrão)</option>
              <option value="PREFER_CONSECUTIVE">Preferir consecutivas</option>
              <option value="CONSECUTIVE">Consecutivas obrigatórias</option>
            </select>
          )}
        </Field>
        <Field
          label="Descanso aos domingos"
          hint="O padrão quinzenal protetivo vale para todos, sem identificar sexo pelo nome. Exceções são opcionais."
        >
          {(id, accessibility) => (
            <select
              id={id} {...accessibility}
              value={draft.sundayRestRule ?? "PROTECTIVE"}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  sundayRestRule: event.target.value as EscalaEmployee["sundayRestRule"],
                  maxConsecutiveSundays: event.target.value === "COMMERCE" ? 2 : 1,
                }))
              }
              className={controlClass}
            >
              <option value="PROTECTIVE">Quinzenal protetivo — todos</option>
              <option value="UNREVIEWED">Não conferido — limite protetivo</option>
              <option value="CLT_386">Mulheres — quinzenal (art. 386 da CLT)</option>
              <option value="COMMERCE">Regra geral do comércio — a cada 3 semanas</option>
            </select>
          )}
        </Field>
        <Field
          label="Máximo de domingos seguidos"
          hint="O padrão protetivo permite no máximo um domingo seguido. Dois exigem enquadramento específico conferido."
        >
          {(id, accessibility) => (
            <select
              id={id} {...accessibility}
              value={draft.sundayRestRule === "COMMERCE" ? draft.maxConsecutiveSundays : 1}
              onChange={(event) => change("maxConsecutiveSundays", Number(event.target.value) as 1 | 2)}
              className={controlClass}
            >
              <option value={1}>1 domingo</option>
              {draft.sundayRestRule === "COMMERCE" && <option value={2}>2 domingos</option>}
            </select>
          )}
        </Field>
        </>}
      </div>
      <Field label="Horário de trabalho" hint={input.generationMode === "HOURS_ONLY" ? "Informe uma referência real para propor horários. Sem horário fixo, nenhuma jornada fictícia é atribuída." : "Sem horário fixo, o sistema planeja as folgas, mas não conta essa pessoa por hora."}>
        {(id, accessibility) => <select id={id} {...accessibility} value={draft.scheduleMode ?? "TIMED"} className={controlClass}
          onChange={(event) => setDraft((previous) => ({
            ...previous,
            scheduleMode: event.target.value as EscalaEmployee["scheduleMode"],
            ...(event.target.value !== "TIMED" ? { shiftIds: [] } : {}),
          }))}>
          <option value="TIMED">Com horário informado</option>
          <option value="MISSING">{input.generationMode === "HOURS_ONLY" ? "Horário não informado (não atribuir referência fictícia)" : "Horário não informado (simular presença e folgas)"}</option>
          <option value="UNTIMED">Sem horário fixo · enquadramento conferido</option>
        </select>}
      </Field>
      {draft.scheduleMode === "MISSING" && <p className="text-sm">{input.generationMode === "HOURS_ONLY" ? "Nenhuma referência fictícia será atribuída." : "Essa pessoa participa das folgas."} Se o arquivo trouxe horários zerados, eles ficam identificados como sem horário fixo (ENC). Acrescente um horário somente se houver uma referência real.</p>}
      {draft.scheduleMode === "UNTIMED" && <p className="text-sm">
        {input.generationMode === "HOURS_ONLY" ? "Os dias já registrados são mantidos; sem grade, não são criadas presenças ou folgas." : "Incluído no rodízio 5×2 e descanso quinzenal protetivo, com no máximo cinco dias seguidos de trabalho."}
        Os dias de trabalho não recebem turno nem horas fictícias. A carga semanal é apenas uma referência cadastral.
      </p>}
      {isAdministrativeEscalaSector(draft.sector) ? <p className={styles.muted}>Setor administrativo: o cadastro fica salvo, mas não entra na escala nem na cobertura.</p> : <Check
        label="Incluir colaborador no planejamento desta proposta"
        checked={draft.planningEnabled !== false}
        onChange={(checked) => setDraft((previous) => ({ ...previous, planningEnabled: checked, planningExclusionReason: checked ? undefined : "Não incluído manualmente nesta proposta." }))}
      />}
      {draft.planningEnabled === false && <Field label="Motivo da não inclusão" hint="Explique a decisão ou a informação que precisa ser corrigida. O cadastro permanece na equipe.">{(id, accessibility) => <input id={id} {...accessibility} maxLength={240} value={draft.planningExclusionReason ?? ""} onChange={(event) => change("planningExclusionReason", event.target.value)} className={controlClass} />}</Field>}
      {draft.scheduleMode !== "UNTIMED" && draft.scheduleMode !== "MISSING" && <fieldset>
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
      </fieldset>}
      {input.generationMode !== "HOURS_ONLY" && <DayChoices
        label="Preferências de folga (não são bloqueios)"
        values={draft.preferredOffDays}
        change={(values) => change("preferredOffDays", values)}
      />}
      <LeadershipFields employee={draft} input={input} onChange={value => change("leadership", value)} />
      <details className="space-y-3 border-t border-[color:var(--app-border)] pt-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
          Histórico anterior e continuidade (avançado, opcional)
        </summary>
        <p className="text-sm text-[color:var(--app-muted)]">
          Informe os 21 dias anteriores a {displayDate(input.startDate)}, ou os dias desde a admissão real quando ela
          for recente. Não preencha folgas por suposição. Sem histórico, a continuidade anterior fica não verificada;
          isso não impede a proposta interna nem certifica sua conformidade legal completa.
        </p>
        <HistoryEditor employee={draft} input={input} entries={history} onChange={setHistory} />
        <Check
          label="Conferi o histórico com os registros reais do colaborador"
          checked={draft.historyKnown}
          onChange={(value) => change("historyKnown", value)}
        />
      </details>
      {(error || (attempt > 0 && !checked.employee)) && (
        <div role="alert" tabIndex={-1} className="text-sm text-[color:var(--app-coral)]">
          <p>{error || "Confira os campos indicados. O cadastro ainda não foi aplicado."}</p>
          {Object.entries(fieldErrors).filter(([field]) => !["registration", "name", "sector", "role", "activeFrom", "activeUntil"].includes(field))
            .map(([field, message]) => <p key={field}>{message}</p>)}
        </div>
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

