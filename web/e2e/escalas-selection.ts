import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";
import { canonicalBranchCode } from "../src/lib/escalas/branch-code";
import { visibleDates } from "../src/lib/escalas/dates";
import type { EscalaWorkspace } from "../src/lib/escalas/types";

/** Select a specific saved workspace through the actual branch and period controls. */
export async function selectEscalasWorkspace(page: Page, workspace: EscalaWorkspace) {
  const picker = page.getByRole("group", { name: "Selecionar planejamento por filial, ano e mês", exact: true, includeHidden: true });
  // The client loads the authorized list after navigation. A count before the fieldset
  // mounts can falsely classify an administrator as having a single fixed branch.
  await revealEscalasControl(picker);
  const code = canonicalBranchCode(workspace.input.branchCode);
  async function choose(control: Locator, value: string): Promise<EscalaWorkspace | undefined> {
    await expect(picker).toBeEnabled();
    // Opening the first saved plan closes the initially expanded disclosure.
    await revealEscalasControl(picker);
    await expect(control).toBeEnabled();
    if (await control.inputValue() === value) return;
    const [response] = await Promise.all([
      page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === "GET" && url.pathname === "/api/escalas" && Boolean(url.searchParams.get("id"));
      }),
      control.selectOption(value),
    ]);
    expect(response.ok()).toBe(true);
    const opened = await response.json() as EscalaWorkspace;
    await expect(picker).toBeEnabled();
    await expect(control).toHaveValue(value);
    return opened;
  }
  const branch = picker.getByLabel("Filial", { exact: true });
  let opened: EscalaWorkspace | undefined;
  if (await branch.count()) opened = await choose(branch, code);
  else await expect(picker.locator("p")).toContainText(`Filial ${code}`);
  const month = workspace.input.visibleMonth ?? visibleDates(workspace.input)[0]?.slice(0, 7) ?? workspace.input.startDate.slice(0, 7);
  opened = await choose(picker.getByLabel("Ano", { exact: true }), month.slice(0, 4)) ?? opened;
  opened = await choose(picker.getByLabel("Mês", { exact: true }), month.slice(5)) ?? opened;
  const matching = picker.getByLabel("Planejamento", { exact: true });
  if (await matching.count()) opened = await choose(matching, workspace.id) ?? opened;
  const heading = page.locator("#escala-scenario-title");
  await expect(heading).toBeVisible();
  if (opened) {
    expect(opened.id).toBe(workspace.id);
    await expect(heading).toHaveText(`Filial ${opened.input.branchCode} · ${opened.input.branchName}`);
    const scenario = page.getByRole("region", { name: `Filial ${opened.input.branchCode} · ${opened.input.branchName}`, exact: true });
    await expect(scenario.getByText(new RegExp(`· revisão ${opened.revision}$`))).toBeVisible();
  } else {
    await expect(heading).toContainText(`Filial ${code} ·`);
  }
}

/** Open actual disclosure controls, from the outermost group to the requested control. */
export async function revealEscalasControl(control: Locator) {
  await control.waitFor({ state: "attached" });
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
