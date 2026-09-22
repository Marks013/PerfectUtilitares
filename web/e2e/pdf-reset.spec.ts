import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { loginAsAdmin } from "./admin-session";

const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

test.beforeEach(async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "PDF reset runs only against an isolated database");
  test.skip(!adminEmail || !adminPassword, "Admin credentials are required");
  test.setTimeout(120_000);
  await loginAsAdmin(page);
});

async function pdfFile(name: string) {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 500]).drawText("PDF descartavel para reiniciar o trabalho");
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) };
}

async function reset(page: Page) {
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set("job", "draft-to-forget");
    url.searchParams.set("keep", "1");
    history.replaceState(history.state, "", url);
  });
  await page.getByRole("button", { name: "Limpar trabalho", exact: true }).click();
  await expect(page).not.toHaveURL(/[?&]job=/);
  await expect(page).toHaveURL(/[?&]keep=1/);
  await expect(page.locator('input[type="file"]')).toBeEnabled();
  expect(await page.locator('input[type="file"]').inputValue()).toBe("");
}

for (const tool of ["comprimir", "editar", "anotar"] as const) {
  test(`PDF ${tool}: limpar descarta o documento e permite novo upload`, async ({ page }) => {
    await page.goto(`/pdf/${tool}`);
    await page.locator('input[type="file"]').setInputFiles(await pdfFile("primeiro.pdf"));
    await expect(page.getByText("primeiro.pdf", { exact: true })).toBeVisible({ timeout: 30_000 });
    await reset(page);
    await expect(page.getByText("primeiro.pdf", { exact: true })).toHaveCount(0);
    await page.locator('input[type="file"]').setInputFiles(await pdfFile("segundo.pdf"));
    await expect(page.getByText("segundo.pdf", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("primeiro.pdf", { exact: true })).toHaveCount(0);
  });
}

test("JPG para PDF: limpar revoga previews e permite novas imagens", async ({ page }) => {
  const buffer = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
  await page.goto("/pdf/jpg-para-pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "primeira.png", mimeType: "image/png", buffer });
  await expect(page.locator(".pdf-image-card")).toHaveCount(1);
  const preview = await page.locator(".pdf-image-card img").getAttribute("src");
  await reset(page);
  await expect(page.locator(".pdf-image-card")).toHaveCount(0);
  expect(await page.evaluate(async (url) => {
    try { await fetch(url!); return true; } catch { return false; }
  }, preview)).toBe(false);
  await page.locator('input[type="file"]').setInputFiles({ name: "segunda.png", mimeType: "image/png", buffer });
  await expect(page.getByText("segunda.png", { exact: true })).toBeVisible();
});

for (const [tool, extension, mimeType] of [
  ["word-para-pdf", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["excel-para-pdf", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
] as const) {
  test(`${tool}: limpar remove seleção e permite selecionar outro arquivo`, async ({ page }) => {
    // This tests file selection only; no conversion or server upload is requested.
    await page.goto(`/pdf/${tool}`);
    await page.locator('input[type="file"]').setInputFiles({ name: `primeiro.${extension}`, mimeType, buffer: Buffer.from("selection-only") });
    await expect(page.getByText(`primeiro.${extension}`, { exact: true })).toBeVisible();
    await reset(page);
    await expect(page.getByText(`primeiro.${extension}`, { exact: true })).toHaveCount(0);
    await page.locator('input[type="file"]').setInputFiles({ name: `segundo.${extension}`, mimeType, buffer: Buffer.from("selection-only") });
    await expect(page.getByText(`segundo.${extension}`, { exact: true })).toBeVisible();
  });
}

test("editor: limpar durante a criação impede upload e resposta tardia", async ({ page }) => {
  await page.goto("/pdf/editar");
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let started = false;
  let uploads = 0;
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  page.on("request", (request) => { if (/\/api\/pdf\/jobs\/late-job\/files$/.test(request.url())) uploads += 1; });
  await page.route("**/api/pdf/jobs", async (route) => {
    started = true;
    await held;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ job: { id: "late-job" } }) }).catch(() => undefined);
  });
  await page.locator('input[type="file"]').setInputFiles(await pdfFile("atrasado.pdf"));
  await expect.poll(() => started).toBe(true);
  await reset(page);
  release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(page.getByText("atrasado.pdf", { exact: true })).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles(await pdfFile("novo.pdf"));
  await expect(page.getByText("novo.pdf", { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(uploads).toBe(0);
  expect(downloads).toEqual([]);
});
