import type { EventAdjustmentEmployee, EventAdjustmentReport } from "@/lib/reajuste-salarial/event-adjustment-types";
import { formatCents, parseMoneyCents } from "@/lib/reajuste-salarial/money";
import { validateGeneration } from "./reajuste-salarial-workspace-model";

export type EventSettings = { bonusOldValue: string; bonusNewValue: string; sundayOldValue: string; sundayNewValue: string };
export type HistoricOverride = { competencyKey: string; bonusOldValue: string; sundayOldValue: string };
export const initialEventSettings: EventSettings = { bonusOldValue: "80,00", bonusNewValue: "", sundayOldValue: "85,00", sundayNewValue: "" };
export const eventMoney = (value: string | null) => value === null ? "Não configurado" : formatCents(BigInt(value));
export function appendEventSettings(data: FormData, settings: EventSettings, overrides: HistoricOverride[]) {
  for (const [key, value] of Object.entries(settings)) data.set(key, value.trim());
  data.set("historicOverrides", JSON.stringify(overrides.filter(row => row.bonusOldValue.trim() || row.sundayOldValue.trim()).map(row => ({ competencyKey: row.competencyKey, bonusOldValue: row.bonusOldValue.trim() || settings.bonusOldValue.trim(), sundayOldValue: row.sundayOldValue.trim() || settings.sundayOldValue.trim() }))));
}
export function validateEventInputs(files: File[], settings: EventSettings, overrides: HistoricOverride[]) {
  const messages = validateGeneration(files, "1", "1");
  const fields = [
    ["Valor antigo do bônus", settings.bonusOldValue, true],
    ["Novo valor do bônus", settings.bonusNewValue, false],
    ["Valor antigo por domingo", settings.sundayOldValue, true],
    ["Novo valor por domingo", settings.sundayNewValue, false],
    ...overrides.flatMap(row => [[`Bônus antigo de ${row.competencyKey}`, row.bonusOldValue, false], [`Domingo antigo de ${row.competencyKey}`, row.sundayOldValue, false]]),
  ] as Array<[string, string, boolean]>;
  for (const [label, value, required] of fields) {
    if (!value.trim() && !required) continue;
    try { if (parseMoneyCents(value) <= 0n) throw new Error(); }
    catch { messages.push(`${label}: informe um valor positivo em reais, como 85,00.`); }
  }
  return messages;
}
export type EventFilters = { search: string; competency: string; event: "all" | "bonus-received" | "bonus-missing" | "sunday-received" | "sunday-missing" | "issues" };
export function displayedEventDifference(employee: EventAdjustmentEmployee, competency: string) {
  return employee.months
    .filter(month => !competency || month.competency.key === competency)
    .reduce((total, month) => total + BigInt(month.bonus565.differenceCents) + BigInt(month.indemnity901.differenceCents), 0n)
    .toString();
}
export function filterEventEmployees(report: EventAdjustmentReport, filters: EventFilters) {
  const term = filters.search.trim().toLocaleLowerCase("pt-BR");
  return report.employees.filter(employee => {
    if (term && !`${employee.employeeName} ${employee.registration} ${employee.branchAlias}`.toLocaleLowerCase("pt-BR").includes(term)) return false;
    const months = employee.months.filter(month => !filters.competency || month.competency.key === filters.competency);
    return months.some(month => {
      if (filters.event === "all") return true;
      if (filters.event === "issues") return Boolean(month.bonus565.issue || month.indemnity901.issue);
      if (!month.inPayroll) return false;
      const received = filters.event.startsWith("bonus") ? month.bonus565.received : month.indemnity901.received;
      return filters.event.endsWith("received") ? received : !received;
    });
  });
}
