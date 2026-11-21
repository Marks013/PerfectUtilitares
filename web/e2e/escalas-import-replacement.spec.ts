import { expect, test } from "./fixtures";
import { loginAsAdmin } from "./admin-session";
import { newEmployee, newInput } from "../src/components/escalas/workspace-model";
import type { EscalaWorkspace } from "../src/lib/escalas/types";
import { openEscalasArea, selectEscalasWorkspace } from "./escalas-selection";
import { absenceCsv, applyReplacement, employeeCsv, importPanel, isImportResponse, ownedAccountScope, previewReplacement, readWorkspace, removeOwnedWorkspace, responseWorkspace, syntheticBranch } from "./escalas-access-fixtures";

test.use({ trace: "off", screenshot: "off", video: "off" });

test.beforeEach(async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires explicitly authorized isolated E2E data");
  test.setTimeout(120_000);
  await loginAsAdmin(page);
});

async function createAB(page: import("@playwright/test").Page) {
  const input = newInput(syntheticBranch("REPLACE"), "Substituição sintética", "2026-12", 40);
  input.shifts = [{ id: "day", name: "Diurno", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1020, kind: "WORK" }] }];
  input.employees = ["0001", "0002"].map((registration, index) => ({ ...newEmployee(40, "day"), id: index ? "B" : "A", registration, name: `Pessoa ${registration}`, sector: "Loja", role: "Operador", activeFrom: "2020-01-01", scheduleMode: "TIMED", weeklyHoursMode: "INDIVIDUAL" }));
  input.employees[1].historyKnown = true;
  input.employees[1].history = [{ employeeId: "B", date: "2026-11-29", kind: "OFF" }];
  const created = await responseWorkspace(await page.request.post("/api/escalas", { headers: { origin: new URL(page.url()).origin }, data: { action: "CREATE", input } }), 201);
  await page.goto("/escala"); await selectEscalasWorkspace(page, created);
  return created;
}

