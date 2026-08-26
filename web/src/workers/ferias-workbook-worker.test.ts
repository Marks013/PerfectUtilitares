import type { Worker, WorkerOptions } from "node:worker_threads";
import { build } from "esbuild";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ code: "", spin: false, workers: [] as Worker[] }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("node:worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:worker_threads")>();
  return {
    ...actual,
    Worker: class extends actual.Worker {
      constructor(_filename: string, options: WorkerOptions) {
        super(state.spin ? "while (true) {}" : state.code, { ...options, eval: true });
        state.workers.push(this);
      }
    },
  };
});

import { runFeriasWorkbook } from "@/lib/ferias/processing";

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const cell = (ref: string, value: string) => `<c r="${ref}" s="0" t="inlineStr"><is><t>${value}</t></is></c>`;

function fixture() {
  const parts = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="${REL}"><Relationship Id="r1" Type="${OFFICE}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${NS}" xmlns:r="${OFFICE}"><sheets><sheet name="Plan1" sheetId="1" r:id="r1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${REL}"><Relationship Id="r1" Type="${OFFICE}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="${OFFICE}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<styleSheet xmlns="${NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${NS}"><dimension ref="A1:H4"/><sheetData><row r="1">${cell("A1", "FÉRIAS - SETEMBRO / 2026")}</row><row r="2">${cell("A2", "Relatório")}</row><row r="3">${["Nº", "FILIAL", "CÓD.", "NOME", "PERÍODO DE GOZO"].map((value, index) => cell(`${String.fromCharCode(65 + index)}3`, value)).join("")}</row><row r="4">${cell("A4", "1")}${cell("B4", "P")}${cell("C4", "1001")}${cell("D4", "Colaborador Exemplo")}${cell("E4", "01/09/2026 à 30/09/2026")}${cell("G4", "stale")}${cell("H4", "stale")}</row></sheetData><mergeCells count="2"><mergeCell ref="A1:E1"/><mergeCell ref="A2:E2"/></mergeCells></worksheet>`,
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, strToU8(value)]))));
}

beforeAll(async () => {
  // Compile in memory: exercise the production bundle without a build/deploy or disk artifact.
  const result = await build({ entryPoints: ["src/workers/ferias-workbook-worker.ts"], bundle: true, platform: "node", format: "cjs", target: "node24", write: false, logLevel: "silent" });
  state.code = result.outputFiles[0].text;
});
afterEach(async () => {
  vi.useRealTimers();
  state.spin = false;
  await Promise.all(state.workers.map((worker) => worker.terminate()));
  state.workers.length = 0;
});

describe("bundled Ferias workbook worker", () => {
  it("parses, writes and reparses a real XLSX through actual worker threads", async () => {
    const buffer = fixture();
    const signal = new AbortController().signal;
    const parsed = await runFeriasWorkbook({ action: "parse", buffer }, signal);
    expect(parsed.competency).toBe("2026-09");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ row: 4, days: 30, highlight: false });
    const rows = parsed.rows.map(({ row, days, highlight }) => ({ row, days, highlight, unimedText: "Mens.: 61,26", loanText: "Consig.R$ 100,00" }));
    const output = await runFeriasWorkbook({ action: "write", buffer, rows }, signal);
    const reparsed = await runFeriasWorkbook({ action: "parse", buffer: output }, signal);
    expect(reparsed).toEqual(parsed);
    const xml = Buffer.from(unzipSync(output)["xl/worksheets/sheet1.xml"]).toString();
    expect(xml).toContain("Mens.: 61,26");
    expect(xml).toContain("Consig.R$ 100,00");
    expect(xml).not.toContain("stale");
    expect(state.workers.every((worker) => worker.threadId === -1)).toBe(true);
  });

  it("returns a readable validation error from the real bundled parser", async () => {
    await expect(runFeriasWorkbook({ action: "parse", buffer: Buffer.from("invalid xlsx") }, new AbortController().signal)).rejects.toMatchObject({ code: "FERIAS_WORKBOOK_INVALID" });
    expect(state.workers[0].threadId).toBe(-1);
  });

  it("kills actual synchronous CPU work when the request is cancelled", async () => {
    state.spin = true;
    const controller = new AbortController();
    const pending = runFeriasWorkbook({ action: "parse", buffer: Buffer.from("fixture") }, controller.signal);
    const expectation = expect(pending).rejects.toMatchObject({ code: "FERIAS_CANCELLED" });
    await new Promise<void>((resolve) => state.workers[0].once("online", resolve));
    controller.abort();
    await expectation;
    expect(state.workers[0].threadId).toBe(-1);
  });

  it("kills actual synchronous CPU work on timeout", async () => {
    state.spin = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = runFeriasWorkbook({ action: "parse", buffer: Buffer.from("fixture") }, new AbortController().signal);
    const expectation = expect(pending).rejects.toMatchObject({ code: "FERIAS_TIMEOUT" });
    await new Promise<void>((resolve) => state.workers[0].once("online", resolve));
    await vi.advanceTimersByTimeAsync(30_000);
    await expectation;
    expect(state.workers[0].threadId).toBe(-1);
  });
});
