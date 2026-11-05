import { expect, test } from "./fixtures";
import { PDFDocument, StandardFonts, setTextRenderingMode, TextRenderingMode } from "pdf-lib";
import sharp from "sharp";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

test("compression prevents duplicate starts and preserves a real processed document", async ({ page, baseURL }) => {
  test.skip(process.env.E2E_PDF_SYNTHETIC !== "1" && process.env.E2E_MUTATION !== "1", "Requires explicit synthetic-PDF permission");
  test.setTimeout(90_000);
  const marker = "PERFECT PDF SAFETY REGRESSION";
  const rows = Array.from({ length: 70 }, (_, index) =>
    `<text x="95" y="${110 + index * 42}" font-size="28" fill="#23344b">Controle de compactacao - linha ${index}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2500" height="3500"><defs><pattern id="p" width="23" height="19" patternUnits="userSpaceOnUse"><circle cx="4" cy="7" r="1.4" fill="#cbd1e1"/></pattern></defs><rect width="2500" height="3500" fill="#fffef8"/><rect width="2500" height="3500" fill="url(#p)"/>${rows}</svg>`;
  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 99, chromaSubsampling: "4:4:4" }).toBuffer();
  const source = await PDFDocument.create();
  const sourcePage = source.addPage([600, 840]);
  sourcePage.drawImage(await source.embedJpg(jpeg), { x: 0, y: 0, width: 600, height: 840 });
  sourcePage.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
  sourcePage.drawText(marker, { x: 10, y: 14, size: 9, font: await source.embedFont(StandardFonts.Helvetica) });
  const input = Buffer.from(await source.save());

  let releaseCreate!: () => void;
  const gate = new Promise<void>((resolve) => { releaseCreate = resolve; });
  let createRequests = 0;
  let jobId: string | undefined;
  const origin = new URL(baseURL as string).origin;
  await page.route("**/api/pdf/jobs", async (route) => {
    if (route.request().method() === "POST") {
      createRequests += 1;
      await gate;
    }
    await route.continue();
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pdf/comprimir");
    await page.locator('input[type="file"]').setInputFiles({ name: "auditoria-sintetica.pdf", mimeType: "application/pdf", buffer: input });
    const submit = page.locator(".pdf-compress-files .pdf-primary-button");
    await expect(submit).toBeEnabled({ timeout: 30_000 });
    await page.getByText("Equilibrado", { exact: true }).click();
    await page.locator(".pdf-compression-advanced > summary").click();
    await page.getByText("Tons de cinza", { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    const created = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/pdf/jobs" && response.request().method() === "POST");
    await submit.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => createRequests).toBe(1);
    await expect(submit).toBeDisabled();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    releaseCreate();
    const creation = await created;
    expect(creation.status()).toBe(201);
    jobId = (await creation.json()).job.id;
    const started = Date.now();
    await expect(page.locator(".pdf-output-panel")).toBeVisible({ timeout: 60_000 });
    const result = await page.request.get(`/api/pdf/jobs/${jobId}`);
    expect(result.ok()).toBe(true);
    const job = (await result.json()).job;
    expect(job.status).toBe("SUCCEEDED");
    const output = job.artifacts.find((artifact: { kind: string }) => artifact.kind === "OUTPUT");
    expect(output.metadata.compression).toMatchObject({
      outcome: "COMPRESSED", applied: { colorMode: "GRAYSCALE" }, preservation: { semanticValidated: true },
    });
    expect(output.metadata.compression.applied.dpi).toBeLessThanOrEqual(150);
    const downloaded = await page.request.get(`/api/pdf/jobs/${jobId}/outputs/${output.id}`);
    expect(downloaded.ok()).toBe(true);
    const bytes = await downloaded.body();
    expect(bytes.length).toBeLessThan(input.length * 0.97);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const task = getDocument({ data: Uint8Array.from(bytes), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
    try {
      const pdf = await task.promise;
      const text = (await (await pdf.getPage(1)).getTextContent()).items.map((item) => "str" in item ? item.str : "").join(" ");
      expect(text).toContain(marker);
    } finally {
      await task.destroy();
    }
    for (const width of [1_280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await expect(page.locator(".pdf-output-panel")).toBeVisible();
    }
    console.log(JSON.stringify({ pdfSynthetic: true, inputBytes: input.length, outputBytes: bytes.length, elapsedMs: Date.now() - started, createRequests }));
  } finally {
    releaseCreate();
    if (jobId) {
      const cleanup = await page.request.delete(`/api/pdf/jobs/${jobId}`, { headers: { Origin: origin } });
      expect(cleanup.status()).toBe(204);
    }
  }
});
