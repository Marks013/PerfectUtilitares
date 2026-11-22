import type { Route } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loginAsAdmin } from "./admin-session";
import { newEmployee, newInput } from "../src/components/escalas/workspace-model";
import { applyReplacement, importPanel, isImportResponse, previewReplacement, readWorkspace, removeOwnedWorkspace, responseWorkspace, syntheticBranch } from "./escalas-access-fixtures";
import { selectEscalasWorkspace } from "./escalas-selection";

test("team replacement recovers from an empty 401 without replay and preserves fixed rests and locked dates", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Only the isolated disposable database may receive these writes");
  test.setTimeout(150_000);
  await loginAsAdmin(page);
  const input = newInput(syntheticBranch("E2E-IMPORT"), "Importação sintética", "2026-12", 42);
  input.shifts = [{ id: "day", name: "Diurno", segments: [{ kind: "WORK", start: 480, end: 720 },
    { kind: "BREAK", start: 720, end: 780 }, { kind: "WORK", start: 780, end: 1044 }] }];
  input.employees = [{ ...newEmployee(42, "day"), id: "existing", registration: "0001",
    name: "Pessoa sintética existente", sector: "Loja", role: "Função", activeFrom: "2020-01-01", scheduleMode: "TIMED",
    offMode: "MIXED", fixedOffDays: [2], fixedRestSlots: [{ enabled: true, weekday: 2 }, { enabled: false, weekday: 6 }] }];
  input.assignments = [{ employeeId: "existing", date: "2026-12-01", kind: "OFF", locked: true }];
  const headers = { origin: new URL(page.url()).origin };
  const workspace = await responseWorkspace(await page.request.post("/api/escalas", { headers, data: { action: "CREATE", input } }), 201);
  let importRequests = 0, legacySaves = 0;
  page.on("request", request => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (path === "/api/escalas/import") importRequests++;
    if (path === "/api/escalas" && request.postDataJSON()?.action === "SAVE") legacySaves++;
  });
  async function openImport() {
    await page.goto("/escala");
    await selectEscalasWorkspace(page, workspace);
    return importPanel(page, "EMPLOYEES");
  }
  // Full replacement must include the existing registration. Its schedule data
  // matches the original; the CSV cannot express manual rests or locks.
  const file = { name: "equipe-sintetica.csv", mimeType: "text/csv", buffer: Buffer.from([
    "Matricula;Nome;Setor;Cargo;CargaSemanal;Horarios;Admissao;RegraDomingos",
    "0001;Pessoa sintética existente;Loja;Função;42;08:00-12:00 / 13:00-17:24;2020-01-01;",
    "0002;Pessoa sintética importada;Loja;Função;42;08:00-12:00 / 13:00-17:24;2020-01-01;",
  ].join("\r\n")) };
  const endpoint = "**/api/escalas/import";
  const denyOnce = (route: Route) => route.request().method() === "POST" ? route.fulfill({ status: 401, body: "" }) : route.continue();
  const upload = { name: "Arquivo de equipe CSV ou XLSX", exact: true };
  const review = { name: "Conferir substituição de equipe", exact: true };
  try {
    const panel = await openImport();
    await panel.getByLabel(upload.name, { exact: true }).setInputFiles({ ...file, buffer: Buffer.alloc(512 * 1024 + 1, 65) });
    await panel.getByRole("button", review).click();
    await expect(panel.getByRole("alert")).toHaveText("Selecione um arquivo não vazio de até 512 KB.");
    expect(importRequests).toBe(0);

    await page.route(endpoint, denyOnce);
    await panel.getByLabel(upload.name, { exact: true }).setInputFiles(file);
    await panel.getByRole("checkbox", { name: /^Declaro que o arquivo cobre integralmente/ }).check();
    const rejected = page.waitForResponse(response => isImportResponse(response, "PREVIEW_REPLACE"));
    await panel.getByRole("button", review).click();
    expect((await rejected).status()).toBe(401);
    const accessNotice = page.getByRole("region", { name: "Confira o acesso da sua conta", exact: true });
    await expect(accessNotice.getByRole("heading", { name: "Confira o acesso da sua conta", exact: true })).toBeVisible();
    await expect(accessNotice.getByRole("alert")).toContainText("O acesso da conta precisa ser conferido novamente.");
    expect(importRequests).toBe(1);
    expect(await readWorkspace(page, workspace.id)).toMatchObject({ revision: workspace.revision, input: workspace.input });
    await page.unroute(endpoint, denyOnce);

    // The artificial 401 leaves the real account authenticated, but the browser must reopen access explicitly.
    await accessNotice.getByRole("link", { name: "Conferir acesso da conta", exact: true }).click();
    await selectEscalasWorkspace(page, workspace);
    const reopened = await importPanel(page, "EMPLOYEES");
    await expect(reopened.getByLabel(upload.name, { exact: true })).toHaveValue("");
    await expect(reopened.getByRole("button", review)).toBeDisabled();
    await expect(reopened.getByRole("checkbox", { name: /^Declaro/ })).not.toBeChecked();
    expect(importRequests).toBe(1);

    const preview = await previewReplacement(page, "EMPLOYEES", file);
    expect(preview.preview).toMatchObject({ canApply: true, blockers: [], context: { revision: workspace.revision },
      counts: { addedPeople: 1, unchangedPeople: 1, updatedPeople: 0, removedPeople: 0 } });
    expect(await readWorkspace(page, workspace.id)).toMatchObject({ revision: workspace.revision, input: workspace.input });
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const { workspace: saved } = await applyReplacement(page, preview.panel, "EMPLOYEES");
    expect(saved.revision).toBe(workspace.revision + 1);
    expect(saved.input.employees).toHaveLength(2);
    expect(saved.input.employees.find(person => person.id === "existing")).toEqual(workspace.input.employees[0]);
    expect(saved.input.assignments).toEqual(workspace.input.assignments);
    expect(saved.input.employees.find(person => person.registration === "0002")).toMatchObject({ offMode: "VARIABLE", fixedOffDays: [] });
    expect(await readWorkspace(page, workspace.id)).toMatchObject({ revision: saved.revision, input: saved.input });
    expect(importRequests).toBe(3);
    expect(legacySaves).toBe(0);
  } finally {
    await page.unroute(endpoint, denyOnce);
    await removeOwnedWorkspace(page, workspace);
  }
});
