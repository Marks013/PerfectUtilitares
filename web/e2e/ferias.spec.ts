import { expect, type Page, test } from "@playwright/test";

const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
const fixture = {
  competency: "2026-09", revision: "revision-1",
  sources: [{ name: "Cadastro Unimed", ready: true, competency: "2026-09", fallback: false }, { name: "Fatura e coparticipação", ready: true, competency: "2026-09", fallback: false }, { name: "Consignado Digital", ready: true, competency: "2026-09", fallback: false }],
  pricePeriods: ["2026-08-01"], issues: [],
  rows: [{
    row: 4, registration: "1234", branch: "MATRIZ", name: "Colaboradora de teste",
    start: "2026-09-01", end: "2026-09-30", days: 30, highlight: false,
    unimedText: "Mens.: 61,26", loanText: "Consig.R$ 100,00", issues: [], warnings: [],
    holderId: "holder-test", loanIdentity: "loan-test", holderCandidates: [], loanCandidates: [],
  }],
  summary: { total: 1, unimed: 1, loans: 1, pending: 0, highlighted: 0 },
  canExport: true,
};

async function login(page: Page) {
  await page.goto("/login?callbackUrl=%2Fadmin%2Fferias");
  await page.locator('input[name="email"]').fill(adminEmail!);
  await page.locator('input[name="password"]').fill(adminPassword!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/ferias(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Férias", exact: true })).toBeVisible();
}

async function upload(page: Page) {
  await page.getByLabel("Arquivo de férias", { exact: true }).setInputFiles({
    name: "ferias.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("mocked-upload-not-sent-to-backend"),
  });
  await page.getByRole("button", { name: "Analisar planilha", exact: true }).click();
}

test("Ferias is inaccessible without an administrative session", async ({ page }) => {
  await page.goto("/admin/ferias");
  await expect(page).not.toHaveURL(/\/admin\/ferias(?:\?|$)/);
  await expect(page.getByRole("link", { name: "Férias", exact: true })).toHaveCount(0);
});

test.describe("Ferias administrative UI with isolated mocked operations", () => {
  let adminCookies: Awaited<
    ReturnType<ReturnType<Page["context"]>["cookies"]>
  > = [];

  test.beforeAll(async ({ browser }) => {
    if (!adminEmail || !adminPassword) return;

    const page = await browser.newPage();
    await login(page);
    adminCookies = await page.context().cookies();
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!adminEmail || !adminPassword, "Admin credentials are required");
    // Interception guarantees fixtures cannot reach real calculation endpoints.
    await page.route("**/api/admin/ferias/**", (route) => route.fulfill({
      status: 500, json: { error: { code: "UNMOCKED", message: "Operação não configurada no teste." } },
    }));
    await page.context().addCookies(adminCookies);
    await page.goto("/admin/ferias");
    await expect(page.getByRole("heading", { name: "Férias", exact: true })).toBeVisible();
  });

  test("requires an explicit identity choice, reanalyzes and downloads", async ({ page }) => {
    let analyses = 0;
    await page.route("**/api/admin/ferias/analisar", async (route) => {
      analyses++;
      const resolved = analyses > 1;
      if (resolved) expect(route.request().postDataBuffer()?.toString()).toContain('"holderId":"holder-test"');
      await route.fulfill({ json: {
        ...fixture, canExport: resolved,
        summary: { ...fixture.summary, pending: resolved ? 0 : 1 },
        rows: [{ ...fixture.rows[0], holderId: resolved ? "holder-test" : undefined, holderCandidates: [{ id: "holder-test", label: "Colaboradora de teste · ***.***.***-00 · MATRIZ" }], issues: resolved ? [] : ["Confirme o titular correspondente."] }],
      } });
    });
    await page.route("**/api/admin/ferias/exportar", async (route) => {
      const request = route.request().postDataBuffer()?.toString();
      expect(request).toContain('name="revision"');
      expect(request).toContain("revision-1");
      await route.fulfill({ contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: Buffer.from("PK-mocked-download") });
    });
    await upload(page);
    await expect(page.getByRole("button", { name: "Baixar planilha", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Titular Unimed · linha 4")).toHaveValue("");
    await page.getByLabel("Titular Unimed · linha 4").selectOption("holder-test");
    await expect(page.getByText("Uma nova análise é necessária.")).toBeVisible();
    await page.getByRole("button", { name: "Analisar novamente", exact: true }).click();
    await expect(page.getByRole("button", { name: "Baixar planilha", exact: true })).toBeEnabled();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Baixar planilha", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("FERIAS-09-2026-CONFERIDO.xlsx");
    await expect(page.getByRole("link", { name: "Baixar novamente", exact: true })).toBeVisible();
  });

  test("blocks stale exports and clears results when the upload changes", async ({ page }) => {
    await page.route("**/api/admin/ferias/analisar", (route) => route.fulfill({ json: fixture }));
    await page.route("**/api/admin/ferias/exportar", (route) => route.fulfill({ status: 409, json: { error: { code: "STALE", message: "As bases foram atualizadas. Analise novamente." } } }));
    await upload(page);
    await page.getByRole("button", { name: "Baixar planilha", exact: true }).click();
    await expect(page.getByRole("region", { name: "Planilha do mês" }).getByRole("alert")).toContainText("As bases foram atualizadas");
    await expect(page.getByRole("button", { name: "Baixar planilha", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Remover planilha", exact: true }).click();
    await expect(page.getByTestId("ferias-row-4")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Analisar planilha", exact: true })).toBeDisabled();
  });

  test("keeps rows and controls within mobile and desktop viewports", async ({ page }, testInfo) => {
    await page.route("**/api/admin/ferias/analisar", (route) => route.fulfill({ json: {
      ...fixture, canExport: false,
      rows: [{ ...fixture.rows[0],
        name: "Colaboradora com nome completo longo para conferência de férias",
        issues: ["Confirme as pessoas correspondentes."],
        holderCandidates: [{ id: "holder-test", label: "Colaboradora com nome completo longo · ***.***.***-00 · MATRIZ" }],
        loanCandidates: [{ id: "loan-test", label: "Colaboradora com nome completo longo · ***.***.***-00 · MATRIZ" }],
      }],
      summary: { ...fixture.summary, pending: 1 },
    } }));
    await upload(page);
    for (const width of [390, 768, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByTestId("ferias-row-4")).toBeVisible();
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
      for (const label of ["Titular Unimed · linha 4", "Consignado Digital · linha 4"]) {
        const control = await page.getByLabel(label).boundingBox();
        expect(control).not.toBeNull();
        expect(control!.x + control!.width).toBeLessThanOrEqual(width);
      }
      await page.screenshot({ path: testInfo.outputPath(`ferias-${width}.png`), fullPage: true });
    }
  });
});
