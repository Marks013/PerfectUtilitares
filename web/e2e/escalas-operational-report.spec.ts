import { expect, test } from "./fixtures";
import { loginAsAdmin } from "./admin-session";
import { selectEscalasWorkspace } from "./escalas-selection";
import { newEmployee, newInput } from "../src/components/escalas/workspace-model";
import type { EscalaWorkspace } from "../src/lib/escalas/types";
import { PDFDocument } from "pdf-lib";
import type { APIResponse, Response } from "@playwright/test";
import { pdfJsServerDocumentOptions } from "../src/lib/pdf/pdfjs-server";

test.use({ trace: "off", screenshot: "off", video: "off" });

async function expectSavedReferencePdf(response: APIResponse | Response, workspace: EscalaWorkspace) {
  const query = new URL(response.url()).searchParams;
  expect(query.get("workspaceId")).toBe(workspace.id);
  expect(query.get("revision")).toBe(String(workspace.revision));
  expect(query.get("month")).toBe(workspace.input.visibleMonth);
  // Report the structured failure code for this synthetic workspace, never a binary PDF body.
  const failure = response.ok() ? null : await response.json().catch(() => null) as { error?: { code?: string } } | null;
  expect(response.status(), `operational-report code=${failure?.error?.code ?? "none"}`).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  const bytes = new Uint8Array(await response.body());
  expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes)), document = await task.promise;
  try {
    const parts: string[] = [];
    for (let i = 1; i <= document.numPages; i++) {
      const content = await (await document.getPage(i)).getTextContent();
      parts.push(content.items.filter(item => "str" in item).map(item => item.str).join(" "));
    }
    const text = parts.join(" ").replace(/\s+/g, " ");
    expect(text).toContain("Жanna de teste");
    expect(text).toContain("08:00-12:00"); expect(text).toContain("13:00-17:00");
    expect(text).toContain("sem grade diária");
    expect(text).not.toMatch(/Calendário mensal|Mapa diário|Pessoas-dia/);
  } finally { await task.destroy(); }
}

for (const mode of ["REST_ONLY", "HOURS_ONLY", "DAYS_AND_HOURS"] as const) {
  test(`operational PDF uses saved references without inventing a roster: ${mode}`, async ({ page }) => {
    test.skip(process.env.E2E_MUTATION !== "1", "Requires the disposable isolated E2E database");
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsAdmin(page);
    const branch = "8" + Date.now().toString().slice(-7);
    const input = newInput(branch, "Filial sintética", "2026-11", 40);
    input.generationMode = mode;
    input.employees = [{ ...newEmployee(40, input.shifts.map(shift => shift.id)), id: "person", registration: "0001", name: "Жanna de teste", sector: "Loja", role: "Repositor", activeFrom: "2020-01-01" }];
    input.assignments = [{ employeeId: "person", date: "2026-11-05", kind: "ABSENCE", locked: true }, { employeeId: "person", date: "2026-11-15", kind: "HOLIDAY", locked: true }];
    const headers = { origin: new URL(page.url()).origin };
    const created = await page.request.post("/api/escalas", { headers, data: { action: "CREATE", input } });
    expect(created.status()).toBe(201);
    const workspace: EscalaWorkspace = await created.json();
    try {
      expect(workspace.input.employees[0].shiftIds).toEqual(input.employees[0].shiftIds);
      expect(workspace.input.visibleMonth).toBe("2026-11");
      expect(workspace.input.assignments).toEqual(input.assignments);
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
      await expectSavedReferencePdf(response, workspace);
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
      expect(current.input).toEqual(workspace.input);
    } finally {
      const current: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(result => result.json());
      expect(current.input.branchCode).toBe(branch); expect(current.status).toBe("DRAFT");
      expect((await page.request.delete("/api/escalas", { headers, data: { workspaceId: current.id, expectedRevision: current.revision } })).status()).toBe(200);
    }
  });
}

test("missing saved references keep their 409 and show the reference guidance", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires the disposable isolated E2E database");
  await loginAsAdmin(page);
  const input = newInput("8" + Date.now().toString().slice(-7), "Filial sintética", "2026-11", 40);
  input.generationMode = "HOURS_ONLY";
  input.employees = [{ ...newEmployee(40, []), id: "person", registration: "0001", name: "Pessoa de teste", sector: "Loja", role: "Repositor", activeFrom: "2020-01-01" }];
  const headers = { origin: new URL(page.url()).origin };
  const created = await page.request.post("/api/escalas", { headers, data: { action: "CREATE", input } });
  expect(created.status()).toBe(201); const workspace: EscalaWorkspace = await created.json();
  try {
    await page.goto("/escala"); await selectEscalasWorkspace(page, workspace);
    const panel = page.locator("details").filter({ has: page.getByText("Relatórios operacionais (opcional)", { exact: true }) });
    await panel.getByText("Relatórios operacionais (opcional)", { exact: true }).click();
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/api/escalas/operational-report");
    await panel.getByRole("button", { name: "Gerar PDF operacional" }).click();
    const response = await pending;
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "ESCALA_REPORT_REFERENCES_INVALID" } });
    await expect(panel.getByRole("alert")).toContainText("Confira os horários de referência");
    await expect(panel.getByRole("alert")).not.toContainText("A revisão mudou");
  } finally {
    const current: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json());
    expect(current.revision).toBe(workspace.revision); expect(current.input).toEqual(workspace.input);
    expect((await page.request.delete("/api/escalas", { headers, data: { workspaceId: current.id, expectedRevision: current.revision } })).status()).toBe(200);
  }
});

test("a delayed PDF from the previous workspace never starts a download", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires the disposable isolated E2E database");
  await loginAsAdmin(page);
  const headers = { origin: new URL(page.url()).origin };
  const workspaces: EscalaWorkspace[] = [];
  try {
    for (const prefix of ["7", "8"]) {
      const input = newInput(prefix + Date.now().toString().slice(-7), "Filial sintética", "2026-11", 40);
      input.generationMode = "HOURS_ONLY";
      input.employees = [{ ...newEmployee(40, input.shifts.map(shift => shift.id)), id: "person", registration: "0001", name: "Жanna de teste", sector: "Loja", role: "Repositor", activeFrom: "2020-01-01" }];
      const response = await page.request.post("/api/escalas", { headers, data: { action: "CREATE", input } });
      expect(response.status()).toBe(201); workspaces.push(await response.json());
    }
    await page.goto("/escala"); await selectEscalasWorkspace(page, workspaces[0]);
    const panel = page.locator("details").filter({ has: page.getByText("Relatórios operacionais (opcional)", { exact: true }) });
    await panel.getByText("Relatórios operacionais (opcional)", { exact: true }).click();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let captured!: (response: APIResponse) => void; const pending = new Promise<APIResponse>(resolve => { captured = resolve; });
    await page.route("**/api/escalas/operational-report?*", async route => {
      const response = await route.fetch(); captured(response); await gate;
      await route.fulfill({ response }).catch(() => {});
    });
    let downloads = 0; page.on("download", () => downloads++);
    try {
      await panel.getByRole("button", { name: "Gerar PDF operacional" }).click();
      await expectSavedReferencePdf(await pending, workspaces[0]);
      await selectEscalasWorkspace(page, workspaces[1]);
    } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
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
