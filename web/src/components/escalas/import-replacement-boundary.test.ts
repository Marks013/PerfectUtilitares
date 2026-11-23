import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalaActor } from "@/lib/escalas/access";
import type { EscalaInput } from "@/lib/escalas/types";
import { POST } from "@/app/api/escalas/import/route";
import type { ImportSyncCommand, ImportSyncPreview, ImportSyncPreviewCommand } from "@/lib/escalas/import-sync-contracts";
const mocks = vi.hoisted(() => ({ user: vi.fn(), transaction: vi.fn(), workspace: vi.fn(), update: vi.fn(), revision: vi.fn(), audit: vi.fn(), importSeed: vi.fn(), policy: vi.fn(), guard: vi.fn(), revisionRead: vi.fn(), approval: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { findFirst: mocks.user }, escalaModuleAccessPolicy: { findUnique: mocks.policy },
  escalaWorkspace: { findFirst: mocks.workspace, updateMany: mocks.update }, escalaRevision: { findUnique: mocks.revisionRead, create: mocks.revision },
  auditLog: { create: mocks.audit }, $transaction: mocks.transaction,
  escalaBranchPolicyVersion: { findFirst: mocks.approval },
} }));
vi.mock("@/lib/escalas/access.server", () => ({ requireEscalaAccess: mocks.guard }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: async () => null }));
const actor: EscalaActor = { tenantId: "tenant", userId: "admin", admin: true, accountSecurityVersion: 0 };
const header = "Matricula;Nome;Setor;Cargo;CargaSemanal;Horarios;Admissao;RegraDomingos";
const employeeRow = (registration: string, name = "Pessoa", hours = "") => `${registration};${name};Loja;Operador;${hours};08:00-12:00 / 13:00-17:24;2020-01-01;`;
const file = (text = [header, employeeRow("0002"), employeeRow("0003")].join("\n")) => ({ buffer: Buffer.from(text), extension: "csv" as const });
const command = (purpose: "EMPLOYEES" | "ABSENCES" = "EMPLOYEES"): ImportSyncPreviewCommand => ({ action: "PREVIEW_REPLACE", purpose, workspaceId: "w1", expectedRevision: 1, startDate: purpose === "EMPLOYEES" ? "2026-11-30" : "2026-12-01", endDate: purpose === "EMPLOYEES" ? "2027-01-03" : "2026-12-31", completeScopeConfirmed: true });
const absenceFile = (registration = "0002", start = "03/12/2026", end = "03/12/2026", extra = "") => file([
  "Período,01/12/2026,a,31/12/2026", "Empresa,Tipo,Cadastro,Nome,Função,Admissão,Afastamento,CID,Situação,Término,Dias",
  ["1", "1", registration, "PRIVATE-NAME", "PRIVATE-ROLE", "01/01/2020", start, "PRIVATE-CID", "PRIVATE-MEDICAL", "2", "Afastamento", end, "999"].join(","), extra,
].filter(Boolean).join("\n"));
function fpreSection(company: string, page: number, registration: string, withContext = true) {
  return [[company, "-", "Empresa", "Pág.:", String(page)], ["Quadro de Horários"], ["", "Nome", "Cargo", "Horário"],
    ...(withContext ? [["02.01 , FILIAL, Loja"], ["Horário:", "0026", "-", "Diurno"]] : []),
    [registration, "-", "Pessoa", "Operador", "08:00", "-", "12:00", "13:00", "-", "17:24"], ["Sábado:", "08:00", "-", "12:00", "13:00", "-", "17:24"]];
}
const fpreFile = (rows: string[][]) => file(rows.map(row => row.map(cell => JSON.stringify(cell)).join(",")).join("\n"));
function initial(): EscalaInput {
  return { schemaVersion: 1, branchCode: "02", branchName: "Filial", startDate: "2026-11-30", endDate: "2027-01-03", visibleMonth: "2026-12", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
    policy: { source: "Cenário sintético", validFrom: "2026-01-01", validUntil: "2027-12-31", reviewed: true, reviewedBy: "Responsável", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: true, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: true, nightWorkReviewed: false },
    employees: ["0001", "0002"].map((registration, index) => ({ id: `e${index + 1}`, registration, name: "Pessoa", sector: "Loja", role: "Operador", weeklyHours: 40, weeklyHoursMode: "INDIVIDUAL", shiftIds: ["day"], scheduleMode: "TIMED", activeFrom: "2020-01-01", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 2, sundayRestRule: "COMMERCE", preferredOffDays: [6], historyKnown: true, history: [{ employeeId: `e${index + 1}`, date: "2026-11-29", kind: "OFF" }] })),
    shifts: [{ id: "day", name: "Diurno", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }], demands: [], assignments: [],
  };
}
let value: EscalaInput, revision: number, revisions: { revision: number; input: unknown }[], audits: unknown[], fail: "revision" | "audit" | null;
let beforeTransaction: (() => void) | undefined, afterTransaction: (() => void) | undefined;
let approvalId: string | null, workspaceStatus: "DRAFT" | "PUBLISHED";
const user = () => ({ id: "admin", tenantId: "tenant", status: "ACTIVE", role: "ADMIN", securityVersion: 0 });
beforeEach(() => {
  vi.resetAllMocks(); actor.accountSecurityVersion = 0;
  value = initial(); revision = 1; revisions = []; audits = []; fail = null; beforeTransaction = undefined; afterTransaction = undefined; approvalId = null; workspaceStatus = "DRAFT";
  mocks.guard.mockResolvedValue({ ok: true, actor }); mocks.user.mockImplementation(async () => user());
  mocks.policy.mockResolvedValue({ mode: "ADMIN_ONLY", version: 1 });
  mocks.workspace.mockImplementation(async ({ where }) => where.id === "w1" && where.tenantId === "tenant" && (where.revision === undefined || where.revision === revision)
    ? { id: "w1", tenantId: "tenant", revision, status: workspaceStatus, branchCode: "02", branchName: "Filial", startDate: value.startDate, endDate: value.endDate, updatedAt: new Date("2026-11-01") } : null);
  mocks.revisionRead.mockImplementation(async () => ({ input: structuredClone(value), revision, status: workspaceStatus, approvedPolicyVersionId: approvalId, createdAt: new Date("2026-11-01") }));
  mocks.update.mockImplementation(async ({ where, data }) => { if (where.revision !== revision || where.tenantId !== "tenant" || where.id !== "w1") return { count: 0 }; revision = data.revision; return { count: 1 }; });
  mocks.revision.mockImplementation(async ({ data }) => { if (fail === "revision") throw new Error("revision failed"); revisions.push(structuredClone(data)); value = structuredClone(data.input); return data; });
  mocks.audit.mockImplementation(async ({ data }) => { if (fail === "audit") throw new Error("audit failed"); audits.push(structuredClone(data)); return data; });
  mocks.transaction.mockImplementation(async callback => {
    beforeTransaction?.();
    const snapshot = structuredClone({ value, revision, revisions, audits });
    const tx = { user: { findFirst: mocks.user }, escalaModuleAccessPolicy: { findUnique: mocks.policy }, escalaWorkspace: { findFirst: mocks.workspace, updateMany: mocks.update }, escalaRevision: { create: mocks.revision }, auditLog: { create: mocks.audit }, escalaImportedTeam: { upsert: mocks.importSeed }, escalaBranchPolicyVersion: { findFirst: mocks.approval }, $executeRaw: async () => 1, $queryRaw: async () => [] };
    try { const result = await callback(tx); afterTransaction?.(); return result; }
    catch (error) { ({ value, revision, revisions, audits } = snapshot); throw error; }
  });
});
import { requestImportReplacement } from "@/components/escalas/import-replacement-client";
import { getEscala } from "@/lib/escalas/service";
import type { ImportReplacementResult } from "@/components/escalas/import-replacement-client";

