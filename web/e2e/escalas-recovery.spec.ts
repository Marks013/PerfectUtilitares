import { expect, test, type Page } from "@playwright/test";
import { newInput } from "../src/components/escalas/workspace-model";
import { dateRange } from "../src/lib/escalas/dates";
import type { EscalaWorkspace } from "../src/lib/escalas/types";
import { loginAsAdmin } from "./admin-session";

test.use({ actionTimeout: 15_000 });
test.beforeEach(async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Only the disposable isolated database may receive these fixtures");
  test.setTimeout(150_000);
  await loginAsAdmin(page);
});

async function fixture(page: Page, locked = false) {
  const input = newInput("REC-" + Date.now().toString(36) + (locked ? "-L" : "-C"), "Recuperação sintética", "2026-11", 40);
  input.employees = [{ id: "p1", registration: "001", name: "Pessoa sintética", sector: "Loja", role: "Repositor", weeklyHours: 40, shiftIds: [input.shifts[0].id], activeFrom: "", offMode: locked ? "FIXED" : "VARIABLE", fixedOffDays: locked ? [5, 6] : [], offPattern: "ANY", maxConsecutiveSundays: 2, preferredOffDays: [], historyKnown: false, history: [] }];
  if (locked) input.assignments = [{ employeeId: "p1", date: "2026-10-31", kind: "WORK", shiftId: input.shifts[0].id, locked: true }];
  else input.demands = dateRange(input.startDate, input.endDate).flatMap(date => input.shifts[0].segments.filter(segment => segment.kind === "WORK").map((segment, index) => ({ id: date + "-" + index, date, sector: "Loja", role: "Repositor", start: segment.start, end: segment.end, minimum: 1, estimated: false })));
  const origin = new URL(page.url()).origin;
  const response = await page.request.post("/api/escalas", { headers: { origin }, data: { action: "CREATE", input } });
  expect(response.status()).toBe(201);
  const workspace: EscalaWorkspace = await response.json();
  await page.goto("/escalas");
  await page.getByLabel("Selecionar filial e período", { exact: true }).selectOption(workspace.id);
  return workspace;
}
async function removeFixture(page: Page, id: string) {
  const response = await page.request.get("/api/escalas?id=" + id);
  if (response.status() === 404) return;
  expect(response.status()).toBe(200);
  const workspace: EscalaWorkspace = await response.json();
  const origin = new URL(page.url()).origin;
  expect((await page.request.delete("/api/escalas", { headers: { origin }, data: { workspaceId: id, expectedRevision: workspace.revision } })).status()).toBe(200);
}
async function generate(page: Page) {
  const response = page.waitForResponse(value => value.request().method() === "POST" && value.url().endsWith("/api/escalas") && value.request().postDataJSON()?.action === "GENERATE");
  await page.locator('section[aria-labelledby="escala-scenario-title"]').getByRole("button", { name: /^(Gerar proposta mensal|Gerar nova proposta)$/ }).click();
  const value = await response;
  expect(value.status()).toBe(200);
  return value.json();
}

