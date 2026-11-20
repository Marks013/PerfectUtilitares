import { expect, test } from "./fixtures";
import { loginAsAdmin } from "./admin-session";
import { selectEscalasWorkspace } from "./escalas-selection";
import { newEmployee, newInput } from "../src/components/escalas/workspace-model";
import type { EscalaWorkspace } from "../src/lib/escalas/types";

test("employee import recovers from an empty 401 and preserves existing fixed rests and locked dates", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Only the isolated disposable database may receive these writes");
  test.setTimeout(150_000);
  await loginAsAdmin(page);
  const input = newInput(`E2E-IMPORT-${Date.now().toString(36)}`, "Importação sintética", "2026-12", 42);
  input.employees = [{ ...newEmployee(42, input.shifts[0].id), id: "existing", registration: "0001",
    name: "Pessoa sintética existente", sector: "Loja", role: "Função", activeFrom: "2020-01-01",
    offMode: "MIXED", fixedOffDays: [2], fixedRestSlots: [{ enabled: true, weekday: 2 }, { enabled: false, weekday: 6 }] }];
  input.assignments = [{ employeeId: "existing", date: "2026-12-01", kind: "OFF", locked: true }];
  const headers = { origin: new URL(page.url()).origin };
  const created = await page.request.post("/api/escalas", { headers, data: { action: "CREATE", input } });
  expect(created.status()).toBe(201);
  const workspace: EscalaWorkspace = await created.json();
  let importRequests = 0;
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/escalas/import") importRequests++;
  });
  async function openImport() {
    await page.goto("/escala");
    await selectEscalasWorkspace(page, workspace);
    const team = page.locator('button[aria-controls="escala-area-team"]');
    if (!await team.isVisible()) await page.getByText("Ferramentas e ajustes opcionais", { exact: true }).click();
    await team.click();
    const summary = page.getByText("Importar equipe com prévia", { exact: true });
    if (!await page.getByLabel("Arquivo CSV ou XLSX", { exact: true }).isVisible()) await summary.click();
  }
  const file = { name: "equipe-sintetica.csv", mimeType: "text/csv", buffer: Buffer.from([
    "Matricula;Nome;Setor;Cargo;CargaSemanal;Horarios;Admissao;RegraDomingos",
    "0002;Pessoa sintética importada;Loja;Função;42;08:00-12:00 / 13:00-17:24;2020-01-01;",
  ].join("\r\n")) };
  try {
    await openImport();
    await page.getByLabel("Arquivo CSV ou XLSX", { exact: true }).setInputFiles({ ...file, buffer: Buffer.alloc(512 * 1024 + 1, 65) });
    await page.getByRole("button", { name: "Conferir arquivo", exact: true }).click();
    await expect(page.getByText("Selecione um arquivo CSV ou XLSX de até 512 KB.", { exact: true })).toBeVisible();
    expect(importRequests).toBe(0);
    await page.route("**/api/escalas/import", route => route.request().method() === "POST"
      ? route.fulfill({ status: 401, body: "" }) : route.continue());
    await page.getByLabel("Arquivo CSV ou XLSX", { exact: true }).setInputFiles(file);
    await page.getByRole("button", { name: "Conferir arquivo", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Acesso ao planejamento de escalas", exact: true })).toBeVisible();
    const unchanged: EscalaWorkspace = await (await page.request.get(`/api/escalas?id=${workspace.id}`)).json();
    expect(unchanged.revision).toBe(workspace.revision);
    expect(unchanged.input.employees).toEqual(workspace.input.employees);
    await page.unroute("**/api/escalas/import");
    await openImport();
    await page.getByLabel("Arquivo CSV ou XLSX", { exact: true }).setInputFiles(file);
    const analyzed = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/escalas/import");
    await page.getByRole("button", { name: "Conferir arquivo", exact: true }).click();
    expect((await analyzed).status()).toBe(200);
    await expect(page.getByText("Prévia: 1 colaboradores aceitos de 1 linhas.", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const saving = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/escalas" && response.request().postDataJSON()?.action === "SAVE");
    await page.getByRole("button", { name: "Aplicar registros aceitos à proposta", exact: true }).click();
    expect((await saving).status()).toBe(200);
    await expect(page.locator('[data-state="saved"]')).toBeVisible();
    const saved: EscalaWorkspace = await (await page.request.get(`/api/escalas?id=${workspace.id}`)).json();
    expect(saved.input.employees).toHaveLength(2);
    expect(saved.input.employees.find(person => person.id === "existing")).toEqual(workspace.input.employees[0]);
    expect(saved.input.assignments).toEqual(workspace.input.assignments);
    expect(saved.input.employees.find(person => person.registration === "0002")).toMatchObject({ offMode: "VARIABLE", fixedOffDays: [] });
  } finally {
    await page.unroute("**/api/escalas/import");
    const response = await page.request.get(`/api/escalas?id=${workspace.id}`);
    if (response.status() !== 404) {
      expect(response.status()).toBe(200);
      const latest: EscalaWorkspace = await response.json();
      expect((await page.request.delete("/api/escalas", { headers, data: { workspaceId: latest.id, expectedRevision: latest.revision } })).status()).toBe(200);
    }
  }
});
