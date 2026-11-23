import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const calls = vi.hoisted(() => ({ guard: vi.fn(), limit: vi.fn(), user: vi.fn(), policy: vi.fn(), session: vi.fn(),
  lock: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/escalas/access.server", () => ({ requireEscalaAccess: calls.guard }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: calls.limit }));
vi.mock("@/lib/prisma", () => {
  const db = { $executeRaw: calls.lock, $queryRaw: vi.fn(), user: { findFirst: calls.user }, escalaModuleAccessPolicy: { findUnique: calls.policy },
    escalaModuleSession: { findFirst: calls.session }, escalaWorkforce: { findUnique: calls.find, create: calls.create, updateMany: calls.update },
    auditLog: { create: calls.audit } };
  return { prisma: { ...db, $transaction: (work: (transaction: typeof db) => unknown) => work(db) } };
});

const admin = { tenantId: "t1", userId: "u1", admin: true };
const operator = { tenantId: "t1", userId: null, admin: false, moduleSessionId: "s1" };
const origin = "http://localhost";
const url = `${origin}/api/escalas/workforce`;
const fpre = (secondRegistration = "0008") => [
  '"0001","-","Empresa sintética","Pág.:","1"', '"Quadro de Horários"', '"","Nome","Cargo","Horário"',
  '"02.01 , FILIAL, SETOR"', '"Horário:","0026","-","Diurno"',
  '"0007","-","Pessoa A","Operador","08:00","-","12:00","13:00","-","17:24"', '"Sábado:","08:00","-","12:00","13:00","-","17:24"',
  '"03.01 , FILIAL, SETOR"', '"Horário:","0027","-","Diurno"',
  `"${secondRegistration}","-","Pessoa B","Operador","00:00","-","00:00","00:00","-","00:00"`, '"Sábado:","00:00","-","00:00","00:00","-","00:00"',
].join("\r\n");

function upload(command: object, file = fpre()) {
  const body = new FormData();
  body.set("file", new File([file], "equipe.csv", { type: "text/csv" }));
  body.set("command", JSON.stringify(command));
  return new Request(url, { method: "POST", headers: { origin }, body });
}

function manual(command: object) {
  return new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(command) });
}

beforeEach(() => {
  vi.resetAllMocks();
  calls.guard.mockResolvedValue({ ok: true, actor: admin });
  calls.limit.mockResolvedValue(null);
  calls.user.mockResolvedValue({ id: "u1", tenantId: "t1", status: "ACTIVE", role: "ADMIN", securityVersion: 1 });
  calls.policy.mockResolvedValue({ tenantId: "t1", mode: "SCOPED", version: 1 });
  calls.session.mockResolvedValue({ id: "s1", tenantId: "t1", operatorId: "o", permissionVersion: 1, accessPolicyVersion: 1,
    createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60_000), revokedAt: null,
    operator: { id: "o", tenantId: "t1", active: true, permissionVersion: 1,
      branchGrants: [{ tenantId: "t1", operatorId: "o", branchCode: "02", active: true, capabilities: ["employee.manage"] }] } });
  calls.find.mockResolvedValue(null);
  calls.create.mockImplementation(async ({ data }) => { calls.find.mockResolvedValue(data); return data; });
  calls.update.mockImplementation(async ({ data }) => { calls.find.mockResolvedValue(data); return { count: 1 }; });
});

