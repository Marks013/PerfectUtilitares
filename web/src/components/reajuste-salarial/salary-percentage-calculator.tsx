"use client";

import { useState } from "react";
import { salaryIncreasePercentage } from "./salary-percentage-calculator-model";

export function SalaryPercentageCalculator() {
  const [oldSalary, setOldSalary] = useState("");
  const [newSalary, setNewSalary] = useState("");
  const percentage = salaryIncreasePercentage(oldSalary, newSalary);
  const inputClass = "mt-2 w-full min-w-0 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-input)] px-3 py-3 text-[color:var(--app-fg)] focus-visible:outline-2 focus-visible:outline-[color:var(--app-teal)]";
  return <section aria-label="Calculadora de percentual salarial" className="mt-6 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 text-[color:var(--app-fg)]">
    <h3 className="text-sm font-black">Calculadora de percentual salarial</h3>
    <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm font-bold">Salário antigo (R$)<input inputMode="decimal" autoComplete="off" maxLength={40} placeholder="0,00" value={oldSalary} onChange={event => setOldSalary(event.target.value)} className={inputClass} /></label>
      <label className="min-w-0 text-sm font-bold">Salário novo (R$)<input inputMode="decimal" autoComplete="off" maxLength={40} placeholder="0,00" value={newSalary} onChange={event => setNewSalary(event.target.value)} className={inputClass} /></label>
    </div>
    <p className="mt-3 text-sm">Percentual calculado: <output aria-live="polite" className="font-black text-[color:var(--app-teal)]">{percentage ?? "—"}</output></p>
    {oldSalary.trim() && newSalary.trim() && percentage === null ? <p role="status" className="mt-2 text-xs">Informe valores válidos e um salário antigo maior que zero.</p> : null}
    <p className="mt-2 text-xs leading-5 text-[color:var(--app-muted)]">(Salário novo − salário antigo) ÷ salário antigo × 100. Resultado arredondado a cinco casas decimais. Apenas informativo: não altera os percentuais da apuração.</p>
  </section>;
}
