import { expect, test } from "./fixtures";
import { openEscalasArea, revealEscalasControl, selectEscalasWorkspace } from "./escalas-selection";
import { applyReplacement, downloadBytes, prepareBasicExport, previewReplacement } from "./escalas-access-fixtures";
import type { EscalaWorkspace } from "../src/lib/escalas/types";
import { loginAsAdmin } from "./admin-session";
import { newEmployee, newInput } from "../src/components/escalas/workspace-model";

test.beforeEach(async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Scheduling writes require the disposable isolated E2E database");
  test.setTimeout(150_000);
  await loginAsAdmin(page);
});

test("monthly planning imports, previews real coverage loss, edits, undoes, swaps and safely deletes with persistence", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const branch = `E2E-${suffix}`;
  await page.goto("/escala");
  await page.getByLabel("Código da filial", { exact: true }).waitFor({ state: "attached" });
  await revealEscalasControl(page.getByLabel("Código da filial", { exact: true }));
  await page.getByLabel("Código da filial", { exact: true }).fill(branch);
  await page.getByLabel("Nome da filial (opcional)", { exact: true }).fill("Filial sintética E2E");
  await page.getByLabel("Mês de referência", { exact: true }).fill("2026-11");
  const creating = page.waitForResponse(response => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/escalas")) return false;
    const request = response.request().postDataJSON();
    return request?.action === "CREATE" && request.input?.branchCode === branch && request.input?.visibleMonth === "2026-11";
  });
  await page.getByRole("button", { name: "Iniciar planejamento", exact: true }).click();
  const created = await creating;
  expect(created.status()).toBe(201);
  const original: EscalaWorkspace = await created.json();
  try {
    expect(original.input.visibleMonth).toBe("2026-11");
    expect(original.input.planningWeekStartsOn).toBe("SUNDAY");
    await expect(page.getByRole("heading", { name: `Filial ${branch} · Filial sintética E2E`, exact: true })).toBeVisible();

    const csv = [
      "Matricula;Nome;Setor;Cargo;CargaSemanal;Horarios;Admissao;RegraDomingos",
      "0001;Ana Sintética;Padaria;Atendente;40;08:00-12:00 / 13:00-17:00;2020-01-01;",
      "0002;Bruno Sintético;Padaria;Atendente;40;08:00-12:00 / 13:00-17:00;2020-01-01;",
    ].join("\r\n");
    const reviewed = await previewReplacement(page, "EMPLOYEES", { name: "equipe-sintetica.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    expect(reviewed.preview.canApply).toBe(true); expect(reviewed.preview.blockers).toEqual([]);
    expect(reviewed.preview.counts.addedPeople).toBe(2);
    expect((await page.request.get("/api/escalas?id=" + original.id).then(response => response.json())).revision).toBe(original.revision);
    const imported = (await applyReplacement(page, reviewed.panel, "EMPLOYEES")).workspace;
    expect(imported.input.employees).toHaveLength(2);
    const ana = imported.input.employees.find((person) => person.registration === "0001");
    const bruno = imported.input.employees.find((person) => person.registration === "0002");
    expect(ana).toBeTruthy(); expect(bruno).toBeTruthy();
    if (!ana || !bruno) throw new Error("Synthetic import did not preserve registrations");
    const origin = new URL(page.url()).origin;
    // A saved draft is seeded through the real API. No solver or authentication response is mocked.
    const preparing = await page.request.post("/api/escalas", {
      headers: { origin }, data: { action: "SAVE", id: imported.id, expectedRevision: imported.revision,
        input: { ...imported.input,
          demands: [{ id: "e2e-required", date: "2026-11-02", sector: "Padaria", start: 480, end: 600, minimum: 1 }],
          assignments: [
            { employeeId: ana.id, date: "2026-11-02", kind: "WORK", shiftId: ana.shiftIds[0] },
            { employeeId: bruno.id, date: "2026-11-02", kind: "OFF" },
          ],
        },
      },
    });
    expect(preparing.status()).toBe(200);
    await page.reload();
    await selectEscalasWorkspace(page, imported);
    await page.getByLabel("Visualização da escala", { exact: true }).selectOption("rest");
    const roster = page.getByRole("region", { name: "Grade mensal da filial", exact: true });
    await expect(roster).toBeVisible();
    await expect(roster.getByRole("columnheader")).toHaveCount(31);
    const periodHeader = roster.getByText(`Filial ${branch} · Filial sintética E2E. 01/11/2026 a 30/11/2026.`, { exact: false });
    await expect(periodHeader).toHaveCount(1);
    await expect(periodHeader).toBeVisible();
    await expect(periodHeader).toContainText("01/11/2026 a 30/11/2026");
    expect(await roster.locator('button[aria-label*="31/10/2026"]').count()).toBe(0);
    expect(await roster.locator('button[aria-label*="01/12/2026"]').count()).toBe(0);
    const anaCell = roster.getByRole("button", { name: /^Ana Sintética, 02\/11\/2026:/ });
    const brunoCell = roster.getByRole("button", { name: /^Bruno Sintético, 02\/11\/2026:/ });
    await expect(anaCell).toContainText(/^T\d+/);
    const originalCode = await anaCell.locator("span").first().textContent();
    await anaCell.click();
    await page.getByLabel("Situação do dia", { exact: true }).selectOption("OFF");
    await page.getByRole("button", { name: "Conferir alteração", exact: true }).click();
    await expect(page.getByRole("region", { name: "Impacto da alteração", exact: true })).toContainText("0 presente(s), mínimo 1");
    await page.getByRole("button", { name: "Aplicar com conflitos ao rascunho", exact: true }).click();
    await expect(anaCell.locator("span").first()).toHaveText("F");
    await expect(roster.getByRole("link", { name: /02\/11\/2026:.*cobertura/ })).toBeVisible();
    await roster.getByRole("button", { name: "Desfazer última alteração", exact: true }).click();
    await expect(anaCell.locator("span").first()).toHaveText(originalCode ?? "");
    await expect(page.locator('[data-state="saved"]')).toBeVisible();

    await anaCell.click();
    await page.getByText("Trocar este dia com outro colaborador ou outra data", { exact: true }).click();
    await page.getByLabel("Colaborador para a troca", { exact: true }).selectOption(bruno.id);
    await page.getByLabel("Data para a troca", { exact: true }).selectOption("2026-11-02");
    await page.getByRole("button", { name: "Conferir troca", exact: true }).click();
    const savingSwap = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "SAVE"
      && response.request().postDataJSON()?.id === imported.id);
    await page.getByRole("button", { name: /^(Confirmar alteração|Aplicar com conflitos ao rascunho)$/ }).click();
    await expect(anaCell.locator("span").first()).toHaveText("F");
    await expect(brunoCell.locator("span").first()).toHaveText(originalCode ?? "");
    await expect(page.locator('[data-state="saved"]')).toBeVisible();
    expect((await savingSwap).status()).toBe(200);
    const persistedResponse = await page.request.get(`/api/escalas?id=${imported.id}`);
    expect(persistedResponse.status()).toBe(200);
    const persisted: EscalaWorkspace = await persistedResponse.json();
    expect(persisted.input.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: ana.id, date: "2026-11-02", kind: "OFF", locked: true }),
      expect.objectContaining({ employeeId: bruno.id, date: "2026-11-02", kind: "WORK", shiftId: ana.shiftIds[0], locked: true }),
    ]));
    await page.setViewportSize({ width: 375, height: 812 });
    await openEscalasArea(page, "adjustments");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Excluir planejamento", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Excluir este planejamento?", exact: true });
    await expect(confirmation).toContainText(`Filial ${branch}`);
    await expect(confirmation).toContainText("01/11/2026 a 30/11/2026");
    await confirmation.getByRole("button", { name: "Manter planejamento", exact: true }).click();
    expect((await page.request.get(`/api/escalas?id=${imported.id}`)).status()).toBe(200);
    await page.getByRole("button", { name: "Excluir planejamento", exact: true }).click();
    const deleting = page.waitForResponse(response => response.request().method() === "DELETE"
      && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.workspaceId === imported.id);
    await confirmation.getByRole("button", { name: "Confirmar exclusão", exact: true }).click();
    expect((await deleting).status()).toBe(200);
    await expect(page.getByText("Planejamento e revisões excluídos. Os demais períodos foram preservados.", { exact: true })).toBeVisible();
    expect((await page.request.get(`/api/escalas?id=${imported.id}`)).status()).toBe(404);
    const list = await page.request.get("/api/escalas").then((response) => response.json());
    expect(list.workspaces.some((workspace: { id: string }) => workspace.id === imported.id)).toBe(false);
  } finally {
    const response = await page.request.get(`/api/escalas?id=${original.id}`);
    if (response.status() !== 404) {
      expect(response.status()).toBe(200);
      const current: EscalaWorkspace = await response.json();
      expect(current.input.branchCode).toBe(branch);
      expect(current.status).toBe("DRAFT");
      const removed = await page.request.delete("/api/escalas", {
        headers: { origin: new URL(page.url()).origin },
        data: { workspaceId: current.id, expectedRevision: current.revision },
      });
      expect(removed.status()).toBe(200);
    }
  }
});

