import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";
import { visibleDates } from "../src/lib/escalas/dates";
import type { EscalaWorkspace } from "../src/lib/escalas/types";

/** Select a specific saved workspace through the actual branch and period controls. */
export async function selectEscalasWorkspace(page: Page, workspace: EscalaWorkspace) {
  const picker = page.getByRole("group", { name: "Selecionar planejamento por filial, ano e mês", exact: true, includeHidden: true });
  await revealEscalasControl(picker);
  const branch = picker.getByLabel("Filial", { exact: true });
  if (await branch.count()) await branch.selectOption(workspace.input.branchCode);
  else await expect(picker).toContainText(`Filial ${workspace.input.branchCode} · ${workspace.input.branchName}`);
  const month = workspace.input.visibleMonth ?? visibleDates(workspace.input)[0]?.slice(0, 7) ?? workspace.input.startDate.slice(0, 7);
  const year = picker.getByLabel("Ano", { exact: true });
  await year.selectOption(month.slice(0, 4));
  await expect(year).toHaveValue(month.slice(0, 4));
  const monthField = picker.getByLabel("Mês", { exact: true });
  await monthField.selectOption(month.slice(5));
  await expect(monthField).toHaveValue(month.slice(5));
  const matching = picker.getByLabel("Planejamento", { exact: true });
  if (await matching.count()) await matching.selectOption(workspace.id);
  if (await matching.count()) await expect(matching).toHaveValue(workspace.id);
  await expect(page.getByRole("heading", { name: `Filial ${workspace.input.branchCode} · ${workspace.input.branchName}`, exact: true })).toBeVisible();
}

/** Open actual disclosure controls, from the outermost group to the requested control. */
export async function revealEscalasControl(control: Locator) {
  const ancestors = control.locator("xpath=ancestor::details");
  for (let index = 0; index < await ancestors.count(); index++) {
    const details = ancestors.nth(index);
    if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await details.locator(":scope > summary").click();
  }
}

export async function openEscalasArea(page: Page, area: "team" | "generate" | "roster" | "coverage" | "review" | "adjustments") {
  const control = page.locator(`button[aria-controls="escala-area-${area}"]`);
  await revealEscalasControl(control);
  await control.click();
  await expect(page.locator(`#escala-area-${area}`)).toBeVisible();
}
