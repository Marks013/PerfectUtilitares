import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { loginAsAdmin } from "./admin-session";

test.beforeEach(async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires the isolated database");
  test.setTimeout(120_000);
  await loginAsAdmin(page);
});

async function inputPdf() {
  if (process.env.PDF_REGRESSION_SOURCE) {
    return readFile(process.env.PDF_REGRESSION_SOURCE);
  }
  const document = await PDFDocument.create();
  document.addPage([3264, 1185]).drawText("PDF crop regression", { x: 400, y: 500 });
  return Buffer.from(await document.save());
}

async function upload(page: Page, buffer: Buffer, name = "documento.pdf") {
  await page.locator('input[type="file"]').setInputFiles({
    name, mimeType: "application/pdf", buffer,
  });
  await expect(page.getByRole("region", { name: "Páginas do documento" })).toBeVisible({ timeout: 60_000 });
}

test("crop saves the visible adjustment without a separate Apply click", async ({ page }) => {
  const input = await inputPdf();
  const source = await PDFDocument.load(input);
  const box = source.getPage(0).getCropBox();
  await page.goto("/pdf/recortar");
  await upload(page, input);
  await page.getByRole("spinbutton", { name: "Superior %", exact: true }).fill("10");
  await page.getByRole("spinbutton", { name: "Direita %", exact: true }).fill("10");
  await page.getByRole("spinbutton", { name: "Inferior %", exact: true }).fill("10");
  await page.getByRole("spinbutton", { name: "Esquerda %", exact: true }).fill("10");
  const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "Salvar PDF recortado", exact: true }).click();
  const download = await downloadPromise;
  const output = await PDFDocument.load(await readFile((await download.path())!));
  expect(output.getPageCount()).toBe(source.getPageCount());
  const cropped = output.getPage(0).getCropBox();
  expect(cropped.width).toBeCloseTo(box.width * 0.8, 3);
  expect(cropped.height).toBeCloseTo(box.height * 0.8, 3);
  expect(cropped.x).toBeCloseTo(box.x + box.width * 0.1, 3);
  expect(cropped.y).toBeCloseTo(box.y + box.height * 0.1, 3);
});

test("long PDF names process and a completed workspace can be cleared and reused", async ({ page }) => {
  await page.goto("/pdf/recortar");
  await upload(page, await inputPdf(), `${"Relatorio 100% %20 ".repeat(15)}.pdf`);
  await page.getByRole("spinbutton", { name: "Direita %", exact: true }).fill("15");
  const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "Salvar PDF recortado", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename().length).toBeLessThanOrEqual(180);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  expect(download.suggestedFilename()).toContain("100% %20");
  await page.getByRole("button", { name: "Limpar trabalho", exact: true }).click();
  await expect(page.getByText("Adicione o PDF que será recortado", { exact: true })).toBeVisible();
  await expect(page.getByText("PDF pronto", { exact: true })).toHaveCount(0);
  await upload(page, await inputPdf(), "novo.pdf");
  await expect(page.getByRole("button", { name: "Salvar PDF recortado", exact: true })).toBeEnabled();
  await expect(page.getByRole("spinbutton", { name: "Direita %", exact: true })).toHaveValue("0");
});

test("crop explains a missing adjustment instead of returning the original", async ({ page }) => {
  await page.goto("/pdf/recortar");
  await upload(page, await inputPdf());
  let queueCalls = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/queue")) queueCalls += 1;
  });
  await page.getByRole("button", { name: "Salvar PDF recortado", exact: true }).click();
  await expect(page.locator(".pdf-workspace").getByRole("alert")).toContainText("Ajuste a área de recorte antes de salvar o PDF.");
  expect(queueCalls).toBe(0);
  await page.getByRole("button", { name: "Limpar trabalho", exact: true }).click();
  await expect(page.locator(".pdf-workspace").getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Adicione o PDF que será recortado", { exact: true })).toBeVisible();
});
