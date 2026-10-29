import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { parse } from "csv-parse/sync";
import { pdfJsServerDocumentOptions } from "../src/lib/pdf/pdfjs-server";
import { strFromU8, unzipSync } from "fflate";
import type { EscalaAssignment, EscalaInput, EscalaWorkspace } from "../src/lib/escalas/types";
import { loginAsAdmin } from "./admin-session";
import { newInput } from "../src/components/escalas/workspace-model";

test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
let disposableId: string | undefined;
test.afterEach(async ({ page }) => {
  if (process.env.E2E_MUTATION !== "1" || !disposableId) return;
  const id = disposableId;
  disposableId = undefined;
  const response = await page.request.get("/api/escalas?id=" + id);
  if (response.status() === 404) return;
  expect(response.status()).toBe(200);
  const saved: EscalaWorkspace = await response.json();
  const origin = new URL(page.url()).origin;
  expect((await page.request.delete("/api/escalas", { headers: { origin }, data: { workspaceId: saved.id, expectedRevision: saved.revision } })).status()).toBe(200);
});

test("real FPRE136 and optional FPHI105 preserve independently checked vacation dates through generation, persistence and reports", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1" || !process.env.E2E_REAL_CSV_PATH || !process.env.E2E_REAL_ABSENCES_PATH, "Requires private runtime CSV files and the disposable isolated database");
  test.setTimeout(180_000);
  const teamFile = await readFile(process.env.E2E_REAL_CSV_PATH!);
  const absenceFile = await readFile(process.env.E2E_REAL_ABSENCES_PATH!);
  await loginAsAdmin(page);
  await page.goto("/escalas");
  await page.getByText("Novo planejamento", { exact: true }).click();
  await page.getByLabel("Código da filial", { exact: true }).fill("02");
  await page.getByLabel("Nome da filial (opcional)", { exact: true }).fill("Validação privada de férias");
  await page.getByLabel("Mês de referência", { exact: true }).fill("2026-11");
  const creating = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "CREATE");
  await page.getByRole("button", { name: "Iniciar planejamento", exact: true }).click();
  const created: EscalaWorkspace = await (await creating).json();
  disposableId = created.id;
  await page.getByLabel("Arquivo CSV ou XLSX", { exact: true }).setInputFiles({ name: "FPRE136.CSV", mimeType: "text/csv", buffer: teamFile });
  const importing = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas/import"));
  await page.getByRole("button", { name: "Conferir arquivo", exact: true }).click();
  const importedResponse = await importing;
  expect(importedResponse.status()).toBe(200);
  const employees: EscalaInput["employees"] = (await importedResponse.json()).preview.employees;
  await page.getByRole("button", { name: "Aplicar registros aceitos à proposta", exact: true }).click();
  await page.getByLabel("Jornada semanal", { exact: true }).selectOption("42");

  // Independent date oracle: reads only the actual FPHI positions, never the product parser.
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(absenceFile); }
  catch { text = new TextDecoder("windows-1252").decode(absenceFile); }
  const rows = parse(text, { relax_column_count: true, skip_empty_lines: true }) as string[][];
  const identities = new Map(employees.map(person => [person.registration.trim().replace(/^0+(?=\d)/, ""), person.id]));
  const expected = new Set<string>();
  const iso = (value: string) => value.trim().split("/").reverse().join("-");
  for (const row of rows) {
    if (row.length !== 13 || !/^\d+$/.test(row[0].trim()) || !/^\d+$/.test(row[2].trim())) continue;
    const id = identities.get(row[2].trim().replace(/^0+(?=\d)/, ""));
    if (!id) continue;
    const first = Math.max(Date.parse(iso(row[6])), Date.parse(created.input.startDate));
    const last = Math.min(Date.parse(iso(row[11])), Date.parse(created.input.endDate));
    for (let day = first; day <= last; day += 86_400_000) expected.add(id + ":" + new Date(day).toISOString().slice(0, 10));
  }
  expect(expected.size > 0).toBe(true);
  await page.getByText("Importar afastamentos e férias (opcional)", { exact: true }).click();
  await page.getByLabel("Arquivo de afastamentos CSV", { exact: true }).setInputFiles({ name: "FPHI105.CSV", mimeType: "text/csv", buffer: absenceFile });
  const previewing = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas/import"));
  await page.getByRole("button", { name: "Conferir afastamentos", exact: true }).click();
  const previewResponse = await previewing;
  expect(previewResponse.status()).toBe(200);
  const preview = (await previewResponse.json()).preview;
  const actual = new Set(preview.assignments.map((item: EscalaAssignment) => item.employeeId + ":" + item.date));
  expect(actual.size === expected.size && [...expected].every(key => actual.has(key))).toBe(true);
  // No medical field, source name or free-form source description may leak in preview.
  expect(preview.assignments.every((item: EscalaAssignment) => item.kind === "ABSENCE" && Object.keys(item).every(key => ["employeeId", "date", "kind"].includes(key)))).toBe(true);
  await page.getByRole("button", { name: "Aplicar afastamentos à proposta", exact: true }).click();
  const generating = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "GENERATE");
  await page.getByRole("button", { name: /^(Gerar proposta mensal|Gerar nova proposta)$/ }).click();
  const generatedResponse = await generating;
  expect(generatedResponse.status()).toBe(200);
  const generated = await generatedResponse.json();
  expect(["FEASIBLE", "OPTIMAL"]).toContain(generated.result.status);
  expect(generated.validation.valid).toBe(true);
  const proposal: EscalaInput = generated.proposalInput;
  const absent = new Set(proposal.assignments.filter(item => item.kind === "ABSENCE").map(item => item.employeeId + ":" + item.date));
  expect([...expected].every(key => absent.has(key))).toBe(true);
  expect(proposal.employees.length === employees.length && proposal.employees.every(person => person.planningEnabled !== false)).toBe(true);
  await page.getByRole("button", { name: "Aplicar proposta à grade", exact: true }).click();
  const saving = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "SAVE");
  await page.getByRole("button", { name: "Salvar revisão", exact: true }).click();
  expect((await saving).status()).toBe(200);
  const saved: EscalaWorkspace = await page.request.get("/api/escalas?id=" + created.id).then(response => response.json());
  const persisted = new Set(saved.input.assignments.filter(item => item.kind === "ABSENCE").map(item => item.employeeId + ":" + item.date));
  expect([...expected].every(key => persisted.has(key))).toBe(true);
  for (const format of ["PDF", "XLSX"] as const) {
    const downloading = page.waitForEvent("download");
    await page.getByRole("link", { name: "Baixar " + format, exact: true }).click();
    const download = await downloading;
    expect(await download.failure()).toBeNull();
    const stream = await download.createReadStream();
    if (!stream) throw new Error("No downloaded file stream");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    expect(bytes.length > 1000).toBe(true);
    if (format === "XLSX") {
      const zip = unzipSync(bytes);
      const sheet = strFromU8(zip["xl/worksheets/sheet1.xml"]);
      const visibleAbsences = [...expected].filter(key => key.slice(-10, -3) === "2026-11").length;
      expect((sheet.match(/>A</g)?.length ?? 0) >= visibleAbsences).toBe(true);
    } else {
      expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loading = getDocument(pdfJsServerDocumentOptions(new Uint8Array(bytes)));
      const document = await loading.promise;
      try {
        const texts: string[] = [];
        let insidePage = true;
        for (let index = 1; index <= document.numPages; index++) {
          const pdfPage = await document.getPage(index);
          const content = await pdfPage.getTextContent();
          const viewport = pdfPage.getViewport({ scale: 1 });
          for (const item of content.items) if ("str" in item) {
            texts.push(item.str);
            insidePage &&= item.transform[4] >= 25 && item.transform[4] + item.width <= viewport.width - 25 && item.transform[5] >= 16;
          }
        }
        const text = texts.join(" ");
        expect(proposal.employees.every(person => text.includes(person.registration))).toBe(true);
        expect(text.includes("2026") && text.includes("08:24") && insidePage).toBe(true);
      } finally { await loading.destroy(); }
    }
    await download.delete();
  }
  const origin = new URL(page.url()).origin;
  const deleted = await page.request.delete("/api/escalas", { headers: { origin }, data: { workspaceId: saved.id, expectedRevision: saved.revision } });
  expect(deleted.status()).toBe(200);
});


