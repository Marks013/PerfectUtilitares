"use client";

import { useState } from "react";
import type { EscalaInput, EscalaPolicy, EscalaShift, WeeklyHours } from "@/lib/escalas/types";
import { buttonClass, Check, controlClass, Field, panelClass, primaryClass } from "./controls";
import { clock, HOURS, parseClock } from "./workspace-model";

function DateList({ label, value, onChange }: { label: string; value: string[]; onChange: (dates: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <Field label={label} hint="Datas AAAA-MM-DD separadas por vírgula. Aplicadas ao sair do campo.">
      {(id) => (
        <input
          id={id}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() =>
            onChange([
              ...new Set(
                text
                  .split(",")
                  .map((date) => date.trim())
                  .filter(Boolean),
              ),
            ])
          }
          className={controlClass}
        />
      )}
    </Field>
  );
}

export function Rules({
  input,
  disabled,
  onChange,
}: {
  input: EscalaInput;
  disabled: boolean;
  onChange: (input: EscalaInput) => void;
}) {
  function change<K extends keyof EscalaPolicy>(field: K, value: EscalaPolicy[K]) {
    onChange({ ...input, policy: { ...input.policy, [field]: value } });
  }
  return (
    <section className={panelClass} aria-labelledby="escala-rules-title">
      <h2 id="escala-rules-title" className="text-lg font-bold">
        2. Regras e vigências
      </h2>
      <p className="text-sm text-[color:var(--app-muted)]">
        O cadastro não certifica a vigência da convenção. Fonte, enquadramento e revisão precisam ser conferidos pelo
        responsável antes da publicação.
      </p>
      <fieldset disabled={disabled} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Carga padrão para novos colaboradores"
            hint="Alterar o padrão não modifica os contratos já cadastrados."
          >
            {(id) => (
              <select
                id={id}
                value={input.defaultWeeklyHours}
                onChange={(event) =>
                  onChange({
                    ...input,
                    defaultWeeklyHours: Number(event.target.value) as WeeklyHours,
                  })
                }
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
          <Field label="Limite semanal da norma aplicável">
            {(id) => (
              <select
                id={id}
                value={input.policy.weeklyLimit}
                onChange={(event) => change("weeklyLimit", Number(event.target.value) as WeeklyHours)}
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
          <Field
            label="Limite diário, em minutos"
            hint="504 = 8h24; 528 = 8h48. A distribuição exige autorização aplicável."
          >
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                max={600}
                step={1}
                value={input.policy.dailyLimitMinutes}
                onChange={(event) => change("dailyLimitMinutes", Number(event.target.value))}
                className={controlClass}
              />
            )}
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Fonte normativa e cláusulas aplicáveis">
              {(id) => (
                <input
                  id={id}
                  maxLength={1000}
                  value={input.policy.source}
                  onChange={(event) => change("source", event.target.value)}
                  className={controlClass}
                />
              )}
            </Field>
          </div>
          <Field label="Início da vigência">
            {(id) => (
              <input
                id={id}
                type="date"
                value={input.policy.validFrom}
                onChange={(event) => change("validFrom", event.target.value)}
                className={controlClass}
              />
            )}
          </Field>
          <Field label="Fim da vigência">
            {(id) => (
              <input
                id={id}
                type="date"
                value={input.policy.validUntil}
                onChange={(event) => change("validUntil", event.target.value)}
                className={controlClass}
              />
            )}
          </Field>
          <Field label="Responsável pela revisão">
            {(id) => (
              <input
                id={id}
                maxLength={160}
                value={input.policy.reviewedBy}
                onChange={(event) => change("reviewedBy", event.target.value)}
                className={controlClass}
              />
            )}
          </Field>
        </div>
        <Check
          label="Distribuição diária e compensação acima de oito horas autorizadas no regime aplicável"
          checked={input.policy.compensationAuthorized}
          onChange={(value) => change("compensationAuthorized", value)}
        />
        <Check
          label="Conferi a fonte, a categoria, o município e a vigência para todo o período"
          checked={input.policy.reviewed}
          onChange={(value) => change("reviewed", value)}
        />
        <details className="space-y-4 border-t border-[color:var(--app-border)] pt-3">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">
            Descansos, feriados e parâmetros avançados
          </summary>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Interjornada mínima (minutos)">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={660}
                  max={1440}
                  value={input.policy.minInterShiftMinutes}
                  onChange={(event) => change("minInterShiftMinutes", Number(event.target.value))}
                  className={controlClass}
                />
              )}
            </Field>
            <Field label="Descanso semanal com interjornada (minutos)">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={2100}
                  max={4320}
                  value={input.policy.minWeeklyRestMinutes}
                  onChange={(event) => change("minWeeklyRestMinutes", Number(event.target.value))}
                  className={controlClass}
                />
              )}
            </Field>
            <Field label="Intervalo de refeição mínimo (minutos)">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={30}
                  max={180}
                  value={input.policy.minMealMinutes}
                  onChange={(event) => change("minMealMinutes", Number(event.target.value))}
                  className={controlClass}
                />
              )}
            </Field>
            <Field label="Máximo de dias de trabalho consecutivos" hint="O sétimo dia consecutivo nunca é permitido.">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={6}
                  value={input.policy.maxConsecutiveWorkDays}
                  onChange={(event) => change("maxConsecutiveWorkDays", Number(event.target.value))}
                  className={controlClass}
                />
              )}
            </Field>
          </div>
          <DateList
            label="Datas de fechamento obrigatório"
            value={input.policy.closedDates}
            onChange={(value) => change("closedDates", value)}
          />
          <DateList
            label="Feriados do período"
            value={input.policy.holidayDates}
            onChange={(value) => change("holidayDates", value)}
          />
          <DateList
            label="Feriados com trabalho expressamente autorizado"
            value={input.policy.authorizedHolidayDates}
            onChange={(value) => change("authorizedHolidayDates", value)}
          />
          <Check
            label="Norma aplicável permite considerar o feriado como folga de rodízio"
            checked={input.policy.holidayRestAllowed}
            onChange={(value) => change("holidayRestAllowed", value)}
          />
          <p className="text-sm text-[color:var(--app-muted)]">
            Turnos noturnos podem ser preparados em rascunho. A publicação permanece pendente enquanto o cômputo
            específico da hora noturna não estiver implantado e conferido.
          </p>
        </details>
      </fieldset>
    </section>
  );
}

