import { build } from "esbuild";
import type { WorkerOptions } from "node:worker_threads";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";
const compiled = vi.hoisted(() => ({ worker: "" }));
vi.mock("node:worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:worker_threads")>();
  return { ...actual, Worker: class extends actual.Worker {
    constructor(_filename: string, options: WorkerOptions) { super(compiled.worker, { ...options, eval: true }); }
  } };
});
beforeAll(async () => {
  // Exercise the production worker in a real thread without relying on stale dist files.
  const output = await build({ entryPoints: ["src/workers/unimed-workbook-worker.ts"], bundle: true, platform: "node", format: "cjs", target: "node24", write: false, logLevel: "silent" });
  compiled.worker = output.outputFiles[0].text;
});
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({ $queryRaw: async () => [{ acquired: true }] }) } }));
import { readAddressWorkbook } from "./workbook-processing";
import { parseAddressRows } from "./importer-workbook";

const SHEET = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function workbook() {
  const rows = [
    ["CADASTRO", "NOME", "CPF", "ENDERECO", "N", "BAIRRO", "CEP", "CIDADE", "UF", "PIS"],
    [123, "Colaborador de teste", "", "Rua Exemplo", 10, "Centro", "87000000", "Cidade Exemplo", "PR", ""],
  ];
  const sheetRows = rows.map((row, index) => `<row r="${index + 1}">${row.map((value, column) => {
    const ref = `${String.fromCharCode(65 + column)}${index + 1}`;
    return typeof value === "number" ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  }).join("")}</row>`).join("");
  const parts = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="${REL}"><Relationship Id="r1" Type="${OFFICE}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${SHEET}" xmlns:r="${OFFICE}"><sheets><sheet name="Endereços" sheetId="1" r:id="r1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${REL}"><Relationship Id="r1" Type="${OFFICE}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${SHEET}"><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, strToU8(value)]))));
}
describe("Unimed real XLSX worker", () => {
  it("reads actual zipped XML and preserves typed cells for the existing address parser", async () => {
    const rows = await readAddressWorkbook(workbook(), new AbortController().signal);
    expect(rows[1][0]).toBe(123);
    const parsed = parseAddressRows("enderecos.xlsx", rows);
    expect(parsed.rows).toEqual([expect.objectContaining({ registration: "123", fullName: "Colaborador de teste", number: "10", state: "PR" })]);
    expect(parsed.rejectedCount).toBe(0);
  });
  it("rejects malformed archives without exposing parser or cell internals", async () => {
    await expect(readAddressWorkbook(Buffer.from("private data"), new AbortController().signal)).rejects.toMatchObject({ code: "UNIMED_ADDRESS_FILE_INVALID", status: 400 });
  });
});
