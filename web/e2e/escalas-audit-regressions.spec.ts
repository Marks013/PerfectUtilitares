import { expect, test } from "./fixtures";
import type { EscalaInput, EscalaWorkspace } from "../src/lib/escalas/types";
import { loginAsAdmin } from "./admin-session";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument } from "pdf-lib";

// Never publish or modify existing plans. Every write below belongs to this unique technical draft.
test.use({ trace: "off", screenshot: "off", video: "off" });

function draft(branch: string): EscalaInput {
  const employee = { id: "audit-active", registration: "QA01", name: "Pessoa de verificação", sector: "Setor de teste", role: "Repositor", weeklyHours: 42 as const, shiftIds: ["day"], activeFrom: "2020-01-01", scheduleMode: "TIMED" as const, offMode: "VARIABLE" as const, fixedOffDays: [], offPattern: "ANY" as const, maxConsecutiveSundays: 2 as const, sundayRestRule: "COMMERCE" as const, preferredOffDays: [], historyKnown: false, history: [] };
  return {
    schemaVersion: 1, branchCode: branch, branchName: "Verificação técnica — não publicar", startDate: "2026-11-02", endDate: "2026-11-08", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
    policy: { source: "Cenário técnico sintético; não publicar", validFrom: "2026-01-01", validUntil: "2026-12-31", reviewed: true, reviewedBy: "Verificação automatizada", normativeProfile: "CUSTOM", weeklyLimit: 44, dailyLimitMinutes: 528, compensationAuthorized: true, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false, coverageReview: "CONFIRMED", limitContinuousWorkBlocks: false },
    employees: [employee, { ...employee, id: "audit-disabled", registration: "QA02", name: "Pessoa excluída de verificação", planningEnabled: false, planningExclusionReason: "Exclusão explícita do cenário técnico" }],
    shifts: [{ id: "day", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }],
    assignments: [...Array.from({ length: 7 }, (_, index) => ({ employeeId: employee.id, date: `2026-11-0${index+2}`, kind: index < 5 ? "WORK" as const : "OFF" as const, ...(index < 5 ? { shiftId: "day" } : {}) })), { employeeId: "audit-disabled", date: "2026-11-03", kind: "ABSENCE" }],
    demands: Array.from({ length: 7 }, (_, index) => ({ id: `audit-demand-${index}`, date: `2026-11-0${index + 2}`, sector: "Setor de teste", start: 480, end: 720, minimum: index < 5 ? 1 : 0 })),
  };
}

