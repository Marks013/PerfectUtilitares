import { expect, test } from "@playwright/test";
import type { EscalaWorkspace } from "../src/lib/escalas/types";
import { loginAsAdmin } from "./admin-session";

test.beforeEach(async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Scheduling writes require the disposable isolated E2E database");
  test.setTimeout(150_000);
  await loginAsAdmin(page);
});

test("monthly planning imports, previews real coverage loss, edits, undoes, swaps and safely deletes with persistence", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const branch = `E2E-${suffix}`;
  await page.goto("/escala");
  await page.getByText("Novo planejamento", { exact: true }).click();
  await page.getByLabel("Código da filial", { exact: true }).fill(branch);
  await page.getByLabel("Nome da filial (opcional)", { exact: true }).fill("Filial sintética E2E");
  await page.getByLabel("Mês de referência", { exact: true }).fill("2026-11");
  const creating = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "CREATE");
  await page.getByRole("button", { name: "Iniciar planejamento", exact: true }).click();
  const created = await creating;
  expect(created.status()).toBe(201);
  const original: EscalaWorkspace = await created.json();
  expect(original.input.visibleMonth).toBe("2026-11");
  await expect(page.getByRole("heading", { name: `Filial ${branch} · Filial sintética E2E`, exact: true })).toBeVisible();

  const csv = [
    "Matricula;Nome;Setor;Cargo;CargaSemanal;Horarios;Admissao;RegraDomingos",
    "0001;Ana Sintética;Padaria;Atendente;40;08:00-12:00 / 13:00-17:00;2020-01-01;",
    "0002;Bruno Sintético;Padaria;Atendente;40;08:00-12:00 / 13:00-17:00;2020-01-01;",
  ].join("\r\n");
  await page.getByLabel("Arquivo CSV ou XLSX", { exact: true }).setInputFiles({ name: "equipe-sintetica.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Conferir arquivo", exact: true }).click();
  await expect(page.getByText("Prévia: 2 colaboradores aceitos de 2 linhas.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Aplicar registros aceitos à proposta", exact: true }).click();
  const savingImport = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "SAVE");
  await expect(page.locator('[data-state="saved"]')).toBeVisible();
  const importedResponse = await savingImport;
  expect(importedResponse.status()).toBe(200);
  const imported: EscalaWorkspace = await importedResponse.json();
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
  await page.getByLabel("Selecionar filial e período", { exact: true }).selectOption(imported.id);
  await page.getByLabel("Visualização da escala", { exact: true }).selectOption("rest");
  const roster = page.getByRole("region", { name: "Grade mensal da filial", exact: true });
  await expect(roster).toBeVisible();
  await expect(roster.getByRole("columnheader")).toHaveCount(31);
  await expect(roster.getByText("01/11/2026 a 30/11/2026", { exact: false })).toBeVisible();
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
  await page.getByRole("button", { name: /^(Confirmar alteração|Aplicar com conflitos ao rascunho)$/ }).click();
  await expect(anaCell.locator("span").first()).toHaveText("F");
  await expect(brunoCell.locator("span").first()).toHaveText(originalCode ?? "");
  const savingSwap = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "SAVE");
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
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Excluir planejamento", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Excluir este planejamento?", exact: true });
  await expect(confirmation).toContainText(`Filial ${branch}`);
  await expect(confirmation).toContainText("01/11/2026 a 30/11/2026");
  await confirmation.getByRole("button", { name: "Manter planejamento", exact: true }).click();
  expect((await page.request.get(`/api/escalas?id=${imported.id}`)).status()).toBe(200);
  await page.getByRole("button", { name: "Excluir planejamento", exact: true }).click();
  const deleting = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().endsWith("/api/escalas"));
  await confirmation.getByRole("button", { name: "Confirmar exclusão", exact: true }).click();
  expect((await deleting).status()).toBe(200);
  await expect(page.getByText("Planejamento e revisões excluídos. Os demais períodos foram preservados.", { exact: true })).toBeVisible();
  expect((await page.request.get(`/api/escalas?id=${imported.id}`)).status()).toBe(404);
  const list = await page.request.get("/api/escalas").then((response) => response.json());
  expect(list.workspaces.some((workspace: { id: string }) => workspace.id === imported.id)).toBe(false);
});

