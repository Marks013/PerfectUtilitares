import { expect, test } from "./fixtures";
import { newInput } from "../src/components/escalas/workspace-model";
import { loginAsAdmin } from "./admin-session";
import type { EscalaWorkspace } from "../src/lib/escalas/types";

test("cancels a real generation, preserves the saved roster and allows a new calculation", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires the disposable isolated database");
  test.setTimeout(150_000);
  await loginAsAdmin(page);
  const origin = new URL(page.url()).origin;
  const post = (data: Record<string, unknown>) => page.request.post("/api/escalas", { headers: { origin }, data });
  const input = newInput("CANCEL-" + Date.now().toString(36), "Cancelamento sintético", "2026-11", 42);
  input.shifts = [
    { id: "early", name: "Manhã", segments: [{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 720, kind: "BREAK" }, { start: 720, end: 984, kind: "WORK" }] },
    { id: "late", name: "Tarde", segments: [{ start: 720, end: 960, kind: "WORK" }, { start: 960, end: 1020, kind: "BREAK" }, { start: 1020, end: 1284, kind: "WORK" }] },
  ];
  input.employees = Array.from({ length: 60 }, (_, index) => ({ id: "person-" + index, registration: String(index + 1), name: "Pessoa sintética " + index, sector: ["Açougue", "Équipe", "Loja 2", "Loja 10", "Zeladoria"][index % 5], role: "Operador", weeklyHours: 42, weeklyHoursMode: "BRANCH", shiftIds: ["early", "late"], activeFrom: "", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, sundayRestRule: "PROTECTIVE", preferredOffDays: [index % 5], historyKnown: false, history: [] }));
  const response = await post({ action: "CREATE", input });
  expect(response.status()).toBe(201);
  const created: EscalaWorkspace = await response.json();
  let operationId: string | undefined;
  try {
    await page.goto("/escala");
    await page.getByLabel("Selecionar filial e período", { exact: true }).selectOption(created.id);
    const started = page.waitForResponse(result => result.url().endsWith("/api/escalas") && result.request().method() === "POST" && result.request().postDataJSON()?.action === "START_GENERATION");
    await page.getByRole("button", { name: "Gerar proposta mensal", exact: true }).click();
    const registration = await started;
    expect(registration.status()).toBe(201);
    operationId = (await registration.json()).operationId;
    expect(operationId).toBeTruthy();
    await expect.poll(async () => (await post({ action: "GENERATION_STATUS", operationId }).then(result => result.json())).state, { timeout: 10_000, intervals: [100, 150, 200] }).toBe("RUNNING");
    const stopped = page.waitForResponse(result => result.url().endsWith("/api/escalas") && result.request().method() === "POST" && result.request().postDataJSON()?.action === "CANCEL_GENERATION");
    await page.getByRole("button", { name: "Cancelar análise", exact: true }).click();
    const cancellation = await stopped;
    expect(cancellation.status()).toBe(200);
    const state = (await cancellation.json()).state;
    expect(["CANCELLED", "CANCEL_REQUESTED"]).toContain(state);
    await expect.poll(async () => (await post({ action: "GENERATION_STATUS", operationId }).then(result => result.json())).state, { timeout: 12_000, intervals: [200, 300] }).toBe("CANCELLED");
    await expect(page.getByText("Cálculo cancelado. Sua escala salva foi mantida; você pode tentar novamente.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Aplicar proposta à grade", exact: true })).toHaveCount(0);
    const unchanged: EscalaWorkspace = await page.request.get("/api/escalas?id=" + created.id).then(result => result.json());
    expect(unchanged.revision).toBe(created.revision);
    expect(unchanged.input.assignments).toEqual(created.input.assignments);
    const completed = page.waitForResponse(result => result.url().endsWith("/api/escalas") && result.request().method() === "POST" && result.request().postDataJSON()?.action === "GENERATE", { timeout: 40_000 });
    await page.getByRole("button", { name: "Gerar proposta mensal", exact: true }).click();
    const calculation = await completed;
    expect(calculation.status()).toBe(200);
    const proposal = await calculation.json();
    expect(["FEASIBLE", "OPTIMAL"]).toContain(proposal.result.status);
    expect(proposal.validation.valid).toBe(true);
    await expect(page.getByRole("button", { name: "Aplicar proposta à grade", exact: true })).toBeVisible();
    const stillSaved: EscalaWorkspace = await page.request.get("/api/escalas?id=" + created.id).then(result => result.json());
    expect(stillSaved.revision).toBe(created.revision);
    expect(stillSaved.input.assignments).toEqual(created.input.assignments);
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    const thirdRegistration = page.waitForResponse(result => result.url().endsWith("/api/escalas") && result.request().method() === "POST" && result.request().postDataJSON()?.action === "START_GENERATION");
    await page.getByRole("button", { name: "Gerar proposta mensal", exact: true }).click();
    operationId = (await (await thirdRegistration).json()).operationId;
    await expect.poll(async () => (await post({ action: "GENERATION_STATUS", operationId }).then(result => result.json())).state, { timeout: 10_000, intervals: [150, 250] }).toBe("RUNNING");
    // Full-page navigation must issue keepalive cancellation, not only discard the preview.
    await page.goto("/escala");
    await expect.poll(async () => (await post({ action: "GENERATION_STATUS", operationId }).then(result => result.json())).state, { timeout: 12_000, intervals: [200, 400] }).toBe("CANCELLED");
  } finally {
    if (operationId) await post({ action: "CANCEL_GENERATION", operationId });
    const latest: EscalaWorkspace = await page.request.get("/api/escalas?id=" + created.id).then(result => result.json());
    expect((await page.request.delete("/api/escalas", { headers: { origin }, data: { workspaceId: latest.id, expectedRevision: latest.revision } })).status()).toBe(200);
  }
});

