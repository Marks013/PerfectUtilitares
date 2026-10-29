"use client";

import { useState } from "react";
import styles from "./escalas.module.css";
import type { EscalaInput, EscalaPolicy, EscalaShift, WeeklyHours } from "@/lib/escalas/types";
import { buttonClass, Check, controlClass, Field, panelClass, primaryClass } from "./controls";
import { clock, HOURS, parseClock } from "./workspace-model";
import { LaborPolicyFields, ShortMealSimulation } from "./labor-policy-fields";
import { ShiftSummary } from "./shift-summary";

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

export function Rules({ input, disabled, onChange }: { input: EscalaInput; disabled: boolean; onChange: (input: EscalaInput) => void }) {
  function change<K extends keyof EscalaPolicy>(field: K, value: EscalaPolicy[K]) {
    onChange({ ...input, policy: { ...input.policy, reviewed: false, [field]: value } });
  }
  return <section className={panelClass} aria-labelledby="escala-rules-title">
    <div><h2 id="escala-rules-title" className={styles.sectionTitle}>Premissas da simulação</h2><p className={styles.subtitle}>O algoritmo aplica os descansos e preserva as restrições informadas. Nada aqui precisa ser preenchido para gerar um rascunho.</p></div>
    <dl className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
      <div><dt className="text-[color:var(--app-muted)]">Regime</dt><dd className="font-semibold">5 dias + 2 folgas</dd></div>
      <div><dt className="text-[color:var(--app-muted)]">Jornada escolhida</dt><dd className="font-semibold">{input.defaultWeeklyHours}h · {clock(input.defaultWeeklyHours * 12)} por dia</dd></div>
      <div><dt className="text-[color:var(--app-muted)]">Entre jornadas</dt><dd className="font-semibold">{clock(input.policy.minInterShiftMinutes)} mínimas</dd></div>
      <div><dt className="text-[color:var(--app-muted)]">Sequência máxima</dt><dd className="font-semibold">{input.policy.maxConsecutiveWorkDays} dias</dd></div>
    </dl>
    {input.policy.maxConsecutiveWorkDays > 5 && <p className={styles.errorText}>Esta revisão usa um limite antigo de {input.policy.maxConsecutiveWorkDays} dias. O modelo 5×2 permite no máximo cinco dias consecutivos. Gere novamente para conferir a grade com esse limite.</p>}
    <fieldset disabled={disabled} className={styles.stackSmall}>
      <ShortMealSimulation input={input} onChange={onChange} />
      <details className="space-y-4 border-t border-[color:var(--app-border)] pt-2">
        <summary className={styles.disclosureTrigger}>Datas e limites específicos da operação</summary>
        <DateList label="Datas de fechamento obrigatório" value={input.policy.closedDates} onChange={(value) => change("closedDates", value)} />
        <DateList label="Feriados do período" value={input.policy.holidayDates} onChange={(value) => change("holidayDates", value)} />
        <div className={styles.formGrid}>
          {([
            ["minInterShiftMinutes", "Interjornada mínima (minutos)", 660, 1440],
            ["minWeeklyRestMinutes", "Descanso semanal com interjornada (minutos)", 2100, 4320],
            ["minMealMinutes", "Intervalo de refeição mínimo (minutos)", 30, 180],
            ["maxConsecutiveWorkDays", "Máximo de dias de trabalho consecutivos", 1, 5],
          ] as const).map(([field, label, minimum, maximum]) => <Field key={field} label={label}>{(id) => <input id={id} type="number" min={minimum} max={maximum} value={input.policy[field]} onChange={(event) => change(field, Number(event.target.value))} className={controlClass} />}</Field>)}
        </div>
      </details>
      <details className="space-y-4 border-t border-[color:var(--app-border)] pt-2">
        <summary className={styles.disclosureTrigger}>Revisão documental para publicação interna</summary>
        <p className={styles.muted}>Opcional para simular e exportar rascunhos. Registre somente informações reais já conferidas para a filial; uma proposta não comprova autorização.</p>
        <LaborPolicyFields input={input} onChange={onChange} />
        <Field label="Fonte normativa e cláusulas aplicáveis">{(id) => <input id={id} maxLength={1000} value={input.policy.source} onChange={(event) => change("source", event.target.value)} className={controlClass} />}</Field>
        <div className={styles.formGrid}>
          <Field label="Início da vigência">{(id) => <input id={id} type="date" value={input.policy.validFrom} onChange={(event) => change("validFrom", event.target.value)} className={controlClass} />}</Field>
          <Field label="Fim da vigência">{(id) => <input id={id} type="date" value={input.policy.validUntil} onChange={(event) => change("validUntil", event.target.value)} className={controlClass} />}</Field>
          <Field label="Responsável pela revisão">{(id) => <input id={id} maxLength={160} value={input.policy.reviewedBy} onChange={(event) => change("reviewedBy", event.target.value)} className={controlClass} />}</Field>
          <Field label="Limite semanal da norma aplicável" hint="Limite normativo, não a jornada selecionada para o cenário.">{(id) => <select id={id} value={input.policy.weeklyLimit} onChange={(event) => change("weeklyLimit", Number(event.target.value) as WeeklyHours)} className={controlClass}>{HOURS.map((hours) => <option key={hours} value={hours}>{hours} horas</option>)}</select>}</Field>
          <Field label="Limite diário, em minutos" hint="Um teto informado não constitui autorização de compensação.">{(id) => <input id={id} type="number" min={1} max={600} value={input.policy.dailyLimitMinutes} onChange={(event) => change("dailyLimitMinutes", Number(event.target.value))} className={controlClass} />}</Field>
        </div>
        <Check label="Distribuição diária e compensação acima de oito horas autorizadas no regime aplicável" checked={input.policy.compensationAuthorized} onChange={(value) => change("compensationAuthorized", value)} />
        <Check label="Conferi a fonte, a categoria, o município e a vigência para todo o período" checked={input.policy.reviewed} onChange={(value) => change("reviewed", value)} />
        <DateList label="Feriados com trabalho expressamente autorizado" value={input.policy.authorizedHolidayDates} onChange={(value) => change("authorizedHolidayDates", value)} />
        <Check label="Norma aplicável permite considerar o feriado como folga de rodízio" checked={input.policy.holidayRestAllowed} onChange={(value) => change("holidayRestAllowed", value)} />
        <p className={styles.muted}>Turnos noturnos participam do rascunho. O cômputo específico da hora noturna continua identificado como limitação de conferência.</p>
      </details>
    </fieldset>
  </section>;
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
      <p className={styles.muted}>
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
        <p role="alert" className={styles.errorText}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
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
        <h2 id="escala-shifts-title" className={styles.sectionTitle}>
          Turnos disponíveis para a proposta
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
                { start: 780, end: 780 + input.defaultWeeklyHours * 12 - 240, kind: "WORK" },
              ],
            })
          }
        >
          Adicionar turno
        </button>
      </div>
      <ShiftSummary input={input} disabled={disabled} onEdit={setEditing} />
      {editing && (
        <fieldset disabled={disabled}>
          <ShiftEditor
            key={editing.id}
            shift={editing}
            onCancel={() => setEditing(null)}
            onSave={(shift) => {
              onChange({
                ...input,
                shifts: input.shifts.some((item) => item.id === shift.id)
                  ? input.shifts.map((item) => item.id === shift.id ? shift : item)
                  : [...input.shifts, shift],
              });
              setEditing(null);
            }}
          />
        </fieldset>
      )}
    </section>
  );
}
