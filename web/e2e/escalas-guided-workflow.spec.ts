import { expect, test, type Page, type Route } from "./fixtures";
import { selectEscalasWorkspace } from "./escalas-selection";
import { downloadBytes, prepareBasicExport } from "./escalas-access-fixtures";
import { PDFDocument } from "pdf-lib";
import { strFromU8, unzipSync } from "fflate";
import { newEmployee, newInput } from "../src/components/escalas/workspace-model";
import { dateRange, dayOfWeek } from "../src/lib/escalas/dates";
import type { EscalaWorkspace } from "../src/lib/escalas/types";
import { loginAsAdmin } from "./admin-session";

test.beforeEach(() => {
  test.skip(process.env.E2E_MUTATION !== "1", "Only the disposable isolated E2E database may receive these writes");
  test.setTimeout(150_000);
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function isSave(route: Route, id: string) {
  const request = route.request();
  return request.method() === "POST" && request.postDataJSON()?.action === "SAVE" && request.postDataJSON()?.id === id;
}
async function fixture(page: Page, suffix: string) {
  const input = newInput("GUI-" + Date.now().toString(36) + suffix, "Fluxo sintético " + suffix, "2027-02", 42);
  input.employees = [{ ...newEmployee(42, input.shifts[0].id), id: "person", registration: "001", name: "Pessoa sintética", sector: "Loja", role: "Repositor", weeklyHoursMode: "BRANCH", activeFrom: "" }];
  input.assignments = dateRange(input.startDate, input.endDate).map(date => ({ employeeId: "person", date, kind: dayOfWeek(date) >= 1 && dayOfWeek(date) <= 5 ? "WORK" : "OFF", ...(dayOfWeek(date) >= 1 && dayOfWeek(date) <= 5 ? { shiftId: input.shifts[0].id } : {}) }));
  const response = await page.request.post("/api/escalas", { headers: { origin: new URL(page.url()).origin }, data: { action: "CREATE", input } });
  expect(response.status()).toBe(201);
  return response.json() as Promise<EscalaWorkspace>;
}
async function selectStep(page: Page, step: "generate" | "roster") {
  await page.getByRole("navigation", { name: "Etapas do planejamento", exact: true })
    .getByRole("button", { name: step === "generate" ? /^Montar escala/ : /^Horários, folgas e arquivos/ })
    .click();
}
async function selectAdjustments(page: Page) {
  const navigation = page.getByRole("navigation", { name: "Áreas do planejamento", exact: true });
  if (!await navigation.isVisible()) {
    await page.getByText("Conferências e configurações", { exact: true }).click();
  }
  await navigation.getByRole("button", { name: "Configurações da filial", exact: true }).click();
}
async function open(page: Page, workspace: EscalaWorkspace, step: "generate" | "roster" = "generate") {
  await page.goto("/escala");
  await selectEscalasWorkspace(page, workspace);
  await selectStep(page, step);
  await expect(page.getByLabel("Jornada semanal", { exact: true })).toHaveValue(String(workspace.input.defaultWeeklyHours));
}
async function read(page: Page, id: string) {
  const response = await page.request.get("/api/escalas?id=" + id);
  expect(response.status()).toBe(200);
  return response.json() as Promise<EscalaWorkspace>;
}
async function cleanup(page: Page, id: string) {
  const current = await read(page, id);
  expect((await page.request.delete("/api/escalas", { headers: { origin: new URL(page.url()).origin }, data: { workspaceId: id, expectedRevision: current.revision } })).status()).toBe(200);
}

test("the three generation modes show relevant controls", async ({ page }) => {
  await loginAsAdmin(page);
  const workspace = await fixture(page, "modes");
  try {
    await open(page, workspace);
    const both = page.getByRole("radio", { name: "Folgas e horários", exact: true });
    const rest = page.getByRole("radio", { name: "Só folgas", exact: true });
    const hours = page.getByRole("radio", { name: "Só horários", exact: true });
    const adjustment = page.locator("#escala-adjust-hours-title");
    await expect(both).toBeChecked();
    await expect(adjustment).toBeVisible();
    await rest.check();
    await expect(rest).toBeChecked();
    await expect(adjustment).toHaveCount(0);
    await hours.check();
    await expect(hours).toBeChecked();
    await expect(adjustment).toBeVisible();
    await expect.poll(async () => (await read(page, workspace.id)).input.generationMode).toBe("HOURS_ONLY");
    await both.check();
    await expect.poll(async () => (await read(page, workspace.id)).input.generationMode).toBe("DAYS_AND_HOURS");
  } finally { await cleanup(page, workspace.id); }
});

test("autosave serializes real writes and a delayed acknowledgement never replaces newer typing", async ({ page }) => {
  await loginAsAdmin(page);
  const workspace = await fixture(page, "slow");
  const committed = gate(), release = gate();
  const writes: { revision: number; hours: number }[] = [];
  try {
    await open(page, workspace);
    await page.route("**/api/escalas", async route => {
      if (!isSave(route, workspace.id)) return route.continue();
      const body = route.request().postDataJSON(); writes.push({ revision: body.expectedRevision, hours: body.input.defaultWeeklyHours });
      if (writes.length === 1) { const response = await route.fetch(); expect(response.status()).toBe(200); committed.release(); await release.promise; await route.fulfill({ response }); }
      else await route.continue();
    });
    const journey = page.getByLabel("Jornada semanal", { exact: true });
    await journey.selectOption("40");
    await committed.promise;
    await expect(journey).toBeEnabled();
    await journey.selectOption("44");
    expect(writes).toEqual([{ revision: workspace.revision, hours: 40 }]);
    release.release();
    await expect(journey).toHaveValue("44");
    await expect.poll(async () => (await read(page, workspace.id)).input.defaultWeeklyHours).toBe(44);
    const saved = await read(page, workspace.id);
    expect(saved.revision).toBe(workspace.revision + 2);
    expect(saved.status).toBe("DRAFT");
    expect(writes).toEqual([{ revision: workspace.revision, hours: 40 }, { revision: workspace.revision + 1, hours: 44 }]);
    await expect(page.locator('[data-state="saved"]')).toBeVisible();
    await page.reload();
    await selectEscalasWorkspace(page, workspace);
    await selectStep(page, "generate");
    await expect(journey).toHaveValue("44");
  } finally { release.release(); await page.unrouteAll({ behavior: "wait" }); await cleanup(page, workspace.id); }
});

test("a lost acknowledgement is reconciled by GET without duplicating a committed revision", async ({ page }) => {
  await loginAsAdmin(page);
  const workspace = await fixture(page, "ack");
  let writes = 0, reads = 0;
  try {
    await open(page, workspace);
    await page.route("**/api/escalas**", async route => {
      if (route.request().method() === "GET" && new URL(route.request().url()).searchParams.get("id") === workspace.id) { reads++; return route.continue(); }
      if (!isSave(route, workspace.id)) return route.continue();
      writes++;
      if (writes === 1) { const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("connectionfailed"); }
      else await route.continue();
    });
    await page.getByLabel("Jornada semanal", { exact: true }).selectOption("40");
    await expect(page.locator('[data-state="saved"]')).toBeVisible();
    const saved = await read(page, workspace.id);
    expect(saved.input.defaultWeeklyHours).toBe(40);
    expect(saved.revision).toBe(workspace.revision + 1);
    expect(writes).toBe(1); expect(reads).toBeGreaterThan(0);
    await page.reload();
    await selectEscalasWorkspace(page, workspace);
    await selectStep(page, "generate");
    await expect(page.getByLabel("Jornada semanal", { exact: true })).toHaveValue("40");
  } finally { await page.unrouteAll({ behavior: "wait" }); await cleanup(page, workspace.id); }
});

test("a write lost before persistence keeps the draft and checks the saved revision before an explicit retry", async ({ page }) => {
  await loginAsAdmin(page);
  const workspace = await fixture(page, "offline");
  const operations: string[] = [];
  let writes = 0;
  try {
    await open(page, workspace);
    await page.route("**/api/escalas**", async route => {
      if (route.request().method() === "GET" && new URL(route.request().url()).searchParams.get("id") === workspace.id) { operations.push("read"); return route.continue(); }
      if (!isSave(route, workspace.id)) return route.continue();
      writes++; operations.push("write" + writes);
      if (writes === 1) await route.abort("connectionfailed"); else await route.continue();
    });
    const journey = page.getByLabel("Jornada semanal", { exact: true });
    await journey.selectOption("40");
    await expect(page.locator('[data-state="error"]')).toBeVisible();
    await expect(journey).toHaveValue("40");
    expect((await read(page, workspace.id)).revision).toBe(workspace.revision);
    await page.getByRole("button", { name: "Tentar salvar", exact: true }).click();
    await expect(page.locator('[data-state="saved"]')).toBeVisible();
    const saved = await read(page, workspace.id);
    expect(saved.revision).toBe(workspace.revision + 1);
    expect(saved.input.defaultWeeklyHours).toBe(40);
    expect(operations.indexOf("read")).toBeGreaterThan(operations.indexOf("write1"));
    expect(operations.indexOf("read")).toBeLessThan(operations.indexOf("write2"));
  } finally { await page.unrouteAll({ behavior: "wait" }); await cleanup(page, workspace.id); }
});

test("an external revision conflict preserves both the newer server content and the recoverable local draft", async ({ page }) => {
  await loginAsAdmin(page);
  const workspace = await fixture(page, "conflict");
  const captured = gate(), release = gate(); let writes = 0;
  try {
    await open(page, workspace);
    await page.route("**/api/escalas", async route => {
      if (!isSave(route, workspace.id)) return route.continue();
      writes++; captured.release(); await release.promise; await route.continue();
    });
    await page.getByLabel("Jornada semanal", { exact: true }).selectOption("40");
    await captured.promise;
    const externalInput = { ...workspace.input, branchName: "Edição externa preservada" };
    const external = await page.request.post("/api/escalas", { headers: { origin: new URL(page.url()).origin }, data: { action: "SAVE", id: workspace.id, expectedRevision: workspace.revision, input: externalInput } });
    expect(external.status()).toBe(200); release.release();
    await expect(page.locator('[data-state="conflict"]')).toBeVisible();
    await expect(page.getByLabel("Jornada semanal", { exact: true })).toHaveValue("40");
    const saved = await read(page, workspace.id);
    expect(saved.input.defaultWeeklyHours).toBe(42); expect(saved.input.branchName).toBe("Edição externa preservada");
    expect(saved.revision).toBe(workspace.revision + 1); expect(writes).toBe(1);
    page.once("dialog", dialog => void dialog.accept());
    await page.reload();
    await selectEscalasWorkspace(page, workspace);
    await selectStep(page, "generate");
    await expect(page.getByRole("alert", { name: "Rascunho recuperável", exact: true })).toBeVisible();
    await expect(page.getByLabel("Jornada semanal", { exact: true })).toHaveValue("42");
    await expect(page.getByLabel("Jornada semanal", { exact: true })).toBeDisabled();
    const preserved = await page.evaluate(id => sessionStorage.getItem("perfectutilitares.escalas.draft:" + id), workspace.id);
    if (!preserved) throw new Error("The recoverable draft must exist before reloading");
    expect(JSON.parse(preserved).input.defaultWeeklyHours).toBe(40);
    await page.reload();
    await selectEscalasWorkspace(page, workspace);
    expect(await page.evaluate(id => sessionStorage.getItem("perfectutilitares.escalas.draft:" + id), workspace.id)).toBe(preserved);
    expect((await read(page, workspace.id)).input.branchName).toBe("Edição externa preservada");
  } finally { release.release(); await page.unrouteAll({ behavior: "wait" }); await cleanup(page, workspace.id); }
});

test("the main workspace prepares real files for the exact saved revision and invalidates them after a changed scenario", async ({ page }) => {
  await loginAsAdmin(page);
  const workspace = await fixture(page, "files");
  try {
    await open(page, workspace, "roster");
    await expect(page.getByRole("link", { name: "Baixar PDF", exact: true })).toHaveCount(0);
    for (const format of ["PDF", "XLSX"] as const) {
      const expected = await prepareBasicExport(page, workspace, format);
      const link = page.getByRole("link", { name: "Baixar " + format, exact: true }); await expect(link).toBeVisible();
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15_000 }), link.click()]);
      try {
        expect(download.suggestedFilename()).toContain("-r" + workspace.revision + "-both.");
        const bytes = await downloadBytes(download);
        expect(bytes.equals(expected), "Downloaded " + format + " must match the export response").toBe(true);
        if (format === "PDF") expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
        else { const files = unzipSync(bytes), book = strFromU8(files["xl/workbook.xml"]); expect(book).toContain('name="Escala"'); expect(book).toContain('name="Horarios"'); expect(book).not.toMatch(/name="(?:Conferencia|Turnos|Jornadas)"/); }
      } finally { await download.delete(); }
    }
    await selectStep(page, "generate");
    await page.getByLabel("Jornada semanal", { exact: true }).selectOption("40");
    await expect(page.getByRole("link", { name: "Baixar PDF", exact: true })).toHaveCount(0);
    await selectStep(page, "roster");
    await expect(page.getByRole("button", { name: "Gerar PDF", exact: true })).toBeDisabled();
    await selectStep(page, "generate");
    await page.locator("#escala-adjust-hours-title").click();
    await page.getByRole("button", { name: "Ajustar horários no rascunho", exact: true }).click();
    const solving = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "GENERATE" && response.request().postDataJSON()?.id === workspace.id, { timeout: 40_000 });
    await page.getByRole("button", { name: "Gerar nova proposta", exact: true }).click();
    const response = await solving;
    expect(response.status(), "Generation must return a successful proposal").toBe(200);
    const solution = await response.json(); expect(["FEASIBLE", "OPTIMAL"]).toContain(solution.result.status); expect(solution.validation.valid).toBe(true);
    const applying = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "APPLY_PROPOSAL" && response.request().postDataJSON()?.id === workspace.id);
    await page.getByRole("region", { name: "Proposta pronta para revisão", exact: true })
      .getByRole("button", { name: "Aplicar proposta à grade", exact: true }).click();
    expect((await applying).status()).toBe(200);
    await expect(page.locator('[data-state="saved"]')).toBeVisible();
    const saved = await read(page, workspace.id); expect(saved.input.defaultWeeklyHours).toBe(40); expect(saved.status).toBe("DRAFT");
    await selectStep(page, "roster");
    const expected = await prepareBasicExport(page, saved, "PDF");
    const link = page.getByRole("link", { name: "Baixar PDF", exact: true });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15_000 }), link.click()]);
    try {
      expect(download.suggestedFilename()).toContain("-r" + saved.revision + "-both.pdf");
      expect((await downloadBytes(download)).equals(expected), "Regenerated PDF must match the export response").toBe(true);
    } finally { await download.delete(); }
  } finally { await cleanup(page, workspace.id); }
});

