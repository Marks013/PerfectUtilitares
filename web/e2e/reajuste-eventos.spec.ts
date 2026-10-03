import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
test.use({ screenshot: "off", trace: "off", video: "off" });

const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
type Rows = Array<Array<string | null>>;
function workbook(rows: Rows) {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const xml = rows.map((row, index) => `<row r="${index + 1}">${row.map((value, column) => value === null ? "" : `<c r="${String.fromCharCode(65 + column)}${index + 1}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join("")}</row>`).join("");
  return Buffer.from(zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "_rels/.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'),
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Plan1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`),
  }));
}
const header: Rows = [["0001", "EMPRESA FICTICIA", "Pág.:", "1"], ["FOLHA DE PAGAMENTO"], ["Local:", "01 MATRIZ"]];
function employee(registration: string, name: string, bonus: string | null, sundays: string | null): Rows {
  return [["Tipo:", "1", "Colaborador:", `${registration} - ${name}`],
    ...(bonus === null ? [] : [["565", "01", "Bonus Convenc. SINDECOMU", null, "1,00", bonus]]),
    ...(sundays === null ? [] : [[null, null, null, null, null, null, null, null, "901", "01", "Indenização Compensatória", null, "", null, sundays]]),
    ["INSS Proc:", "1.000,00"]];
}
function syntheticFile(month: number, rows: Rows) { return { name: `0${month}-2026.xlsx`, mimeType, buffer: workbook([...header, ...rows]) }; }
async function respectRateLimit(page: Page, response: Response) {
  const seconds = Number(response.headers()["retry-after"]);
  expect(seconds).toBeGreaterThan(0); expect(seconds).toBeLessThanOrEqual(60);
  const body = await response.json();
  await expect(page.getByRole("alert").filter({ hasText: body.error.message })).toBeVisible();
  await page.waitForTimeout(seconds * 1000);
}
async function analyze(page: Page, expand = true) {
  const pending = page.waitForResponse(response => response.url().endsWith("/eventos/analisar"));
  await page.getByRole("button", { name: "Apurar eventos", exact: true }).click();
  let response = await pending;
  if (response.status() === 429) {
    await respectRateLimit(page, response);
    const retry = page.waitForResponse(response => response.url().endsWith("/eventos/analisar"));
    await page.getByRole("button", { name: "Apurar eventos", exact: true }).click();
    response = await retry;
  }
  expect(response.status()).toBe(200);
  const { report } = await response.json();
  const summary = page.locator("summary").filter({ hasText: "Conferência por colaborador e competência" });
  await expect(summary).toBeVisible();
  if (expand && await summary.locator("..").getAttribute("open") === null) await summary.click();
  return report;
}
async function configure(page: Page) {
  await page.getByLabel("Novo valor do bônus (R$)", { exact: true }).fill("90,00");
  await page.getByLabel("Novo valor por domingo (R$)", { exact: true }).fill("90,00");
}
async function pdf(page: Page, kind: "summary" | "detailed" = "detailed") {
  const button = kind === "summary" ? "Resumo Consolidado" : "Detalhado";
  const pending = page.waitForEvent("download", { timeout: 120_000 });
  void pending.catch(() => undefined);
  // Large real payroll PDFs may exceed the default interaction timeout.
  const responsePending = page.waitForResponse(response => response.url().endsWith("/api/reajuste-salarial/gerar"), { timeout: 120_000 });
  await page.getByRole("button", { name: button, exact: true }).click();
  let response = await responsePending;
  if (response.status() === 429) {
    await respectRateLimit(page, response);
    const retry = page.waitForResponse(response => response.url().endsWith("/api/reajuste-salarial/gerar"), { timeout: 120_000 });
    await page.getByRole("button", { name: button, exact: true }).click();
    response = await retry;
  }
  expect(response.status()).toBe(200);
  const download = await pending; expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const document = await PDFDocument.load(await readFile((await download.path())!));
  expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
  expect(document.getTitle()).toBe(kind === "summary" ? "Antecipação Salarial — Resumo Consolidado" : "Antecipação Salarial — Apuração Detalhada");
  await expect(page.getByText(/PDF gerado\. Download iniciado:/)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Use the isolated database runner");
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  // Keep this file's real password logins independent from other suites
  // sharing the isolated runner's loopback address and 5-attempt access limit.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.88" });
  const password = process.env.E2E_UNIMED_STANDARD_PASSWORD; expect(password).toBeTruthy();
  await page.goto("/reajuste-salarial/acesso", { timeout: 30_000 });
  await page.getByLabel("Senha padrão").fill(password!);
  const unlockResponse = page.waitForResponse(response => response.url().endsWith("/api/reajuste-salarial/access/session") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Desbloquear módulo", exact: true }).click();
  expect((await unlockResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/reajuste-salarial$/, { timeout: 30_000 });
  await expect(page.getByRole("tab", { name: "Eventos 565 e 901", exact: true })).toHaveCount(0);
  const includeEvents = page.getByRole("checkbox", { name: "Incluir diferenças de bônus e domingos", exact: true });
  await expect(includeEvents).not.toBeChecked();
  await includeEvents.check();
  await page.locator("#salary-adjustment-percentage").fill("5,00");
  await page.getByLabel("Percentual para Embalador a mão (%)", { exact: true }).fill("2,26550");
});

test("synthetic monthly events distinguish absence, apportion exact quantities and download PDF", async ({ page }) => {
  await page.locator("#salary-adjustment-files").setInputFiles([
    syntheticFile(6, [...employee("1", "ANA FICTICIA", "80,00", "170,00"), ...employee("2", "BIA FICTICIA", null, null)]),
    syntheticFile(7, employee("1", "ANA FICTICIA", "80,00", "85,00")),
    syntheticFile(8, [...employee("1", "ANA FICTICIA", "80,00", "255,00"), ...employee("2", "BIA FICTICIA", "80,00", null)]),
  ]);
  await configure(page); const report = await analyze(page, false);
  const conference = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Conferência por colaborador e competência" }) });
  await expect(conference).not.toHaveAttribute("open");
  await expect(page.getByLabel("Buscar colaborador", { exact: true })).not.toBeVisible();
  await conference.locator("summary").first().focus(); await page.keyboard.press("Enter");
  await expect(conference).toHaveAttribute("open", "");
  expect(report).toMatchObject({ employeeCount: 2, issueCount: 0, bonusTotalCents: "4000", sundayTotalCents: "3000", grandTotalCents: "7000" });
  expect(report.employees.find((item: { registration: string }) => item.registration === "1").months.map((month: { indemnity901: { quantity: number } }) => month.indemnity901.quantity)).toEqual([2, 1, 3]);
  const bia = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "BIA FICTICIA", exact: true }) });
  await expect(bia.getByText("Colaborador não consta nesta base mensal. Não equivale a evento ausente.")).toBeVisible();
  await page.getByRole("combobox", { name: "Situação do evento", exact: true }).selectOption("bonus-missing");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Competência", exact: true }).selectOption("07-2026");
  await expect(page.getByText("Nenhum colaborador corresponde aos filtros.")).toBeVisible();
  await page.getByRole("combobox", { name: "Competência", exact: true }).selectOption("");
  await page.getByRole("combobox", { name: "Situação do evento", exact: true }).selectOption("all");
  await pdf(page, "summary");
  await expect(page.getByRole("button", { name: /^Remover \d\d-2026\.xlsx$/ })).toHaveCount(3);
  await pdf(page, "detailed");
  await conference.locator("summary").first().click();
  await expect(page.getByLabel("Buscar colaborador", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Incluir diferenças de bônus e domingos", exact: true })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Incluir diferenças de bônus e domingos", exact: true }).check();
  await expect(page.getByLabel("Novo valor do bônus (R$)", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Valor antigo por domingo (R$)", { exact: true })).toHaveValue("85,00");
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Detalhado", exact: true })).toBeDisabled();
  await expect(page.getByText("06-2026.xlsx", { exact: true })).toHaveCount(0);
});

test("historical competency overrides resolve nonintegral Sunday quantities and invalidate previews", async ({ page }) => {
  await page.locator("#salary-adjustment-files").setInputFiles(syntheticFile(6, employee("1", "ANA FICTICIA", "80,00", "170,00")));
  await configure(page);
  await page.getByLabel("Valor antigo por domingo (R$)", { exact: true }).fill("90,00");
  const report = await analyze(page); expect(report.issueCount).toBeGreaterThan(0);
  expect(report.employees[0].months[0].indemnity901.quantity).toBeNull();
  await expect(page.getByRole("button", { name: "Detalhado", exact: true })).toBeDisabled();
  await page.getByText("Valores antigos por competência", { exact: true }).click();
  await page.getByLabel("Domingo antigo de 06-2026", { exact: true }).fill("85,00");
  await expect(page.locator("summary").filter({ hasText: "Conferência por colaborador e competência" })).toHaveCount(0);
  const corrected = await analyze(page);
  expect(corrected).toMatchObject({ issueCount: 0, bonusTotalCents: "1000", sundayTotalCents: "1000", grandTotalCents: "2000" });
  await expect(page.getByRole("button", { name: "Detalhado", exact: true })).toBeEnabled();
  await page.getByLabel("Novo valor por domingo (R$)", { exact: true }).fill("80,00");
  const lower = await analyze(page); expect(lower.sundayTotalCents).toBe("0");
});

test("synthetic preview paginates and remains inside mobile and desktop viewports", async ({ page }) => {
  const rows = Array.from({ length: 14 }, (_, index) => employee(String(index + 1), `COLABORADOR FICTICIO ${String(index + 1).padStart(2, "0")}`, "80,00", "170,00")).flat();
  await page.locator("#salary-adjustment-files").setInputFiles(syntheticFile(6, rows));
  await configure(page); await analyze(page);
  await expect(page.getByRole("article")).toHaveCount(12);
  await page.getByRole("button", { name: "Próxima", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.getByRole("button", { name: "Anterior", exact: true }).click();
  await page.getByLabel("Buscar colaborador", { exact: true }).fill("FICTICIO 14");
  await expect(page.getByRole("article")).toHaveCount(1);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Detalhado", exact: true })).toBeVisible();
  }
});

test("review regressions preserve four bases, show monthly subtotals and cancel stale tab responses", async ({ page }) => {
  test.setTimeout(180_000);
  const june = syntheticFile(6, employee("1", "ANA FICTICIA", "80,00", "170,00"));
  await page.locator("#salary-adjustment-files").setInputFiles([
    june,
    syntheticFile(7, employee("1", "ANA FICTICIA", "80,00", "85,00")),
    syntheticFile(8, employee("1", "ANA FICTICIA", "80,00", "255,00")),
    syntheticFile(9, employee("1", "ANA FICTICIA", "80,00", "170,00")),
  ]);
  await configure(page);
  const report = await analyze(page);
  expect(report.grandTotalCents).toBe("8000");
  await page.getByRole("combobox", { name: "Competência", exact: true }).selectOption("06-2026");
  await expect(page.getByRole("article").getByText("Diferença exibida: R$ 20,00", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Totais de todas as bases", exact: true })).toBeVisible();
  await expect(page.getByText(/O PDF contém a apuração completa de todas as bases/)).toBeVisible();
  await page.locator("#salary-adjustment-files").setInputFiles(syntheticFile(6, employee("99", "REVISAO FICTICIA", "80,00", "170,00")));
  await expect(page.getByRole("alert").filter({ hasText: "Seleção não adicionada" })).toBeVisible();
  await expect(page.getByRole("article").getByRole("heading", { name: "ANA FICTICIA", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remover \d\d-2026\.xlsx$/ })).toHaveCount(4);
  expect((await analyze(page)).employees[0].registration).toBe("1");

  const revisionTab = page.getByRole("tab", { name: "Reajuste Salarial", exact: true });
  const advanceTab = page.getByRole("tab", { name: "Antecipação Salarial", exact: true });
  await advanceTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(revisionTab).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Reajuste Salarial", exact: true })).toBeVisible();
  await page.keyboard.press("Home");
  await expect(advanceTab).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Antecipação Salarial", exact: true })).toBeVisible();
  await page.keyboard.press("End");
  await expect(revisionTab).toBeFocused();
  await page.keyboard.press("Home");
  await expect(advanceTab).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tabpanel", { name: "Antecipação Salarial", exact: true })).toBeFocused();

  let releaseAnalysis: () => void = () => undefined;
  const heldAnalysis = new Promise<void>(resolve => { releaseAnalysis = resolve; });
  let analysisStarted: () => void = () => undefined;
  const startedAnalysis = new Promise<void>(resolve => { analysisStarted = resolve; });
  await page.route("**/eventos/analisar", async route => {
    analysisStarted(); await heldAnalysis;
    await route.fulfill({ json: { report: { ...report, grandTotalCents: "999999" } } }).catch(() => undefined);
  });
  await page.getByRole("button", { name: "Apurar eventos", exact: true }).click();
  await startedAnalysis;
  await advanceTab.focus(); await page.keyboard.press("ArrowRight");
  releaseAnalysis();
  await revisionTab.focus(); await page.keyboard.press("Home");
  await expect(page.getByRole("button", { name: "Apurar eventos", exact: true })).toBeEnabled();
  await expect(page.getByText("R$ 9.999,99", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Totais de todas as bases", exact: true })).toBeVisible();
  await page.unroute("**/eventos/analisar");

  const downloads: string[] = [];
  page.on("download", download => downloads.push(download.suggestedFilename()));
  let releasePdf: () => void = () => undefined;
  const heldPdf = new Promise<void>(resolve => { releasePdf = resolve; });
  let pdfStarted: () => void = () => undefined;
  const startedPdf = new Promise<void>(resolve => { pdfStarted = resolve; });
  await page.route("**/api/reajuste-salarial/gerar", async route => {
    pdfStarted(); await heldPdf;
    await route.fulfill({ contentType: "application/pdf", body: Buffer.from("%PDF-1.7\nSTALE TEST") }).catch(() => undefined);
  });
  await page.getByRole("button", { name: "Detalhado", exact: true }).click();
  await startedPdf;
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  releasePdf();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Incluir diferenças de bônus e domingos", exact: true })).not.toBeChecked();
  await expect(page.getByText("PDF gerado. Download iniciado.", { exact: true })).toHaveCount(0);
  expect(downloads).toEqual([]);
});

test.describe("original private payroll", () => {
  test("original June July August payroll produces audited event totals and PDF", async ({ page }) => {
    const directory = process.env.E2E_REAJUSTE_FIXTURE_DIR;
    test.skip(!directory, "Private originals are optional; synthetic cases always run");
    await page.locator("#salary-adjustment-files").setInputFiles(await Promise.all([6, 7, 8].map(async month => {
      const name = `0${month}-2026.xlsx`; return { name, mimeType, buffer: await readFile(path.join(directory!, name)) };
    })));
    await configure(page); const report = await analyze(page);
    expect(report).toMatchObject({ issueCount: 0, bonusTotalCents: "1908000", sundayTotalCents: "930500", grandTotalCents: "2838500" });
    await pdf(page);
  });
});
