import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { loginAsAdmin } from "./admin-session";

test.beforeEach(async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Office export checks use an isolated database");
  test.skip(!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD, "Admin credentials are required");
  test.setTimeout(120_000);
  await loginAsAdmin(page);
});

async function pdfFile(name: string) {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 500]).drawText("Documento descartavel para selecionar");
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) };
}

for (const format of ["Word", "Excel"] as const) {
  test(`PDF para ${format}: seleção, limite de lote e limpar trabalho`, async ({ page }) => {
    await page.goto("/pdf");
    await page.getByRole("link", { name: `PDF para ${format}`, exact: false }).click();
    await expect(page.getByRole("heading", { name: `PDF para ${format}`, exact: true })).toBeVisible();
    await expect(page.getByText(/Até 100 páginas por PDF/)).toBeVisible();
    const input = page.locator('input[type="file"]');
    const convert = page.getByRole("button", { name: `Converter para ${format}`, exact: true });
    await expect(convert).toBeDisabled();
    await input.setInputFiles(await pdfFile("primeiro.pdf"));
    await expect(page.getByText("primeiro.pdf", { exact: true })).toBeVisible();
    await expect(convert).toBeEnabled();
    await input.setInputFiles(await Promise.all(Array.from({ length: 5 }, (_, index) => pdfFile(`extra-${index}.pdf`))));
    await expect(page.locator(".pdf-workspace").getByRole("alert")).toHaveText("Selecione no máximo 5 arquivos por conversão.");
    await expect(page.locator(".pdf-convert-files article")).toHaveCount(1);
    await page.getByRole("button", { name: "Limpar trabalho", exact: true }).click();
    await expect(page.getByText("primeiro.pdf", { exact: true })).toHaveCount(0);
    await expect(convert).toBeDisabled();
    expect(await input.inputValue()).toBe("");
    await input.setInputFiles(await pdfFile("segundo.pdf"));
    await expect(page.getByText("segundo.pdf", { exact: true })).toBeVisible();
    await expect(convert).toBeEnabled();
  });
}

test("PDF para JPG: salva resolução e qualidade e restaura o padrão ao limpar", async ({ page }) => {
  await page.goto("/pdf/para-jpg");
  const resolution = page.getByRole("combobox", { name: "Resolução JPG", exact: true });
  const quality = page.getByRole("slider", { name: /Qualidade JPG/ });
  await expect(resolution).toHaveValue("200");
  await expect(quality).toHaveValue("90");
  await resolution.selectOption("300");
  await quality.fill("95");
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH"
    && /\/api\/pdf\/jobs\/[^/]+$/.test(new URL(response.url()).pathname));
  await page.locator('input[type="file"]').setInputFiles(await pdfFile("imagem.pdf"));
  const response = await saved;
  expect(response.status()).toBe(200);
  const stored = await page.request.get(response.url());
  expect(stored.status()).toBe(200);
  const payload = await stored.json();
  expect(payload.job.options.jpg).toEqual({ dpi: 300, quality: 95 });
  await page.getByRole("button", { name: "Limpar trabalho", exact: true }).click();
  await expect(resolution).toHaveValue("200");
  await expect(quality).toHaveValue("90");
});
