import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./admin-session";

test.beforeEach(async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Resets run against an isolated database");
  test.setTimeout(120_000);
  await loginAsAdmin(page);
});

const spreadsheet = { name: "reset.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("selection-only") };

test("Jornada clears inputs, batch and pending results without deleting history", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let started = false;
  let deletes = 0;
  page.on("request", (request) => { if (request.method() === "DELETE") deletes += 1; });
  await page.route("**/api/jornada/validar", async (route) => {
    started = true;
    await pending;
    await route.fulfill({ status: 500, json: { message: "Resposta antiga" } }).catch(() => {});
  });
  await page.goto("/jornada/validar");
  const history = await page.request.get("/api/jornada/historico").then((response) => response.json());
  await page.locator('input[name="horarios"]').fill("0800 1200");
  await page.getByRole("button", { name: "Validar", exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole("button", { name: "Limpar dados", exact: true }).click();
  release();
  await expect(page.locator('input[name="horarios"]')).toHaveValue("");
  await expect(page.getByText("Resposta antiga")).toHaveCount(0);
  await page.locator(".jornada-batch-summary").click();
  await page.locator('input[type="file"]').setInputFiles(spreadsheet);
  await page.getByRole("button", { name: "Limpar dados", exact: true }).click();
  await page.locator(".jornada-batch-summary").click();
  await expect(page.locator('input[type="file"]')).toHaveValue("");
  await page.locator('input[type="file"]').setInputFiles(spreadsheet);
  expect(await page.locator('input[type="file"]').inputValue()).toContain("reset.xlsx");
  expect(deletes).toBe(0);
  expect(await page.request.get("/api/jornada/historico").then((response) => response.json())).toEqual(history);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Limpar dados", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Férias clears pending work and accepts the same file again", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let started = false;
  await page.route("**/api/admin/ferias/analisar", async (route) => {
    started = true;
    await pending;
    await route.fulfill({ status: 500, json: { message: "Resposta antiga" } }).catch(() => {});
  });
  await page.goto("/admin/ferias");
  await page.locator('input[type="file"]').setInputFiles(spreadsheet);
  await page.getByRole("button", { name: "Analisar planilha", exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole("button", { name: "Limpar dados", exact: true }).click();
  release();
  await expect(page.getByText("reset.xlsx", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Analisar planilha", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles(spreadsheet);
  await expect(page.getByText("reset.xlsx", { exact: true })).toBeVisible();
});

test("Reajuste clears pending analysis and accepts the same file again", async ({ page }) => {
  test.skip(!process.env.E2E_UNIMED_STANDARD_PASSWORD, "Isolated module password required");
  await page.goto("/reajuste-salarial/acesso");
  const origin = new URL(page.url()).origin;
  const unlocked = await page.request.post("/api/reajuste-salarial/access/session", {
    headers: { origin }, data: { password: process.env.E2E_UNIMED_STANDARD_PASSWORD },
  });
  expect(unlocked.status()).toBe(200);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let started = false;
  await page.route("**/api/reajuste-salarial/reajuste/analisar", async (route) => {
    started = true;
    await pending;
    await route.fulfill({ status: 500, json: { error: { message: "Resposta antiga" } } }).catch(() => {});
  });
  await page.goto("/reajuste-salarial");
  await page.getByRole("tab", { name: "Reajuste Salarial", exact: true }).click();
  const file = spreadsheet;
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: /Analisar/ }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  release();
  await expect(page.locator('input[type="file"]')).toHaveValue("");
  await expect(page.getByText("Resposta antiga")).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText("reset.xlsx", { exact: true })).toBeVisible();
});
