import path from "node:path";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { PDFDocument } from "pdf-lib";
import type * as Preview from "../src/components/unimed/unimed-document-preview";

declare global {
  interface Window {
    unimedPreview: typeof Preview;
  }
}

for (const [kind, expected] of [
  ["RN561", "RN-561 - João da Conceição.pdf"],
  ["INACTIVE_TERM", "Termo de Inativo - João da Conceição.pdf"],
] as const) {
  test(`Unimed ${kind} downloads the PDF with the holder name`, async ({ page }) => {
    const bundled = await build({
      entryPoints: [path.resolve("src/components/unimed/unimed-document-preview.ts")],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "unimedPreview",
    });
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = Array.from(await pdf.save());

    await page.route("**/unimed-download-test", (route) => route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><head><title>Teste</title></head><body></body></html>",
    }));
    await page.goto("/unimed-download-test");
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    const generated = await page.evaluate(({ kind, bytes }) => ({
      fileName: window.unimedPreview.unimedDocumentFileName(kind, "João da Conceição"),
      url: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" })),
    }), { kind, bytes });

    for (let opening = 0; opening < 2; opening += 1) {
      const popupPromise = page.waitForEvent("popup");
      await page.evaluate(({ fileName, bytes }) => {
        const previewWindow = window.open("about:blank", "_blank");
        if (!previewWindow) throw new Error("Preview window blocked");
        previewWindow.opener = null;
        const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
        window.unimedPreview.showUnimedDocumentPreview(previewWindow, blob, fileName);
      }, { ...generated, bytes });
      const popup = await popupPromise;
      await expect(popup).toHaveTitle(expected);
      await expect(popup.locator("iframe")).toHaveAttribute("src", /^blob:.*#toolbar=0$/);
      expect(await popup.locator("iframe").getAttribute("src"))
        .not.toBe(`${generated.url}#toolbar=0`);
      await page.evaluate((url) => URL.revokeObjectURL(url), generated.url);
      if (opening === 1) await page.close();
      const downloadPromise = popup.waitForEvent("download");
      await popup.getByRole("link", { name: `Baixar PDF — ${expected}`, exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(expected);
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
      await popup.close();
    }
  });
}
