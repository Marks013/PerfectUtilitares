import type { Locator, Page, Request } from "@playwright/test";
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
  const month = workspace.input.visibleMonth ?? visibleDates(workspace.input)[0]?.slice(0, 7) ?? workspace.input.startDate.slice(0, 7);
  const requestedWorkspaces: string[] = [];
  const recordWorkspace = (request: Request) => {
    const url = new URL(request.url());
    const id = url.searchParams.get("id");
    if (request.method() === "GET" && url.pathname === "/api/escalas" && id) requestedWorkspaces.push(id);
  };
  page.on("request", recordWorkspace);
  try {
    const branch = picker.getByLabel("Filial", { exact: true });
    if (await branch.count()) {
      if (await branch.inputValue() !== code) await branch.selectOption(code);
    } else {
      await expect(picker.getByText(`Filial ${code}`)).toBeVisible();
    }
    const yearControl = picker.getByLabel("Ano", { exact: true });
    const monthControl = picker.getByLabel("Mês", { exact: true });
    const year = month.slice(0, 4);
    await expect(yearControl).toBeEnabled();
    if (await yearControl.inputValue() !== year) {
      await yearControl.selectOption(year);
      await expect(monthControl).toBeEnabled();
      await expect(monthControl).toHaveValue("");
    }
    if (await monthControl.inputValue() !== month.slice(5)) await monthControl.selectOption(month.slice(5));
    const matching = picker.getByLabel("Planejamento", { exact: true });
    if (await matching.count() && await matching.inputValue() !== workspace.id) {
      await expect(page.getByRole("button", { name: "Abrir planejamento", exact: true })).toBeDisabled();
      await matching.selectOption(workspace.id);
    }
    expect(requestedWorkspaces).toEqual([]);
  } finally {
    page.off("request", recordWorkspace);
  }
  const open = page.getByRole("button", { name: "Abrir planejamento", exact: true });
  const heading = page.locator("#escala-scenario-title");
  if (await open.isEnabled()) {
    const [response] = await Promise.all([
      page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === "GET" && url.pathname === "/api/escalas" && url.searchParams.get("id") === workspace.id;
      }),
      open.click(),
    ]);
    expect(response.ok()).toBe(true);
    const opened = await response.json() as EscalaWorkspace;
    expect(opened.id).toBe(workspace.id);
    await expect(heading).toHaveText(`Filial ${opened.input.branchCode} · ${opened.input.branchName}`);
    const scenario = page.getByRole("region", { name: `Filial ${opened.input.branchCode} · ${opened.input.branchName}`, exact: true });
    await expect(scenario.getByText(new RegExp(`· revisão ${opened.revision}$`))).toBeVisible();
  } else {
    await expect(open).toHaveAttribute("data-opened-plan", workspace.id);
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
