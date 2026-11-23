import { expect, test } from "./fixtures";
import { openEscalasArea, selectEscalasWorkspace } from "./escalas-selection";
import { newInput } from "../src/components/escalas/workspace-model";
import { loginAsAdmin } from "./admin-session";
import type { EscalaWorkspace } from "../src/lib/escalas/types";

test("cancels a real generation, preserves the saved roster and allows a new calculation", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires the disposable isolated database");
  test.setTimeout(150_000);
  await loginAsAdmin(page);
  const origin = new URL(page.url()).origin;
  const post = (data: Record<string, unknown>) => page.request.post("/api/escalas", { headers: { origin }, data });
  const readStatus = async (operationId: string | undefined) => {
    if (!operationId) throw new Error("No generation operation was registered");
    const result = await page.evaluate(async (id) => {
      const response = await fetch("/api/escalas", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "GENERATION_STATUS", operationId: id }),
      });
      const state: unknown = response.status === 200 ? (await response.json()).state : undefined;
      return { status: response.status, state };
    }, operationId);
    expect(result.status).toBe(200);
    return result.state;
  };
  const december = { visibleMonth: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31", planningWeekStartsOn: "SUNDAY" } as const;
  const input = newInput("CANCEL-" + Date.now().toString(36), "Cancelamento sintético", december.visibleMonth, 42);
  input.shifts = [
    { id: "early", name: "Manhã", segments: [{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 720, kind: "BREAK" }, { start: 720, end: 984, kind: "WORK" }] },
    { id: "late", name: "Tarde", segments: [{ start: 720, end: 960, kind: "WORK" }, { start: 960, end: 1020, kind: "BREAK" }, { start: 1020, end: 1284, kind: "WORK" }] },
  ];
  input.employees = Array.from({ length: 60 }, (_, index) => ({ id: "person-" + index, registration: String(index + 1), name: "Pessoa sintética " + index, sector: ["Açougue", "Équipe", "Loja 2", "Loja 10", "Zeladoria"][index % 5], role: "Operador", weeklyHours: 42, weeklyHoursMode: "BRANCH", shiftIds: ["early", "late"], activeFrom: "", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, sundayRestRule: "PROTECTIVE", preferredOffDays: [index % 5], historyKnown: false, history: [] }));
  const response = await post({ action: "CREATE", input });
  expect(response.status()).toBe(201);
  const created: EscalaWorkspace = await response.json();
  expect(created.input).toMatchObject(december);
  let operationId: string | undefined;
  try {
    await page.goto("/escala");
    await selectEscalasWorkspace(page, created);
    await openEscalasArea(page, "generate");
    const started = page.waitForResponse(result => result.url().endsWith("/api/escalas") && result.request().method() === "POST" && result.request().postDataJSON()?.action === "START_GENERATION");
    await page.getByRole("button", { name: "Gerar escala e horários", exact: true }).click();
    const registration = await started;
    expect(registration.status()).toBe(201);
    operationId = (await registration.json()).operationId;
    expect(operationId).toBeTruthy();
    await expect.poll(() => readStatus(operationId), { timeout: 10_000, intervals: [100, 150, 200] }).toBe("RUNNING");
    const stopped = page.waitForResponse(result => result.url().endsWith("/api/escalas") && result.request().method() === "POST" && result.request().postDataJSON()?.action === "CANCEL_GENERATION");
    await page.getByRole("button", { name: "Cancelar análise", exact: true }).click();
    const cancellation = await stopped;
    expect(cancellation.status()).toBe(200);
    const state = (await cancellation.json()).state;
    expect(["CANCELLED", "CANCEL_REQUESTED"]).toContain(state);
    await expect.poll(() => readStatus(operationId), { timeout: 12_000, intervals: [200, 300] }).toBe("CANCELLED");
    await expect(page.getByText("Cálculo cancelado. Sua escala salva foi mantida; você pode tentar novamente.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Aplicar proposta à grade", exact: true })).toHaveCount(0);
    const unchanged: EscalaWorkspace = await page.request.get("/api/escalas?id=" + created.id).then(result => result.json());
    expect(unchanged.revision).toBe(created.revision);
    expect(unchanged.input.assignments).toEqual(created.input.assignments);
    const completed = page.waitForResponse(result => result.url().endsWith("/api/escalas") && result.request().method() === "POST" && result.request().postDataJSON()?.action === "GENERATE", { timeout: 40_000 });
    await page.getByRole("button", { name: "Gerar escala e horários", exact: true }).click();
    const calculation = await completed;
    expect(calculation.status()).toBe(200);
    const proposal = await calculation.json();
    expect(["FEASIBLE", "OPTIMAL"]).toContain(proposal.result.status);
    expect(proposal.validation.valid).toBe(true);
    expect(proposal.proposalInput).toMatchObject(december);
    expect(proposal.proposalInput.assignments.every(({ date }: { date: string }) => date >= december.startDate && date <= december.endDate)).toBe(true);
    await expect(page.getByRole("button", { name: "Aplicar proposta à grade", exact: true })).toBeVisible();
    const stillSaved: EscalaWorkspace = await page.request.get("/api/escalas?id=" + created.id).then(result => result.json());
    expect(stillSaved.revision).toBe(created.revision);
    expect(stillSaved.input.assignments).toEqual(created.input.assignments);
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await page.getByRole("navigation", { name: "Etapas do planejamento", exact: true }).getByRole("button", { name: /^Montar escala/ }).click();
    const thirdRegistration = page.waitForResponse(result => result.url().endsWith("/api/escalas") && result.request().method() === "POST" && result.request().postDataJSON()?.action === "START_GENERATION");
    await page.getByRole("button", { name: "Gerar escala e horários", exact: true }).click();
    operationId = (await (await thirdRegistration).json()).operationId;
    await expect.poll(() => readStatus(operationId), { timeout: 10_000, intervals: [150, 250] }).toBe("RUNNING");
    // Full-page navigation must issue keepalive cancellation, not only discard the preview.
    await page.goto("/escala");
    await expect.poll(() => readStatus(operationId), { timeout: 12_000, intervals: [200, 400] }).toBe("CANCELLED");
  } finally {
    if (operationId) await post({ action: "CANCEL_GENERATION", operationId });
    const latest: EscalaWorkspace = await page.request.get("/api/escalas?id=" + created.id).then(result => result.json());
    expect((await page.request.delete("/api/escalas", { headers: { origin }, data: { workspaceId: latest.id, expectedRevision: latest.revision } })).status()).toBe(200);
  }
});

// Cross-session query/cancellation privacy is exercised with real nominal sessions
// in escalas-scoped-access.spec.ts, in its exclusively owned configured tenant.
