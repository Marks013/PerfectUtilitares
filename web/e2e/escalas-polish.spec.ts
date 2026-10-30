import { expect, test } from "@playwright/test";
import { newInput } from "../src/components/escalas/workspace-model";
import { loginAsAdmin } from "./admin-session";
import type { EscalaInput, EscalaWorkspace } from "../src/lib/escalas/types";

test("guided controls, hours ordering, ENC and apprentice exclusion work in the real browser", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires the disposable isolated database");
  test.setTimeout(150_000);
  await loginAsAdmin(page);
  const origin = new URL(page.url()).origin;
  const input = newInput("POLISH-" + Date.now().toString(36), "Organização visual", "2026-11", 42);
  input.shifts = [
    { id: "early", name: "Manhã", segments: [{ start: 450, end: 680, kind: "WORK" }, { start: 680, end: 800, kind: "BREAK" }, { start: 800, end: 1074, kind: "WORK" }] },
    { id: "late", name: "Mais tarde", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 840, kind: "BREAK" }, { start: 840, end: 1104, kind: "WORK" }] },
  ];
  const make = (id: string, name: string, sector: string, role: string, shiftId: string): EscalaInput["employees"][number] => ({
    id, name, registration: id, sector, role, weeklyHours: 42, weeklyHoursMode: "BRANCH", shiftIds: [shiftId], activeFrom: "", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, sundayRestRule: "PROTECTIVE", preferredOffDays: [], historyKnown: false, history: [],
  });
  input.employees = [make("3", "Zoe Horário", "Açougue", "Auxiliar", "late"), make("2", "Bia Horário", "Açougue", "Operador", "early"), make("1", "Ana Horário", "Açougue", "Operador", "early"),
    make("4", "Lia Setor", "Zeladoria", "Auxiliar", "early"), make("5", "Aprendiz Teste", "Açougue", "AUX. DE SERVIÇOS EM SUPER", "early")];
  const manager = make("6", "Encarregado Teste", "Zeladoria", "ENC. SETOR", "early");
  manager.shiftIds = []; manager.scheduleMode = "MISSING";
  manager.sourceSchedule = { report: "FPRE136", code: "0000", description: "Sem horário fixo", weekday: "00:00-00:00 / 00:00-00:00", saturday: "00:00-00:00 / 00:00-00:00" };
  input.employees.push(manager);
  const createdResponse = await page.request.post("/api/escalas", { headers: { origin }, data: { action: "CREATE", input } });
  expect(createdResponse.status()).toBe(201);
  const created: EscalaWorkspace = await createdResponse.json();
  try {
    await page.goto("/escala");
    await page.getByLabel("Selecionar filial e período", { exact: true }).selectOption(created.id);
    await page.getByRole("button", { name: "Intervalos de jornadas curtas", exact: true }).click();
    const pause = page.getByLabel("Simular jornadas de 4 a 6 horas sem pausa", { exact: true });
    await expect(pause).toBeVisible();
    await pause.check();
    await pause.uncheck();
    const generated = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "GENERATE");
    await page.getByRole("button", { name: /^(Gerar proposta mensal|Gerar nova proposta)$/ }).click();
    const response = await generated;
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.validation.valid).toBe(true);
    expect(result.proposalInput.employees.find((person: { id: string }) => person.id === "5").planningEnabled).toBe(false);
    expect(result.proposalInput.assignments.some((item: { employeeId: string }) => item.employeeId === "5")).toBe(false);
    await page.getByRole("button", { name: "Aplicar proposta à grade", exact: true }).click();
    await expect(page.locator('[data-state="saved"]')).toBeVisible();
    await page.getByRole("button", { name: "Escala", exact: true }).click();
    const roster = page.getByRole("region", { name: "Grade mensal da filial", exact: true });
    await page.getByLabel("Visualização da escala", { exact: true }).selectOption("rest");
    await expect(roster.getByRole("row").filter({ hasText: "Aprendiz Teste" })).toHaveCount(0);
    await expect(roster.getByRole("row").filter({ hasText: "Encarregado Teste" })).toHaveCount(1);
    await page.getByLabel("Visualização da escala", { exact: true }).selectOption("hours");
    const names = await roster.locator('tbody th[scope="row"]').allTextContents();
    expect(names.findIndex(text => text.includes("Ana Horário"))).toBeLessThan(names.findIndex(text => text.includes("Bia Horário")));
    expect(names.findIndex(text => text.includes("Bia Horário"))).toBeLessThan(names.findIndex(text => text.includes("Zoe Horário")));
    await page.getByLabel("Visualização da escala", { exact: true }).selectOption("rest");
    const managerRow = roster.getByRole("row").filter({ hasText: "Encarregado Teste" });
    expect(await managerRow.getByText("ENC", { exact: true }).count()).toBeGreaterThan(0);
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(page.getByRole("button", { name: "Gerar nova proposta", exact: true })).toBeVisible();
    }
    if (process.env.E2E_VISUAL_REVIEW === "1") {
      await roster.scrollIntoViewIfNeeded();
      console.log("SYNTHETIC_UI_PNG:" + (await page.screenshot({ fullPage: false })).toString("base64"));
      await page.getByRole("button", { name: "Gerar PDF", exact: true }).click();
      await expect(page.getByRole("link", { name: "Baixar PDF", exact: true })).toBeVisible();
      const downloading = page.waitForEvent("download");
      await page.getByRole("link", { name: "Baixar PDF", exact: true }).click();
      const download = await downloading;
      const stream = await download.createReadStream();
      if (!stream) throw new Error("Synthetic PDF stream unavailable");
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      console.log("SYNTHETIC_PDF:" + Buffer.concat(chunks).toString("base64"));
      await download.delete();
    }
    await page.getByRole("button", { name: "Revisão e suporte", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Central de revisão", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Desfalques \(/ }).click();
    const correction = page.getByRole("button", { name: "Conferir este setor e horário", exact: true }).first();
    await expect(correction).toBeVisible();
    await correction.click();
    await expect(page.getByLabel("Data da cobertura", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Setor no gráfico", { exact: true })).toHaveValue(/Açougue|Zeladoria/);
    await expect(page.getByLabel("Faixa de horário e colaboradores", { exact: true })).toBeVisible();
  } finally {
    const current: EscalaWorkspace = await page.request.get("/api/escalas?id=" + created.id).then(response => response.json());
    expect((await page.request.delete("/api/escalas", { headers: { origin }, data: { workspaceId: current.id, expectedRevision: current.revision } })).status()).toBe(200);
  }
});
