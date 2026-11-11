"use client";

import { canonicalBranchCode } from "@/lib/escalas/branch-code";
import { visibleDates } from "@/lib/escalas/dates";
import { compareBranches } from "@/lib/escalas/order";
import { controlClass, Field } from "./controls";
import styles from "./escalas.module.css";
import type { WorkspaceSummary } from "./use-escalas-workspace";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const displayDate = (value: string) => value.split("-").reverse().join("/");

/** Reuse the same legacy-month interpretation as the roster; never change a saved period. */
export function planPeriod(plan: WorkspaceSummary) {
  const dates = visibleDates(plan.input), start = dates[0] ?? plan.input.startDate, end = dates.at(-1) ?? plan.input.endDate;
  const month = (plan.input.visibleMonth ?? start.slice(0, 7));
  const monthly = Boolean(plan.input.visibleMonth) || start.endsWith("-01")
    && end === new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
  return { branch: canonicalBranchCode(plan.input.branchCode), year: month.slice(0, 4), month: month.slice(5, 7), key: month,
    label: monthly ? `${MONTHS[Number(month.slice(5)) - 1]} de ${month.slice(0, 4)}` : `${displayDate(start)} a ${displayDate(end)}` };
}

function newest(plans: readonly WorkspaceSummary[]) {
  return [...plans].sort((a, b) => planPeriod(b).key.localeCompare(planPeriod(a).key)
    || b.updatedAt.localeCompare(a.updatedAt) || b.revision - a.revision || a.id.localeCompare(b.id));
}

/** Choose only a real saved plan; opening still goes through the existing unsaved-change guard. */
export function selectPlan(plans: readonly WorkspaceSummary[], selectedId: string | undefined, field: "branch" | "year" | "month", value: string): string | undefined {
  const current = plans.find(plan => plan.id === selectedId), period = current && planPeriod(current);
  let candidates = plans.filter(plan => {
    const item = planPeriod(plan);
    if (field === "branch") return item.branch === value;
    if (!period || item.branch !== period.branch) return false;
    return field === "year" ? item.year === value : item.year === period.year && item.month === value;
  });
  if (period && field === "branch") {
    const samePeriod = candidates.filter(plan => planPeriod(plan).key === period.key);
    if (samePeriod.length) candidates = samePeriod;
  } else if (period && field === "year") {
    const sameMonth = candidates.filter(plan => planPeriod(plan).month === period.month);
    if (sameMonth.length) candidates = sameMonth;
  }
  return candidates.find(plan => plan.id === selectedId)?.id ?? newest(candidates)[0]?.id;
}

export function planSelection(plans: readonly WorkspaceSummary[], selectedId?: string) {
  const active = plans.find(plan => plan.id === selectedId), period = active && planPeriod(active);
  const branches = new Map<string, { branchCode: string; branchName: string }>();
  for (const plan of [...plans].sort((a, b) => compareBranches(a.input, b.input))) {
    const code = canonicalBranchCode(plan.input.branchCode);
    if (!branches.has(code)) branches.set(code, { branchCode: code, branchName: plan.input.branchName });
  }
  const branchPlans = period ? plans.filter(plan => planPeriod(plan).branch === period.branch) : [];
  const yearPlans = period ? branchPlans.filter(plan => planPeriod(plan).year === period.year) : [];
  return { active, period, branches: [...branches.values()].sort(compareBranches),
    years: [...new Set(branchPlans.map(plan => planPeriod(plan).year))].sort().reverse(),
    months: [...new Set(yearPlans.map(plan => planPeriod(plan).month))].sort(),
    matching: period ? newest(yearPlans.filter(plan => planPeriod(plan).month === period.month)) : [] };
}

export function PlanSelector({ plans, selectedId, disabled, onSelect }: {
  plans: readonly WorkspaceSummary[]; selectedId?: string; disabled: boolean; onSelect: (id: string) => void;
}) {
  const { active, period, branches, years, months, matching } = planSelection(plans, selectedId);
  const open = (field: "branch" | "year" | "month", value: string) => {
    const id = selectPlan(plans, selectedId, field, value);
    if (id && id !== selectedId) onSelect(id);
  };
  return <div className={styles.stackSmall}>
    <fieldset disabled={disabled} className={`${styles.formGrid} ${styles.formGridWide}`}>
      <legend className="sr-only">Selecionar planejamento por filial, ano e mês</legend>
      <Field label="Filial">{id => <select id={id} className={controlClass} value={period?.branch ?? ""} onChange={event => open("branch", event.target.value)}>
        <option value="" disabled>Selecione a filial</option>
        {branches.map(branch => <option key={branch.branchCode} value={branch.branchCode}>Filial {branch.branchCode} · {branch.branchName}</option>)}
      </select>}</Field>
      <Field label="Ano">{id => <select id={id} className={controlClass} disabled={!active} value={period?.year ?? ""} onChange={event => open("year", event.target.value)}>
        {!active && <option value="">Selecione a filial primeiro</option>}
        {years.map(year => <option key={year} value={year}>{year}</option>)}
      </select>}</Field>
      <Field label="Mês">{id => <select id={id} className={controlClass} disabled={!active} value={period?.month ?? ""} onChange={event => open("month", event.target.value)}>
        {!active && <option value="">Selecione a filial primeiro</option>}
        {months.map(month => <option key={month} value={month}>{MONTHS[Number(month) - 1]}</option>)}
      </select>}</Field>
      {matching.length > 1 && <Field label="Planejamento">{id => <select id={id} className={controlClass} value={selectedId} onChange={event => { if (matching.some(plan => plan.id === event.target.value) && event.target.value !== selectedId) onSelect(event.target.value); }}>
        {matching.map((plan, index) => <option key={plan.id} value={plan.id}>{index + 1}. {planPeriod(plan).label} · {plan.status === "PUBLISHED" ? "Publicada" : "Rascunho"} · revisão {plan.revision}</option>)}
      </select>}</Field>}
    </fieldset>
    {active && period && <p className={styles.muted}><strong>Planejamento aberto:</strong> Filial {period.branch} · {period.label} · {active.status === "PUBLISHED" ? "Publicada" : "Rascunho"}</p>}
  </div>;
}