describe("base global de Escalas por HTTP", () => {
  it("reads revision zero before initialization, only for the operator's branch", async () => {
    calls.guard.mockResolvedValue({ ok: true, actor: operator });
    const response = await GET(new Request(`${url}?branchCode=02`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 0, people: [], catalogs: [], absences: [] });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await GET(new Request(`${url}?branchCode=03`))).status).toBe(403);
    expect(calls.find).toHaveBeenCalledTimes(1);
    expect(calls.create).not.toHaveBeenCalled();
  });

  it("confirms administrator preview at revision zero, preserves unknown admission and no-ops on reimport", async () => {
    const command = { action: "IMPORT_PREVIEW", purpose: "EMPLOYEES" };
    const previewResponse = await POST(upload(command));
    expect(previewResponse.status).toBe(200);
    const { preview } = await previewResponse.json();
    expect(preview).toMatchObject({ revision: 0, branchCodes: ["02", "03"], rowCount: 2, canApply: true, changed: true });
    expect(calls.create).not.toHaveBeenCalled();
    const apply = { ...command, action: "IMPORT_APPLY", expectedRevision: 0, impactHash: preview.impactHash };
    expect((await POST(upload(apply, fpre("0009")))).status).toBe(409);
    const applied = await POST(upload(apply));
    expect(applied.status).toBe(200);
    expect(await applied.json()).toEqual({ revision: 1, changed: true });
    expect(calls.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({ tenantId: "t1", revision: 1,
      snapshot: expect.objectContaining({ people: expect.arrayContaining([expect.objectContaining({ branchCode: "03",
        employee: expect.objectContaining({ activeFrom: "", registration: "0008", shiftIds: [], scheduleMode: "UNTIMED" }) })]) }) }) });
    const repeated = await (await POST(upload(command))).json();
    expect(repeated.preview).toMatchObject({ revision: 1, canApply: true, changed: false });
    const same = await POST(upload({ ...apply, expectedRevision: 1, impactHash: repeated.preview.impactHash }));
    expect(await same.json()).toEqual({ revision: 1, changed: false });
    expect(calls.update).not.toHaveBeenCalled();
  });

  it("requests missing registrations before creating the base and denies import by nominal operators", async () => {
    const command = { action: "IMPORT_PREVIEW", purpose: "EMPLOYEES" };
    const response = await POST(upload(command, fpre("")));
    expect(response.status).toBe(200);
    const { preview } = await response.json();
    expect(preview).toMatchObject({ canApply: false, missingRegistrations: [{ line: 10, branchCode: "03", resolved: false }] });
    const apply = { ...command, action: "IMPORT_APPLY", expectedRevision: 0, impactHash: preview.impactHash };
    expect((await POST(upload(apply, fpre("")))).status).toBe(422);
    expect(calls.create).not.toHaveBeenCalled();
    const corrected = { ...command, registrationCorrections: [{ line: 10, registration: "0008" }] };
    const { preview: fixed } = await (await POST(upload(corrected, fpre("")))).json();
    expect(fixed).toMatchObject({ canApply: true, missingRegistrations: [{ line: 10, branchCode: "03", resolved: true }] });
    calls.guard.mockResolvedValue({ ok: true, actor: operator });
    expect((await POST(upload(corrected, fpre("")))).status).toBe(403);
    expect(calls.create).not.toHaveBeenCalled();
  });

  it("allows manual registration only inside the assigned branch and does not create a second identity", async () => {
    const command = { action: "IMPORT_PREVIEW", purpose: "EMPLOYEES" };
    const { preview } = await (await POST(upload(command))).json();
    expect((await POST(upload({ ...command, action: "IMPORT_APPLY", expectedRevision: 0, impactHash: preview.impactHash }))).status).toBe(200);
    calls.guard.mockResolvedValue({ ok: true, actor: operator });
    const person = { action: "CREATE_PERSON", expectedRevision: 1, registration: "0010", name: "Pessoa C", sector: "Caixa",
      role: "Operador", activeFrom: "2026-12-01", branchCode: "02" };
    expect((await POST(manual({ ...person, branchCode: "03" }))).status).toBe(403);
    expect((await POST(manual({ ...person, registration: "7" }))).status).toBe(409);
    const created = await POST(manual(person));
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ revision: 2, changed: true });
    expect((await POST(manual({ ...person, action: "UPDATE_PERSON", newRegistration: "0011" }))).status).toBe(422);
    expect(calls.update).toHaveBeenCalledTimes(1);
  });

  it("imports an open FPHI105 event only after team confirmation and permits a branch operator to record the return", async () => {
    const absenceCsv = ["0001,Empresa sintética,Pág.:,1,FPHI105", "Período :,01/12/2026,a,31/12/2026",
      '"02.01 , FILIAL, SETOR"', "Empresa,Tipo,Cadastro,Nome,Função,Admissão,Afastamento,CID,Situação,Término,Dias",
      '"0001","1","0007","Pessoa A","Operador","01/12/2026","09/12/2026","","","2","Férias","","999"'].join("\r\n");
    const absence = { action: "IMPORT_PREVIEW", purpose: "ABSENCES" };
    expect((await POST(upload(absence, absenceCsv))).status).toBe(409);
    expect(calls.create).not.toHaveBeenCalled();
    const team = { action: "IMPORT_PREVIEW", purpose: "EMPLOYEES" };
    const { preview } = await (await POST(upload(team))).json();
    expect((await POST(upload({ ...team, action: "IMPORT_APPLY", expectedRevision: 0, impactHash: preview.impactHash }))).status).toBe(200);
    const reportPreview = await POST(upload(absence, absenceCsv));
    expect(reportPreview.status).toBe(200);
    const { preview: events } = await reportPreview.json();
    expect(events).toMatchObject({ revision: 1, openRowCount: 1, rowCount: 1 });
    expect((await POST(upload({ ...absence, action: "IMPORT_APPLY", expectedRevision: 1, impactHash: events.impactHash }, absenceCsv))).status).toBe(200);
    calls.guard.mockResolvedValue({ ok: true, actor: operator });
    const ownBranch = () => GET(new Request(`${url}?branchCode=02`));
    expect((await (await ownBranch()).json()).absences).toMatchObject([{ registration: "0007", startDate: "2026-12-09", endDate: null }]);
    const returned = await POST(manual({ action: "SET_RETURN_DATE", branchCode: "02", registration: "0007", expectedRevision: 2,
      startDate: "2026-12-09", returnDate: "2026-12-12" }));
    expect(returned.status).toBe(200);
    expect((await (await ownBranch()).json()).absences).toMatchObject([{ registration: "0007", startDate: "2026-12-09", endDate: "2026-12-11" }]);
  });
});
