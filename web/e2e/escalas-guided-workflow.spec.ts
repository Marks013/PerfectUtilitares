import { expect, test, type Page, type Route } from "@playwright/test";
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
  const input = newInput("GUI-" + Date.now().toString(36) + suffix, "Fluxo sintético " + suffix, "2026-11", 42);
  input.employees = [{ ...newEmployee(42, input.shifts[0].id), id: "person", registration: "001", name: "Pessoa sintética", sector: "Loja", role: "Repositor", weeklyHoursMode: "BRANCH", activeFrom: "" }];
  input.assignments = dateRange(input.startDate, input.endDate).map(date => ({ employeeId: "person", date, kind: dayOfWeek(date) >= 1 && dayOfWeek(date) <= 5 ? "WORK" : "OFF", ...(dayOfWeek(date) >= 1 && dayOfWeek(date) <= 5 ? { shiftId: input.shifts[0].id } : {}) }));
  const response = await page.request.post("/api/escalas", { headers: { origin: new URL(page.url()).origin }, data: { action: "CREATE", input } });
  expect(response.status()).toBe(201);
  return response.json() as Promise<EscalaWorkspace>;
}
async function open(page: Page, workspace: EscalaWorkspace) {
  await page.goto("/escala");
  await page.getByLabel("Selecionar filial e período", { exact: true }).selectOption(workspace.id);
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
    await page.getByLabel("Selecionar filial e período", { exact: true }).selectOption(workspace.id);
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
    await page.getByLabel("Selecionar filial e período", { exact: true }).selectOption(workspace.id);
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
    await page.getByLabel("Selecionar filial e período", { exact: true }).selectOption(workspace.id);
    await expect(page.getByRole("alert", { name: "Rascunho recuperável", exact: true })).toBeVisible();
    await expect(page.getByLabel("Jornada semanal", { exact: true })).toHaveValue("42");
    await expect(page.getByLabel("Jornada semanal", { exact: true })).toBeDisabled();
    const preserved = await page.evaluate(id => sessionStorage.getItem("perfectutilitares.escalas.draft:" + id), workspace.id);
    expect(JSON.parse(preserved!).input.defaultWeeklyHours).toBe(40);
    await page.reload();
    await page.getByLabel("Selecionar filial e período", { exact: true }).selectOption(workspace.id);
    expect(await page.evaluate(id => sessionStorage.getItem("perfectutilitares.escalas.draft:" + id), workspace.id)).toBe(preserved);
    expect((await read(page, workspace.id)).input.branchName).toBe("Edição externa preservada");
  } finally { release.release(); await page.unrouteAll({ behavior: "wait" }); await cleanup(page, workspace.id); }
});

