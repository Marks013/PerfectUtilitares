import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Paragraph } from "docx";
import writeXlsxFile, {
  type Sheet,
  type SheetData,
} from "write-excel-file/node";
import {
  readPdfStorageFile,
  resolvePdfStorageKey,
} from "@/lib/pdf/storage";
import { ensureServerLocalStorage } from "@/lib/pdf/server-runtime";

type PositionedText = {
  text: string;
  width: number;
  x: number;
  y: number;
};

type ExtractedPage = {
  lines: Array<{
    cells: string[];
    text: string;
  }>;
};

export class PdfOfficeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    details?: string,
  ) {
    super(message, {
      cause: details ? new Error(details.slice(0, 8_000)) : undefined,
    });
    this.name = "PdfOfficeError";
  }
}

function groupTextItems(items: PositionedText[]) {
  const sorted = [...items].sort((left, right) => {
    const verticalDistance = right.y - left.y;
    return Math.abs(verticalDistance) > 2 ? verticalDistance : left.x - right.x;
  });
  const lines: PositionedText[][] = [];

  for (const item of sorted) {
    const line = lines.find(
      (candidate) => Math.abs((candidate[0]?.y ?? item.y) - item.y) <= 2,
    );
    if (line) {
      line.push(item);
    } else {
      lines.push([item]);
    }
  }

  return lines.map((line) => {
    line.sort((left, right) => left.x - right.x);
    const cells: string[] = [];
    let current = "";
    let previousEnd = 0;

    for (const item of line) {
      const gap = item.x - previousEnd;
      if (current && gap > Math.max(18, item.width * 0.8)) {
        cells.push(current.trim());
        current = item.text;
      } else {
        current += `${current && gap > 2 ? " " : ""}${item.text}`;
      }
      previousEnd = item.x + item.width;
    }
    if (current.trim()) cells.push(current.trim());

    return {
      cells: cells.length ? cells : [""],
      text: cells.join("    "),
    };
  });
}

async function extractPdfTextPages(storageKey: string) {
  ensureServerLocalStorage();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await readPdfStorageFile(storageKey)),
    useSystemFonts: true,
  }).promise;
  const pages: ExtractedPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.flatMap((item): PositionedText[] => {
        if (!("str" in item) || !item.str.trim()) return [];
        return [
          {
            text: item.str,
            width: item.width,
            x: item.transform[4],
            y: item.transform[5],
          },
        ];
      });
      pages.push({ lines: groupTextItems(items) });
      page.cleanup();
    }
  } finally {
    await document.cleanup();
  }

  return pages;
}

export async function convertPdfToDocx(storageKey: string) {
  ensureServerLocalStorage();
  const { Document, Packer, PageBreak, Paragraph, TextRun } =
    await import("docx");
  const pages = await extractPdfTextPages(storageKey);
  const children: Paragraph[] = [];

  pages.forEach((page, pageIndex) => {
    if (page.lines.length) {
      for (const line of page.lines) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: line.text })],
            spacing: { after: 80 },
          }),
        );
      }
    } else {
      children.push(new Paragraph({ children: [new TextRun("")] }));
    }
    if (pageIndex < pages.length - 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  });

  const document = new Document({
    creator: "PerfectUtilitares",
    description: "Documento convertido de PDF",
    sections: [{ children }],
    title: "Documento convertido",
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

export async function convertPdfToXlsx(storageKey: string) {
  const pages = await extractPdfTextPages(storageKey);
  const sheets: Sheet<Buffer>[] = pages.map((page, index) => {
    const data: SheetData = page.lines.length
      ? page.lines.map((line) => line.cells)
      : [[""]];
    const widestRow = data.reduce(
      (maximum, row) => Math.max(maximum, row.length),
      1,
    );
    return {
      columns: Array.from({ length: widestRow }, () => ({ width: 24 })),
      data,
      sheet: `Página ${index + 1}`,
    };
  });
  const workbook = writeXlsxFile(sheets.length ? sheets : [{
    data: [[""]],
    sheet: "Página 1",
  }]);
  return new Uint8Array(await workbook.toBuffer());
}

function runLibreOffice(args: string[], profileDirectory: string) {
  return new Promise<void>((resolve, reject) => {
    const binary = process.env.LIBREOFFICE_BIN || "soffice";
    const child = spawn(binary, args, {
      env: {
        ...process.env,
        HOME: profileDirectory,
        TMPDIR: profileDirectory,
      },
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorOutput = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, 180_000);

    child.stderr.on("data", (chunk: Buffer) => {
      if (errorOutput.length < 8_000) errorOutput += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new PdfOfficeError(
            signal ? "OFFICE_CONVERSION_TIMEOUT" : "OFFICE_CONVERSION_FAILED",
            signal
              ? "A conversão excedeu o tempo permitido."
              : "O documento não pôde ser convertido para PDF.",
            errorOutput.trim(),
          ),
        );
      }
    });
  });
}

export async function convertOfficeToPdf({
  jobId,
  storageKey,
}: {
  jobId: string;
  storageKey: string;
}) {
  const workKey = `${jobId}/work/${randomUUID()}`;
  const workDirectory = resolvePdfStorageKey(workKey);
  const profileDirectory = path.join(workDirectory, "profile");
  const outputDirectory = path.join(workDirectory, "output");
  await mkdir(profileDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });

  try {
    await runLibreOffice(
      [
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--nofirststartwizard",
        `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
        "--convert-to",
        "pdf",
        "--outdir",
        outputDirectory,
        resolvePdfStorageKey(storageKey),
      ],
      profileDirectory,
    );
    const outputName = (await readdir(outputDirectory)).find((fileName) =>
      fileName.toLowerCase().endsWith(".pdf"),
    );
    if (!outputName) {
      throw new PdfOfficeError(
        "OFFICE_OUTPUT_MISSING",
        "A conversão não gerou um arquivo PDF.",
      );
    }
    return new Uint8Array(
      await readFile(path.join(outputDirectory, outputName)),
    );
  } finally {
    await rm(workDirectory, { force: true, recursive: true }).catch(
      () => undefined,
    );
  }
}
