import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { strToU8, zipSync } from "fflate";

test.use({ screenshot: "off", trace: "off", video: "off" });
const root = process.env.E2E_REAJUSTE_AUDIT_OUTPUT!;
const originals = process.env.E2E_REAJUSTE_FIXTURE_DIR!;

function monthlyFixture(month: number) {
  const rows: string[][] = [["0001", "EMPRESA DE TESTE", "Pág.:", "1"], ["FOLHA DE PAGAMENTO"], ["Local:", "01 MATRIZ"]];
  const employees = [
    { id: "1", status: month === 6 ? "Trabalhando" : "Demitido", role: "Embalador a mão", sunday: "170,00" },
    { id: "2", status: month === 6 ? "Lic. s/ Remuneraçäo" : "Trabalhando", role: "OPERADOR", sunday: "255,00" },
    ...["Lic. s/ Remuneraçäo", "Demitido", "Aposent. Invalidez", "Detenção"].map((status, index) => ({ id: String(index + 3), status, role: "OPERADOR", sunday: "85,00" })),
  ];
  for (const employee of employees) rows.push(
    ["Colaborador:", `${employee.id} - COLABORADOR TESTE ${employee.id}`, "Sit:", employee.status],
    ["Cargo:", `000001 - ${employee.role}`],
    ["565", "01", "Bonus Convenc. SINDECOMU", "", "1,00", "80,00"],
    ["901", "01", "Indenização Compensatória", "", "0,00", employee.sunday],
    ["INSS Proc:", "2.000,00"],
  );
  const xml = rows.map((row, index) => `<row r="${index + 1}">${row.map((cell, column) => `<c r="${String.fromCharCode(65 + column)}${index + 1}" t="inlineStr"><is><t>${cell}</t></is></c>`).join("")}</row>`).join("");
  return { name: `0${month}-2026.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "_rels/.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'),
    "xl/workbook.xml": strToU8('<workbook xmlns:r="urn:r"><sheets><sheet name="Plan1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`),
  })) };
}

