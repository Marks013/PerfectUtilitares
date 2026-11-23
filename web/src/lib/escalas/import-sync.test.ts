import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalaActor } from "./access";
import type { EscalaInput } from "./types";
import { applyAdminImport, previewAdminImport } from "./import-sync";
import { POST } from "@/app/api/escalas/import/route";
import { saveEscala } from "./service";
import { reopenEscalaPublication } from "./reopen-publication";
import { buildEscalaApprovedPolicy } from "./approved-policy";
import type { ImportSyncCommand, ImportSyncPreview, ImportSyncPreviewCommand } from "./import-sync-contracts";
const mocks = vi.hoisted(() => ({ user: vi.fn(), transaction: vi.fn(), workspace: vi.fn(), update: vi.fn(), revision: vi.fn(), audit: vi.fn(), importSeed: vi.fn(), policy: vi.fn(), guard: vi.fn(), revisionRead: vi.fn(), approval: vi.fn() }));
const legacy = vi.hoisted(() => ({ escalaWorkforce: { findUnique: async () => null } }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  ...legacy,
  user: { findFirst: mocks.user }, escalaModuleAccessPolicy: { findUnique: mocks.policy },
  escalaWorkspace: { findFirst: mocks.workspace, updateMany: mocks.update }, escalaRevision: { findUnique: mocks.revisionRead, create: mocks.revision },
  auditLog: { create: mocks.audit }, $transaction: mocks.transaction,
  escalaBranchPolicyVersion: { findFirst: mocks.approval },
} }));
vi.mock("./access.server", () => ({ requireEscalaAccess: mocks.guard }));
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
function december(): EscalaInput {
  const input = initial();
  return { ...input, startDate: "2026-12-01", endDate: "2026-12-31", planningWeekStartsOn: "SUNDAY",
    employees: input.employees.map(person => ({ ...person, history: [] })) };
}
const decemberCommand = (purpose: "EMPLOYEES" | "ABSENCES" = "EMPLOYEES"): ImportSyncPreviewCommand =>
  ({ ...command(purpose), startDate: "2026-12-01", endDate: "2026-12-31" });
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
  mocks.update.mockImplementation(async ({ where, data }) => { if (where.revision !== revision || where.tenantId !== "tenant" || where.id !== "w1" || where.status && where.status !== workspaceStatus) return { count: 0 }; revision = data.revision; workspaceStatus = data.status; return { count: 1 }; });
  mocks.revision.mockImplementation(async ({ data }) => { if (fail === "revision") throw new Error("revision failed"); revisions.push(structuredClone(data)); value = structuredClone(data.input); return data; });
  mocks.audit.mockImplementation(async ({ data }) => { if (fail === "audit") throw new Error("audit failed"); audits.push(structuredClone(data)); return data; });
  mocks.transaction.mockImplementation(async callback => {
    beforeTransaction?.();
    const snapshot = structuredClone({ value, revision, revisions, audits, workspaceStatus });
    const tx = { user: { findFirst: mocks.user }, escalaModuleAccessPolicy: { findUnique: mocks.policy }, escalaWorkspace: { findFirst: mocks.workspace, updateMany: mocks.update }, escalaRevision: { create: mocks.revision, findUnique: mocks.revisionRead }, auditLog: { create: mocks.audit }, escalaImportedTeam: { upsert: mocks.importSeed }, escalaBranchPolicyVersion: { findFirst: mocks.approval }, $executeRaw: async () => 1, $queryRaw: async () => [] };
    try { const result = await callback({ ...tx, ...legacy }); afterTransaction?.(); return result; }
    catch (error) { ({ value, revision, revisions, audits, workspaceStatus } = snapshot); throw error; }
  });
});
async function apply(settings = command(), source = file(), preview?: ImportSyncPreview) {
  const reviewed = preview ?? await previewAdminImport(actor, settings, source);
  return applyAdminImport(actor, { ...settings, action: "APPLY_REPLACE", completeScopeConfirmed: true, confirm: true, expectedImpactHash: reviewed.expectedImpactHash }, source);
}
async function http(settings: ImportSyncCommand | Record<string, unknown>, source = file()) {
  const body = new FormData(); body.set("command", JSON.stringify(settings));
  body.set("file", new File([new Uint8Array(source.buffer)], "source.csv", { type: "text/csv" }));
  return POST(new Request("http://localhost/api/escalas/import", { method: "POST", headers: { origin: "http://localhost" }, body }));
}
describe("administrative replacement with real service and authorization", () => {
  it("requests a missing FPRE136 identity by physical line, rechecks it on APPLY, and never rewrites an identical file", async () => {
    value = december();
    const settings = decemberCommand();
    const source = fpreFile([...fpreSection("1", 1, "0002"), [], ...fpreSection("1", 2, "", false)]);
    const previewResponse = await http(settings, source);
    expect(previewResponse.status).toBe(200);
    const { preview }: { preview: ImportSyncPreview } = await previewResponse.json();
    expect(preview.missingRegistrations).toEqual([{ line: 12, name: "Pessoa", sector: "Loja", role: "Operador", resolved: false }]);
    expect(preview.impact.people.removed).toEqual([]);
    expect(preview.blockers).toEqual([expect.objectContaining({ code: "SOURCE_IDENTITY", line: 12 })]);
    expect(preview.canApply).toBe(false);
    const correction = { ...settings, registrationCorrections: [{ line: 12, registration: "0003" }] };
    const reviewedResponse = await http(correction, source);
    expect(reviewedResponse.status).toBe(200);
    const { preview: reviewed }: { preview: ImportSyncPreview } = await reviewedResponse.json();
    expect(reviewed.canApply).toBe(true);
    expect(reviewed.missingRegistrations).toEqual([expect.objectContaining({ line: 12, resolved: true })]);
    expect(reviewed.impact.people.removed.map(person => person.registration)).toEqual(["0001"]);
    expect(reviewed.impact.people.added.map(person => person.registration)).toEqual(["0003"]);
    const approval = { ...correction, action: "APPLY_REPLACE", confirm: true, expectedImpactHash: reviewed.expectedImpactHash };
    expect((await http({ ...approval, registrationCorrections: [{ line: 12, registration: "0004" }] }, source)).status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect((await http(approval, source)).status).toBe(200);
    expect(value.employees.map(person => person.registration).sort()).toEqual(["0002", "0003"]);
    expect(revision).toBe(2);
    expect(audits).toHaveLength(1);
    expect(mocks.importSeed).toHaveBeenCalledTimes(1);
    const saved = structuredClone(value);
    const repeated = { ...correction, expectedRevision: revision };
    const repeatedReview = await previewAdminImport(actor, repeated, source);
    expect(repeatedReview).toMatchObject({ canApply: false, blockers: [], effect: { noChanges: true, approvalInvalidated: false },
      counts: { updatedPeople: 0, addedPeople: 0, removedPeople: 0, unchangedPeople: 2, assignmentChanges: 0 } });
    const noChanges = await http({ ...approval, expectedRevision: revision, expectedImpactHash: repeatedReview.expectedImpactHash }, source);
    expect(noChanges.status).toBe(422);
    expect(await noChanges.json()).toMatchObject({ error: { code: "ESCALA_IMPORT_NO_CHANGES" } });
    expect(value).toEqual(saved);
    expect(revision).toBe(2);
    expect(audits).toHaveLength(1);
    expect(mocks.importSeed).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it("fills a blank template matrícula but protects a filled row, duplicates and an existing matrícula with another name", async () => {
    value = december();
    const settings = decemberCommand();
    const source = file([header, employeeRow("0002"), employeeRow("", "Pessoa Nova")].join("\r\n"));
    for (const [line, registration, code] of [[2, "0005", "SOURCE_IDENTITY"], [3, "0002", "SOURCE_PARTIAL"], [3, "0001", "SOURCE_IDENTITY"]] as const) {
      const reviewed = await previewAdminImport(actor, { ...settings, registrationCorrections: [{ line, registration }] }, source);
      expect(reviewed.canApply).toBe(false);
      expect(reviewed.blockers).toContainEqual(expect.objectContaining({ line, code }));
      expect(reviewed.impact.people.removed).toEqual([]);
    }
    const correction = { ...settings, registrationCorrections: [{ line: 3, registration: "0005" }] };
    const corrected = await previewAdminImport(actor, correction, source);
    expect(corrected.canApply).toBe(true);
    expect(corrected.impact.people.removed.map(person => person.registration)).toEqual(["0001"]);
    expect(corrected.impact.people.added.map(person => person.registration)).toEqual(["0005"]);
    await apply(correction, source, corrected);
    expect(value.employees.find(person => person.registration === "0005")?.name).toBe("Pessoa Nova");
  });
  it("rejects an FPRE136 correction aimed at a blank row of another branch", async () => {
    value = december();
    const other = fpreSection("1", 2, "");
    other[3] = ["03.01 , OUTRA FILIAL, Loja"];
    const source = fpreFile([...fpreSection("1", 1, "0002"), ...other]);
    const reviewed = await previewAdminImport(actor, { ...decemberCommand(), registrationCorrections: [{ line: 13, registration: "0003" }] }, source);
    expect(reviewed.blockers).toEqual([expect.objectContaining({ code: "SOURCE_IDENTITY", line: 13 })]);
    expect(reviewed.missingRegistrations).toBeUndefined();
    expect(reviewed.impact.people.removed).toEqual([]);
    expect(reviewed.canApply).toBe(false);
  });
  it("does not suggest a departure while a supplied matrícula has multiple current-period bindings", async () => {
    value = december();
    value.employees[0].activeUntil = "2026-12-10";
    value.employees.push({ ...value.employees[0], id: "new-binding", activeFrom: "2026-12-11", activeUntil: undefined });
    const source = file([header, employeeRow("0002"), employeeRow("")].join("\n"));
    const settings = { ...decemberCommand(), registrationCorrections: [{ line: 3, registration: "0001" }] };
    const reviewed = await previewAdminImport(actor, settings, source);
    expect(reviewed.canApply).toBe(false);
    expect(reviewed.blockers).toEqual([expect.objectContaining({ code: "AMBIGUOUS_REGISTRATION", line: 3 })]);
    expect(reviewed.impact.people.removed).toEqual([]);
    await expect(apply(settings, source, reviewed)).rejects.toMatchObject({ status: 422 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([["0002", "1"], ["0008", "8"]])("requires the complete official number when a shorter numeric correction would duplicate a binding", async (existingRow, incomplete) => {
    value = december();
    const source = file([header, employeeRow(existingRow), employeeRow("")].join("\n"));
    const settings = { ...decemberCommand(), registrationCorrections: [{ line: 3, registration: incomplete }] };
    const reviewed = await previewAdminImport(actor, settings, source);
    expect(reviewed.canApply).toBe(false);
    expect(reviewed.blockers).toEqual([expect.objectContaining({ code: "SOURCE_IDENTITY", line: 3, message: expect.stringContaining("matrícula completa") })]);
    expect(reviewed.impact.people.removed).toEqual([]);
    expect(reviewed.impact.people.added.map(person => person.registration)).not.toContain(incomplete);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("reuses the existing identity and keeps a no-op when a missing matrícula is restored from the official record", async () => {
    value = december();
    const baseline = structuredClone(value);
    const source = file([header, employeeRow(""), employeeRow("0002")].join("\n"));
    const settings = { ...decemberCommand(), registrationCorrections: [{ line: 2, registration: "0001" }] };
    const reviewed = await previewAdminImport(actor, settings, source);
    expect(reviewed).toMatchObject({ canApply: false, blockers: [], effect: { noChanges: true }, counts: { unchangedPeople: 2 } });
    expect(reviewed.impact.people.unchanged).toEqual([
      { id: "e1", registration: "0001", name: "Pessoa", fields: [] },
      { id: "e2", registration: "0002", name: "Pessoa", fields: [] },
    ]);
    await expect(apply(settings, source, reviewed)).rejects.toMatchObject({ code: "ESCALA_IMPORT_NO_CHANGES" });
    expect(value).toEqual(baseline);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("blocks FPRE136 duplicates before replacing the existing registration or its editable work", async () => {
    revision = 7;
    value.assignments = [{ employeeId: "e1", date: "2026-12-03", kind: "WORK", shiftId: "day", locked: false }];
    const original = structuredClone(value);
    const source = fpreFile([
      ...fpreSection("1", 1, "0001"),
      ...fpreSection("1", 2, "0001"),
      ...fpreSection("1", 3, "0002"),
    ]);
    const settings = { ...command(), expectedRevision: revision };
    const response = await http(settings, source);
    expect(response.status).toBe(200);
    const { preview } = await response.json() as { preview: ImportSyncPreview };
    expect(preview.context).toMatchObject({ workspaceId: settings.workspaceId, revision: 7, branchCode: "02" });
    expect(preview.scope).toEqual({ startDate: settings.startDate, endDate: settings.endDate });
    expect(preview.coverage.completeScopeConfirmed).toBe(true);
    expect(preview.layout).toBe("FPRE136");
    expect(preview.blockers).toMatchObject([
      { code: "SOURCE_PARTIAL", line: 6, message: expect.stringContaining("Matrícula duplicada") },
      { code: "SOURCE_PARTIAL", line: 13, message: expect.stringContaining("Matrícula duplicada") },
    ]);
    expect(preview.warnings).not.toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("Matrícula duplicada") })]));
    expect(preview.impact.people.removed).toMatchObject([{ id: "e1", registration: "0001" }]);
    expect(preview.canApply).toBe(false);
    expect(preview.expectedImpactHash).toMatch(/^[a-f0-9]{64}$/);

    const application = await http({
      ...settings,
      ...preview.scope,
      action: "APPLY_REPLACE",
      expectedRevision: preview.context.revision,
      expectedImpactHash: preview.expectedImpactHash,
      confirm: true,
    }, source);
    expect(application.status).toBe(422);
    expect(await application.json()).toMatchObject({ error: { code: "ESCALA_IMPORT_BLOCKED" } });
    expect(value).toEqual(original);
    expect(revision).toBe(7);
    expect(revisions).toEqual([]);
    expect(audits).toEqual([]);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(["starts-at-two", "missing-middle-page", "repeated-page", "reversed-pages", "unknown-company-context"])("AIBR01 blocks identifiable incomplete FPRE136 %s through HTTP before all writes", async kind => {
    value.employees.push({ ...value.employees[0], id: "e3", registration: "0003", history: [] });
    value.assignments = [{ employeeId: "e3", date: "2026-12-03", kind: "WORK", shiftId: "day", locked: false }];
    const rows = kind === "starts-at-two" ? fpreSection("1", 2, "0002")
      : kind === "unknown-company-context" ? [...fpreSection("1", 1, "0001"), ...fpreSection("2", 1, "0002", false)]
      : [...fpreSection("1", kind === "reversed-pages" ? 2 : 1, "0001"), ...fpreSection("1", kind === "missing-middle-page" ? 3 : 1, "0002")];
    const source = fpreFile(rows);
    const baseline = structuredClone(value);
    const response = await http(command(), source), { preview } = await response.json() as { preview: ImportSyncPreview };
    const confirmed = await http({ ...command(), action: "APPLY_REPLACE", completeScopeConfirmed: true, confirm: true, expectedImpactHash: preview.expectedImpactHash }, source);
    console.log("AIBR01 " + JSON.stringify({ kind, previewStatus: response.status, canApply: preview.canApply, blockers: preview.blockers.map(problem => problem.code), applyStatus: confirmed.status, revision, writes: { workspace: mocks.update.mock.calls.length, revision: mocks.revision.mock.calls.length, audit: mocks.audit.mock.calls.length }, persistence: "mock" }));
    expect(response.status).toBe(200); expect(preview.layout).toBe("FPRE136"); expect(preview.canApply).toBe(false);
    expect(preview.blockers.some(problem => problem.code === "SOURCE_PARTIAL")).toBe(true);
    expect(confirmed.status).toBe(422); expect(value).toEqual(baseline); expect(revision).toBe(1);
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.revision).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(["sequential-pages", "distinct-company-restart", "context-continuation"])("AIBR01 preserves complete FPRE136 %s through HTTP and legacy preview", async kind => {
    value.employees.push({ ...value.employees[0], id: "e3", registration: "0003", history: [] });
    value.assignments = [{ employeeId: "e3", date: "2026-12-03", kind: "WORK", shiftId: "day", locked: false }];
    const source = fpreFile([...fpreSection("1", 1, "0001"), ...fpreSection(kind === "distinct-company-restart" ? "2" : "1", kind === "distinct-company-restart" ? 1 : 2, "0002", kind !== "context-continuation")]);
    const response = await http(command(), source), { preview } = await response.json() as { preview: ImportSyncPreview };
    const confirmed = await http({ ...command(), action: "APPLY_REPLACE", completeScopeConfirmed: true, confirm: true, expectedImpactHash: preview.expectedImpactHash }, source);
    console.log("AIBR01 " + JSON.stringify({ kind, previewStatus: response.status, canApply: preview.canApply, blockers: preview.blockers.map(problem => problem.code), applyStatus: confirmed.status, revision, writes: { workspace: mocks.update.mock.calls.length, revision: mocks.revision.mock.calls.length, audit: mocks.audit.mock.calls.length }, persistence: "mock" }));
    expect(preview.canApply).toBe(true); expect(confirmed.status).toBe(200); expect(revision).toBe(2); expect(value.employees.map(person => person.registration).sort()).toEqual(["0001", "0002"]); expect(value.assignments).toEqual([]);
    const body = new FormData(); body.set("branchCode", "02"); body.set("startDate", "2026-11-30"); body.set("file", new File([new Uint8Array(source.buffer)], "source.csv", { type: "text/csv" }));
    const legacy = await POST(new Request("http://localhost/api/escalas/import", { method: "POST", headers: { origin: "http://localhost" }, body }));
    expect(legacy.status).toBe(200); expect((await legacy.json()).preview.employees).toHaveLength(2); expect(revision).toBe(2);
  });
  function approve() {
    const built = buildEscalaApprovedPolicy({ input: value, version: 1, provenance: { tenantId: actor.tenantId, approvedById: "admin", approvedAt: "2026-11-13T12:00:00.000Z", origin: null }, selectedSeedAssignments: [], regimeModelSelections: value.employees.map(person => ({ id: `model-${person.id}`, label: "Regime", employeeId: person.id })) });
    if (!built.ok) throw new Error("Invalid approval fixture");
    approvalId = "approval"; const row = { ...built.value, id: approvalId, approvedAt: new Date(built.value.approvedAt), revokedAt: null };
    mocks.approval.mockResolvedValue(row); return row;
  }
  it("keeps approval for names alone but invalidates it for a replacement of team", async () => {
    approve();
    const names = file([header, employeeRow("0001", "Novo nome"), employeeRow("0002")].join("\n"));
    const preview = await previewAdminImport(actor, command(), names);
    expect(preview.effect).toMatchObject({ approvalInvalidated: false, needsRegeneration: false, approvedPolicyVersionIdAfter: "approval" });
    const result = await apply(command(), names, preview); expect(result.workspace).toMatchObject({ approvedPolicyVersionId: "approval" });
    revision = 1; value = initial(); revisions = []; audits = [];
    const replacement = await apply(); expect(replacement.summary.effect.approvalInvalidated).toBe(true);
    expect(mocks.revision.mock.lastCall?.[0].data.approvedPolicyVersionId).toBeNull();
  });
  it("rechecks approval during the final transaction before any write", async () => {
    const row = approve(); const preview = await previewAdminImport(actor, command(), file());
    beforeTransaction = () => mocks.approval.mockResolvedValue({ ...row, revokedAt: new Date() });
    await expect(apply(command(), file(), preview)).rejects.toMatchObject({ status: 409 }); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("reads FPRE136 without copying default regime, admission, history or manual leadership", async () => {
    value.employees[1].leadership = { role: "SECTOR", source: "MANUAL", sectors: ["Loja"] };
    const records = [["1", "-", "Empresa", "Pág.:", "1"], ["Quadro de Horários"], ["", "Nome", "Cargo", "Horário"], ["02.01 , FILIAL, Loja"], ["Horário:", "0026", "-", "Diurno"], ["0002", "-", "Nome importado", "Operador", "08:00", "-", "12:00", "13:00", "-", "17:24"], ["Sábado:", "08:00", "-", "12:00", "13:00", "-", "17:24"]];
    const encode = (rows: string[][]) => file(rows.map(row => row.map(cell => JSON.stringify(cell)).join(",")).join("\n"));
    const source = encode(records), preview = await previewAdminImport(actor, command(), source);
    expect(preview.layout).toBe("FPRE136"); expect(preview.canApply).toBe(true);
    const baseline = structuredClone(value.employees[1]); await apply(command(), source, preview);
    expect(value.employees[0]).toMatchObject({ id: "e2", weeklyHours: 40, weeklyHoursMode: "INDIVIDUAL", activeFrom: baseline.activeFrom, history: baseline.history, sundayRestRule: "COMMERCE", maxConsecutiveSundays: 2, leadership: baseline.leadership });
    revision = 1; value = initial();
    const partial = await previewAdminImport(actor, command(), encode([...records, ["0003", "-", "Truncado"]]));
    expect(partial.blockers.some(problem => problem.code === "SOURCE_PARTIAL")).toBe(true);
  });
  it("blocks a reference conflicting with protected work and preserves valid manual intervals", async () => {
    value.assignments = [{ employeeId: "e2", date: "2026-12-03", kind: "WORK", shiftId: "day", locked: true }];
    const changed = file([header, employeeRow("0001"), employeeRow("0002").replace("08:00-12:00 / 13:00-17:24", "07:00-11:00 / 13:00-17:24")].join("\n"));
    expect((await previewAdminImport(actor, command(), changed)).blockers.some(problem => problem.code === "PROTECTED_ASSIGNMENT")).toBe(true);
    value = initial(); value.employees[1].manualShiftOverrides = [{ catalogCode: 1500, shiftId: "manual", markings: ["08:00", "12:00", "13:00", "17:24"], effectiveFrom: "2026-12-01", effectiveUntil: "2026-12-05" }];
    const result = await apply(); expect(result.workspace.input.employees.find(person => person.id === "e2")?.manualShiftOverrides).toEqual(value.employees.find(person => person.id === "e2")?.manualShiftOverrides);
  });
  it.each(["EMPLOYEES", "ABSENCES"] as const)("previews and commits %s through HTTP with canonical data", async purpose => {
    if (purpose === "ABSENCES") value.assignments = [{ employeeId: "e2", date: "2026-12-02", kind: "ABSENCE", locked: true }, { employeeId: "e2", date: "2026-11-30", kind: "ABSENCE", locked: true }, { employeeId: "e2", date: "2027-01-01", kind: "ABSENCE" }];
    const baseline = structuredClone(value), settings = command(purpose), source = purpose === "EMPLOYEES" ? file() : absenceFile();
    const response = await http(settings, source); expect(response.status).toBe(200);
    const { preview } = await response.json() as { preview: ImportSyncPreview };
    expect(preview.canApply).toBe(true); expect(mocks.transaction).not.toHaveBeenCalled();
    const repeated = await previewAdminImport(actor, settings, source); expect(repeated.expectedImpactHash).toBe(preview.expectedImpactHash);
    const committed = await http({ ...settings, action: "APPLY_REPLACE", completeScopeConfirmed: true, confirm: true, expectedImpactHash: preview.expectedImpactHash }, source);
    expect(committed.status).toBe(200); const result = await committed.json();
    expect(result.workspace.revision).toBe(2); expect(result.workspace.status).toBe("DRAFT"); expect(revisions).toHaveLength(1); expect(audits).toHaveLength(1);
    expect(result.workspace.input.needsRegeneration).toBe(true);
    if (purpose === "EMPLOYEES") {
      expect(preview.layout).toBe("ESCALA_TEMPLATE"); expect(preview.counts).toMatchObject({ addedPeople: 1, removedPeople: 1 });
      expect(value.employees.map(person => person.registration)).toEqual(["0002", "0003"]);
      expect(value.employees.find(person => person.id === "e2")).toMatchObject({ history: baseline.employees[1].history, weeklyHours: 40, sundayRestRule: "COMMERCE", activeFrom: "2020-01-01" });
    } else {
      expect(preview.layout).toBe("FPHI105"); expect(value.employees).toEqual(baseline.employees);
      expect(value.assignments.map(day => day.date)).toEqual(["2026-11-30", "2026-12-03", "2027-01-01"]);
      expect(value.assignments.some(day => day.kind === "WORK")).toBe(false);
      expect(JSON.stringify({ result, audits })).not.toContain("PRIVATE-");
    }
  });
  it.each(["revision", "audit"] as const)("simulated transaction restores all state after %s failure", async point => {
    const before = structuredClone(value); fail = point;
    await expect(apply()).rejects.toThrow(`${point} failed`);
    expect(value).toEqual(before); expect(revision).toBe(1); expect(revisions).toEqual([]); expect(audits).toEqual([]);
  });
  it("rejects revoked authority before writes, and distinguishes denial after commit", async () => {
    const preview = await previewAdminImport(actor, command(), file());
    beforeTransaction = () => mocks.user.mockResolvedValue({ ...user(), status: "BLOCKED" });
    await expect(apply(command(), file(), preview)).rejects.toMatchObject({ status: 403 }); expect(revision).toBe(1); expect(mocks.update).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue(user()); beforeTransaction = undefined;
    afterTransaction = () => mocks.user.mockResolvedValue({ ...user(), role: "OPERATOR" });
    await expect(apply(command(), file(), preview)).rejects.toMatchObject({ status: 403 }); expect(revision).toBe(2); expect(revisions).toHaveLength(1);
  });
  it("requires new review for changed bytes, context, or revision and never retries", async () => {
    const preview = await previewAdminImport(actor, command(), file());
    await expect(apply(command(), file([header, employeeRow("0002", "Outro")].join("\n")), preview)).rejects.toMatchObject({ status: 409 });
    revision = 2; await expect(apply(command(), file(), preview)).rejects.toMatchObject({ status: 409 }); expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["empty", "header", "partial", "duplicate", "wrong-layout"])("blocks unsafe employee source %s even with full-scope declaration", async kind => {
    const source = file(kind === "empty" ? " " : kind === "header" ? header : kind === "wrong-layout" ? "wrong,data\n1,2" : [header, employeeRow("0002"), kind === "partial" ? "0003;Truncado" : employeeRow("0002")].join("\n"));
    const preview = await previewAdminImport(actor, command(), source); expect(preview.canApply).toBe(false);
    if (kind === "header") expect(preview.layout).toBe("ESCALA_TEMPLATE");
    if (kind === "wrong-layout") expect(preview.layout).toBe("UNRECOGNIZED");
    await expect(apply(command(), source, preview)).rejects.toMatchObject({ status: 422 }); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("preserves textual identity and rejects ambiguous bindings and protected removals", async () => {
    value.employees[1].activeUntil = "2026-12-10";
    value.employees.push({ ...value.employees[1], id: "another", activeFrom: "2026-12-11", activeUntil: undefined, history: [] });
    expect((await previewAdminImport(actor, command(), file())).blockers.some(problem => problem.code === "AMBIGUOUS_REGISTRATION")).toBe(true);
    value = initial(); value.assignments = [{ employeeId: "e1", date: "2026-12-02", kind: "HOLIDAY", locked: false }];
    const preview = await previewAdminImport(actor, command(), file()); expect(preview.blockers.some(problem => problem.code === "PROTECTED_ASSIGNMENT")).toBe(true);
    await expect(apply(command(), file(), preview)).rejects.toMatchObject({ status: 422 });
  });
  it("applies a complete FPRE136 with a departure, keeping other people and the calendar", async () => {
    value = december();
    value.policy.closedDates = value.policy.holidayDates = ["2026-12-25"];
    value.assignments = [
      { employeeId: "e1", date: "2026-12-01", kind: "WORK", shiftId: "day" },
      { employeeId: "e1", date: "2026-12-02", kind: "OFF" },
      { employeeId: "e1", date: "2026-12-03", kind: "DUTY" },
      { employeeId: "e1", date: "2026-12-04", kind: "ABSENCE" },
      { employeeId: "e1", date: "2026-12-25", kind: "HOLIDAY" },
      { employeeId: "e2", date: "2026-12-01", kind: "WORK", shiftId: "day", locked: true },
      { employeeId: "e2", date: "2026-12-25", kind: "HOLIDAY", locked: true },
    ];
    const original = structuredClone(value);
    const source = fpreFile([...fpreSection("1", 1, "0002"), ...fpreSection("1", 2, "0003", false), ...fpreSection("1", 3, "0004", false)]);
    const settings = decemberCommand();
    const response = await http(settings, source);
    expect(response.status).toBe(200);
    const { preview } = await response.json() as { preview: ImportSyncPreview };
    expect(preview.canApply).toBe(true);
    expect(preview.impact.people.removed.map(person => person.registration)).toEqual(["0001"]);
    expect(preview.counts).toMatchObject({ removedPeople: 1, removedAbsenceDays: 1 });
    expect(preview.warnings.filter(warning => warning.code === "UNKNOWN_BINDING")).toEqual([
      { code: "UNKNOWN_BINDING", message: expect.stringContaining("Vínculos sem data no cadastro: 2") },
    ]);
    const committed = await http({ ...settings, action: "APPLY_REPLACE", completeScopeConfirmed: true, confirm: true, expectedImpactHash: preview.expectedImpactHash }, source);
    expect(committed.status).toBe(200);
    expect(revision).toBe(2);
    expect(value.assignments).toEqual(original.assignments.filter(day => day.employeeId === "e2"));
    expect(value.employees.find(person => person.id === "e2")?.activeFrom).toBe("2020-01-01");
    expect(value.employees.find(person => person.registration === "0003")?.activeFrom).toBe("");
    expect(value.policy.closedDates).toEqual(original.policy.closedDates);
    expect(audits).toHaveLength(1);
    expect(value.needsRegeneration).toBe(true);
  });
  it.each([
    { employeeId: "e1", date: "2026-12-01", kind: "OFF", locked: true },
    { employeeId: "e1", date: "2026-12-01", kind: "ABSENCE", locked: true },
    { employeeId: "e1", date: "2026-12-01", kind: "ABSENCE", absenceSource: "MANUAL" },
  ] as const)("does not silently remove a protected departure day: %o", async day => {
    value = december();
    value.assignments = [day];
    const source = fpreFile(fpreSection("1", 1, "0002"));
    const settings = decemberCommand();
    const preview = await previewAdminImport(actor, settings, source);
    expect(preview.blockers).toEqual([expect.objectContaining({ code: "PROTECTED_ASSIGNMENT", employeeId: "e1", date: day.date })]);
    await expect(apply(settings, source, preview)).rejects.toMatchObject({ status: 422 });
    expect(value.assignments).toEqual([day]);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("keeps ordinary legacy work for a retained person while refreshing the reference", async () => {
    value = december();
    value.assignments = [{ employeeId: "e2", date: "2026-12-01", kind: "WORK", shiftId: "day" }];
    const previous = structuredClone(value.assignments);
    const rows = fpreSection("1", 1, "0002");
    rows[5][9] = "16:00";
    const result = await apply(decemberCommand(), fpreFile(rows));
    expect(result.summary.impact.references).toHaveLength(1);
    expect(result.workspace.input.assignments).toEqual(previous);
    expect(result.workspace.input.needsRegeneration).toBe(true);
  });
  it("imports eligible FPHI105 days over legacy work without false admission or outside-matricula errors", async () => {
    value = december();
    value.employees[1].activeFrom = "";
    value.assignments = [{ employeeId: "e2", date: "2026-12-03", kind: "WORK", shiftId: "day" }];
    const outside = absenceFile("999", "01/12/2026", "01/12/2026").buffer.toString().split("\n").at(-1);
    const source = absenceFile("0002", "03/12/2026", "05/12/2026", outside);
    const result = await apply({ ...decemberCommand("ABSENCES"), startDate: "2026-12-02" }, source);
    expect(result.summary.blockers).toEqual([]);
    expect(result.summary.warnings).toEqual([]);
    expect(result.summary.counts.addedAbsenceDays).toBe(3);
    expect(value.employees[1].activeFrom).toBe("");
    expect(value.assignments.every(day => day.kind === "ABSENCE")).toBe(true);
  });
  it.each(["lock", "lock on a closure", "manual shift"] as const)("does not replace work protected by %s with FPHI105", async protection => {
    value = december();
    value.assignments = [{ employeeId: "e2", date: "2026-12-03", kind: "WORK", shiftId: "day", locked: protection !== "manual shift" }];
    if (protection === "lock on a closure") value.policy.closedDates = ["2026-12-03"];
    if (protection === "manual shift") value.employees[1].manualShiftOverrides = [{ catalogCode: 1500, shiftId: "day", markings: ["08:00", "12:00", "13:00", "17:24"], effectiveFrom: "2026-12-01", effectiveUntil: "2026-12-05" }];
    const settings = decemberCommand("ABSENCES"), source = absenceFile();
    const preview = await previewAdminImport(actor, settings, source);
    expect(preview.blockers).toEqual([expect.objectContaining({ code: "PROTECTED_ASSIGNMENT", date: "2026-12-03" })]);
    await expect(apply(settings, source, preview)).rejects.toMatchObject({ status: 422 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([false, true])("applies FPHI105 around holiday closures (holiday locked: %s) and preserves existing canonical absences", async locked => {
    value = december();
    value.policy.closedDates = ["2026-12-24", "2026-12-25", "2026-12-26"];
    value.policy.holidayDates = ["2026-12-25"];
    const holiday = { employeeId: "e2", date: "2026-12-25", kind: "HOLIDAY", locked } as const;
    const existing = { employeeId: "e2", date: "2026-12-26", kind: "ABSENCE", locked: true } as const;
    value.assignments = [holiday, existing];
    const result = await apply(decemberCommand("ABSENCES"), absenceFile("0002", "23/12/2026", "27/12/2026"));
    expect(result.summary.warnings).toContainEqual({ code: "SOURCE_WARNING", message: expect.stringContaining("preservados 2 dia(s)") });
    expect(value.assignments).toEqual([
      { employeeId: "e2", date: "2026-12-23", kind: "ABSENCE" }, holiday, existing,
      { employeeId: "e2", date: "2026-12-27", kind: "ABSENCE" },
    ]);
  });
  it("does not remove existing absences if every new FPHI105 day is a closure", async () => {
    value = december();
    value.policy.closedDates = ["2026-12-25"];
    value.assignments = [{ employeeId: "e2", date: "2026-12-20", kind: "ABSENCE" }];
    const settings = decemberCommand("ABSENCES"), source = absenceFile("0002", "25/12/2026", "25/12/2026");
    const preview = await previewAdminImport(actor, settings, source);
    expect(preview.blockers).toEqual([expect.objectContaining({ code: "EMPTY_SOURCE" })]);
    expect(preview.impact.absences.removed).toEqual([]);
    await expect(apply(settings, source, preview)).rejects.toMatchObject({ status: 422 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("shows invalid or unmatched FPHI105 lines once, as blockers and without personal data", async () => {
    value = december();
    const invalid = absenceFile("0002", "32/12/2026").buffer.toString().split("\n").at(-1);
    const source = absenceFile("999", "03/12/2026", "03/12/2026", invalid);
    const preview = await previewAdminImport(actor, decemberCommand("ABSENCES"), source);
    expect(preview.blockers.filter(problem => problem.code === "SOURCE_PARTIAL").map(problem => problem.line)).toEqual([3, 4]);
    expect(preview.warnings).toEqual([]);
    expect(JSON.stringify(preview.blockers)).not.toContain("PRIVATE");
  });
  it.each(["unknown-row", "wrong-period", "outside-binding", "protected", "unmatched"])("blocks unsafe absence source %s", async kind => {
    let source = absenceFile(kind === "unmatched" ? "999" : "0002", "03/12/2026", "03/12/2026", kind === "unknown-row" ? "truncated,record" : "");
    if (kind === "wrong-period") source = file(source.buffer.toString().replace("31/12/2026", "02/12/2026"));
    if (kind === "outside-binding") value.employees[1].activeFrom = "2026-12-04";
    if (kind === "protected") value.assignments = [{ employeeId: "e2", date: "2026-12-03", kind: "HOLIDAY" }];
    const preview = await previewAdminImport(actor, command("ABSENCES"), source); expect(preview.canApply).toBe(false);
    await expect(apply(command("ABSENCES"), source, preview)).rejects.toMatchObject({ status: 422 }); expect(revision).toBe(1);
  });
  it("reports the legacy numeric match without rewriting registration", async () => {
    const result = await apply(command("ABSENCES"), absenceFile("2"));
    expect(result.summary.warnings.some(warning => warning.code === "NUMERIC_REGISTRATION_MATCH")).toBe(true);
    expect(value.employees[1].registration).toBe("0002");
  });
  it("blocks an ambiguous numeric fallback and a report with no recognized absence days", async () => {
    value.employees.push({ ...value.employees[1], id: "numeric", registration: "2", history: [] });
    const ambiguous = await previewAdminImport(actor, command("ABSENCES"), absenceFile("02"));
    expect(ambiguous.canApply).toBe(false); expect(ambiguous.blockers.some(problem => problem.code === "SOURCE_PARTIAL")).toBe(true);
    value = initial();
    const empty = file(absenceFile().buffer.toString().split("\n").slice(0, 2).join("\n"));
    const preview = await previewAdminImport(actor, command("ABSENCES"), empty);
    expect(preview.layout).toBe("FPHI105"); expect(preview.blockers.some(problem => problem.code === "EMPTY_SOURCE")).toBe(true);
    await expect(apply(command("ABSENCES"), empty, preview)).rejects.toMatchObject({ status: 422 }); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("removes only the reviewed ABSENCE delta and retains identical locked absence objects", async () => {
    value.assignments = [{ employeeId: "e2", date: "2026-12-03", kind: "ABSENCE", locked: true }, { employeeId: "e2", date: "2026-12-04", kind: "WORK", shiftId: "day", locked: false }];
    const result = await apply(command("ABSENCES"), absenceFile("0002", "03/12/2026", "04/12/2026"));
    expect(value.assignments[0]).toEqual({ employeeId: "e2", date: "2026-12-03", kind: "ABSENCE", locked: true });
    expect(result.summary.impact.assignments).toMatchObject([{ date: "2026-12-04", previousKind: "WORK", nextKind: "ABSENCE" }]);
    expect(result.summary.counts).toMatchObject({ addedAbsenceDays: 1, unchangedAbsenceDays: 1 });
  });
  it("replaces an open absence with a finite range on reimport without inventing work or changing the employee", async () => {
    value = december();
    const other = { employeeId: "e1", date: "2026-12-31", kind: "WORK", shiftId: "day", locked: true } as const;
    value.assignments = [other];
    const initialSettings = decemberCommand("ABSENCES");
    const opened = await apply(initialSettings, absenceFile("0002", "27/12/2026", ""));
    expect(opened.summary.counts).toMatchObject({ addedAbsenceDays: 5, removedAbsenceDays: 0 });
    const employee = structuredClone(value.employees.find((person) => person.id === "e2"));

    const settings = { ...initialSettings, expectedRevision: revision };
    const updated = absenceFile("0002", "27/12/2026", "29/12/2026");
    const preview = await previewAdminImport(actor, settings, updated);
    expect(preview.impact.absences.removed.map((entry) => entry.date)).toEqual(["2026-12-30", "2026-12-31"]);
    await apply(settings, updated, preview);
    expect(value.assignments.filter((entry) => entry.employeeId === "e2")).toEqual(["2026-12-27", "2026-12-28", "2026-12-29"]
      .map((date) => ({ employeeId: "e2", date, kind: "ABSENCE" })));
    expect(value.assignments).toContainEqual(other);
    expect(value.employees.find((person) => person.id === "e2")).toEqual(employee);
    expect(value.needsRegeneration).toBe(true);
  });
  it("replaces manual absences only within the confirmed FPHI105 scope", async () => {
    value.assignments = [
      { employeeId: "e2", date: "2026-11-30", kind: "ABSENCE", absenceSource: "MANUAL" },
      { employeeId: "e2", date: "2026-12-02", kind: "ABSENCE", absenceSource: "MANUAL" },
      { employeeId: "e2", date: "2026-12-03", kind: "ABSENCE", absenceSource: "MANUAL" },
    ];
    const result = await apply(command("ABSENCES"), absenceFile("0002", "03/12/2026", "03/12/2026"));
    expect(value.assignments).toEqual([
      { employeeId: "e2", date: "2026-11-30", kind: "ABSENCE", absenceSource: "MANUAL" },
      { employeeId: "e2", date: "2026-12-03", kind: "ABSENCE" },
    ]);
    expect(result.summary.counts).toMatchObject({ assignmentChanges: 2, addedAbsenceDays: 0, removedAbsenceDays: 1, unchangedAbsenceDays: 2 });
    expect(result.summary.warnings).toContainEqual({ code: "SOURCE_WARNING", message: expect.stringContaining("confirma 1 dia(s)") });
    expect(result.workspace.input.needsRegeneration).toBe(true);
  });
  it.each(["source-only", "added-day", "removed-day"] as const)("revalidates approval according to the FPHI105 %s delta", async delta => {
    Object.assign(value, { startDate: "2026-12-01", endDate: "2026-12-31", planningWeekStartsOn: "SUNDAY" });
    value.assignments = [{ employeeId: "e2", date: "2026-12-03", kind: "ABSENCE", absenceSource: "MANUAL" }];
    if (delta === "removed-day") value.assignments.push({ employeeId: "e2", date: "2026-12-02", kind: "ABSENCE" });
    approve();
    const settings = command("ABSENCES");
    const source = absenceFile("0002", "03/12/2026", delta === "added-day" ? "04/12/2026" : "03/12/2026");
    const preview = await previewAdminImport(actor, settings, source);
    const invalidate = delta !== "source-only";
    expect(preview.effect).toMatchObject({ approvalInvalidated: invalidate, needsRegeneration: invalidate,
      approvedPolicyVersionIdBefore: "approval", approvedPolicyVersionIdAfter: invalidate ? null : "approval" });
    expect(preview.counts.assignmentChanges).toBe(invalidate ? 2 : 1);
    expect(preview.warnings).toContainEqual({ code: "SOURCE_WARNING", message: expect.stringContaining("confirma 1 dia(s)") });
    const result = await apply(settings, source, preview);
    expect(result.workspace).toMatchObject({ revision: 2, approvedPolicyVersionId: invalidate ? null : "approval" });
    expect(value.assignments[0]).toEqual({ employeeId: "e2", date: "2026-12-03", kind: "ABSENCE" });
    expect(audits).toContainEqual(expect.objectContaining({ metadata: expect.objectContaining({
      approvalInvalidated: invalidate, adminImport: expect.objectContaining({ impactHash: preview.expectedImpactHash }),
    }) }));
  });
  it("does not permit absence removal through ordinary SAVE", async () => {
    value.assignments = [{ employeeId: "e2", date: "2026-12-02", kind: "ABSENCE", locked: true }];
    await expect(saveEscala(actor, "w1", 1, { ...value, assignments: [] })).rejects.toMatchObject({ code: "ESCALA_LOCKED_ASSIGNMENT" }); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each(["work", "outside-scope"])("rejects an internal absence exception targeting %s", async kind => {
    value.assignments = [{ employeeId: "e2", date: "2026-12-02", kind: kind === "work" ? "WORK" : "ABSENCE", ...(kind === "work" ? { shiftId: "day" } : {}), locked: true }];
    const verify = vi.fn();
    await expect(saveEscala(actor, "w1", 1, { ...value, assignments: [] }, false, { adminImport: { removedAbsenceKeys: ["e2\0" + "2026-12-02"], invalidatesApproval: false, verify,
      audit: { purpose: "ABSENCES", fileHash: "a".repeat(64), impactHash: "b".repeat(64), startDate: kind === "work" ? "2026-12-01" : "2026-12-03", endDate: "2026-12-31", addedPeople: 0, removedPeople: 0, addedAbsenceDays: 0, removedAbsenceDays: 1 } } })).rejects.toMatchObject({ code: "ESCALA_IMPORT_INTENT_INVALID" });
    expect(verify).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("strictly rejects forged authority, duplicate metadata and false confirmation through HTTP", async () => {
    const response = await http({ ...command(), tenantId: "other" }); expect(response.status).toBe(400);
    const preview = await previewAdminImport(actor, { ...command(), completeScopeConfirmed: false }, file()); expect(preview.canApply).toBe(false);
    const wrong = await http({ ...command(), workspaceId: "other" }); expect(wrong.status).toBe(404); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects duplicate commands and invalid JSON boolean values instead of coercing them", async () => {
    const body = new FormData(); body.set("command", JSON.stringify(command()));
    body.append("command", JSON.stringify(command())); body.set("file", new File([file().buffer], "source.csv", { type: "text/csv" }));
    expect((await POST(new Request("http://localhost/api/escalas/import", { method: "POST", headers: { origin: "http://localhost" }, body }))).status).toBe(400);
    expect((await http({ ...command(), completeScopeConfirmed: "yes" })).status).toBe(400);
    const unchecked = await http({ ...command(), completeScopeConfirmed: false });
    expect((await unchecked.json()).preview.blockers.some((problem: { code: string }) => problem.code === "COVERAGE_UNCONFIRMED")).toBe(true);
  });
  it.each(["invalid-json", "extra-field", "null", "bare-action"])("rejects %s without falling through to the legacy preview", async kind => {
    const body = new FormData();
    if (kind === "bare-action") body.set("action", "PREVIEW_REPLACE");
    else body.set("command", kind === "invalid-json" ? "{" : kind === "null" ? "null" : JSON.stringify(command()));
    if (kind === "extra-field") body.set("branchCode", "02");
    body.set("file", new File([file().buffer], "source.csv", { type: "text/csv" }));
    const response = await POST(new Request("http://localhost/api/escalas/import", { method: "POST", headers: { origin: "http://localhost" }, body }));
    expect(response.status).toBe(400); expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("blocks shortened technical scope for team replacement and an interval outside the workspace", async () => {
    for (const settings of [{ ...command(), startDate: "2026-12-01", endDate: "2026-12-31" }, { ...command("ABSENCES"), startDate: "2026-11-29" }]) {
      expect((await previewAdminImport(actor, settings, settings.purpose === "EMPLOYEES" ? file() : absenceFile())).blockers.some(problem => problem.code === "SCOPE_MISMATCH")).toBe(true);
    }
  });
  it("preserves proven outside bindings and distinguishes zero-prefixed textual employee registrations", async () => {
    value.employees.push({ ...value.employees[0], id: "outside", registration: "9", activeFrom: "2019-01-01", activeUntil: "2020-12-31", history: [] });
    const source = file([header, employeeRow("0002"), employeeRow("2"), employeeRow("A7")].join("\n"));
    const first = await previewAdminImport(actor, command(), source), second = await previewAdminImport(actor, command(), source);
    expect(first.impact.people.added[0].id).toBe(second.impact.people.added[0].id);
    await apply(command(), source, first);
    expect(value.employees.map(person => person.registration).sort()).toEqual(["0002", "2", "9", "A7"]);
  });
  it("restores a person removed manually and gives a complete import priority over manual team changes", async () => {
    const [kept, removed] = value.employees;
    kept.name = "Edição manual";
    value.employees = [kept, { ...removed, id: "manual-person", registration: "0999", history: [] }];
    const source = file([header, employeeRow(kept.registration, "Nome do arquivo"), employeeRow(removed.registration)].join("\n"));

    const result = await apply(command(), source);
    expect(result.workspace.input.employees).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: kept.id, registration: kept.registration, name: "Nome do arquivo" }),
      expect.objectContaining({ registration: removed.registration }),
    ]));
    expect(result.workspace.input.employees).toHaveLength(2);
    expect(result.summary.impact.people.removed).toEqual([expect.objectContaining({ id: "manual-person" })]);
    expect(mocks.importSeed).toHaveBeenCalledOnce();
  });
  it("rejects lost admin status before reading the file into a candidate", async () => {
    mocks.user.mockResolvedValue({ ...user(), role: "OPERATOR" });
    expect((await http(command())).status).toBe(403); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("imports only after explicit reopening of a publication whose snapshot is preserved", async () => {
    workspaceStatus = "PUBLISHED";
    const published = structuredClone(value);
    for (const purpose of ["EMPLOYEES", "ABSENCES"] as const) {
      await expect(previewAdminImport(actor, command(purpose), file())).rejects.toMatchObject({ code: "ESCALA_REOPEN_REQUIRED" });
      await expect(applyAdminImport(actor, { ...command(purpose), action: "APPLY_REPLACE", completeScopeConfirmed: true, confirm: true, expectedImpactHash: "0".repeat(64) }, file())).rejects.toMatchObject({ code: "ESCALA_REOPEN_REQUIRED" });
    }
    expect(mocks.revision).not.toHaveBeenCalled();
    const draft = await reopenEscalaPublication(actor, "w1", 1);
    expect(draft).toMatchObject({ revision: 2, status: "DRAFT" });
    expect(revisions[0]).toMatchObject({ revision: 2, status: "DRAFT", input: published });
    const target = { ...command(), expectedRevision: 2 };
    const preview = await previewAdminImport(actor, target, file());
    expect(preview.context.status).toBe("DRAFT");
    const result = await apply(target, file(), preview);
    expect(result.workspace).toMatchObject({ status: "DRAFT", revision: 3 });
    expect(revisions[0].input).toEqual(published);
    expect(revisions[1]).toMatchObject({ workspaceId: "w1", tenantId: "tenant", revision: 3, status: "DRAFT" });
    expect(mocks.update.mock.lastCall?.[0].where).toEqual({ id: "w1", tenantId: "tenant", revision: 2 });
  });
  it("detects a revision race at the final transaction before writing", async () => {
    const preview = await previewAdminImport(actor, command(), file()); beforeTransaction = () => { revision = 2; };
    await expect(apply(command(), file(), preview)).rejects.toMatchObject({ status: 409 }); expect(mocks.update).not.toHaveBeenCalled(); expect(revisions).toEqual([]);
  });
});