test("revision confirmation, inactive panels, canonical identity and excluded-person absence survive the real workflow", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires explicit authorization to create and remove one technical draft");
  test.setTimeout(180_000);
  const branch = "9" + Date.now().toString().slice(-7);
  let owned: { id: string; revision: number } | undefined;
  try { await loginAsAdmin(page); } catch { throw new Error("Administrative browser authentication failed; credentials omitted"); }
  const origin = new URL(page.url()).origin;
  const headers = { origin };
  const command = (data: unknown) => page.request.post("/api/escalas", { headers, data });
  try {
    const created = await command({ action: "CREATE", input: draft(branch) });
    expect(created.status()).toBe(201);
    const workspace: EscalaWorkspace = await created.json();
    owned = { id: workspace.id, revision: workspace.revision };
    console.log("ESCALA_TECHNICAL_DRAFT", workspace.id, branch);
    expect(workspace.input.branchCode).toBe(branch);
    expect(workspace.validation.valid, JSON.stringify(workspace.validation.issues.map(issue => issue.code))).toBe(true);
    expect(workspace.validation.readyToPublish, JSON.stringify(workspace.validation.issues.map(issue => issue.code))).toBe(true);

    const duplicate = await command({ action: "CREATE", input: { ...draft(branch), branchCode: "00" + branch } });
    expect(duplicate.status()).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: { code: "ESCALA_ALREADY_EXISTS" } });

    await page.goto("/escala");
    await page.getByLabel("Selecionar filial e período", { exact: true }).selectOption(workspace.id);
    await page.getByRole("button", { name: /^Revisar e exportar/ }).click();
    const confirmation = page.getByRole("checkbox", { name: "Conferi esta revisão da filial " + branch, exact: true });
    const approval = page.getByRole("button", { name: "Publicar proposta", exact: true });
    if (!await confirmation.isVisible()) await page.getByText("Aprovação interna (opcional)", { exact: true }).click();
    await confirmation.check(); await expect(approval).toBeEnabled();

    const review = async () => {
      const button = page.getByRole("button", { name: "Revisão e suporte", exact: true });
      if (!await button.isVisible()) await page.getByText("Ferramentas e ajustes opcionais", { exact: true }).click();
      await button.click(); await expect(page.locator("#escala-area-review")).toBeVisible();
    };
    await review();
    const gapView = page.getByRole("button", { name: /^Desfalques \(/ });
    await gapView.click();
    await page.getByRole("button", { name: /^Escolher jornada e gerar/ }).click();
    await expect(page.locator("#escala-area-review")).toBeHidden();
    await review(); await expect(gapView).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^Revisar e exportar/ }).click();
    await expect(confirmation).toBeChecked();

    await page.getByRole("button", { name: /^Pessoa de verificação, 02\/11\/2026:/ }).click();
    await page.getByRole("checkbox", { name: "Preservar esta decisão nas próximas gerações", exact: true }).check();
    await page.getByRole("button", { name: "Conferir alteração", exact: true }).click();
    const saving = page.waitForResponse(response => response.url().endsWith("/api/escalas") && response.request().method() === "POST" && response.request().postDataJSON()?.action === "SAVE");
    await page.getByRole("button", { name: "Confirmar alteração", exact: true }).click();
    await expect(confirmation).not.toBeChecked();
    const saved = await saving; expect(saved.status()).toBe(200);
    const revised: EscalaWorkspace = await saved.json(); owned.revision = revised.revision;
    expect(revised.validation.readyToPublish).toBe(true);
    await expect(page.locator('[data-state="saved"]')).toBeVisible();
    await expect(confirmation).not.toBeChecked(); await expect(approval).toBeDisabled();

    await page.getByRole("button", { name: /^Escolher jornada e gerar/ }).click();
    const calculating = page.waitForResponse(response => response.url().endsWith("/api/escalas") && response.request().method() === "POST" && response.request().postDataJSON()?.action === "GENERATE", { timeout: 60_000 });
    await page.getByRole("button", { name: "Gerar nova proposta", exact: true }).click();
    const generated = await calculating; expect(generated.status()).toBe(200);
    const proposal = await generated.json();
    expect(["OPTIMAL", "FEASIBLE"]).toContain(proposal.result.status);
    expect(proposal.result.assignments.filter((day: { employeeId: string }) => day.employeeId === "audit-disabled")).toEqual([{ employeeId: "audit-disabled", date: "2026-11-03", kind: "ABSENCE" }]);
    const applying = page.waitForResponse(response => response.url().endsWith("/api/escalas") && response.request().method() === "POST" && response.request().postDataJSON()?.action === "SAVE");
    await page.getByRole("button", { name: "Aplicar proposta à grade", exact: true }).click();
    const applied = await applying; expect(applied.status()).toBe(200);
    const final: EscalaWorkspace = await applied.json(); owned.revision = final.revision;
    expect(final.input.assignments.filter(day => day.employeeId === "audit-disabled")).toEqual([{ employeeId: "audit-disabled", date: "2026-11-03", kind: "ABSENCE" }]);
    expect(final.input.assignments.find(day => day.employeeId === "audit-active" && day.date === "2026-11-02")?.locked).toBe(true);
    await expect(page.locator('[data-state="saved"]')).toBeVisible();

    for (const format of ["pdf", "xlsx"]) {
      const exporting = page.waitForResponse(response => response.url().includes("/api/escalas/export") && new URL(response.url()).searchParams.get("format") === format);
      await page.getByRole("button", { name: "Gerar " + format.toUpperCase(), exact: true }).click();
      expect((await exporting).status()).toBe(200);
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("link", { name: "Baixar " + format.toUpperCase(), exact: true }).click();
      const download = await downloadPromise; expect(await download.failure()).toBeNull();
      const stream = await download.createReadStream(); if (!stream) throw new Error("Report download is missing");
      const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); const bytes = Buffer.concat(chunks);
      if (format === "pdf") expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
      else expect(strFromU8(unzipSync(bytes)["xl/workbook.xml"])).toContain('name="Horarios"');
    }
    for (const width of [375, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
  } finally {
    if (owned) {
      const response = await page.request.get("/api/escalas?id=" + owned.id);
      if (response.ok()) {
        const current: EscalaWorkspace = await response.json();
        if (current.id === owned.id && current.input.branchCode === branch && current.input.branchName === "Verificação técnica — não publicar" && current.status === "DRAFT") {
          const removed = await page.request.delete("/api/escalas", { headers, data: { workspaceId: owned.id, expectedRevision: owned.revision } });
          expect(removed.status(), "Could not clean up the task-owned technical draft").toBe(200);
        } else throw new Error("Technical draft changed unexpectedly; preserved for review instead of deleting");
      }
    }
  }
});
