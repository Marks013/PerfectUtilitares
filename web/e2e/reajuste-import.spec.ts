import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";

const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function workbook(rows: Array<Array<string | number | null>>) {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const sheetData = rows.map((row, index) => {
    const cells = row.map((value, column) => {
      if (value === null) return "";
      const reference = `${String.fromCharCode(65 + column)}${index + 1}`;
      return typeof value === "number"
        ? `<c r="${reference}"><v>${value}</v></c>`
        : `<c r="${reference}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${index + 1}">${cells}</row>`;
  }).join("");
  return Buffer.from(zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "_rels\\.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'),
    "xl\\workbook.xml": strToU8('<workbook xmlns:r="urn:r"><sheets><sheet name="Plan1" r:id="rId1"/></sheets></workbook>'),
    "xl\\_rels\\workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="sheet1.xml"/></Relationships>'),
    "xl\\sheet1.xml": strToU8(`<worksheet><sheetData>${sheetData}</sheetData></worksheet>`),
  }));
}

async function fixture(name: string, rows: Array<Array<string | number | null>>) {
  const directory = process.env.E2E_REAJUSTE_FIXTURE_DIR;
  const buffer = directory ? await readFile(path.join(directory, name)) : workbook(rows);
  return { name, mimeType, buffer };
}

async function assertPdfDownload(page: Page, buttonName: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  const document = await PDFDocument.load(await readFile(downloadedPath!));
  expect(document.getPageCount()).toBeGreaterThan(0);
  await expect(page.getByText("PDF gerado.", { exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Run with the isolated database runner");
  test.setTimeout(120_000);
  const password = process.env.E2E_UNIMED_STANDARD_PASSWORD;
  expect(password).toBeTruthy();
  await page.goto("/reajuste-salarial/acesso");
  await page.getByLabel("Senha padrão").fill(password!);
  await page.getByRole("button", { name: "Desbloquear módulo", exact: true }).click();
  await expect(page).toHaveURL(/\/reajuste-salarial$/, { timeout: 30_000 });
  await page.getByLabel("Percentual para Embalador a mão (%)", { exact: true }).fill("2,26550");
});

test("monthly payroll imports and generates the salary advance PDF", async ({ page }) => {
  const files = await Promise.all([6, 7, 8].map(month => fixture(`0${month}-2026.xlsx`, [
    ["FOLHA DE PAGAMENTO"],
    ["Local:", "08  TIRADENTES"],
    ["Colaborador:", "001 - ANA TESTE"],
    ["Salário Base:", 1_000],
    ["INSS Proc:", "2.000,00"],
  ])));
  await page.locator("#salary-adjustment-files").setInputFiles(files);
  await page.getByLabel("Percentual restante a pagar (%)").fill("4,42");
  await assertPdfDownload(page, "Detalhado");
  await expect(page.getByRole("button", { name: /^Remover \d\d-2026\.xlsx$/ })).toHaveCount(3);
  await assertPdfDownload(page, "Resumo Consolidado");
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  await expect(page.getByText("06-2026.xlsx", { exact: true })).toHaveCount(0);
});

test("FPRE131 totals allow analysis, general adjustment and selected rules", async ({ page }) => {
  await page.getByRole("tab", { name: "Reajuste Salarial", exact: true }).click();
  const file = await fixture("FPRE131.xlsx", [
    ["Cadastro", "Nome", null, null, null, "Admissão", "Cargo", null, null, "Salário"],
    ["08 , TIRADENTES"],
    [1, "ANA TESTE", null, null, null, 45_000, "CAIXA", null, null, "2.143,70"],
    ["Total", "08 , TIRADENTES", null, null, null, null, "00001", null, null, "2.143,70"],
    ["16 , MULTI ATACADO"],
    [2, "BIA TESTE", null, null, null, 45_000, "CAIXA", null, null, "2.143,70"],
    ["Total", "16 , MULTI ATACADO", null, null, null, null, "00001", null, null, "2.143,70"],
    ["18 , ANCHIETA"],
    [3, "CIDA TESTE", null, null, null, 45_000, "CAIXA", null, null, "2.143,70"],
    ["Total", "18 , ANCHIETA", null, null, null, null, "00001", null, null, "2.143,70"],
    ["Total Geral", null, null, null, null, null, "00003", null, null, "6.431,10"],
  ]);
  await page.locator("#salary-revision-file").setInputFiles(file);
  const analysisResponse = page.waitForResponse(response => response.url().endsWith("/reajuste/analisar"));
  await page.getByRole("button", { name: "Analisar arquivo", exact: true }).click();
  const response = await analysisResponse;
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.analysis).toMatchObject({ employeeCount: 3, branchCount: 3 });
  await page.getByLabel("Percentual geral (%)").fill("4,42");
  await assertPdfDownload(page, "Gerar PDF de reajuste");
  await page.getByRole("button", { name: "Adicionar regra", exact: true }).click();
  await page.getByLabel("Salário mínimo").fill("2.000,00");
  await page.getByLabel("Salário máximo").fill("2.200,00");
  await page.getByLabel("Novo salário fixo").fill("2.300,00");
  await page.getByRole("button", { name: "Selecionar faixa", exact: true }).click();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(3);
  await page.getByRole("radio", { name: /Somente selecionados nas regras/ }).check();
  await assertPdfDownload(page, "Gerar PDF de reajuste");
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Gerar PDF de reajuste", exact: true })).toBeDisabled();
});