type Call = { command: ImportSyncCommand; keys: string[]; status: number; body: Record<string, unknown> };
let calls: Call[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url !== "/api/escalas/import" || init.method !== "POST" || !(init.body instanceof FormData)) throw new Error("BOUNDARY_UNEXPECTED_FETCH");
    const request = new Request("http://localhost/api/escalas/import", { ...init, headers: { origin: "http://localhost" } });
    const multipart = await request.clone().formData();
    const sent = JSON.parse(multipart.get("command") as string) as ImportSyncCommand;
    const response = await POST(request);
    calls.push({ command: sent, keys: [...multipart.keys()], status: response.status, body: await response.clone().json() });
    return response;
  }));
});
const upload = (source: ReturnType<typeof file>) => new File([new Uint8Array(source.buffer)], "source.csv", { type: "text/csv" });
const signal = () => new AbortController().signal;
describe("real import client to real route/service boundary", () => {
  it("accepts a complete contiguous FPRE136 report through PREVIEW and APPLY", async () => {
    const source = upload(fpreFile([...fpreSection("1", 1, "0002"), ...fpreSection("1", 2, "0003")])), workspace = await getEscala(actor, "w1"), settings = command();
    const result = await requestImportReplacement(source, settings, workspace, signal());
    if (!("preview" in result)) throw Error("Missing real preview");
    expect(result.preview.layout).toBe("FPRE136"); expect(result.preview.canApply).toBe(true);
    const saved = await requestImportReplacement(source, { ...settings, action: "APPLY_REPLACE", completeScopeConfirmed: true, confirm: true, expectedImpactHash: result.preview.expectedImpactHash }, workspace, signal());
    if (!("workspace" in saved)) throw Error("Missing saved workspace");
    expect(saved.workspace.input).toEqual(value); expect(saved.workspace.revision).toBe(2);
    expect(calls.map(call => call.status)).toEqual([200,200]); expect(revisions).toHaveLength(1); expect(audits).toHaveLength(1);
  });
  it("accepts complete EMPLOYEES PREVIEW/APPLY, digest, counts and the canonical saved workspace", async () => {
    const workspace = await getEscala(actor, "w1"), source = upload(file());
    let error: unknown, preview: ImportSyncPreview | undefined, saved: ImportReplacementResult | undefined;
    try {
      const result = await requestImportReplacement(source, command(), workspace, signal());
      if (!("preview" in result)) throw Error("Missing real preview"); preview = result.preview;
      saved = await requestImportReplacement(source, { ...command(), action: "APPLY_REPLACE", confirm: true, completeScopeConfirmed: true, expectedImpactHash: preview.expectedImpactHash }, workspace, signal());
    } catch (cause) { error = cause; }

    expect(error).toBeUndefined(); expect(preview?.counts).toMatchObject({ addedPeople: 1, removedPeople: 1 });
    expect(saved && "workspace" in saved ? saved.workspace.revision : null).toBe(2);
    expect(saved && "workspace" in saved ? saved.workspace.input : null).toEqual(value);
    expect(saved && "summary" in saved ? saved.summary.expectedImpactHash : null).toBe(preview?.expectedImpactHash);
    expect(calls).toHaveLength(2); expect(calls.every(call => call.status === 200 && call.keys.sort().join() === "command,file")).toBe(true);
    expect(revisions).toHaveLength(1); expect(audits).toHaveLength(1);
  });
  it.each(["starts-at-two", "missing-middle-page"])("keeps the actual SOURCE_PARTIAL block for FPRE136 %s", async kind => {
    const rows = kind === "starts-at-two" ? fpreSection("1", 2, "0002") : [...fpreSection("1", 1, "0001"), ...fpreSection("1", 3, "0002")];
    const source = upload(fpreFile(rows)), workspace = await getEscala(actor, "w1");
    let error: unknown, blocked = false, preview: ImportSyncPreview | undefined;
    try { const result = await requestImportReplacement(source, command(), workspace, signal()); if ("preview" in result) { preview = result.preview; blocked = !result.preview.canApply; } }
    catch (cause) { error = cause; }
    let applyError: unknown;
    if (preview) try { await requestImportReplacement(source, { ...command(), action: "APPLY_REPLACE", confirm: true, completeScopeConfirmed: true, expectedImpactHash: preview.expectedImpactHash }, workspace, signal()); } catch (cause) { applyError = cause; }

    expect(error).toBeUndefined(); expect(blocked).toBe(true); expect(preview?.blockers.some(problem => problem.code === "SOURCE_PARTIAL")).toBe(true);
    expect(calls.map(call => call.status)).toEqual([200, 422]); expect(applyError).toBeInstanceOf(Error);
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(revision).toBe(1);
  });
  it.each(["PREVIEW_REPLACE", "APPLY_REPLACE"] as const)("accepts the real ABSENCES %s response with preserved days outside its narrow scope", async action => {
    value.assignments = [
      { employeeId: "e2", date: "2026-11-30", kind: "ABSENCE", locked: true },
      { employeeId: "e2", date: "2026-12-02", kind: "ABSENCE", locked: true },
      { employeeId: "e2", date: "2026-12-03", kind: "ABSENCE", locked: true },
      { employeeId: "e2", date: "2027-01-01", kind: "ABSENCE", locked: true },
    ];
    const workspace = await getEscala(actor, "w1"), source = upload(absenceFile("0002", "03/12/2026", "04/12/2026")), settings = command("ABSENCES");
    let error: unknown, previewError: unknown, result: ImportReplacementResult | undefined;
    try { result = await requestImportReplacement(source, settings, workspace, signal()); } catch (cause) { previewError = cause; }
    if (action === "APPLY_REPLACE") {
      // Diagnostic continuation only: reuse the untouched preview actually produced by the backend.
      // This does not pretend the normal UI could confirm after a rejected preview.
      const actual = calls[0].body.preview as ImportSyncPreview;
      try { result = await requestImportReplacement(source, { ...settings, action, confirm: true, completeScopeConfirmed: true, expectedImpactHash: actual.expectedImpactHash }, workspace, signal()); } catch (cause) { error = cause; }
    } else error = previewError;

    expect(calls.every(call => call.status === 200)).toBe(true);
    const actual = (calls.at(-1)?.body.summary ?? calls.at(-1)?.body.preview) as ImportSyncPreview;
    expect(actual.counts).toMatchObject({ addedAbsenceDays: 1, removedAbsenceDays: 1, unchangedAbsenceDays: 3, assignmentChanges: 2 });
    expect(actual.impact.absences.unchanged.map(day => day.date)).toEqual(["2026-11-30", "2026-12-03", "2027-01-01"]);
    if (action === "APPLY_REPLACE") {
      expect(revision).toBe(2); expect(value.assignments.map(day => day.date)).toEqual(["2026-11-30", "2026-12-03", "2026-12-04", "2027-01-01"]);
      expect(mocks.update).toHaveBeenCalledTimes(1); expect(revisions).toHaveLength(1); expect(audits).toHaveLength(1);
    } else expect(mocks.transaction).not.toHaveBeenCalled();
    expect(previewError).toBeUndefined();
    expect(error).toBeUndefined();
    expect(result).toBeDefined();
    if (action === "APPLY_REPLACE") expect(result && "workspace" in result ? result.workspace.input : null).toEqual(value);
  });
  it("accepts a real narrow ABSENCES response when no unchanged absence lies outside the scope", async () => {
    value.assignments = [{ employeeId: "e2", date: "2026-12-02", kind: "ABSENCE", locked: true }, { employeeId: "e2", date: "2026-12-03", kind: "ABSENCE", locked: true }];
    const workspace = await getEscala(actor, "w1"), source = upload(absenceFile("0002", "03/12/2026", "04/12/2026")), settings = command("ABSENCES");
    let error: unknown, preview: ImportSyncPreview | undefined, saved: ImportReplacementResult | undefined;
    try {
      const result = await requestImportReplacement(source, settings, workspace, signal());
      if (!("preview" in result)) throw Error("Missing real preview"); preview = result.preview;
      saved = await requestImportReplacement(source, { ...settings, action: "APPLY_REPLACE", confirm: true, completeScopeConfirmed: true, expectedImpactHash: preview.expectedImpactHash }, workspace, signal());
    } catch (cause) { error = cause; }

    expect(error).toBeUndefined(); expect(saved && "workspace" in saved ? saved.workspace.revision : null).toBe(2);
    expect(saved && "workspace" in saved ? saved.workspace.input : null).toEqual(value);
    expect(preview?.counts).toMatchObject({ addedAbsenceDays: 1, removedAbsenceDays: 1, unchangedAbsenceDays: 1 });
  });
  it("refuses any external fetch in the bridge", async () => {
    await expect(fetch("https://synthetic.invalid", { method: "POST", body: new FormData() })).rejects.toThrow("BOUNDARY_UNEXPECTED_FETCH");
  });
  it("keeps an incomplete ABSENCES report blocked even with scope declaration", async () => {
    const text = absenceFile().buffer.toString().replace("31/12/2026", "02/12/2026");
    const source = upload(file(text)), workspace = await getEscala(actor, "w1"), settings = command("ABSENCES");
    const result = await requestImportReplacement(source, settings, workspace, signal());
    expect("preview" in result).toBe(true);
    if (!("preview" in result)) throw Error("Missing preview");
    expect(result.preview.canApply).toBe(false); expect(result.preview.blockers.length).toBeGreaterThan(0);
    await expect(requestImportReplacement(source, { ...settings, action: "APPLY_REPLACE", completeScopeConfirmed: true, confirm: true, expectedImpactHash: result.preview.expectedImpactHash }, workspace, signal())).rejects.toThrow();
    expect(calls.map(call => call.status)).toEqual([200, 422]); expect(mocks.transaction).not.toHaveBeenCalled(); expect(revision).toBe(1);
  });
});

afterEach(() => { vi.unstubAllGlobals(); });
