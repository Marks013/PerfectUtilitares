"use client";

import { useState } from "react";
import { canonicalBranchCode } from "@/lib/escalas/branch-code";
import { visibleDates } from "@/lib/escalas/dates";
import { compareBranches } from "@/lib/escalas/order";
import { planningWeekStartsOn } from "@/lib/escalas/planning-calendar";
import { canDisplayEscalaAction, useEscalaClientAccess } from "./access-context";
import { controlClass, Field } from "./controls";
import styles from "./escalas.module.css";
import type { WorkspaceSummary } from "./use-escalas-workspace";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const displayDate = (value: string) => value.split("-").reverse().join("/");
const weekLabel = (plan: WorkspaceSummary) => planningWeekStartsOn(plan.input) === "SUNDAY" ? "domingo a sábado" : "segunda a domingo";

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
export function selectPlan(plans: readonly WorkspaceSummary[], selectedId: string | undefined, field: "branch" | "month", value: string, fixedBranch?: string, selectedYear?: string): string | undefined {
  if (fixedBranch && field === "branch") return undefined;
  const current = plans.find(plan => plan.id === selectedId), period = current && planPeriod(current);
  const branch = fixedBranch ?? period?.branch;
  const year = selectedYear ?? period?.year;
  let candidates = plans.filter(plan => {
    const item = planPeriod(plan);
    if (field === "branch") return item.branch === value;
    return item.branch === branch && item.year === year && item.month === value;
  });
  if (period && field === "branch") {
    const samePeriod = candidates.filter(plan => planPeriod(plan).key === period.key);
    if (samePeriod.length) candidates = samePeriod;
  }
  return candidates.find(plan => plan.id === selectedId)?.id ?? newest(candidates)[0]?.id;
}

export function planSelection(plans: readonly WorkspaceSummary[], selectedId?: string, fixedBranch?: string, requestedYear?: string) {
  const active = plans.find(plan => plan.id === selectedId), period = active && planPeriod(active);
  const branches = new Map<string, { branchCode: string; branchName: string }>();
  for (const plan of [...plans].sort((a, b) => compareBranches(a.input, b.input))) {
    const code = canonicalBranchCode(plan.input.branchCode);
    if (!branches.has(code)) branches.set(code, { branchCode: code, branchName: plan.input.branchName });
  }
  const branch = fixedBranch ?? period?.branch;
  const branchPlans = branch ? plans.filter(plan => planPeriod(plan).branch === branch) : [];
  const years = [...new Set(branchPlans.map(plan => planPeriod(plan).year))].sort().reverse();
  const year = requestedYear && years.includes(requestedYear) ? requestedYear : period?.year;
  const month = year === period?.year ? period?.month : undefined;
  const yearPlans = branchPlans.filter(plan => planPeriod(plan).year === year);
  return { active, period, branches: [...branches.values()].sort(compareBranches),
    years, year, month,
    months: [...new Set(yearPlans.map(plan => planPeriod(plan).month))].sort(),
    matching: month ? newest(yearPlans.filter(plan => planPeriod(plan).month === month)) : [] };
}