test("another operational session cannot query or cancel a private generation operation", async ({ page, browser }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires the disposable isolated database");
  await loginAsAdmin(page);
  const origin = new URL(page.url()).origin;
  const post = (data: Record<string, unknown>) => page.request.post("/api/escalas", { headers: { origin }, data });
  const input = newInput("OWNER-" + Date.now().toString(36), "Controle de operação", "2026-11", 42);
  const created = await post({ action: "CREATE", input }); expect(created.status()).toBe(201);
  const workspace: EscalaWorkspace = await created.json();
  const other = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const started = await post({ action: "START_GENERATION", id: workspace.id, expectedRevision: workspace.revision });
    expect(started.status()).toBe(201);
    const { operationId } = await started.json();
    const unlocked = await other.request.post("/api/escalas/access/session", { headers: { origin }, data: { password: process.env.E2E_UNIMED_STANDARD_PASSWORD } });
    expect(unlocked.status()).toBe(200);
    for (const action of ["CANCEL_GENERATION", "GENERATION_STATUS"]) {
      const denied = await other.request.post("/api/escalas", { headers: { origin }, data: { action, operationId } });
      expect(denied.status()).toBe(404);
    }
    expect(await (await post({ action: "GENERATION_STATUS", operationId })).json()).toMatchObject({ state: "CREATED" });
    const duplicate = await post({ action: "START_GENERATION", id: workspace.id, expectedRevision: workspace.revision });
    expect(duplicate.status()).toBe(429);
    expect(await (await post({ action: "CANCEL_GENERATION", operationId })).json()).toMatchObject({ state: "CANCELLED" });
    expect(await (await post({ action: "CANCEL_GENERATION", operationId })).json()).toMatchObject({ state: "CANCELLED" });
  } finally {
    await other.close();
    expect((await page.request.delete("/api/escalas", { headers: { origin }, data: { workspaceId: workspace.id, expectedRevision: workspace.revision } })).status()).toBe(200);
  }
});