test("optional absence preview preserves existing absences and locked work before real generation and saving", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires disposable isolated database");
  test.setTimeout(150_000);
  await loginAsAdmin(page);
  const origin = new URL(page.url()).origin;
  const input = newInput("E2E-ABS-" + Date.now().toString(36), "Afastamentos sintéticos", "2026-11", 40);
  input.employees = ["a", "b"].map((id, index) => ({ id, registration: "000" + (index + 1), name: index ? "Bruno Sintético" : "Ana Sintética", sector: "Loja", role: "Repositor", weeklyHours: 40, weeklyHoursMode: "BRANCH", shiftIds: [input.shifts[0].id], activeFrom: "", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 2, preferredOffDays: [], historyKnown: false, history: [] }));
  input.assignments = [
    { employeeId: "a", date: "2026-11-04", kind: "WORK", shiftId: input.shifts[0].id, locked: true },
    { employeeId: "b", date: "2026-11-10", kind: "ABSENCE", locked: true },
  ];
  const createdResponse = await page.request.post("/api/escalas", { headers: { origin }, data: { action: "CREATE", input } });
  expect(createdResponse.status()).toBe(201);
  const created: EscalaWorkspace = await createdResponse.json();
  disposableId = created.id;
  await page.goto("/escalas");
  await page.getByLabel("Selecionar filial e período", { exact: true }).selectOption(created.id);
  await page.getByRole("button", { name: "Equipe", exact: true }).click();
  await page.getByText("Importar afastamentos e férias (opcional)", { exact: true }).click();
  const csvRows = [
    ["Período", "01/11/2026", "a", "30/11/2026"],
    ["Empresa", "Tipo", "Cadastro", "Nome", "Função", "Admissão", "Afastamento", "CID", "Situação", "Término", "Dias"],
    ["0001", "1", "0001", "Nome não utilizado", "Função não utilizada", "01/01/2020", "03/11/2026", "MEDICAL-DO-NOT-KEEP", "PRIVATE", "2", "Férias", "06/11/2026", "4"],
    ["0001", "1", "0002", "Nome não utilizado", "Função não utilizada", "01/01/2020", "09/11/2026", "", "", "2", "Férias", "11/11/2026", "3"],
  ];
  const csv = csvRows.map(row => row.map(value => '"' + value.replaceAll('"', '""') + '"').join(",")).join("\r\n");
  await page.getByLabel("Arquivo de afastamentos CSV", { exact: true }).setInputFiles({ name: "FPHI105-sintetico.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  const previewing = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas/import"));
  await page.getByRole("button", { name: "Conferir afastamentos", exact: true }).click();
  const previewResponse = await previewing;
  expect(previewResponse.status()).toBe(200);
  const body = await previewResponse.json();
  expect(body.preview.assignments).toHaveLength(7);
  expect(JSON.stringify(body)).not.toContain("MEDICAL-DO-NOT-KEEP");
  await expect(page.getByText("1 dias bloqueados serão preservados.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Aplicar afastamentos à proposta", exact: true }).click();
  await expect(page.getByText("5 dias de afastamento aplicados à proposta.", { exact: false })).toBeVisible();
  const savingAbsences = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "SAVE");
  await page.getByRole("button", { name: "Salvar revisão", exact: true }).click();
  const staleResponse = await savingAbsences;
  expect(staleResponse.status()).toBe(200);
  const stale: EscalaWorkspace = await staleResponse.json();
  expect(stale.input.needsRegeneration).toBe(true);
  expect((await page.request.get("/api/escalas/export?id=" + stale.id + "&revision=" + stale.revision + "&format=xlsx")).status()).toBe(409);
  await page.reload();
  await page.getByLabel("Selecionar filial e período", { exact: true }).selectOption(created.id);
  await expect(page.getByRole("button", { name: "Baixar PDF", exact: true })).toBeDisabled();
  const generating = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "GENERATE");
  await page.getByRole("button", { name: "Gerar nova proposta", exact: true }).click();
  const generatedResponse = await generating;
  expect(generatedResponse.status()).toBe(200);
  const generated = await generatedResponse.json();
  expect(["FEASIBLE", "OPTIMAL"]).toContain(generated.result.status);
  expect(generated.validation.valid).toBe(true);
  const expected = ["a:2026-11-03", "a:2026-11-05", "a:2026-11-06", "b:2026-11-09", "b:2026-11-10", "b:2026-11-11"];
  const proposal: EscalaInput = generated.proposalInput;
  const absent = new Set(proposal.assignments.filter(item => item.kind === "ABSENCE").map(item => item.employeeId + ":" + item.date));
  expect(expected.every(key => absent.has(key))).toBe(true);
  expect(proposal.assignments).toContainEqual(expect.objectContaining(input.assignments[0]));
  expect(proposal.assignments).toContainEqual(expect.objectContaining(input.assignments[1]));
  await page.getByRole("button", { name: "Aplicar proposta à grade", exact: true }).click();
  const saving = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "SAVE");
  await page.getByRole("button", { name: "Salvar revisão", exact: true }).click();
  expect((await saving).status()).toBe(200);
  const saved: EscalaWorkspace = await page.request.get("/api/escalas?id=" + created.id).then(response => response.json());
  expect(saved.input.assignments).toEqual(proposal.assignments);
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Baixar XLSX", exact: true }).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  await download.delete();
  expect((await page.request.delete("/api/escalas", { headers: { origin }, data: { workspaceId: saved.id, expectedRevision: saved.revision } })).status()).toBe(200);
});