export function PlanSelector({ plans, selectedId, disabled, onSelect, showSummary = true }: {
  plans: readonly WorkspaceSummary[]; selectedId?: string; disabled: boolean; onSelect: (id: string) => void; showSummary?: boolean;
}) {
  const access = useEscalaClientAccess();
  const [yearFilter, setYearFilter] = useState<{ year: string; workspaceId?: string; fixedBranch?: string }>();
  const unrestricted = access?.channel === "ACCOUNT" && access.administrator && access.allBranches;
  const readableGrants = unrestricted ? [] : (access?.branches.filter(grant =>
    canDisplayEscalaAction(access, "workspace.read", grant.code)
  ) ?? []);
  const fixedGrant = readableGrants.length === 1 ? readableGrants[0] : undefined;
  const fixedBranch = fixedGrant && canonicalBranchCode(fixedGrant.code);
  const allowedPlans = plans.filter(plan => canDisplayEscalaAction(access, "workspace.read", plan.input.branchCode));
  const requestedYear = yearFilter?.workspaceId === selectedId && yearFilter?.fixedBranch === fixedBranch ? yearFilter?.year : undefined;
  const { active, period, branches, years, year, month, months, matching } = planSelection(allowedPlans, selectedId, fixedBranch, requestedYear);
  const open = (field: "branch" | "month", value: string) => {
    if (disabled) return;
    const id = selectPlan(allowedPlans, selectedId, field, value, fixedBranch, year);
    if (id && id !== selectedId) onSelect(id);
  };
  const fixedName = fixedGrant?.label.trim();
  const fixedCodeLabel = fixedBranch && `Filial ${fixedBranch}`;
  const branchIdentity = fixedGrant && <div className={styles.field}>
    <span className={styles.fieldLabel}>Filial</span>
    <p className={styles.branchIdentity}>{fixedName && fixedName !== fixedCodeLabel ? `${fixedCodeLabel} · ${fixedName}` : fixedCodeLabel}</p>
  </div>;

  if (!allowedPlans.length) return <div className={styles.stackSmall}>
    {branchIdentity}
    <p role="status" className={styles.muted}>{disabled
      ? "Carregando planejamentos…"
      : !access ? "Não foi possível confirmar o acesso às filiais."
        : fixedBranch ? "Nenhum planejamento disponível nesta filial."
          : "Nenhum planejamento disponível para este acesso."}</p>
    {!disabled && access && !unrestricted && <p className={styles.muted}>Se o período já existe, peça ao administrador para conferir a configuração vinculada ao planejamento.</p>}
  </div>;

  return <div className={styles.stackSmall}>
    <fieldset disabled={disabled} className={`${styles.formGrid} ${styles.formGridWide}`}>
      <legend className="sr-only">Selecionar planejamento por filial, ano e mês</legend>
      {branchIdentity ?? <Field label="Filial">{id => <select id={id} className={controlClass} value={period?.branch ?? ""} onChange={event => open("branch", event.target.value)}>
        <option value="" disabled>Selecione a filial</option>
        {branches.map(branch => <option key={branch.branchCode} value={branch.branchCode}>Filial {branch.branchCode} · {branch.branchName}</option>)}
      </select>}</Field>}
      <Field label="Ano">{id => <select id={id} className={controlClass} disabled={!years.length} value={year ?? ""} onChange={event => setYearFilter({ year: event.target.value, workspaceId: selectedId, fixedBranch })}>
        {!year && <option value="" disabled>{fixedBranch ? "Selecione o ano" : "Selecione a filial primeiro"}</option>}
        {years.map(year => <option key={year} value={year}>{year}</option>)}
      </select>}</Field>
      <Field label="Mês">{id => <select id={id} className={controlClass} disabled={!months.length} value={month ?? ""} onChange={event => open("month", event.target.value)}>
        {!month && <option value="" disabled>{year ? "Selecione o mês" : fixedBranch ? "Selecione o ano primeiro" : "Selecione a filial primeiro"}</option>}
        {months.map(month => <option key={month} value={month}>{MONTHS[Number(month) - 1]}</option>)}
      </select>}</Field>
      {matching.length > 1 && <Field label="Planejamento">{id => <select id={id} className={controlClass} value={selectedId} onChange={event => { if (!disabled && matching.some(plan => plan.id === event.target.value) && event.target.value !== selectedId) onSelect(event.target.value); }}>
        {matching.map((plan, index) => <option key={plan.id} value={plan.id}>{index + 1}. {planPeriod(plan).label} · {weekLabel(plan)} · {plan.status === "PUBLISHED" ? "Publicada" : "Rascunho"} · revisão {plan.revision}</option>)}
      </select>}</Field>}
    </fieldset>
    {showSummary && active && period && <p className={styles.muted}><strong>Planejamento aberto:</strong> Filial {period.branch} · {period.label} · {weekLabel(active)} · {active.status === "PUBLISHED" ? "Publicada" : "Rascunho"}</p>}
  </div>;
}
