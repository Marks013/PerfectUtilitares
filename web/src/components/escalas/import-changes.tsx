"use client";
import type { EscalaEmployee, EscalaInput, EscalaShift } from "@/lib/escalas/types";
import { Check } from "./controls";
import { previewImportReconciliation, type ImportChoices } from "./import-reconciliation";

export function ImportChanges({ input, employees, shifts, choices, disabled, onChange }: {
  input: EscalaInput; employees: EscalaEmployee[]; shifts: EscalaShift[]; choices: ImportChoices; disabled: boolean;
  onChange: (choices: ImportChoices) => void;
}) {
  const entries = previewImportReconciliation(input, employees, shifts);
  const counts = (status: string) => entries.filter(entry => entry.status === status).length;
  function choose(registration: string, checked: boolean, schedule = false) {
    const field = schedule ? "scheduleRegistrations" : "updateRegistrations";
    const selected = choices[field] ?? [];
    onChange({ ...choices, [field]: checked ? [...new Set([...selected, registration])] : selected.filter(value => value !== registration),
      ...(!schedule && !checked ? { scheduleRegistrations: choices.scheduleRegistrations?.filter(value => value !== registration) } : {}) });
  }
  return <section aria-label="Conferência das mudanças da equipe" className="space-y-2 rounded-lg border border-[color:var(--app-border)] p-3">
    <h3 className="text-sm font-semibold">O que será importado</h3>
    <p className="text-sm">{counts("NEW")} novos · {counts("UNCHANGED")} sem alteração · {counts("CHANGED")} com mudanças · {counts("CONFLICT")} para conferir.</p>
    <p className="text-xs text-[color:var(--app-muted)]">Novos registros serão incluídos. Pessoas já cadastradas só mudam com sua confirmação. Folgas, afastamentos, carga individual, bloqueios e histórico são preservados. Ausência no arquivo não exclui ninguém.</p>
    <div className="max-h-64 space-y-2 overflow-y-auto">
      {entries.filter(entry => entry.status === "CHANGED" || entry.status === "CONFLICT").map(entry => <div key={entry.employee.id} className="border-t border-[color:var(--app-border)] py-2 text-sm">
        <p className="font-semibold">{entry.employee.name} · {entry.employee.registration}</p>
        {entry.status === "CONFLICT" ? <p role="alert">{entry.message}</p> : <>
          <p>Diferenças: {entry.changes.join(", ")}. Arquivo: {entry.employee.sector} / {entry.employee.role}.</p>
          <Check disabled={disabled} label={`Atualizar nome, setor e cargo da matrícula ${entry.employee.registration}`}
            checked={choices.updateRegistrations.includes(entry.employee.registration)} onChange={checked => choose(entry.employee.registration, checked)} />
          {entry.scheduleChanged && <Check disabled={disabled || entry.scheduleBlocked || !choices.updateRegistrations.includes(entry.employee.registration)}
            label={`Também usar a referência de horário do arquivo para ${entry.employee.registration}`}
            checked={choices.scheduleRegistrations?.includes(entry.employee.registration) ?? false} onChange={checked => choose(entry.employee.registration, checked, true)} />}
          {entry.message && <p className="text-xs text-[color:var(--app-muted)]">{entry.message}</p>}
        </>}
      </div>)}
    </div>
  </section>;
}