test("one journey controls a full FPRE136 simulation, stale outputs and actual PDF/XLSX downloads across screen sizes", async ({ page }) => {
  await page.goto("/escala");
  await page.getByText("Novo planejamento", { exact: true }).click();
  await page.getByLabel("Código da filial", { exact: true }).fill("02");
  await page.getByLabel("Nome da filial (opcional)", { exact: true }).fill("Supermercado sintético E2E");
  await page.getByLabel("Mês de referência", { exact: true }).fill("2026-11");
  const creating = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "CREATE");
  await page.getByRole("button", { name: "Iniciar planejamento", exact: true }).click();
  const created: EscalaWorkspace = await (await creating).json();
  const journey = page.getByLabel("Jornada semanal", { exact: true });
  await expect(journey).toHaveCount(1);
  await journey.selectOption("44");
  const rows: string[][] = [["0001", "-", "Empresa sintética", "Pág.:", "1"], ["Quadro de Horários"], ["", "Nome", "Cargo", "Horário"], ["02.01 , ICARAIMA, LOJA"], ["Horário:", "0026", "-", "07:00 11:00 13:00 16:20"]];
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
  await page.getByLabel("Arquivo CSV ou XLSX", { exact: true }).setInputFiles({ name: "FPRE136-sintetico.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Conferir arquivo", exact: true }).click();
  await expect(page.getByText("Prévia: 5 colaboradores aceitos de 5 linhas.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Aplicar registros aceitos à proposta", exact: true }).click();
  await journey.selectOption("42");
  await expect(page.getByText("08:24", { exact: true })).toBeVisible();
  const generating = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "GENERATE");
  await page.getByRole("button", { name: "Gerar proposta mensal", exact: true }).click();
  const generatedResponse = await generating;
  expect(generatedResponse.status()).toBe(200);
  const generated = await generatedResponse.json();
  expect(["FEASIBLE", "OPTIMAL"]).toContain(generated.result.status);
  expect(generated.validation.valid).toBe(true);
  expect(generated.proposalInput.defaultWeeklyHours).toBe(42);
  expect(generated.proposalInput.policy.compensationAuthorized).toBe(false);
  expect(generated.proposalInput.policy.reviewed).toBe(false);
  expect(generated.proposalInput.employees).toHaveLength(5);
  expect(generated.proposalInput.employees.every((person: { planningEnabled?: boolean }) => person.planningEnabled !== false)).toBe(true);
  const timed = generated.proposalInput.employees.find((person: { registration: string }) => person.registration === "001");
  const shift = generated.proposalInput.shifts.find((item: { id: string }) => item.id === timed.shiftIds[0]);
  expect(timed.weeklyHours).toBe(42);
  expect(timed.sourceSchedule.weekday).toBe("07:00-11:00 / 13:00-16:20");
  expect(shift.segments.reduce((sum: number, segment: { kind: string; start: number; end: number }) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0)).toBe(504);
  expect(generated.proposalInput.employees.find((person: { registration: string }) => person.registration === "004").scheduleMode).toBe("MISSING");
  expect(generated.proposalInput.employees.find((person: { registration: string }) => person.registration === "005").simulationDailyMinutes).toBe(240);
  await expect(page.getByRole("heading", { name: "Proposta pronta para revisão", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Aplicar proposta à grade", exact: true }).click();
  const saving = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "SAVE");
  await expect(page.locator('[data-state="saved"]')).toBeVisible();
  expect((await saving).status()).toBe(200);
  await expect(page.getByRole("region", { name: "Grade mensal da filial", exact: true })).toBeVisible();
  for (const format of ["PDF", "XLSX"] as const) {
    await page.getByRole("button", { name: `Gerar ${format}`, exact: true }).click();
    await expect(page.getByRole("link", { name: `Baixar ${format}`, exact: true })).toBeVisible();
    const downloading = page.waitForEvent("download");
    await page.getByRole("link", { name: `Baixar ${format}`, exact: true }).click();
    const download = await downloading;
    expect(await download.failure()).toBeNull();
    const stream = await download.createReadStream();
    if (!stream) throw new Error("No downloaded file stream");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    expect(bytes.length).toBeGreaterThan(500);
    expect(bytes.subarray(0, format === "PDF" ? 4 : 2).toString()).toBe(format === "PDF" ? "%PDF" : "PK");
    await expect(page.getByRole("article", { name: `Arquivo ${format}`, exact: true }).getByText("Pronto para baixar", { exact: true })).toBeVisible();
  }
  await journey.selectOption("40");
  await expect(page.getByText("Cenário alterado.", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Baixar PDF", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gerar PDF", exact: true })).toBeDisabled();
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(journey).toBeVisible();
  }
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Excluir planejamento", exact: true }).click();
  await page.getByRole("dialog", { name: "Excluir este planejamento?", exact: true }).getByRole("button", { name: "Confirmar exclusão", exact: true }).click();
  await expect(page.getByText("Planejamento e revisões excluídos. Os demais períodos foram preservados.", { exact: true })).toBeVisible();
  expect((await page.request.get(`/api/escalas?id=${created.id}`)).status()).toBe(404);
});
