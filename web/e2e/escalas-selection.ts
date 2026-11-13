import type { Page } from "@playwright/test";
import { expect } from "./fixtures";
import { visibleDates } from "../src/lib/escalas/dates";
import type { EscalaWorkspace } from "../src/lib/escalas/types";

/** Select a specific saved workspace through the actual branch and period controls. */
export async function selectEscalasWorkspace(page: Page, workspace: EscalaWorkspace) {
  const branch = page.getByLabel("Filial", { exact: true });
  await branch.selectOption(workspace.input.branchCode);
  await expect(branch).toHaveValue(workspace.input.branchCode);
  const month = workspace.input.visibleMonth ?? visibleDates(workspace.input)[0]?.slice(0, 7) ?? workspace.input.startDate.slice(0, 7);
  const year = page.getByLabel("Ano", { exact: true });
  await year.selectOption(month.slice(0, 4));
  await expect(year).toHaveValue(month.slice(0, 4));
  const monthField = page.getByLabel("Mês", { exact: true });
  await monthField.selectOption(month.slice(5));
  await expect(monthField).toHaveValue(month.slice(5));
  const matching = page.getByLabel("Planejamento", { exact: true });
  if (await matching.count()) await matching.selectOption(workspace.id);
  if (await matching.count()) await expect(matching).toHaveValue(workspace.id);
}