test("PREVIEW leaves A/B intact; visible removals and one explicit APPLY adopt canonical B/C", async ({ page }) => {
  const created = await createAB(page);
  try {
    const reviewed = await previewReplacement(page, "EMPLOYEES", { name: "equipe.csv", mimeType: "text/csv", buffer: employeeCsv(["0002", "0003"]) });
    expect(reviewed.preview.canApply).toBe(true); expect(reviewed.preview.blockers).toEqual([]);
    expect(reviewed.preview.counts).toMatchObject({ addedPeople: 1, removedPeople: 1 });
    const unchanged = await readWorkspace(page, created.id); expect(unchanged.revision).toBe(created.revision); expect(unchanged.input).toEqual(created.input);
    const removed = reviewed.panel.locator("details").filter({ has: reviewed.panel.locator("summary").filter({ hasText: /^Pessoas retiradas \(1\)$/ }) });
    await expect(removed).toHaveAttribute("open", ""); await expect(removed).toContainText("0001 · Pessoa 0001");
    await expect(reviewed.panel.getByRole("region", { name: "Conferência da substituição", exact: true })).toBeFocused();
    const apply = reviewed.panel.getByRole("button", { name: "Confirmar e salvar substituição de equipe", exact: true });
    await expect(apply).toBeDisabled(); await reviewed.panel.getByRole("checkbox", { name: /^Confirmo substituir equipe/ }).check();
    let applyRequests = 0;
    page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/escalas/import" && request.postDataBuffer()?.includes(Buffer.from('"action":"APPLY_REPLACE"'))) applyRequests++; });
    const receiving = page.waitForResponse(response => isImportResponse(response, "APPLY_REPLACE"));
    await apply.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    const response = await receiving; expect(response.status()).toBe(200);
    const { workspace: saved } = await response.json() as { workspace: EscalaWorkspace };
    expect(applyRequests).toBe(1); expect(saved.revision).toBe(created.revision + 1); expect(saved.status).toBe("DRAFT");
    expect(saved.input.employees.map(person => person.registration).sort()).toEqual(["0002", "0003"]);
    expect(saved.input.employees.find(person => person.registration === "0002")).toMatchObject({ id: "B", historyKnown: true, history: created.input.employees[1].history });
    const canonical = await readWorkspace(page, saved.id); expect(canonical.input).toEqual(saved.input);
    await expect(page.getByRole("heading", { name: /Filial .*Substituição sintética/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirmar e salvar substituição de equipe", exact: true })).toHaveCount(0);
  } finally { await removeOwnedWorkspace(page, created); }
});

test("partial absence file is blocked; scoped replacement preserves technical borders and leaves removed days empty", async ({ page }) => {
  let owned = await createAB(page);
  const origin = new URL(page.url()).origin;
  try {
    owned = await responseWorkspace(await page.request.post("/api/escalas", { headers: { origin }, data: { action: "SAVE", id: owned.id, expectedRevision: owned.revision,
      input: { ...owned.input, assignments: [{ employeeId: "A", date: "2026-11-30", kind: "ABSENCE", locked: true }, { employeeId: "A", date: "2026-12-02", kind: "ABSENCE", locked: true }, { employeeId: "B", date: "2027-01-01", kind: "ABSENCE", locked: true }] } } }));
    await page.reload(); await selectEscalasWorkspace(page, owned);
    const scope = { startDate: "2026-12-01", endDate: "2026-12-31" };
    const csv = absenceCsv([{ registration: "0002", start: "03/12/2026", end: "03/12/2026" }]);
    const partial = await previewReplacement(page, "ABSENCES", { name: "parcial.csv", mimeType: "text/csv", buffer: Buffer.concat([csv, Buffer.from("\r\ntruncated,record")]) }, scope);
    expect(partial.preview.canApply).toBe(false); expect(partial.preview.blockers.some(problem => problem.code === "SOURCE_PARTIAL")).toBe(true);
    await expect(partial.panel.getByRole("checkbox", { name: /^Confirmo substituir/ })).toBeDisabled();
    expect((await readWorkspace(page, owned.id)).input).toEqual(owned.input);
    const reviewed = await previewReplacement(page, "ABSENCES", { name: "afastamentos.csv", mimeType: "text/csv", buffer: csv }, scope);
    expect(reviewed.preview.canApply).toBe(true); expect(reviewed.preview.blockers).toEqual([]);
    expect(reviewed.preview.impact.absences.removed).toContainEqual({ employeeId: "A", registration: "0001", date: "2026-12-02" });
    expect(reviewed.preview.impact.absences.unchanged).toEqual(expect.arrayContaining([{ employeeId: "A", registration: "0001", date: "2026-11-30" }, { employeeId: "B", registration: "0002", date: "2027-01-01" }]));
    const result = await applyReplacement(page, reviewed.panel, "ABSENCES");
    expect(result.workspace.revision).toBe(owned.revision + 1);
    expect(result.workspace.input.employees).toEqual(owned.input.employees);
    expect(result.workspace.input.assignments).toEqual(expect.arrayContaining([owned.input.assignments[0], owned.input.assignments[2], { employeeId: "B", date: "2026-12-03", kind: "ABSENCE" }]));
    expect(result.workspace.input.assignments.some(day => day.employeeId === "A" && day.date === "2026-12-02")).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC-MEDICAL|SYNTHETIC-PRIVATE/);
  } finally { await removeOwnedWorkspace(page, owned); }
});

test("real revision conflict clears the preview and never retries APPLY automatically", async ({ page }) => {
  const created = await createAB(page); let requests = 0;
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/escalas/import" && request.postDataBuffer()?.includes(Buffer.from('"action":"APPLY_REPLACE"'))) requests++; });
  try {
    const reviewed = await previewReplacement(page, "EMPLOYEES", { name: "equipe.csv", mimeType: "text/csv", buffer: employeeCsv(["0002", "0003"]) });
    const external = await responseWorkspace(await page.request.post("/api/escalas", { headers: { origin: new URL(page.url()).origin }, data: { action: "SAVE", id: created.id, expectedRevision: created.revision, input: { ...created.input, branchName: "Revisão externa sintética" } } }));
    await reviewed.panel.getByRole("checkbox", { name: /^Confirmo substituir/ }).check();
    const receiving = page.waitForResponse(response => isImportResponse(response, "APPLY_REPLACE"));
    await reviewed.panel.getByRole("button", { name: "Confirmar e salvar substituição de equipe", exact: true }).click();
    expect((await receiving).status()).toBe(409);
    await expect(reviewed.panel.getByRole("alert")).toContainText(/revisão|Recarregue/);
    await expect(reviewed.panel.getByRole("region", { name: "Conferência da substituição", exact: true })).toHaveCount(0);
    expect((await readWorkspace(page, created.id)).input).toEqual(external.input);
    expect(requests).toBe(1);
  } finally { await removeOwnedWorkspace(page, created); }
});

test("a lost real APPLY acknowledgement reports uncertainty and requires explicit reload, without rollback or retry", async ({ page }) => {
  const created = await createAB(page); let requests = 0;
  try {
    const reviewed = await previewReplacement(page, "EMPLOYEES", { name: "equipe.csv", mimeType: "text/csv", buffer: employeeCsv(["0002", "0003"]) });
    await page.route("**/api/escalas/import", async route => {
      if (!route.request().postDataBuffer()?.includes(Buffer.from('"action":"APPLY_REPLACE"'))) return route.continue();
      requests++; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("connectionreset");
    });
    await reviewed.panel.getByRole("checkbox", { name: /^Confirmo substituir/ }).check();
    await reviewed.panel.getByRole("button", { name: "Confirmar e salvar substituição de equipe", exact: true }).click();
    await expect(reviewed.panel.getByRole("alert")).toContainText("Cancelar a espera não desfaz uma gravação");
    await expect(reviewed.panel.getByRole("alert")).toBeFocused(); expect(requests).toBe(1);
    const committed = await readWorkspace(page, created.id); expect(committed.revision).toBe(created.revision + 1);
    expect(committed.input.employees.map(person => person.registration).sort()).toEqual(["0002", "0003"]);
    await expect(reviewed.panel).toContainText(`revisão ${created.revision}.`);
    await page.unrouteAll({ behavior: "wait" }); await page.reload(); await selectEscalasWorkspace(page, committed);
    expect((await readWorkspace(page, committed.id)).revision).toBe(committed.revision); expect(requests).toBe(1);
  } finally { await page.unrouteAll({ behavior: "wait" }); await removeOwnedWorkspace(page, created); }
});

test("invalid end date focuses its associated error; editing or changing coverage invalidates an earlier preview", async ({ page }) => {
  const created = await createAB(page);
  try {
    const panel = await importPanel(page, "ABSENCES");
    await panel.getByLabel("Arquivo de afastamentos CSV", { exact: true }).setInputFiles({ name: "afastamentos.csv", mimeType: "text/csv", buffer: absenceCsv([{ registration: "0002", start: "03/12/2026", end: "03/12/2026" }]) });
    const end = panel.getByLabel("Substituir afastamentos até", { exact: true }); await end.fill("2027-01-04");
    await panel.getByRole("button", { name: "Conferir substituição de afastamentos", exact: true }).click();
    await expect(end).toBeFocused(); await expect(end).toHaveAttribute("aria-invalid", "true");
    expect(await end.evaluate(element => Boolean(document.getElementById(element.getAttribute("aria-describedby") ?? "")?.textContent))).toBe(true);
    await openEscalasArea(page, "team");
    const reviewed = await previewReplacement(page, "EMPLOYEES", { name: "equipe.csv", mimeType: "text/csv", buffer: employeeCsv(["0002", "0003"]) });
    await reviewed.panel.getByRole("checkbox", { name: /^Declaro/ }).uncheck();
    await expect(reviewed.panel.getByRole("region", { name: "Conferência da substituição", exact: true })).toHaveCount(0);
    expect((await readWorkspace(page, created.id)).revision).toBe(created.revision);
  } finally { await removeOwnedWorkspace(page, created); }
});

test("FPRE136 page gaps, duplicates, reversed pages and a missing first page block replacement without removing anyone", async ({ browser }) => {
  const scope = await ownedAccountScope(browser); const page = scope.admin;
  const input = newInput("02", "Filial sintética exclusiva", "2026-12", 40);
  input.employees = ["0001", "0002"].map((registration, index) => ({ ...newEmployee(40, input.shifts[0].id), id: index ? "B" : "A", registration, name: `Pessoa ${registration}`, sector: "Loja", role: "Operador", activeFrom: "2020-01-01" }));
  const owned = scope.trackWorkspace(await responseWorkspace(await scope.post({ action: "CREATE", input }), 201));
  try {
    await page.goto("/escala"); await selectEscalasWorkspace(page, owned);
    for (const pages of [[2], [1, 3], [1, 1], [2, 1], [0], [1, 0]]) {
      const rows = pages.flatMap((number, index) => [
        ["0001", "-", "Empresa sintética", "Pág.:", String(number)], ["Quadro de Horários"], ["", "Nome", "Cargo", "Horário"],
        ["02.01 , FILIAL SINTETICA, LOJA"], ["Horário:", "0026", "-", "Diurno"],
        [String(index + 2).padStart(4, "0"), "-", "Pessoa sintética", "Operador", "08:00", "-", "12:00", "13:00", "-", "17:00"],
        ["Sábado:", "08:00", "-", "12:00", "13:00", "-", "17:00", "08:00", "0026"],
      ]);
      const buffer = Buffer.from(rows.map(row => row.map(cell => JSON.stringify(cell)).join(",")).join("\r\n"));
      const reviewed = await previewReplacement(page, "EMPLOYEES", { name: "fpre-parcial.csv", mimeType: "text/csv", buffer });
      expect(reviewed.preview.layout).toBe("FPRE136"); expect(reviewed.preview.canApply).toBe(false);
      expect(reviewed.preview.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SOURCE_PARTIAL" })]));
      await expect(reviewed.panel.getByRole("checkbox", { name: /^Confirmo substituir/ })).toBeDisabled();
      await expect(reviewed.panel.getByRole("button", { name: "Confirmar e salvar substituição de equipe", exact: true })).toBeDisabled();
      const canonical = await readWorkspace(page, owned.id); expect(canonical.revision).toBe(owned.revision); expect(canonical.input).toEqual(owned.input);
    }
  } finally { await scope.cleanup(); }
});

test("cancelling the wait for a committed APPLY preserves uncertainty and never claims rollback", async ({ page }) => {
  const created = await createAB(page);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  let committed!: () => void; const received = new Promise<void>(resolve => { committed = resolve; }); let requests = 0;
  try {
    const reviewed = await previewReplacement(page, "EMPLOYEES", { name: "equipe.csv", mimeType: "text/csv", buffer: employeeCsv(["0002", "0003"]) });
    await page.route("**/api/escalas/import", async route => {
      if (!route.request().postDataBuffer()?.includes(Buffer.from('"action":"APPLY_REPLACE"'))) return route.continue();
      requests++; const response = await route.fetch(); expect(response.status()).toBe(200); committed(); await held;
      await route.fulfill({ response }).catch(() => {});
    });
    await reviewed.panel.getByRole("checkbox", { name: /^Confirmo substituir/ }).check();
    await reviewed.panel.getByRole("button", { name: "Confirmar e salvar substituição de equipe", exact: true }).click(); await received;
    await reviewed.panel.getByRole("button", { name: "Cancelar espera da importação", exact: true }).click();
    await expect(reviewed.panel.getByRole("alert")).toContainText("Cancelar a espera não desfaz uma gravação");
    const canonical = await readWorkspace(page, created.id); expect(canonical.revision).toBe(created.revision + 1);
    expect(canonical.input.employees.map(person => person.registration).sort()).toEqual(["0002", "0003"]);
    release(); await page.unrouteAll({ behavior: "wait" }); expect(requests).toBe(1);
    await expect(reviewed.panel.getByRole("region", { name: "Conferência da substituição", exact: true })).toHaveCount(0);
    await expect(reviewed.panel).toContainText(`revisão ${created.revision}.`);
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); await removeOwnedWorkspace(page, created); }
});

test("a delayed real PREVIEW from the previous plan cannot confirm or modify the new plan", async ({ page }) => {
  const previous = await createAB(page);
  const next = await createAB(page);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  let captured!: () => void; const received = new Promise<void>(resolve => { captured = resolve; });
  try {
    await selectEscalasWorkspace(page, previous);
    const panel = await importPanel(page, "EMPLOYEES");
    await panel.getByLabel("Arquivo de equipe CSV ou XLSX", { exact: true }).setInputFiles({ name: "equipe.csv", mimeType: "text/csv", buffer: employeeCsv(["0002", "0003"]) });
    await panel.getByRole("checkbox", { name: /^Declaro/ }).check();
    await page.route("**/api/escalas/import", async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200); captured(); await held;
      await route.fulfill({ response }).catch(() => {});
    });
    await panel.getByRole("button", { name: "Conferir substituição de equipe", exact: true }).click(); await received;
    await page.goto("/escala"); await selectEscalasWorkspace(page, next);
    release(); await page.unrouteAll({ behavior: "wait" });
    await openEscalasArea(page, "team");
    await expect(page.getByRole("region", { name: "Conferência da substituição", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Confirmar e salvar substituição de equipe", exact: true })).toHaveCount(0);
    for (const owned of [previous, next]) { const saved = await readWorkspace(page, owned.id); expect(saved.revision).toBe(owned.revision); expect(saved.input).toEqual(owned.input); }
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); await removeOwnedWorkspace(page, previous); await removeOwnedWorkspace(page, next); }
});
