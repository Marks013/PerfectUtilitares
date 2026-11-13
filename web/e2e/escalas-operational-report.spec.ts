import { expect, test } from "./fixtures";
import { loginAsAdmin } from "./admin-session";
import { selectEscalasWorkspace } from "./escalas-selection";
import { newEmployee, newInput } from "../src/components/escalas/workspace-model";
import type { EscalaWorkspace } from "../src/lib/escalas/types";

test.use({ trace: "off", screenshot: "off", video: "off" });

for (const mode of ["REST_ONLY", "HOURS_ONLY", "DAYS_AND_HOURS"] as const) {
  test(`operational PDF uses saved references without inventing a roster: ${mode}`, async ({ page }) => {
    test.skip(process.env.E2E_MUTATION !== "1", "Requires the disposable isolated E2E database");
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsAdmin(page);
    const branch = "8" + Date.now().toString().slice(-7);
    const input = newInput(branch, "Filial sintética", "2026-11", 40);
    input.generationMode = mode;
    input.employees = [{ ...newEmployee(40, []), id: "person", registration: "0001", name: "Pessoa de teste", sector: "Loja", role: "Repositor", activeFrom: "2020-01-01" }];
    input.assignments = [{ employeeId: "person", date: "2026-11-05", kind: "ABSENCE", locked: true }, { employeeId: "person", date: "2026-11-15", kind: "HOLIDAY", locked: true }];
    const headers = { origin: new URL(page.url()).origin };
    const created = await page.request.post("/api/escalas", { headers, data: { action: "CREATE", input } });
    expect(created.status()).toBe(201);
    const workspace: EscalaWorkspace = await created.json();
    try {
      await page.goto("/escala");
      await selectEscalasWorkspace(page, workspace);
      const panel = page.locator("details").filter({ has: page.getByText("Relatórios operacionais (opcional)", { exact: true }) });
      await panel.getByText("Relatórios operacionais (opcional)", { exact: true }).click();
      await expect(panel.getByText("Sem grade calculada", { exact: false })).toBeVisible();
      await expect(panel.getByLabel("Jornadas e turnos")).toBeChecked();
      await expect(panel.getByLabel("Catálogo de variantes")).toBeChecked();
      await expect(panel.getByLabel("Calendário mensal")).toHaveCount(0);
      await expect(panel.getByLabel("Mapa diário por horário")).toHaveCount(0);
      await expect(panel.getByLabel("Jornadas e turnos")).toBeEnabled();
      await panel.getByLabel("Catálogo de variantes").uncheck();
      await panel.getByLabel("Catálogo de variantes").check();
      await panel.getByLabel("Loja", { exact: true }).check();
      await expect(panel.getByRole("button", { name: "Gerar PDF operacional" })).toBeEnabled();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const request = page.waitForResponse(response => new URL(response.url()).pathname === "/api/escalas/operational-report");
      const download = page.waitForEvent("download");
      await panel.getByRole("button", { name: "Gerar PDF operacional" }).click();
      const response = await request;
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/pdf");
      const query = new URL(response.url()).searchParams;
      expect(query.get("workspaceId")).toBe(workspace.id);
      expect(query.get("revision")).toBe(String(workspace.revision));
      expect(query.get("month")).toBe("2026-11");
      expect(query.getAll("section")).toEqual(["journeys", "variants"]);
      expect(query.getAll("sector")).toEqual(["Loja"]);
      const file = await download; expect(file.suggestedFilename()).toContain(".pdf"); await file.delete();
      await expect(panel.getByText("Concluído.", { exact: false })).toBeVisible();
      const current: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(result => result.json());
      expect(current.revision).toBe(workspace.revision);
      expect(current.input.assignments).toEqual(workspace.input.assignments);
    } finally {
      const current: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(result => result.json());
      expect(current.input.branchCode).toBe(branch); expect(current.status).toBe("DRAFT");
      expect((await page.request.delete("/api/escalas", { headers, data: { workspaceId: current.id, expectedRevision: current.revision } })).status()).toBe(200);
    }
  });
}

test("a delayed PDF from the previous workspace never starts a download", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires the disposable isolated E2E database");
  await loginAsAdmin(page);
  const headers = { origin: new URL(page.url()).origin };
  const workspaces: EscalaWorkspace[] = [];
  try {
    for (const prefix of ["7", "8"]) {
      const input = newInput(prefix + Date.now().toString().slice(-7), "Filial sintética", "2026-11", 40);
      input.generationMode = "HOURS_ONLY";
      input.employees = [{ ...newEmployee(40, []), id: "person", registration: "0001", name: "Pessoa de teste", sector: "Loja", role: "Repositor", activeFrom: "2020-01-01" }];
      const response = await page.request.post("/api/escalas", { headers, data: { action: "CREATE", input } });
      expect(response.status()).toBe(201); workspaces.push(await response.json());
    }
    await page.goto("/escala"); await selectEscalasWorkspace(page, workspaces[0]);
    const panel = page.locator("details").filter({ has: page.getByText("Relatórios operacionais (opcional)", { exact: true }) });
    await panel.getByText("Relatórios operacionais (opcional)", { exact: true }).click();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let captured!: () => void; const pending = new Promise<void>(resolve => { captured = resolve; });
    await page.route("**/api/escalas/operational-report?*", async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200); captured(); await gate;
      await route.fulfill({ response }).catch(() => {});
    });
    let downloads = 0; page.on("download", () => downloads++);
    await panel.getByRole("button", { name: "Gerar PDF operacional" }).click(); await pending;
    await selectEscalasWorkspace(page, workspaces[1]);
    release(); await page.unrouteAll({ behavior: "wait" });
    await new Promise(resolve => setTimeout(resolve, 1000)); expect(downloads).toBe(0);
    await expect(page.getByText("PDF preparado para download.")).toHaveCount(0);
  } finally {
    for (const workspace of workspaces) {
      const current: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json());
      expect(current.status).toBe("DRAFT"); expect(current.input.branchCode).toBe(workspace.input.branchCode);
      expect((await page.request.delete("/api/escalas", { headers, data: { workspaceId: current.id, expectedRevision: current.revision } })).status()).toBe(200);
    }
  }
});