test("one journey controls a full FPRE136 simulation, stale outputs and actual PDF/XLSX downloads across screen sizes", async ({ page }) => {
  const listResponse = await page.request.get("/api/escalas");
  expect(listResponse.status()).toBe(200);
  const listed: { workspaces: EscalaWorkspace[] } = await listResponse.json();
  const used = new Set(listed.workspaces.map(workspace => workspace.input.branchCode));
  const branch = Array.from({ length: 90 }, (_, index) => String(index + 10)).find(code => !used.has(code));
  if (!branch) throw new Error("No unused two-digit branch is available for the isolated FPRE136 fixture");
  await page.goto("/escala");
  await page.getByLabel("Código da filial", { exact: true }).waitFor({ state: "attached" });
  await revealEscalasControl(page.getByLabel("Código da filial", { exact: true }));
  await page.getByLabel("Código da filial", { exact: true }).fill(branch);
  await page.getByLabel("Nome da filial (opcional)", { exact: true }).fill("Supermercado sintético E2E");
  await page.getByLabel("Mês de referência", { exact: true }).fill("2026-11");
  const creating = page.waitForResponse(response => {
    if (response.request().method() !== "POST" || !response.url().endsWith("/api/escalas")) return false;
    const request = response.request().postDataJSON();
    return request?.action === "CREATE" && request.input?.branchCode === branch && request.input?.visibleMonth === "2026-11";
  });
  await page.getByRole("button", { name: "Iniciar planejamento", exact: true }).click();
  const createResponse = await creating;
  expect(createResponse.status()).toBe(201);
  const created: EscalaWorkspace = await createResponse.json();
  try {
  const journey = page.getByLabel("Jornada semanal", { exact: true });
  await expect(journey).toHaveCount(1);
  await page.locator('button[aria-controls="escala-area-generate"]').click();
  await journey.selectOption("44");
  const rows: string[][] = [["0001", "-", "Empresa sintética", "Pág.:", "1"], ["Quadro de Horários"], ["", "Nome", "Cargo", "Horário"], [`${branch}.01 , ICARAIMA, LOJA`], ["Horário:", "0026", "-", "07:00 11:00 13:00 16:20"]];
  for (const [registration, name, role, zero, short] of [
    ["001", "Ana Sintética", "Repositor", false, false],
    ["002", "Bruno Sintético", "Repositor", false, false],
    ["003", "Carla Sintética", "Encarregado", false, false],
    ["004", "Diego Sintético", "Gerente", true, false],
    ["005", "Eva Sintética", "Empacotador", false, true],
  ] as const) {
    rows.push([registration, "-", name, role, zero ? "00:00" : "07:00", "-", zero ? "00:00" : "11:00", zero || short ? "00:00" : "13:00", "-", zero || short ? "00:00" : "16:20"]);
    rows.push(["Sábado:", zero ? "00:00" : "07:00", "-", zero ? "00:00" : "11:00", zero || short ? "00:00" : "13:00", "-", zero || short ? "00:00" : "16:20", zero ? "00:00" : "07:00", "0026"]);
  }
  const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  await page.locator('button[aria-controls="escala-area-team"]').click();
  await expect(page.locator('[data-state="saved"]')).toBeVisible();
  const reviewed = await previewReplacement(page, "EMPLOYEES", { name: "FPRE136-sintetico.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  expect(reviewed.preview.layout).toBe("FPRE136"); expect(reviewed.preview.canApply).toBe(true); expect(reviewed.preview.blockers).toEqual([]); expect(reviewed.preview.counts.addedPeople).toBe(5);
  await applyReplacement(page, reviewed.panel, "EMPLOYEES");
  await openEscalasArea(page, "generate");
  await journey.selectOption("42");
  await expect(page.getByText("08:24", { exact: true })).toBeVisible();
  const generating = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "GENERATE" && response.request().postDataJSON()?.id === created.id, { timeout: 40_000 });
  await page.getByRole("button", { name: "Gerar escala e horários", exact: true }).click();
  const generatedResponse = await generating;
  expect(generatedResponse.status()).toBe(200);
  const generated = await generatedResponse.json();
  expect(["FEASIBLE", "OPTIMAL"]).toContain(generated.result.status);
  expect(generated.validation.valid).toBe(true);
  expect(generated.proposalInput.defaultWeeklyHours).toBe(42);
  expect(generated.proposalInput.policy.compensationAuthorized).toBe(false);
  expect(generated.proposalInput.policy.reviewed).toBe(false);
  expect(generated.proposalInput.employees).toHaveLength(5);
  expect(generated.proposalInput.employees.filter((person: { planningEnabled?: boolean }) => person.planningEnabled !== false)).toHaveLength(4);
  const timed = generated.proposalInput.employees.find((person: { registration: string }) => person.registration === "001");
  const shift = generated.proposalInput.shifts.find((item: { id: string }) => item.id === timed.shiftIds[0]);
  expect(timed.weeklyHours).toBe(42);
  expect(timed.sourceSchedule.weekday).toBe("07:00-11:00 / 13:00-16:20");
  expect(shift.segments.reduce((sum: number, segment: { kind: string; start: number; end: number }) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0)).toBe(504);
  expect(generated.proposalInput.employees.find((person: { registration: string }) => person.registration === "004").scheduleMode).toBe("UNTIMED");
  const shortPerson = generated.proposalInput.employees.find((person: { registration: string }) => person.registration === "005");
  expect(shortPerson).toMatchObject({ planningEnabled: false, scheduleMode: "TIMED", sourceSchedule: { weekday: "07:00-11:00 / 00:00-00:00" } });
  expect(shortPerson.planningExclusionReason).toContain("até 6h, inclusive");
  expect(generated.proposalInput.assignments.filter((item: { employeeId: string }) => item.employeeId === shortPerson.id)).toEqual([]);
  await expect(page.getByRole("heading", { name: "Proposta pronta para revisão", exact: true })).toBeVisible();
  const saving = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "APPLY_PROPOSAL" && response.request().postDataJSON()?.id === created.id);
  await page.getByRole("region", { name: "Proposta pronta para revisão", exact: true })
    .getByRole("button", { name: "Aplicar proposta à grade", exact: true }).click();
  await expect(page.locator('[data-state="saved"]')).toBeVisible();
  const applied = await saving;
  expect(applied.status()).toBe(200);
  const saved: EscalaWorkspace = await applied.json();
  await expect(page.getByRole("region", { name: "Grade mensal da filial", exact: true })).toBeVisible();
  for (const format of ["PDF", "XLSX"] as const) {
    const expected = await prepareBasicExport(page, saved, format);
    const link = page.getByRole("link", { name: "Baixar " + format, exact: true });
    await expect(link).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15_000 }), link.click()]);
    try {
      const bytes = await downloadBytes(download);
      expect(bytes.length).toBeGreaterThan(500);
      expect(bytes.subarray(0, format === "PDF" ? 4 : 2).toString()).toBe(format === "PDF" ? "%PDF" : "PK");
      expect(bytes.equals(expected), "Downloaded " + format + " must match the export response").toBe(true);
    } finally { await download.delete(); }
    await expect(page.getByRole("article", { name: `Arquivo ${format}`, exact: true }).getByText("Pronto para baixar", { exact: true })).toBeVisible();
  }
  await page.locator('button[aria-controls="escala-area-generate"]').click();
  await journey.selectOption("40");
  await page.locator('button[aria-controls="escala-area-roster"]').click();
  await expect(page.getByText("Cenário alterado.", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Baixar PDF", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gerar PDF", exact: true })).toBeDisabled();
  await page.locator('button[aria-controls="escala-area-generate"]').click();
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(journey).toBeVisible();
  }
  await openEscalasArea(page, "adjustments");
  await page.getByRole("button", { name: "Excluir planejamento", exact: true }).click();
  await page.getByRole("dialog", { name: "Excluir este planejamento?", exact: true }).getByRole("button", { name: "Confirmar exclusão", exact: true }).click();
  await expect(page.getByText("Planejamento e revisões excluídos. Os demais períodos foram preservados.", { exact: true })).toBeVisible();
  expect((await page.request.get(`/api/escalas?id=${created.id}`)).status()).toBe(404);
  } finally {
    const response = await page.request.get(`/api/escalas?id=${created.id}`);
    if (response.status() !== 404) {
      expect(response.status()).toBe(200);
      const current: EscalaWorkspace = await response.json();
      expect(current.input.branchCode).toBe(branch);
      expect(current.status).toBe("DRAFT");
      const removed = await page.request.delete("/api/escalas", { headers: { origin: new URL(page.url()).origin }, data: { workspaceId: created.id, expectedRevision: current.revision } });
      expect(removed.status()).toBe(200);
    }
  }
});