test("monthly situation blocks all three amounts while the packer percentage remains configurable", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires the isolated database runner");
  test.setTimeout(120_000);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.114" });
  await page.goto("/reajuste-salarial/acesso");
  await page.getByLabel("Senha padrão").fill(process.env.E2E_UNIMED_STANDARD_PASSWORD!);
  const unlocked = page.waitForResponse(response => response.url().endsWith("/access/session") && response.request().method() === "POST", { timeout: 60_000 });
  await page.getByRole("button", { name: "Desbloquear módulo", exact: true }).click();
  expect((await unlocked).status()).toBe(200);
  await expect(page).toHaveURL(/\/reajuste-salarial$/, { timeout: 30_000 });
  await page.locator("#salary-adjustment-files").setInputFiles([monthlyFixture(6), monthlyFixture(7)]);
  await page.getByLabel("Percentual restante a pagar (%)", { exact: true }).fill("1,08");
  const special = page.getByLabel("Percentual para Embalador a mão (%)", { exact: true });
  await expect(special).toHaveValue("2.2655");
  await page.getByRole("checkbox", { name: "Incluir diferenças de bônus e domingos", exact: true }).check();
  await page.getByLabel("Novo valor do bônus (R$)", { exact: true }).fill("90,00");
  await page.getByLabel("Novo valor por domingo (R$)", { exact: true }).fill("90,00");
  const pending = page.waitForResponse(response => response.url().endsWith("/eventos/analisar"), { timeout: 60_000 });
  await page.getByRole("button", { name: "Apurar eventos", exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const { report } = await response.json();
  expect(report).toMatchObject({ employeeCount: 6, issueCount: 0, bonusTotalCents: "2000", sundayTotalCents: "2500", grandTotalCents: "4500" });
  expect(report.employees.flatMap((employee: { months: Array<{ exclusionReason?: string }> }) => employee.months).filter((month: { exclusionReason?: string }) => month.exclusionReason)).toHaveLength(10);
  await expect(page.getByText(/Cálculo bloqueado nesta competência:/).first()).toBeVisible();
  await special.fill("2.26555");
  await expect(page.getByRole("button", { name: "Gerar PDF", exact: true })).toBeDisabled();
  await special.fill("3,1234");
  const button = page.getByRole("button", { name: "Gerar PDF", exact: true });
  await expect(button).toBeEnabled();
  const sent = page.waitForRequest(request => request.url().endsWith("/api/reajuste-salarial/gerar") && request.method() === "POST");
  const generated = page.waitForResponse(response => response.url().endsWith("/api/reajuste-salarial/gerar") && response.request().method() === "POST", { timeout: 120_000 });
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await button.click();
  const submitted = await sent;
  expect(submitted.headers()["content-type"]).toContain("multipart/form-data");
  await expect(special).toHaveValue("3,1234");
  expect((await generated).status()).toBe(200);
  const downloaded = await download;
  expect(await downloaded.failure()).toBeNull();
  const bytes = await readFile((await downloaded.path())!);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  if (root) await writeFile(path.join(root, "ANTECIPACAO-SINTETICO-PERCENTUAL-FUTURO.pdf"), bytes, { mode: 0o600 });
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  await expect(special).toHaveValue("2.2655");
});

test("original payroll imports with monthly eligibility and precise hand packer rate", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires the isolated database runner");
  test.skip(!root || !originals, "Requires private read-only originals and an audit output directory");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.112" });
  const errors: string[] = [];
  page.on("pageerror", () => errors.push("pageerror"));
  await page.goto("/reajuste-salarial/acesso");
  await page.getByLabel("Senha padrão").fill(process.env.E2E_UNIMED_STANDARD_PASSWORD!);
  const unlock = page.waitForResponse(response => response.url().endsWith("/access/session") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Desbloquear módulo", exact: true }).click();
  expect((await unlock).status()).toBe(200);
  await expect(page).toHaveURL(/\/reajuste-salarial$/, { timeout: 30_000 });
  await expect(page.getByRole("tab", { name: "Antecipação Salarial", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.locator("#salary-adjustment-files").setInputFiles(await Promise.all([6, 7, 8].map(async month => {
    const name = `0${month}-2026.xlsx`;
    return { name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await readFile(path.join(originals, name)) };
  })));
  await page.getByLabel("Percentual restante a pagar (%)", { exact: true }).fill("1,08");
  await expect(page.getByLabel("Percentual para Embalador a mão (%)", { exact: true })).toHaveValue("2.2655");
  await page.getByLabel("Percentual para Embalador a mão (%)", { exact: true }).fill("2,2655");
  await page.getByRole("checkbox", { name: "Incluir diferenças de bônus e domingos", exact: true }).check();
  await page.getByLabel("Valor antigo do bônus (R$)", { exact: true }).fill("80,00");
  await page.getByLabel("Novo valor do bônus (R$)", { exact: true }).fill("90,00");
  await page.getByLabel("Valor antigo por domingo (R$)", { exact: true }).fill("85,00");
  await page.getByLabel("Novo valor por domingo (R$)", { exact: true }).fill("90,00");
  await expect(page.getByLabel("Percentual restante a pagar (%)", { exact: true })).toHaveValue("1,08");
  for (const name of ["06-2026.xlsx", "07-2026.xlsx", "08-2026.xlsx"]) await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gerar PDF", exact: true })).toBeDisabled();
  await page.locator("#salary-adjustment-percentage").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(root, "configuracao-regras.png"), fullPage: false });
  const analysis = page.waitForResponse(response => response.url().endsWith("/eventos/analisar"), { timeout: 120_000 });
  await page.getByRole("button", { name: "Apurar eventos", exact: true }).click();
  const analysisResponse = await analysis;
  expect(analysisResponse.status()).toBe(200);
  const { report } = await analysisResponse.json();
  expect(report).toMatchObject({ employeeCount: 787, branchCount: 8, issueCount: 0, bonusTotalCents: "1908000", sundayTotalCents: "937000", grandTotalCents: "2845000" });
  const product = JSON.parse(await readFile(path.join(root, "product-rules.private.json"), "utf8"));
  const comparable = (value: typeof report) => ({ ...value, generatedAt: "ignored" });
  // Avoid exposing payroll identities through test assertion diagnostics.
  expect(JSON.stringify(comparable(report)) === JSON.stringify(comparable(product.events))).toBe(true);
  await writeFile(path.join(root, "ui-event-results.private.json"), JSON.stringify(report), { mode: 0o600 });
  const button = page.getByRole("button", { name: "Gerar PDF", exact: true });
  await expect(button).toBeEnabled();
  const request = page.waitForRequest(request => request.url().endsWith("/api/reajuste-salarial/gerar") && request.method() === "POST");
  const response = page.waitForResponse(response => response.url().endsWith("/api/reajuste-salarial/gerar") && response.request().method() === "POST", { timeout: 120_000 });
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await button.click();
  const submitted = await request;
  expect(submitted.method()).toBe("POST");
  expect(submitted.headers()["content-type"]).toContain("multipart/form-data");
  expect((await response).status()).toBe(200);
  const downloaded = await download;
  expect(await downloaded.failure()).toBeNull();
  const bytes = await readFile((await downloaded.path())!);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getTitle()).toBe("Antecipação Salarial com diferenças de bônus e domingos");
  expect(pdf.getPageCount()).toBeGreaterThan(40);
  await writeFile(path.join(root, "ANTECIPACAO-IMPORTACAO-REGRAS.pdf"), bytes, { mode: 0o600 });
  await expect(page.getByText(/PDF gerado\. Download iniciado:/)).toBeVisible();
  expect(errors).toEqual([]);
  await writeFile(path.join(root, "ui-summary.json"), JSON.stringify({ percentage: "1,08", packerPercentage: "2,2655", employees: 787, issues: 0, eventReportMatchesProduct: true, pageErrors: errors.length, pdfPages: pdf.getPageCount(), pdfBytes: bytes.length, screenPercentageMatches: true, requestMethod: submitted.method(), integratedPdf: true }), { mode: 0o600 });
});
