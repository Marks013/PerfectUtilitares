import { expect, test } from "./fixtures";
import { loginAsAdmin } from "./admin-session";
import { selectEscalasWorkspace } from "./escalas-selection";
import { newEmployee, newInput } from "../src/components/escalas/workspace-model";
import type { EscalaWorkspace } from "../src/lib/escalas/types";

test("two personal fixed-rest controls save independently and retain disabled weekdays after reload", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Only the disposable isolated E2E database may receive these writes");
  test.setTimeout(150_000);
  await loginAsAdmin(page);
  const input = newInput(`E2E-REST-${Date.now().toString(36)}`, "Folgas sintéticas", "2026-12", 42);
  input.generationMode = "REST_ONLY";
  input.employees = [{ ...newEmployee(42, input.shifts[0].id), id: "synthetic-person", registration: "S-1",
    name: "Pessoa sintética de folgas", sector: "Loja", role: "Função", activeFrom: "2020-01-01" }];
  const headers = { origin: new URL(page.url()).origin };
  const created = await page.request.post("/api/escalas", { headers, data: { action: "CREATE", input } });
  expect(created.status()).toBe(201);
  const workspace: EscalaWorkspace = await created.json();
  async function openEditor() {
    await page.goto("/escala");
    await selectEscalasWorkspace(page, workspace);
    const team = page.locator('button[aria-controls="escala-area-team"]');
    if (!await team.isVisible()) await page.getByText("Ferramentas e ajustes opcionais", { exact: true }).click();
    await team.click();
    await page.getByRole("button", { name: "Editar Pessoa sintética de folgas", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Editar colaborador", exact: true })).toBeVisible();
  }
  async function saveEditor() {
    const saved = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/escalas" && response.request().postDataJSON()?.action === "SAVE");
    await page.getByRole("button", { name: "Aplicar cadastro à proposta", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.locator('[data-state="saved"]')).toBeVisible();
    const reloaded = await page.request.get(`/api/escalas?id=${workspace.id}`);
    expect(reloaded.status()).toBe(200);
    return reloaded.json() as Promise<EscalaWorkspace>;
  }
  try {
    await openEditor();
    await expect(page.getByLabel("Habilitar folga fixa 1", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("Habilitar folga fixa 2", { exact: true })).not.toBeChecked();
    await page.getByLabel("Dia da folga fixa 1", { exact: true }).selectOption("2");
    await page.getByLabel("Dia da folga fixa 2", { exact: true }).selectOption("6");
    await page.getByLabel("Habilitar folga fixa 2", { exact: true }).focus();
    await page.keyboard.press("Space");
    let saved = await saveEditor();
    expect(saved.input.employees[0]).toMatchObject({ offMode: "MIXED", fixedOffDays: [6], fixedRestSlots: [
      { enabled: false, weekday: 2 }, { enabled: true, weekday: 6 },
    ] });
    await openEditor();
    await expect(page.getByLabel("Dia da folga fixa 1", { exact: true })).toHaveValue("2");
    await page.getByLabel("Habilitar folga fixa 1", { exact: true }).check();
    saved = await saveEditor();
    expect(saved.input.employees[0]).toMatchObject({ offMode: "FIXED", fixedOffDays: [2, 6] });
    await openEditor();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByLabel("Habilitar folga fixa 2", { exact: true }).uncheck();
    saved = await saveEditor();
    expect(saved.input.employees[0]).toMatchObject({ offMode: "MIXED", fixedOffDays: [2], fixedRestSlots: [
      { enabled: true, weekday: 2 }, { enabled: false, weekday: 6 },
    ] });
    await openEditor();
    await expect(page.getByLabel("Dia da folga fixa 2", { exact: true })).toHaveValue("6");
    await page.getByLabel("Habilitar folga fixa 1", { exact: true }).uncheck();
    saved = await saveEditor();
    expect(saved.input.employees[0]).toMatchObject({ offMode: "VARIABLE", fixedOffDays: [], fixedRestSlots: [
      { enabled: false, weekday: 2 }, { enabled: false, weekday: 6 },
    ] });
    expect(saved.input.assignments).toEqual([]);
  } finally {
    const response = await page.request.get(`/api/escalas?id=${workspace.id}`);
    if (response.status() !== 404) {
      expect(response.status()).toBe(200);
      const current: EscalaWorkspace = await response.json();
      expect((await page.request.delete("/api/escalas", { headers, data: {
        workspaceId: current.id, expectedRevision: current.revision,
      } })).status()).toBe(200);
    }
  }
});
