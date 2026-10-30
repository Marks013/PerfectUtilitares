import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import type { EscalaInput, EscalaWorkspace } from "../src/lib/escalas/types";
import { effectiveWeeklyMinutes } from "../src/lib/escalas/labor-rules";
import { loginAsAdmin } from "./admin-session";

// An optional user-owned file is supplied at runtime. No private fixture, trace or screenshot is retained.
test.use({ trace: "off", screenshot: "off", video: "off" });
test("private real FPRE136 imports, generates 42h, preserves every employee and downloads the actual monthly reports", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1" || !process.env.E2E_REAL_CSV_PATH, "Requires a private runtime CSV and the disposable isolated database");
  test.setTimeout(180000);
  const csv = await readFile(process.env.E2E_REAL_CSV_PATH!);
  await loginAsAdmin(page);
  await page.goto("/escala");
  await page.getByText("Novo planejamento", { exact: true }).click();
  await page.getByLabel("Código da filial", { exact: true }).fill("02");
  await page.getByLabel("Nome da filial (opcional)", { exact: true }).fill("Validação privada isolada");
  await page.getByLabel("Mês de referência", { exact: true }).fill("2026-11");
  const creating = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "CREATE");
  await page.getByRole("button", { name: "Iniciar planejamento", exact: true }).click();
  const createdResponse = await creating;
  expect(createdResponse.status()).toBe(201);
  const created: EscalaWorkspace = await createdResponse.json();
  const journey = page.getByLabel("Jornada semanal", { exact: true });
  await journey.selectOption("44");
  await page.getByLabel("Arquivo CSV ou XLSX", { exact: true }).setInputFiles({ name: "FPRE136.CSV", mimeType: "text/csv", buffer: csv });
  const importing = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas/import"));
  await page.getByRole("button", { name: "Conferir arquivo", exact: true }).click();
  const importResponse = await importing;
  expect(importResponse.status()).toBe(200);
  const { preview } = await importResponse.json();
  const originalEmployees: EscalaInput["employees"] = preview.employees;
  expect(originalEmployees.length > 1).toBe(true);
  expect(preview.issues.length).toBe(0);
  await page.getByRole("button", { name: "Aplicar registros aceitos à proposta", exact: true }).click();
  await journey.selectOption("42");
  const generating = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "GENERATE");
  await page.getByRole("button", { name: "Gerar proposta mensal", exact: true }).click();
  const generatedResponse = await generating;
  expect(generatedResponse.status()).toBe(200);
  const generated = await generatedResponse.json();
  expect(["FEASIBLE", "OPTIMAL"]).toContain(generated.result.status);
  expect(generated.validation.valid).toBe(true);
  const proposed: EscalaInput = generated.proposalInput;
  expect(proposed.defaultWeeklyHours).toBe(42);
  expect(proposed.simulation).toBe(true);
  expect(proposed.policy.compensationAuthorized).toBe(false);
  expect(proposed.policy.reviewed).toBe(false);
  expect(proposed.employees.length).toBe(originalEmployees.length);
  const learnerIds = new Set(originalEmployees.filter(person => person.role === "AUX. DE SERVIÇOS EM SUPER").map(person => person.id));
  expect(proposed.employees.filter(person => person.planningEnabled === false).map(person => person.id).sort()).toEqual([...learnerIds].sort());
  expect(proposed.employees.every(person => person.weeklyHours === 42)).toBe(true);
  const originals = new Map(originalEmployees.map(person => [person.id, JSON.stringify(person.sourceSchedule)]));
  expect(proposed.employees.every(person => JSON.stringify(person.sourceSchedule) === originals.get(person.id))).toBe(true);
  for (const person of proposed.employees) {
    const rows = proposed.assignments.filter(item => item.employeeId === person.id);
    if (learnerIds.has(person.id)) { expect(rows).toEqual([]); continue; }
    expect(rows.length > 0).toBe(true);
    for (let week = 0; week < rows.length; week += 7) {
      const group = rows.slice(week, week + 7);
      expect(group.filter(item => item.kind === "WORK" || item.kind === "DUTY").length).toBe(5);
      expect(group.filter(item => item.kind === "OFF").length).toBe(2);
      if (person.scheduleMode === "MISSING" || person.scheduleMode === "UNTIMED") continue;
      const minutes = group.reduce((sum, item) => sum + (item.kind !== "WORK" ? 0 : proposed.shifts.find(shift => shift.id === item.shiftId)!.segments.reduce((paid, segment) => paid + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0)), 0);
      expect(minutes).toBe(effectiveWeeklyMinutes(person, group[0].date));
    }
  }
  await page.getByRole("button", { name: "Aplicar proposta à grade", exact: true }).click();
  const saving = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "SAVE");
  await expect(page.locator('[data-state="saved"]')).toBeVisible();
  expect((await saving).status()).toBe(200);
  for (const format of ["PDF", "XLSX"] as const) {
    await page.getByRole("button", { name: "Gerar " + format, exact: true }).click();
    await expect(page.getByRole("link", { name: "Baixar " + format, exact: true })).toBeVisible();
    const downloading = page.waitForEvent("download");
    await page.getByRole("link", { name: "Baixar " + format, exact: true }).click();
    const download = await downloading;
    expect(await download.failure()).toBeNull();
    const stream = await download.createReadStream();
    if (!stream) throw new Error("Downloaded file has no readable stream");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    expect(bytes.length > 1000).toBe(true);
    expect(bytes.subarray(0, format === "PDF" ? 4 : 2).toString()).toBe(format === "PDF" ? "%PDF" : "PK");
    if (format === "XLSX") {
      const zip = unzipSync(bytes);
      const main = strFromU8(zip["xl/worksheets/sheet1.xml"]);
      expect(proposed.employees.filter(person => !learnerIds.has(person.id)).every(person => main.includes(">" + person.registration + "<"))).toBe(true);
      const allSheets = Object.entries(zip).filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).map(([, bytes]) => strFromU8(bytes)).join(" ");
      expect(proposed.employees.every(person => allSheets.includes(">" + person.registration + "<"))).toBe(true);
      expect(proposed.employees.filter(person => learnerIds.has(person.id)).every(person => !main.includes(">" + person.registration + "<"))).toBe(true);
      expect(strFromU8(zip["xl/workbook.xml"])).toContain("Desfalques");
    }
    await download.delete();
  }
  const origin = new URL(page.url()).origin;
  const saved: EscalaWorkspace = await page.request.get("/api/escalas?id=" + created.id).then(response => response.json());
  expect(saved.input.defaultWeeklyHours).toBe(42);
  expect(saved.input.employees.length).toBe(originalEmployees.length);
  const deleted = await page.request.delete("/api/escalas", { headers: { origin }, data: { workspaceId: saved.id, expectedRevision: saved.revision } });
  expect(deleted.status()).toBe(200);
});
