"use client";

import { useState } from "react";
import { canonicalBranchCode } from "@/lib/escalas/branch-code";
import { visibleDates } from "@/lib/escalas/dates";
import { compareBranches } from "@/lib/escalas/order";
import { planningWeekLabel } from "@/lib/escalas/planning-calendar";
import { canDisplayEscalaAction, useEscalaClientAccess } from "./access-context";
import { controlClass, Field, primaryClass } from "./controls";
import styles from "./escalas.module.css";
import type { WorkspaceSummary } from "./use-escalas-workspace";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const displayDate = (value: string) => value.split("-").reverse().join("/");
const weekLabel = (plan: WorkspaceSummary) => planningWeekLabel(plan.input);

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

type PlanFilters = { branch?: string; year?: string; month?: string; planId?: string };

export function planSelection(plans: readonly WorkspaceSummary[], selectedId?: string, fixedBranch?: string, filters: PlanFilters = {}) {
  const active = plans.find(plan => plan.id === selectedId), period = active && planPeriod(active);
  const branches = new Map<string, { branchCode: string; branchName: string }>();
  for (const plan of [...plans].sort((a, b) => compareBranches(a.input, b.input))) {
    const code = canonicalBranchCode(plan.input.branchCode);
    if (!branches.has(code)) branches.set(code, { branchCode: code, branchName: plan.input.branchName });
  }
  const requestedBranch = filters.branch ?? period?.branch;
  const branch = fixedBranch ?? (requestedBranch && branches.has(requestedBranch) ? requestedBranch : undefined);
  const branchPlans = branch ? plans.filter(plan => planPeriod(plan).branch === branch) : [];
  const years = [...new Set(branchPlans.map(plan => planPeriod(plan).year))].sort().reverse();
  const requestedYear = filters.year ?? (branch === period?.branch ? period?.year : undefined);
  const year = years.find(value => value === requestedYear);
  const yearPlans = branchPlans.filter(plan => planPeriod(plan).year === year);
  const months = [...new Set(yearPlans.map(plan => planPeriod(plan).month))].sort();
  const requestedMonth = filters.month ?? (branch === period?.branch && year === period?.year ? period?.month : undefined);
  const month = months.find(value => value === requestedMonth);
  const matching = month ? newest(yearPlans.filter(plan => planPeriod(plan).month === month)) : [];
  const chosen = matching.length === 1 ? matching[0] : matching.find(plan => plan.id === (filters.planId ?? selectedId));
  return { active, period, branches: [...branches.values()].sort(compareBranches),
    branch, years, year, months, month, matching, chosen };
}

export function PlanSelector({ plans, selectedId, disabled, onSelect, showSummary = true }: {
  plans: readonly WorkspaceSummary[]; selectedId?: string; disabled: boolean; onSelect: (id: string) => void; showSummary?: boolean;
}) {
  const access = useEscalaClientAccess();
  const [selection, setSelection] = useState<{ filters: PlanFilters; workspaceId?: string; fixedBranch?: string }>();
  const unrestricted = access?.channel === "ACCOUNT" && access.administrator && access.allBranches;
  const readableGrants = unrestricted ? [] : (access?.branches.filter(grant =>
    canDisplayEscalaAction(access, "workspace.read", grant.code)
  ) ?? []);
  const fixedGrant = readableGrants.length === 1 ? readableGrants[0] : undefined;
  const fixedBranch = fixedGrant && canonicalBranchCode(fixedGrant.code);
  const allowedPlans = plans.filter(plan => canDisplayEscalaAction(access, "workspace.read", plan.input.branchCode));
  const filters = selection && selection.workspaceId === selectedId && selection.fixedBranch === fixedBranch ? selection.filters : {};
  const { active, period, branches, branch, years, year, month, months, matching, chosen } = planSelection(allowedPlans, selectedId, fixedBranch, filters);
  const canOpen = !disabled && Boolean(chosen && chosen.id !== selectedId);
  const changeFilters = (next: PlanFilters) => {
    setSelection({ filters: next, workspaceId: selectedId, fixedBranch });
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
    <form className={styles.stackSmall} onSubmit={event => {
      event.preventDefault();
      if (canOpen && chosen) onSelect(chosen.id);
    }}>
      <fieldset disabled={disabled} className={`${styles.formGrid} ${styles.formGridWide}`}>
        <legend className="sr-only">Selecionar planejamento por filial, ano e mês</legend>
        {branchIdentity ?? <Field label="Filial">{id => <select id={id} className={controlClass} value={branch ?? ""} onChange={event => changeFilters({ branch: event.target.value, year: "", month: "", planId: "" })}>
          <option value="" disabled>Selecione a filial</option>
          {branches.map(option => <option key={option.branchCode} value={option.branchCode}>Filial {option.branchCode} · {option.branchName}</option>)}
        </select>}</Field>}
        <Field label="Ano">{id => <select id={id} className={controlClass} disabled={!years.length} value={year ?? ""} onChange={event => changeFilters({ ...filters, year: event.target.value, month: "", planId: "" })}>
          {!year && <option value="" disabled>{branch ? "Selecione o ano" : "Selecione a filial primeiro"}</option>}
          {years.map(option => <option key={option} value={option}>{option}</option>)}
        </select>}</Field>
        <Field label="Mês">{id => <select id={id} className={controlClass} disabled={!months.length} value={month ?? ""} onChange={event => changeFilters({ ...filters, month: event.target.value, planId: "" })}>
          {!month && <option value="" disabled>{year ? "Selecione o mês" : branch ? "Selecione o ano primeiro" : "Selecione a filial primeiro"}</option>}
          {months.map(option => <option key={option} value={option}>{MONTHS[Number(option) - 1]}</option>)}
        </select>}</Field>
        {matching.length > 1 && <Field label="Planejamento" hint="Há mais de uma versão para o mês. Confira o período e a revisão.">{id => <select id={id} className={controlClass} value={chosen?.id ?? ""} onChange={event => changeFilters({ ...filters, planId: event.target.value })}>
          <option value="" disabled>Selecione a versão</option>
          {matching.map(plan => <option key={plan.id} value={plan.id}>{displayDate(plan.input.startDate)} a {displayDate(plan.input.endDate)} · {weekLabel(plan)} · {plan.status === "PUBLISHED" ? "Publicada" : "Rascunho"} · revisão {plan.revision}</option>)}
        </select>}</Field>}
      </fieldset>
      <div className={styles.actions}>
        <button type="submit" className={primaryClass} disabled={!canOpen} data-opened-plan={active?.id}>Abrir planejamento</button>
      </div>
    </form>
    {showSummary && active && period && <p className={styles.muted}><strong>Planejamento aberto:</strong> Filial {period.branch} · {period.label} · {weekLabel(active)} · {active.status === "PUBLISHED" ? "Publicada" : "Rascunho"}</p>}
  </div>;
}