// Nominal access, scope, revocation and recovery are covered with owned identities
// in escalas-scoped-access.spec.ts; the retired shared password is never used.


test("autosave resumes after a long independent validation without requiring another edit", async ({ page }) => {
  const clockStart = Date.now();
  await page.clock.install({ time: clockStart });
  await loginAsAdmin(page);
  const workspace = await fixture(page, "validate");
  const captured = gate(), release = gate(); let writes = 0;
  try {
    await open(page, workspace);
    await page.route("**/api/escalas", async route => {
      if (isSave(route, workspace.id)) { writes++; return route.continue(); }
      if (route.request().method() === "POST" && route.request().postDataJSON()?.action === "VALIDATE"
          && route.request().postDataJSON()?.id === workspace.id) { captured.release(); await release.promise; }
      await route.continue();
    });
    await selectAdjustments(page);
    await expect(page.getByRole("button", { name: "Conferir dados atuais", exact: true })).toBeEnabled();
    await selectStep(page, "generate");
    // Freeze only browser timers so automation latency cannot consume the debounce before validation starts.
    await page.clock.pauseAt(clockStart + 60_000);
    await page.getByLabel("Jornada semanal", { exact: true }).selectOption("40");
    await selectAdjustments(page);
    await page.getByRole("button", { name: "Conferir dados atuais", exact: true }).click();
    await captured.promise;
    // This deliberately exceeds the product's 850ms debounce while VALIDATE still owns the operation lock.
    await page.clock.runFor(1100);
    expect(writes).toBe(0);
    release.release();
    await expect(page.getByRole("button", { name: "Conferir dados atuais", exact: true })).toBeEnabled();
    await page.clock.runFor(1000);
    await expect.poll(async () => (await read(page, workspace.id)).input.defaultWeeklyHours).toBe(40);
    expect(writes).toBe(1);
    await expect(page.locator('[data-state="saved"]')).toBeVisible();
  } finally { release.release(); await page.unrouteAll({ behavior: "wait" }); await cleanup(page, workspace.id); }
});