test("explicit Sunday upgrade preserves its legacy source and protected outer absence through real persistence", async ({ page }) => {
  const branch = `E2E-WEEK-${Date.now().toString(36)}`;
  await page.goto("/escala");
  const origin = new URL(page.url()).origin;
  const source = newInput(branch, "Calendário sintético E2E", "2026-12", 42);
  source.planningWeekStartsOn = "MONDAY";
  source.startDate = "2026-11-30"; source.endDate = "2027-01-03";
  source.employees = [{ ...newEmployee(42), id: "synthetic-calendar-person", registration: "SYNTHETIC-1", name: "Pessoa sintética", activeFrom: "2020-01-01", scheduleMode: "UNTIMED" }];
  source.assignments = [
    { employeeId: "synthetic-calendar-person", date: "2026-12-06", kind: "OFF", locked: true },
    { employeeId: "synthetic-calendar-person", date: "2027-01-03", kind: "ABSENCE" },
  ];
  const createdResponse = await page.request.post("/api/escalas", { headers: { origin }, data: { action: "CREATE", input: source } });
  expect(createdResponse.status()).toBe(201);
  const original: EscalaWorkspace = await createdResponse.json();
  let upgraded: EscalaWorkspace | undefined;
  try {
    await page.reload();
    await selectEscalasWorkspace(page, original);
    const action = page.getByRole("button", { name: "Usar semana de domingo a sábado", exact: true });
    await expect(action).toBeEnabled();
    const responsePromise = page.waitForResponse(response => response.request().method() === "POST"
      && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "UPGRADE_CALENDAR"
      && response.request().postDataJSON()?.id === original.id && response.request().postDataJSON()?.expectedRevision === original.revision);
    await action.click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    upgraded = await response.json();
    if (!upgraded) throw new Error("The explicit calendar upgrade did not return a workspace");
    expect(upgraded.id).not.toBe(original.id);
    expect(upgraded.input).toMatchObject({ planningWeekStartsOn: "SUNDAY", planningCalendarSource: { workspaceId: original.id, revision: original.revision }, startDate: "2026-11-29", endDate: "2027-01-02" });
    expect(upgraded.input.assignments).toEqual([original.input.assignments[0]]);
    const boundary = { employeeId: "synthetic-calendar-person", date: "2027-01-03", kind: "ABSENCE", locked: true };
    expect(upgraded.input.employees[0].planningFuture).toEqual([boundary]);
    await expect(page.getByText("Semana: domingo a sábado. O domingo inicia uma nova semana.", { exact: true })).toBeVisible();
    const unchangedResponse = await page.request.get(`/api/escalas?id=${original.id}`);
    expect(unchangedResponse.status()).toBe(200);
    const unchanged: EscalaWorkspace = await unchangedResponse.json();
    expect(unchanged.revision).toBe(original.revision);
    expect(unchanged.input).toEqual(original.input);
    const client = structuredClone(upgraded.input); client.employees[0].planningFuture = [];
    const savedResponse = await page.request.post("/api/escalas", { headers: { origin }, data: { action: "SAVE", id: upgraded.id, expectedRevision: upgraded.revision, input: client } });
    expect(savedResponse.status()).toBe(200);
    const saved: EscalaWorkspace = await savedResponse.json();
    expect(saved.revision).toBe(upgraded.revision + 1);
    expect(saved.input.employees[0].planningFuture).toEqual([boundary]);
    const reloaded: EscalaWorkspace = await (await page.request.get(`/api/escalas?id=${saved.id}`)).json();
    expect(reloaded.input).toEqual(saved.input);
  } finally {
    for (const id of [upgraded?.id, original.id].filter((id): id is string => Boolean(id))) {
      const response = await page.request.get(`/api/escalas?id=${id}`);
      if (response.status() === 404) continue;
      expect(response.status()).toBe(200);
      const current: EscalaWorkspace = await response.json();
      expect((await page.request.delete("/api/escalas", { headers: { origin }, data: { workspaceId: id, expectedRevision: current.revision } })).status()).toBe(200);
    }
  }
});
