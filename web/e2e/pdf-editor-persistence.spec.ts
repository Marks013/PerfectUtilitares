import { expect, test, type Page } from "@playwright/test";
import { degrees, PDFDocument } from "pdf-lib";
import { loginAsAdmin } from "./admin-session";

test.beforeEach(async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Uses an isolated database");
  test.skip(!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD, "Admin credentials required");
  test.setTimeout(120_000);
  await loginAsAdmin(page);
});

async function openEditor(page: Page) {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 600]).setRotation(degrees(90));
  await page.goto("/pdf/editar");
  await page.locator('input[type="file"]').setInputFiles({
    name: "editor-descartavel.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.locator(".pdf-editor-canvas canvas")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".pdf-save-state")).toHaveText("Alterações salvas", { timeout: 30_000 });
  return page.locator(".pdf-editor-canvas__overlay");
}

for (const failure of ["network", "401"] as const) {
  test(`editor: ${failure} permits retry and locks the final snapshot`, async ({ page }) => {
    const overlay = await openEditor(page);
    let failed = false;
    let releaseSave: (() => void) | undefined;
    let finalizing = false;
    let queued = false;
    let finalAnnotations = 0;
    await page.route(/\/api\/pdf\/jobs\/[^/]+$/, async (route) => {
      if (route.request().method() !== "PATCH") {
        if (queued) return route.fulfill({ json: { job: {
          id: "test", status: "SUCCEEDED", progress: 100,
          artifacts: [{ id: "result", kind: "OUTPUT" }],
        } } });
        return route.continue();
      }
      if (!failed) {
        failed = true;
        if (failure === "network") return route.abort("failed");
        return route.fulfill({ status: 401, json: { error: { message: "Sessão expirada" } } });
      }
      if (finalizing) {
        finalAnnotations = route.request().postDataJSON().annotations.length;
        await new Promise<void>((resolve) => { releaseSave = resolve; });
      }
      await route.continue();
    });
    await page.route(/\/api\/pdf\/jobs\/[^/]+\/queue$/, async (route) => {
      queued = true;
      await route.fulfill({ json: { job: { id: "test", status: "RUNNING", progress: 1 } } });
    });
    await page.route(/\/api\/pdf\/jobs\/[^/]+\/outputs\/result$/, (route) =>
      route.fulfill({ contentType: "application/pdf", body: Buffer.from("%PDF-1.7\n") }));
    await overlay.click({ position: { x: 50, y: 50 } });
    await expect(page.locator(".pdf-save-state")).toHaveText("Falha ao salvar");
    await expect(page.getByText("Alterações não salvas. Use Salvar PDF para tentar novamente.")).toBeVisible();
    finalizing = true;
    await page.getByRole("button", { name: "Salvar PDF", exact: true }).click();
    await expect.poll(() => Boolean(releaseSave)).toBe(true);
    await expect(page.getByRole("button", { name: "Salvar PDF", exact: true })).toBeDisabled();
    await overlay.click({ position: { x: 90, y: 90 } });
    await expect(page.locator(".pdf-editor-annotation--text")).toHaveCount(1);
    expect(queued).toBe(false);
    expect(finalAnnotations).toBe(1);
    releaseSave?.();
    await expect(page.getByText("PDF pronto para download")).toBeVisible();
    await overlay.click({ position: { x: 100, y: 100 } });
    await expect(page.locator(".pdf-editor-annotation--text")).toHaveCount(1);
  });
}

test("editor: autosave ordering and rotated responsive font dimensions", async ({ page }) => {
  const overlay = await openEditor(page);
  const snapshots: number[] = [];
  let releaseFirst: (() => void) | undefined;
  await page.route(/\/api\/pdf\/jobs\/[^/]+$/, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    snapshots.push(route.request().postDataJSON().annotations.length);
    if (snapshots.length === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
    await route.continue();
  });
  await overlay.click({ position: { x: 50, y: 50 } });
  await expect.poll(() => snapshots.length).toBe(1);
  await overlay.click({ position: { x: 90, y: 90 } });
  await page.waitForTimeout(900);
  expect(snapshots).toEqual([1]);
  releaseFirst?.();
  await expect.poll(() => snapshots).toEqual([1, 2]);
  await expect(page.locator(".pdf-save-state")).toHaveText("Alterações salvas");
  for (const width of [1280, 700]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => page.locator(".pdf-editor-annotation--text").first().evaluate((element) => {
      const canvas = element.closest(".pdf-editor-canvas")!;
      const expected = 18 * canvas.getBoundingClientRect().width / 600;
      return Math.abs(Number.parseFloat(getComputedStyle(element).fontSize) - expected);
    })).toBeLessThan(0.1);
  }
  await expect(page.locator(".pdf-editor-annotation--text").first()).toHaveCSS("font-family", /PerfectPdfAnnotation/);
});