test("the main workspace prepares real files for the exact saved revision and invalidates them after a changed scenario", async ({ page }) => {
  await loginAsAdmin(page);
  const workspace = await fixture(page, "files");
  try {
    await open(page, workspace);
    await expect(page.getByRole("link", { name: "Baixar PDF", exact: true })).toHaveCount(0);
    for (const format of ["PDF", "XLSX"] as const) {
      await page.getByRole("button", { name: "Gerar " + format, exact: true }).click();
      const link = page.getByRole("link", { name: "Baixar " + format, exact: true }); await expect(link).toBeVisible();
      const downloading = page.waitForEvent("download"); await link.click(); const download = await downloading;
      expect(await download.failure()).toBeNull(); expect(download.suggestedFilename()).toContain("-r" + workspace.revision + "-both.");
      const stream = await download.createReadStream(); if (!stream) throw new Error("Actual download stream missing");
      const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); const bytes = Buffer.concat(chunks);
      if (format === "PDF") expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
      else { const files = unzipSync(bytes), book = strFromU8(files["xl/workbook.xml"]); expect(book).toContain('name="Escala"'); expect(book).toContain('name="Horarios"'); expect(book).not.toMatch(/name="(?:Conferencia|Turnos|Jornadas)"/); }
      await download.delete();
    }
    await page.getByLabel("Jornada semanal", { exact: true }).selectOption("40");
    await expect(page.getByRole("link", { name: "Baixar PDF", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Gerar PDF", exact: true })).toBeDisabled();
    await page.locator("#escala-adjust-hours-title").click();
    await page.getByRole("button", { name: "Ajustar horários no rascunho", exact: true }).click();
    const solving = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "GENERATE");
    await page.locator('section[aria-labelledby="escala-scenario-title"]').getByRole("button", { name: "Gerar nova proposta", exact: true }).click();
    const solution = await (await solving).json(); expect(["FEASIBLE", "OPTIMAL"]).toContain(solution.result.status); expect(solution.validation.valid).toBe(true);
    await page.getByRole("button", { name: "Aplicar proposta à grade", exact: true }).click();
    await expect(page.locator('[data-state="saved"]')).toBeVisible();
    const saved = await read(page, workspace.id); expect(saved.input.defaultWeeklyHours).toBe(40); expect(saved.status).toBe("DRAFT");
    await page.getByRole("button", { name: "Gerar PDF", exact: true }).click();
    const downloading = page.waitForEvent("download"); await page.getByRole("link", { name: "Baixar PDF", exact: true }).click();
    const download = await downloading; expect(download.suggestedFilename()).toContain("-r" + saved.revision + "-both.pdf"); await download.delete();
  } finally { await cleanup(page, workspace.id); }
});

test("shared operational access is independent, scoped, revocable and restores an expired draft without admin login", async ({ page, browser }) => {
  const password = process.env.E2E_UNIMED_STANDARD_PASSWORD;
  if (!password) throw new Error("Isolated standard module password is required");
  const database = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid").pathname.slice(1);
  expect(database.startsWith("perfectutilitares_e2e_")).toBe(true);
  const adminContext = await browser.newContext({ baseURL: test.info().project.use.baseURL }); const admin = await adminContext.newPage();
  await loginAsAdmin(admin); const workspace = await fixture(admin, "access");
  const { prisma } = await import("../src/lib/prisma");
  const tenant = await prisma.tenant.create({ data: { name: "Outro escopo de teste", slug: "e2e-scope-" + Date.now().toString(36) } });
  const foreign = await prisma.escalaWorkspace.create({ data: { tenantId: tenant.id, branchCode: workspace.input.branchCode, branchName: "Escopo privado", startDate: workspace.input.startDate, endDate: workspace.input.endDate } });
  const origin = new URL(admin.url()).origin;
  try {
    await page.goto("/escalas"); await expect(page).toHaveURL(/\/escala$/);
    await expect(page.getByRole("heading", { name: "Acesso ao planejamento de escalas", exact: true })).toBeVisible();
    expect((await page.request.get("/api/escalas")).status()).toBe(401);
    await page.getByLabel("Senha operacional", { exact: true }).fill("wrong-isolated-password");
    await page.getByRole("button", { name: "Liberar planejamento", exact: true }).click(); await expect(page.locator("#escala-access-error")).toContainText("Senha incorreta");
    const unlock = async () => { await page.getByLabel("Senha operacional", { exact: true }).fill(password); await page.getByRole("button", { name: "Liberar planejamento", exact: true }).click(); await expect(page.getByRole("button", { name: "Bloquear Escalas", exact: true })).toBeVisible(); };
    await unlock();
    expect((await page.request.get("/api/admin/users")).status()).toBe(401);
    expect((await page.request.post("/api/escalas", { headers: { origin }, data: { action: "PUBLISH", id: workspace.id, expectedRevision: workspace.revision } })).status()).toBe(403);
    const cookie = (await page.context().cookies()).find(value => value.name === "perfectutilitares.escalas-access"); expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict" });
    expect((await page.request.get("/api/escalas?id=" + foreign.id)).status()).toBe(404);
    expect((await page.request.get("/api/escalas/export?id=" + foreign.id + "&revision=1&format=pdf")).status()).toBe(404);
    expect((await page.request.post("/api/escalas", { headers: { origin }, data: { action: "SAVE", id: foreign.id, expectedRevision: 1, input: workspace.input } })).status()).toBe(404);
    expect((await page.request.post("/api/escalas", { headers: { origin }, data: { action: "GENERATE", id: foreign.id, expectedRevision: 1 } })).status()).toBe(404);
    expect((await page.request.delete("/api/escalas", { headers: { origin }, data: { workspaceId: foreign.id, expectedRevision: 1 } })).status()).toBe(404);
    const list = await page.request.get("/api/escalas").then(response => response.json()); expect(list.workspaces.some((item: { id: string }) => item.id === foreign.id)).toBe(false);
    expect((await page.request.get("/api/unimed/access/session")).status()).toBe(401);
    expect((await page.request.post("/api/unimed/access/session", { headers: { origin }, data: { password } })).status()).toBe(200);
    await page.getByLabel("Selecionar filial e período", { exact: true }).selectOption(workspace.id);
    await page.getByLabel("Jornada semanal", { exact: true }).selectOption("40");
    await page.getByRole("button", { name: "Bloquear Escalas", exact: true }).click();
    await expect(page.getByLabel("Senha operacional", { exact: true })).toBeVisible();
    expect((await page.request.get("/api/escalas?id=" + workspace.id)).status()).toBe(401);
    expect((await page.request.post("/api/escalas/import", { headers: { origin } })).status()).toBe(401);
    expect((await page.request.get("/api/escalas/export?id=" + workspace.id + "&revision=1&format=xlsx")).status()).toBe(401);
    expect((await page.request.get("/api/unimed/access/session")).status()).toBe(200);
    for (const action of ["SAVE", "GENERATE", "VALIDATE"] as const) expect((await page.request.post("/api/escalas", { headers: { origin }, data: { action, id: workspace.id, expectedRevision: workspace.revision, input: workspace.input } })).status()).toBe(401);
    expect((await page.request.delete("/api/escalas", { headers: { origin }, data: { workspaceId: workspace.id, expectedRevision: workspace.revision } })).status()).toBe(401);
    await unlock();
    await expect(page.getByLabel("Jornada semanal", { exact: true })).toHaveValue("40");
    await expect.poll(async () => (await read(admin, workspace.id)).input.defaultWeeklyHours).toBe(40);
    await expect(page.locator('[data-state="saved"]')).toBeVisible();
    const liveCookie = (await page.context().cookies()).find(value => value.name === "perfectutilitares.escalas-access"); if (!liveCookie) throw new Error("Module cookie missing");
    // Expire the browser credential, then let a real protected SAVE return 401.
    await page.context().addCookies([{ ...liveCookie, expires: Math.floor(Date.now() / 1000) - 10 }]);
    await page.getByLabel("Jornada semanal", { exact: true }).selectOption("44");
    await expect(page.getByLabel("Senha operacional", { exact: true })).toBeVisible();
    await expect(page.getByText(/seu rascunho foi mantido nesta tela/)).toBeVisible();
    await unlock();
    await expect(page.getByLabel("Jornada semanal", { exact: true })).toHaveValue("44");
    await expect.poll(async () => (await read(admin, workspace.id)).input.defaultWeeklyHours).toBe(44);
    const saved = await read(admin, workspace.id); expect(saved.status).toBe("DRAFT");
    const revision = await prisma.escalaRevision.findUnique({ where: { tenantId_workspaceId_revision: { tenantId: (await prisma.escalaWorkspace.findUniqueOrThrow({ where: { id: workspace.id } })).tenantId, workspaceId: workspace.id, revision: saved.revision } } });
    expect(revision).toMatchObject({ createdById: null, accessChannel: "ESCALAS_MODULE_PASSWORD" }); expect(revision?.moduleSessionId).toBeTruthy();
    expect((await page.request.post("/api/escalas/access/session", { headers: { origin: "https://foreign.invalid" }, data: { password } })).status()).toBe(403);
    const attempts: number[] = []; for (let index = 0; index < 6; index++) attempts.push((await page.request.post("/api/escalas/access/session", { headers: { origin }, data: { password: "wrong-isolated-password" } })).status());
    expect(attempts).toContain(429);
  } finally {
    await cleanup(admin, workspace.id); await prisma.escalaWorkspace.delete({ where: { id: foreign.id } }); await prisma.tenant.delete({ where: { id: tenant.id } }); await prisma.$disconnect(); await adminContext.close();
  }
});


test("autosave resumes after a long independent validation without requiring another edit", async ({ page }) => {
  await loginAsAdmin(page);
  const workspace = await fixture(page, "validate");
  const captured = gate(), release = gate(); let writes = 0;
  try {
    await open(page, workspace);
    await page.route("**/api/escalas", async route => {
      if (isSave(route, workspace.id)) { writes++; return route.continue(); }
      if (route.request().method() === "POST" && route.request().postDataJSON()?.action === "VALIDATE") { captured.release(); await release.promise; }
      await route.continue();
    });
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Conferir dados atuais", exact: true })).toBeEnabled();
    await page.getByLabel("Jornada semanal", { exact: true }).selectOption("40");
    await page.getByRole("button", { name: "Conferir dados atuais", exact: true }).click();
    await captured.promise;
    // This deliberately exceeds the product's 850ms debounce while VALIDATE still owns the operation lock.
    await page.waitForTimeout(1100);
    expect(writes).toBe(0);
    release.release();
    await expect.poll(async () => (await read(page, workspace.id)).input.defaultWeeklyHours).toBe(40);
    expect(writes).toBe(1);
    await expect(page.locator('[data-state="saved"]')).toBeVisible();
  } finally { release.release(); await page.unrouteAll({ behavior: "wait" }); await cleanup(page, workspace.id); }
});