type SegmentDraft = {
  key: string;
  start: string;
  end: string;
  kind: EscalaShift["segments"][number]["kind"];
};

function ShiftEditor({
  shift,
  onSave,
  onCancel,
}: {
  shift: EscalaShift;
  onSave: (shift: EscalaShift) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(shift.name);
  const [segments, setSegments] = useState<SegmentDraft[]>(
    shift.segments.map((segment) => ({
      ...segment,
      key: `${shift.id}-${segment.start}-${segment.end}`,
      start: clock(segment.start),
      end: clock(segment.end),
    })),
  );
  const [error, setError] = useState("");
  function change(index: number, patch: Partial<SegmentDraft>) {
    setSegments((previous) =>
      previous.map((segment, position) => (position === index ? { ...segment, ...patch } : segment)),
    );
  }
  return (
    <form
      className="space-y-4 border-t border-[color:var(--app-border)] pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          if (!name.trim()) throw new Error("Informe o nome do turno.");
          const parsed = segments.map((segment) => ({
            start: parseClock(segment.start),
            end: parseClock(segment.end),
            kind: segment.kind,
          }));
          if (!parsed.length || !parsed.some((segment) => segment.kind === "WORK"))
            throw new Error("Informe ao menos um período de trabalho.");
          if (
            parsed.some(
              (segment, index) => segment.end <= segment.start || (index > 0 && segment.start < parsed[index - 1].end),
            )
          )
            throw new Error("Os períodos devem estar em ordem, sem sobreposição e com fim posterior ao início.");
          onSave({ ...shift, name: name.trim(), segments: parsed });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Confira os horários.");
        }
      }}
    >
      <Field label="Nome do turno">
        {(id) => (
          <input
            id={id}
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={controlClass}
          />
        )}
      </Field>
      <p className="text-sm text-[color:var(--app-muted)]">
        Use HH:MM. Após a meia-noite, continue a contagem: 25:00 significa 01:00 do dia seguinte. Refeições e pausas não
        cobrem atendimento.
      </p>
      {segments.map((segment, index) => (
        <div key={segment.key} className="grid items-end gap-3 sm:grid-cols-4">
          <Field label={`Período ${index + 1}`}>
            {(id) => (
              <select
                id={id}
                value={segment.kind}
                onChange={(event) =>
                  change(index, {
                    kind: event.target.value as SegmentDraft["kind"],
                  })
                }
                className={controlClass}
              >
                <option value="WORK">Trabalho</option>
                <option value="BREAK">Intervalo não remunerado</option>
                <option value="PAID_BREAK">Pausa remunerada</option>
              </select>
            )}
          </Field>
          <Field label={`Início ${index + 1}`}>
            {(id) => (
              <input
                id={id}
                required
                inputMode="numeric"
                maxLength={5}
                value={segment.start}
                onChange={(event) => change(index, { start: event.target.value })}
                className={controlClass}
              />
            )}
          </Field>
          <Field label={`Fim ${index + 1}`}>
            {(id) => (
              <input
                id={id}
                required
                inputMode="numeric"
                maxLength={5}
                value={segment.end}
                onChange={(event) => change(index, { end: event.target.value })}
                className={controlClass}
              />
            )}
          </Field>
          <button
            type="button"
            className={buttonClass}
            onClick={() => setSegments((previous) => previous.filter((_, position) => position !== index))}
          >
            Remover período {index + 1}
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-[color:var(--app-coral)]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={buttonClass}
          disabled={segments.length >= 12}
          onClick={() =>
            setSegments((previous) => [...previous, { key: crypto.randomUUID(), start: "", end: "", kind: "WORK" }])
          }
        >
          Adicionar período
        </button>
        <button type="submit" className={primaryClass}>
          Aplicar turno
        </button>
        <button type="button" className={buttonClass} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function Shifts({
  input,
  disabled,
  onChange,
}: {
  input: EscalaInput;
  disabled: boolean;
  onChange: (input: EscalaInput) => void;
}) {
  const [editing, setEditing] = useState<EscalaShift | null>(null);
  return (
    <section className={panelClass} aria-labelledby="escala-shifts-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="escala-shifts-title" className="text-lg font-bold">
          Horários autorizados
        </h2>
        <button
          type="button"
          className={buttonClass}
          disabled={disabled}
          onClick={() =>
            setEditing({
              id: crypto.randomUUID(),
              name: "",
              segments: [
                { start: 480, end: 720, kind: "WORK" },
                { start: 720, end: 780, kind: "BREAK" },
                { start: 780, end: 1044, kind: "WORK" },
              ],
            })
          }
        >
          Adicionar turno
        </button>
      </div>
      <p className="text-sm text-[color:var(--app-muted)]">
        40h em cinco dias = 8h00; 42h = 8h24; 44h = 8h48. Cadastre as distribuições realmente autorizadas.
      </p>
      <div className="space-y-3">
        {input.shifts.map((shift) => (
          <div
            key={shift.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--app-border)] pb-3"
          >
            <div className="min-w-0">
              <p className="font-semibold">
                {shift.name} ·{" "}
                {clock(
                  shift.segments
                    .filter((segment) => segment.kind !== "BREAK")
                    .reduce((sum, segment) => sum + segment.end - segment.start, 0),
                )}{" "}
                computadas
              </p>
              <p className="break-words text-xs text-[color:var(--app-muted)]">
                {shift.segments
                  .map(
                    (segment) =>
                      `${clock(segment.start)}–${clock(segment.end)} ${segment.kind === "WORK" ? "trabalho" : segment.kind === "BREAK" ? "intervalo" : "pausa remunerada"}`,
                  )
                  .join(" · ")}
              </p>
            </div>
            <button type="button" className={buttonClass} disabled={disabled} onClick={() => setEditing(shift)}>
              Editar<span className="sr-only"> {shift.name}</span>
            </button>
          </div>
        ))}
      </div>
      {editing && (
        <fieldset disabled={disabled}>
          <ShiftEditor
            key={editing.id}
            shift={editing}
            onCancel={() => setEditing(null)}
            onSave={(shift) => {
              onChange({
                ...input,
                shifts: [...input.shifts.filter((item) => item.id !== shift.id), shift],
              });
              setEditing(null);
            }}
          />
        </fieldset>
      )}
    </section>
  );
}
