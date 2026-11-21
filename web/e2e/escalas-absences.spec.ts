import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { openEscalasArea, revealEscalasControl, selectEscalasWorkspace } from "./escalas-selection";
import { applyReplacement, previewReplacement } from "./escalas-access-fixtures";
import { parse } from "csv-parse/sync";
import { pdfJsServerDocumentOptions } from "../src/lib/pdf/pdfjs-server";
import { strFromU8, unzipSync } from "fflate";
import type { EscalaInput, EscalaWorkspace } from "../src/lib/escalas/types";
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

test("private FPRE136 and FPHI105 preserve independently checked absence dates through replacement, generation and reports", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1" || !process.env.E2E_REAL_CSV_PATH || !process.env.E2E_REAL_ABSENCES_PATH, "Requires private runtime CSV files and the disposable isolated database");
  test.setTimeout(180_000);
  const teamPath = process.env.E2E_REAL_CSV_PATH, absencePath = process.env.E2E_REAL_ABSENCES_PATH;
  if (!teamPath || !absencePath) throw new Error("The private fixture paths must be supplied at runtime");
  const teamFile = await readFile(teamPath);
  const absenceFile = await readFile(absencePath);
  await loginAsAdmin(page);
  await page.goto("/escala");
  await page.getByLabel("Código da filial", { exact: true }).waitFor({ state: "attached" });
  await revealEscalasControl(page.getByLabel("Código da filial", { exact: true }));
  await page.getByLabel("Código da filial", { exact: true }).fill("02");
  await page.getByLabel("Nome da filial (opcional)", { exact: true }).fill("Validação privada de férias");
  await page.getByLabel("Mês de referência", { exact: true }).fill("2026-11");
  const creating = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "CREATE");
  await page.getByRole("button", { name: "Iniciar planejamento", exact: true }).click();
  const created: EscalaWorkspace = await (await creating).json();
  disposableId = created.id;
  const team = await previewReplacement(page, "EMPLOYEES", { name: "FPRE136.CSV", mimeType: "text/csv", buffer: teamFile });
  expect(team.preview.layout).toBe("FPRE136"); expect(team.preview.blockers).toEqual([]); expect(team.preview.canApply).toBe(true);
  const employees = (await applyReplacement(page, team.panel, "EMPLOYEES")).workspace.input.employees;
  await openEscalasArea(page, "generate");
  await page.getByLabel("Jornada semanal", { exact: true }).selectOption("42");

  // Independent date oracle: reads only the actual FPHI positions, never the product parser.
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(absenceFile); }
  catch { text = new TextDecoder("windows-1252").decode(absenceFile); }
  const rows = parse(text, { relax_column_count: true, skip_empty_lines: true }) as string[][];
  const identities = new Map(employees.map(person => [person.registration.trim().replace(/^0+(?=\d)/, ""), person.id]));
  const expected = new Set<string>();
  const iso = (value: string) => value.trim().split("/").reverse().join("-");
  const period = rows.find(row => row[0]?.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase() === "periodo");
  if (!period?.[1] || !period[3]) throw new Error("The private absence report must declare its real coverage period");
  const scope = { startDate: iso(period[1]) > created.input.startDate ? iso(period[1]) : created.input.startDate,
    endDate: iso(period[3]) < created.input.endDate ? iso(period[3]) : created.input.endDate };
  expect(scope.startDate <= scope.endDate).toBe(true);
  for (const row of rows) {
    if (row.length !== 13 || !/^\d+$/.test(row[0].trim()) || !/^\d+$/.test(row[2].trim())) continue;
    const id = identities.get(row[2].trim().replace(/^0+(?=\d)/, ""));
    if (!id) continue;
    const first = Math.max(Date.parse(iso(row[6])), Date.parse(scope.startDate));
    const last = Math.min(Date.parse(iso(row[11])), Date.parse(scope.endDate));
    for (let day = first; day <= last; day += 86_400_000) expected.add(id + ":" + new Date(day).toISOString().slice(0, 10));
  }
  expect(expected.size > 0).toBe(true);
  await expect(page.locator('[data-state="saved"]')).toBeVisible();
  const absence = await previewReplacement(page, "ABSENCES", { name: "FPHI105.CSV", mimeType: "text/csv", buffer: absenceFile }, scope);
  const preview = absence.preview;
  expect(preview.layout).toBe("FPHI105"); expect(preview.canApply).toBe(true); expect(preview.blockers).toEqual([]);
  const actual = new Set([...preview.impact.absences.added, ...preview.impact.absences.unchanged].filter(item => item.date >= scope.startDate && item.date <= scope.endDate).map(item => item.employeeId + ":" + item.date));
  expect(actual.size === expected.size && [...expected].every(key => actual.has(key))).toBe(true);
  // No medical field, source name or free-form source description may leak in preview.
  expect(preview.impact.absences.added.every(item => Object.keys(item).every(key => ["employeeId", "registration", "date"].includes(key)))).toBe(true);
  await applyReplacement(page, absence.panel, "ABSENCES");
  await page.locator('button[aria-controls="escala-area-generate"]').click();
  const generating = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "GENERATE", { timeout: 40_000 });
  await page.getByRole("button", { name: /^(Gerar escala e horários|Gerar nova proposta)$/ }).click();
  const generatedResponse = await generating;
  expect(generatedResponse.status()).toBe(200);
  const generated = await generatedResponse.json();
  expect(["FEASIBLE", "OPTIMAL"]).toContain(generated.result.status);
  expect(generated.validation.valid).toBe(true);
  const proposal: EscalaInput = generated.proposalInput;
  const absent = new Set(proposal.assignments.filter(item => item.kind === "ABSENCE").map(item => item.employeeId + ":" + item.date));
  expect([...expected].every(key => absent.has(key))).toBe(true);
  expect(proposal.employees.length).toBe(employees.length);
  const learnerIds = new Set(employees.filter(person => person.role === "AUX. DE SERVIÇOS EM SUPER").map(person => person.id));
  expect(proposal.employees.filter(person => person.planningEnabled === false).map(person => person.id).sort()).toEqual([...learnerIds].sort());
  expect(proposal.assignments.filter(item => learnerIds.has(item.employeeId)).every(item => item.kind === "ABSENCE" || item.locked)).toBe(true);
  expect(generated.validation.issues.some((issue: { code: string }) => issue.code === "PARTIAL_WEEK_PENDING")).toBe(false);
  const saving = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "APPLY_PROPOSAL");
  await page.getByRole("button", { name: "Aplicar proposta à grade", exact: true }).click();
  await expect(page.locator('[data-state="saved"]')).toBeVisible();
  expect((await saving).status()).toBe(200);
  const saved: EscalaWorkspace = await page.request.get("/api/escalas?id=" + created.id).then(response => response.json());
  const persisted = new Set(saved.input.assignments.filter(item => item.kind === "ABSENCE").map(item => item.employeeId + ":" + item.date));
  expect([...expected].every(key => persisted.has(key))).toBe(true);
  for (const format of ["PDF", "XLSX"] as const) {
    await page.getByRole("button", { name: "Gerar " + format, exact: true }).click();
    await expect(page.getByRole("link", { name: "Baixar " + format, exact: true })).toBeVisible();
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
      expect((sheet.match(/>AF</g)?.length ?? 0) >= visibleAbsences).toBe(true);
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


test("replacement blocks protected collisions, then preserves borders and locked work through real generation and saving", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires disposable isolated database");
  test.setTimeout(150_000);
  await loginAsAdmin(page);
  const origin = new URL(page.url()).origin;
  const input = newInput("E2E-ABS-" + Date.now().toString(36), "Afastamentos sintéticos", "2026-12", 40);
  input.employees = ["a", "b"].map((id, index) => ({ id, registration: "000" + (index + 1), name: index ? "Bruno Sintético" : "Ana Sintética", sector: "Loja", role: "Repositor", weeklyHours: 40, weeklyHoursMode: "BRANCH", shiftIds: [input.shifts[0].id], activeFrom: "", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 2, preferredOffDays: [], historyKnown: false, history: [] }));
  input.assignments = [
    { employeeId: "a", date: "2026-12-04", kind: "WORK", shiftId: input.shifts[0].id, locked: true },
    { employeeId: "b", date: "2026-12-10", kind: "ABSENCE", locked: true },
    { employeeId: "b", date: input.startDate, kind: "ABSENCE", locked: true },
    { employeeId: "b", date: input.endDate, kind: "ABSENCE", locked: true },
  ];
  const createdResponse = await page.request.post("/api/escalas", { headers: { origin }, data: { action: "CREATE", input } });
  const createBody = await createdResponse.json();
  const createCode = typeof createBody?.error?.code === "string" && /^[A-Z_]+$/.test(createBody.error.code) ? createBody.error.code : "UNCLASSIFIED";
  expect(createdResponse.status(), `CREATE public code: ${createCode}`).toBe(201);
  const created: EscalaWorkspace = createBody;
  disposableId = created.id;
  await page.goto("/escala");
  await selectEscalasWorkspace(page, created);
  const csvRows = [
    ["Período", "01/12/2026", "a", "31/12/2026"],
    ["Empresa", "Tipo", "Cadastro", "Nome", "Função", "Admissão", "Afastamento", "CID", "Situação", "Término", "Dias"],
    ["0001", "1", "0001", "Nome não utilizado", "Função não utilizada", "01/01/2020", "03/12/2026", "MEDICAL-DO-NOT-KEEP", "PRIVATE", "2", "Férias", "06/12/2026", "4"],
    ["0001", "1", "0002", "Nome não utilizado", "Função não utilizada", "01/01/2020", "09/12/2026", "", "", "2", "Férias", "11/12/2026", "3"],
  ];
  const csv = csvRows.map(row => row.map(value => '"' + value.replaceAll('"', '""') + '"').join(",")).join("\r\n");
  const scope = { startDate: "2026-12-01", endDate: "2026-12-31" };
  const blocked = await previewReplacement(page, "ABSENCES", { name: "FPHI105-conflito.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }, scope);
  expect(blocked.preview.canApply).toBe(false);
  expect(blocked.preview.blockers.some(problem => problem.code === "PROTECTED_ASSIGNMENT")).toBe(true);
  expect(JSON.stringify(blocked.preview)).not.toContain("MEDICAL-DO-NOT-KEEP");
  await expect(blocked.panel.getByRole("checkbox", { name: /^Confirmo substituir/ })).toBeDisabled();
  expect((await page.request.get("/api/escalas?id=" + created.id).then(response => response.json())).input).toEqual(created.input);
  const safeRows = [...csvRows.slice(0, 2), [...csvRows[2].slice(0, 11), "03/12/2026", "1"], [...csvRows[2].slice(0, 6), "05/12/2026", ...csvRows[2].slice(7)], csvRows[3]];
  const safeCsv = safeRows.map(row => row.map(value => JSON.stringify(value)).join(",")).join("\r\n");
  const reviewed = await previewReplacement(page, "ABSENCES", { name: "FPHI105-sem-colisao.csv", mimeType: "text/csv", buffer: Buffer.from(safeCsv) }, scope);
  expect(reviewed.preview.canApply).toBe(true); expect(reviewed.preview.blockers).toEqual([]);
  expect(reviewed.preview.counts.addedAbsenceDays).toBe(5);
  const stale = (await applyReplacement(page, reviewed.panel, "ABSENCES")).workspace;
  expect(stale.input.assignments).toEqual(expect.arrayContaining(input.assignments));
  expect(stale.input.needsRegeneration).toBe(true);
  expect((await page.request.get("/api/escalas/export?id=" + stale.id + "&revision=" + stale.revision + "&format=xlsx")).status()).toBe(409);
  await page.reload();
  await selectEscalasWorkspace(page, created);
  await page.locator('button[aria-controls="escala-area-roster"]').click();
  await expect(page.getByRole("button", { name: "Gerar PDF", exact: true })).toBeDisabled();
  await page.locator('button[aria-controls="escala-area-generate"]').click();
  const generating = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "GENERATE", { timeout: 40_000 });
  await page.getByRole("button", { name: "Gerar nova proposta", exact: true }).click();
  const generatedResponse = await generating;
  const generated = await generatedResponse.json();
  const failureCode = typeof generated?.error?.code === "string" && /^[A-Z_]+$/.test(generated.error.code) ? generated.error.code : "UNCLASSIFIED";
  expect(generatedResponse.status(), `GENERATE public code: ${failureCode}`).toBe(200);
  expect(["FEASIBLE", "OPTIMAL"]).toContain(generated.result.status);
  expect(generated.validation.valid).toBe(true);
  const expected = ["a:2026-12-03", "a:2026-12-05", "a:2026-12-06", "b:2026-12-09", "b:2026-12-10", "b:2026-12-11"];
  const proposal: EscalaInput = generated.proposalInput;
  const absent = new Set(proposal.assignments.filter(item => item.kind === "ABSENCE").map(item => item.employeeId + ":" + item.date));
  expect(expected.every(key => absent.has(key))).toBe(true);
  expect(proposal.assignments).toEqual(expect.arrayContaining(input.assignments));
  const saving = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "APPLY_PROPOSAL");
  await page.getByRole("button", { name: "Aplicar proposta à grade", exact: true }).click();
  await expect(page.locator('[data-state="saved"]')).toBeVisible();
  expect((await saving).status()).toBe(200);
  const saved: EscalaWorkspace = await page.request.get("/api/escalas?id=" + created.id).then(response => response.json());
  expect(saved.input.assignments).toEqual(proposal.assignments);
  await page.getByRole("button", { name: "Gerar XLSX", exact: true }).click();
  await expect(page.getByRole("link", { name: "Baixar XLSX", exact: true })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Baixar XLSX", exact: true }).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  await download.delete();
  expect((await page.request.delete("/api/escalas", { headers: { origin }, data: { workspaceId: saved.id, expectedRevision: saved.revision } })).status()).toBe(200);
});