test("real infeasible coverage explains the budget, opens the correct filters and recovers only after explicit confirmation", async ({ page }) => {
  const workspace = await fixture(page);
  try {
    const failed = await generate(page);
    expect(failed.result.status).toBe("INFEASIBLE");
    expect(failed.result.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ code: "COVERAGE_WEEKLY_CAPACITY", target: "coverage", sector: "Loja" })]));
    await expect(page.getByText("Proposta não gerada.", { exact: true })).toBeVisible();
    await expect(page.getByText(/os mínimos exigem 56h00.*40h00/)).toBeVisible();
    const action = page.getByRole("button", { name: "Conferir cobertura", exact: true });
    await action.focus(); await page.keyboard.press("Enter");
    const list = page.locator("#escala-coverage-required");
    await expect(list).toHaveAttribute("open", "");
    await expect(page.getByLabel("Filtrar setor da cobertura", { exact: true })).toHaveValue("Loja");
    await expect(page.getByLabel("Filtrar dia da cobertura", { exact: true })).toHaveValue("2026-11-02");
    expect(await list.locator("summary").evaluate(element => element === document.activeElement)).toBe(true);
    await list.locator("summary").click();
    await page.getByRole("button", { name: "Equipe", exact: true }).click();
    await action.click();
    await expect(list).toHaveAttribute("open", "");
    const unchanged: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json());
    expect(unchanged.revision).toBe(workspace.revision);
    expect(unchanged.input).toEqual(workspace.input);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Voltar à cobertura automática", exact: true }).click();
    await page.getByRole("button", { name: "Manter mínimos atuais", exact: true }).click();
    expect((await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json())).revision).toBe(workspace.revision);
    await page.getByRole("button", { name: "Voltar à cobertura automática", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar uso de cobertura automática", exact: true }).click();
    await expect(page.getByText(/Cobertura automática selecionada no rascunho/)).toBeVisible();
    const generated = await generate(page);
    expect(["FEASIBLE", "OPTIMAL"]).toContain(generated.result.status);
    expect(generated.validation.valid).toBe(true);
    expect(generated.proposalInput.defaultWeeklyHours).toBe(40);
    expect(generated.proposalInput.demands.length > 0).toBe(true);
    expect(generated.proposalInput.demands.every((demand: { estimated?: boolean }) => demand.estimated === true)).toBe(true);
    await page.getByRole("button", { name: "Aplicar proposta à grade", exact: true }).click();
    const saving = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "SAVE");
    await page.getByRole("button", { name: "Salvar revisão", exact: true }).click();
    expect((await saving).status()).toBe(200);
    const saved: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json());
    expect(saved.input.demands.every(demand => demand.estimated === true)).toBe(true);
    expect(saved.input.assignments).toHaveLength(42);
  } finally { await removeFixture(page, workspace.id); }
});

test("Conferir equipe e restrições opens the actual employee editor after a genuine locked-rest conflict", async ({ page }) => {
  const workspace = await fixture(page, true);
  try {
    const failed = await generate(page);
    expect(failed.result.status).toBe("INFEASIBLE");
    expect(failed.result.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ code: "LOCKED_WORK_ON_FIXED_REST", employeeId: "p1", date: "2026-10-31" })]));
    await page.getByRole("button", { name: "Conferir equipe e restrições", exact: true }).click();
    await expect(page.locator("#escala-team-restrictions")).toHaveAttribute("open", "");
    const editor = page.locator("#escala-employee-editor");
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel("Matrícula", { exact: true })).toHaveValue("001");
    await expect(editor).toBeFocused();
    const unchanged: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json());
    expect(unchanged.revision).toBe(workspace.revision);
    expect(unchanged.input.assignments).toEqual(workspace.input.assignments);
    expect(unchanged.input.employees[0].fixedOffDays).toEqual([5, 6]);
  } finally { await removeFixture(page, workspace.id); }
});


test("legacy global review cannot turn estimates into mandatory minima when creating and saving unrelated branches", async ({ page }) => {
  const ids: string[] = [];
  const origin = new URL(page.url()).origin;
  try {
    for (const suffix of ["A", "B"]) {
      const input = newInput("OUTRA-" + Date.now().toString(36) + suffix, "Regressão de outra filial", "2026-11", 40);
      input.policy.coverageReview = "CONFIRMED";
      input.demands = [
        { id: "estimated", sector: "Setor", date: input.startDate, start: 480, end: 720, minimum: 1, estimated: true },
        { id: "required", sector: "Setor", date: input.startDate, start: 780, end: 900, minimum: 1, estimated: false },
      ];
      const response = await page.request.post("/api/escalas", { headers: { origin }, data: { action: "CREATE", input } });
      expect(response.status()).toBe(201);
      const created: EscalaWorkspace = await response.json();
      ids.push(created.id);
      expect(created.input.demands.find(demand => demand.id === "estimated")?.estimated).toBe(true);
      expect(created.input.demands.find(demand => demand.id === "required")?.estimated).toBe(false);
      const next = { ...created.input, policy: { ...created.input.policy, coverageReview: "SUGGESTED" } };
      const savedResponse = await page.request.post("/api/escalas", { headers: { origin }, data: { action: "SAVE", id: created.id, expectedRevision: created.revision, input: next } });
      expect(savedResponse.status()).toBe(200);
      const persisted: EscalaWorkspace = await page.request.get("/api/escalas?id=" + created.id).then(value => value.json());
      expect(persisted.input.demands.find(demand => demand.id === "estimated")?.estimated).toBe(true);
      expect(persisted.input.demands.find(demand => demand.id === "required")?.estimated).toBe(false);
    }
  } finally { for (const id of ids) await removeFixture(page, id); }
});
