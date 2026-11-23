import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalaActor } from "./access";
import { type EscalaWorkforceSnapshot, projectEscalaWorkforceDraft } from "./global-workforce-domain";
import { editEscalaWorkforce, importEscalaWorkforce, readEscalaWorkforceBranch } from "./global-workforce-service";

const db = vi.hoisted(() => ({
  execute: vi.fn(), query: vi.fn(), policy: vi.fn(), session: vi.fn(), user: vi.fn(),
  find: vi.fn(), update: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $executeRaw: db.execute,
    $queryRaw: db.query,
    escalaModuleAccessPolicy: { findUnique: db.policy },
    escalaModuleSession: { findFirst: db.session },
    user: { findFirst: db.user },
    escalaWorkforce: { findUnique: db.find, updateMany: db.update },
    auditLog: { create: db.audit },
  };
  return { prisma: { $transaction: async <T>(work: (transaction: typeof tx) => Promise<T>) => work(tx) } };
});

const operator: EscalaActor = { tenantId: "empresa", userId: null, admin: false, moduleSessionId: "sessao" };
const admin: EscalaActor = { tenantId: "empresa", userId: "admin", admin: true };
const target = { branchCode: "002", registration: "0007", expectedRevision: 3 };
const startDate = "2026-12-09";

function fixture(): EscalaWorkforceSnapshot {
  const employee: EscalaWorkforceSnapshot["people"][number]["employee"] = {
    id: "pessoa-a", registration: "0007", name: "Pessoa A", role: "Atendente", sector: "Caixa",
    weeklyHours: 40, shiftIds: [], activeFrom: "2026-12-01", offMode: "VARIABLE",
    fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [], historyKnown: false, history: [],
  };
  return {
    version: 1,
    people: [
      { branchCode: "02", employee, dismissedFrom: null },
      { branchCode: "03", employee: { ...employee, registration: "0008", id: "pessoa-b", name: "Pessoa B" }, dismissedFrom: null },
    ],
    catalogs: [{ branchCode: "02", shifts: [] }, { branchCode: "03", shifts: [] }],
    absences: [
      { registration: "0007", startDate, endDate: null, source: "FPHI105" },
      { registration: "0008", startDate, endDate: null, source: "MANUAL" },
    ],
  };
}

function session() {
  return {
    id: "sessao", tenantId: "empresa", operatorId: "operador", permissionVersion: 1, accessPolicyVersion: 1,
    createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60_000), revokedAt: null,
    operator: { id: "operador", tenantId: "empresa", active: true, permissionVersion: 1,
      branchGrants: [{ tenantId: "empresa", operatorId: "operador", branchCode: "02", active: true, capabilities: ["employee.manage"] }] },
  };
}

function changes(): { revision: number; snapshot: EscalaWorkforceSnapshot } {
  return db.update.mock.lastCall?.[0].data;
}

function report(endDate = "11/12/2026", branchCode = "02") {
  return Buffer.from([
    "0001,Empresa sintética,Pág.:,1,FPHI105",
    "Período :,01/12/2026,a,31/12/2026",
    `"${branchCode}.01 , FILIAL SINTÉTICA, SETOR SINTÉTICO"`,
    "Empresa,Tipo,Cadastro,Nome,Função,Admissão,Afastamento,CID,Situação,Término,Dias",
    ["0001", "1", "0007", "Pessoa sintética", "Operador", "01/12/2026", "09/12/2026", "CODIGO-MEDICO-SINTETICO",
      "DESCRICAO-MEDICA-SINTETICA", "2", "Férias", endDate, "999"].map((value) => JSON.stringify(value)).join(","),
  ].join("\r\n"));
}

function transferReport() {
  const rows = [["0001", "-", "Empresa sintética", "Pág.:", "1"], ["Quadro de Horários"], ["", "Nome", "Cargo", "Horário"],
    ...[{ branch: "02", registrations: ["0010"] }, { branch: "03", registrations: ["0007", "0008"] }].flatMap(({ branch, registrations }) => [
      [`${branch}.01 , FILIAL SINTÉTICA, CAIXA`], ["Horário:", "0026", "-", "Diurno"],
      ...registrations.flatMap(registration => [[registration, "-", "Pessoa sintética", "Operador", "08:00", "-", "12:00", "13:00", "-", "17:24"],
        ["Sábado:", "08:00", "-", "12:00", "13:00", "-", "17:24"]]),
    ])];
  return Buffer.from(rows.map(row => row.map(value => JSON.stringify(value)).join(",")).join("\r\n"));
}

async function previewEscalaWorkforceFphi105(actor: EscalaActor, file: Buffer) {
  const result = await importEscalaWorkforce(actor, { action: "IMPORT_PREVIEW", purpose: "ABSENCES" }, file);
  if (!("preview" in result) || !result.preview) throw new Error("Prévia não retornada");
  return result.preview;
}

const confirmEscalaWorkforceFphi105 = (actor: EscalaActor, file: Buffer, command: { expectedRevision: number; impactHash: string }) =>
  importEscalaWorkforce(actor, { ...command, action: "IMPORT_APPLY", purpose: "ABSENCES" }, file);

beforeEach(() => {
  vi.resetAllMocks();
  delete admin.accountSecurityVersion;
  db.policy.mockResolvedValue({ tenantId: "empresa", mode: "SCOPED", version: 1 });
  db.session.mockResolvedValue(session());
  db.user.mockResolvedValue({ id: "admin", tenantId: "empresa", status: "ACTIVE", role: "ADMIN", securityVersion: 1 });
  db.find.mockResolvedValue({ revision: 3, snapshot: fixture() });
  db.update.mockResolvedValue({ count: 1 });
});

describe("serviço interno da base global de Escalas", () => {
  it("autoriza a leitura nominal e não devolve pessoas, turnos ou ausências de outra filial", async () => {
    const result = await readEscalaWorkforceBranch(operator, "2");
    expect(result.revision).toBe(3);
    expect(result.people.map((person) => person.employee.registration)).toEqual(["0007"]);
    expect(result.catalogs.map((catalog) => catalog.branchCode)).toEqual(["02"]);
    expect(result.absences.map((absence) => absence.registration)).toEqual(["0007"]);
    expect(db.find).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "empresa" } }));
    expect(db.update).not.toHaveBeenCalled();
  });

  it("altera apenas campos cadastrais admitidos e audita sem registrar os dados da pessoa", async () => {
    await expect(editEscalaWorkforce(operator, { ...target, action: "UPDATE_PERSON", name: "Nome atualizado" }))
      .resolves.toEqual({ revision: 4, changed: true });
    expect(db.execute.mock.invocationCallOrder[0]).toBeLessThan(db.session.mock.invocationCallOrder[0]);
    expect(db.session.mock.invocationCallOrder[0]).toBeLessThan(db.update.mock.invocationCallOrder[0]);
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "empresa", revision: 3 } }));
    expect(changes().snapshot.people[0].employee).toEqual({ ...fixture().people[0].employee, name: "Nome atualizado" });
    expect(changes().snapshot.people[1]).toEqual(fixture().people[1]);
    expect(db.audit).toHaveBeenCalledExactlyOnceWith({ data: {
      userId: null, action: "UPDATE_PERSON", entity: "EscalaWorkforce", entityId: "empresa",
      metadata: { accessChannel: "ESCALAS_USERNAME_ONLY", moduleSessionId: "sessao", branchCode: "02", previousRevision: 3, revision: 4 },
    } });
  });

  it("permite ao administrador editar pessoa de outra filial, mas não permite ao operador", async () => {
    const other = { ...target, branchCode: "03", registration: "0008", action: "UPDATE_PERSON", role: "Caixa" };
    await expect(readEscalaWorkforceBranch(operator, "03")).rejects.toMatchObject({ status: 403 });
    await expect(editEscalaWorkforce(operator, other)).rejects.toMatchObject({ status: 403 });
    expect(db.find).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    await expect(editEscalaWorkforce(admin, other)).resolves.toEqual({ revision: 4, changed: true });
    expect(changes().snapshot.people[1].employee.role).toBe("Caixa");
  });

  it("não permite usar a concessão para alcançar matrícula vinculada à outra filial", async () => {
    await expect(editEscalaWorkforce(operator, { ...target, registration: "0008", action: "DISMISS_PERSON", dismissedFrom: "2026-12-20" }))
      .rejects.toMatchObject({ status: 404, code: "ESCALA_WORKFORCE_PERSON_NOT_FOUND" });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.audit).not.toHaveBeenCalled();
  });

  it("revalida a concessão da sessão antes de acessar a base", async () => {
    db.session.mockResolvedValueOnce({ ...session(), revokedAt: new Date() });
    await expect(editEscalaWorkforce(operator, { ...target, action: "UPDATE_PERSON", name: "Outro nome" }))
      .rejects.toMatchObject({ status: 401 });
    expect(db.find).not.toHaveBeenCalled();
  });

  it("recusa revisão antiga e não audita uma escrita perdida na comparação atômica", async () => {
    const action = { ...target, action: "UPDATE_PERSON", name: "Outro nome" };
    await expect(editEscalaWorkforce(operator, { ...action, expectedRevision: 2 }))
      .rejects.toMatchObject({ status: 409, code: "ESCALA_WORKFORCE_STALE" });
    expect(db.update).not.toHaveBeenCalled();
    db.update.mockResolvedValueOnce({ count: 0 });
    await expect(editEscalaWorkforce(operator, action))
      .rejects.toMatchObject({ status: 409, code: "ESCALA_WORKFORCE_STALE" });
    expect(db.audit).not.toHaveBeenCalled();
  });

  it("não atualiza a revisão nem cria auditoria em edição idêntica", async () => {
    await expect(editEscalaWorkforce(operator, { ...target, action: "UPDATE_PERSON", name: "Pessoa A" }))
      .resolves.toEqual({ revision: 3, changed: false });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.audit).not.toHaveBeenCalled();
  });

  it("permite fechar manualmente afastamento importado, com retorno no primeiro dia disponível", async () => {
    await expect(editEscalaWorkforce(operator, { ...target, action: "SET_RETURN_DATE", startDate, returnDate: "2026-12-12" }))
      .resolves.toEqual({ revision: 4, changed: true });
    expect(changes().snapshot.absences).toEqual([
      { registration: "0007", startDate, endDate: "2026-12-11", source: "MANUAL" },
      fixture().absences[1],
    ]);
    expect(changes().snapshot.people).toEqual(fixture().people);
  });

  it("marca desligamento como primeiro dia inativo sem alterar a matrícula ou apagar afastamentos", async () => {
    await expect(editEscalaWorkforce(operator, { ...target, action: "DISMISS_PERSON", dismissedFrom: "2026-12-21" }))
      .resolves.toEqual({ revision: 4, changed: true });
    expect(changes().snapshot.people[0]).toEqual({ ...fixture().people[0], dismissedFrom: "2026-12-21" });
    expect(changes().snapshot.absences).toEqual(fixture().absences);
  });

  it("altera as datas de um afastamento sem duplicá-lo e mantém o término inclusivo", async () => {
    await expect(editEscalaWorkforce(operator, { ...target, action: "SET_ABSENCE", previousStartDate: startDate,
      startDate: "2026-12-10", endDate: "2026-12-12" })).resolves.toEqual({ revision: 4, changed: true });
    expect(changes().snapshot.absences).toEqual([
      { registration: "0007", startDate: "2026-12-10", endDate: "2026-12-12", source: "MANUAL" },
      fixture().absences[1],
    ]);
  });

  it("recusa tentativa de alterar matrícula, filial ou jornada por campos extras", async () => {
    await expect(editEscalaWorkforce(operator, { ...target, action: "UPDATE_PERSON", newRegistration: "0009", weeklyHours: 42 }))
      .rejects.toMatchObject({ status: 422, code: "ESCALA_WORKFORCE_INVALID_COMMAND" });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("exige administrador no FPHI105 mesmo com concessão nominal forjada", async () => {
    const nominal = session();
    nominal.operator.branchGrants[0].capabilities.push("import.manage");
    db.session.mockResolvedValue(nominal);
    await expect(previewEscalaWorkforceFphi105(operator, report())).rejects.toMatchObject({ status: 403 });
    await expect(confirmEscalaWorkforceFphi105(operator, report(), { expectedRevision: 3, impactHash: "a".repeat(64) }))
      .rejects.toMatchObject({ status: 403 });
    expect(db.find).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("confirma uma prévia FPHI105, fecha o mesmo evento e preserva o registro ausente do relatório", async () => {
    const file = report();
    const preview = await previewEscalaWorkforceFphi105(admin, file);
    expect(preview).toEqual({ revision: 3, impactHash: expect.stringMatching(/^[a-f\d]{64}$/), rowCount: 1, openRowCount: 0, changed: true, canApply: true });
    expect(db.update).not.toHaveBeenCalled();
    await expect(confirmEscalaWorkforceFphi105(admin, file, { expectedRevision: preview.revision, impactHash: preview.impactHash }))
      .resolves.toEqual({ revision: 4, changed: true });
    expect(changes().snapshot.absences).toEqual([
      { registration: "0007", startDate, endDate: "2026-12-11", source: "FPHI105" },
      fixture().absences[1],
    ]);
    expect(db.audit).toHaveBeenCalledExactlyOnceWith({ data: {
      userId: "admin", action: "IMPORT_FPHI105", entity: "EscalaWorkforce", entityId: "empresa",
      metadata: { rowCount: 1, previousRevision: 3, revision: 4 },
    } });
  });

  it("recusa a confirmação com outro arquivo ou revisão e não grava", async () => {
    const preview = await previewEscalaWorkforceFphi105(admin, report());
    const confirmation = { expectedRevision: preview.revision, impactHash: preview.impactHash };
    await expect(confirmEscalaWorkforceFphi105(admin, report("12/12/2026"), confirmation))
      .rejects.toMatchObject({ status: 409, code: "ESCALA_WORKFORCE_PREVIEW_CHANGED" });
    await expect(confirmEscalaWorkforceFphi105(admin, report(), { ...confirmation, expectedRevision: 2 }))
      .rejects.toMatchObject({ status: 409, code: "ESCALA_WORKFORCE_STALE" });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.audit).not.toHaveBeenCalled();
  });

  it("recusa relatório incompleto ou conflitante com a filial da matrícula", async () => {
    await expect(previewEscalaWorkforceFphi105(admin, Buffer.concat([report(), Buffer.from("\r\n0001,1,0008")])))
      .rejects.toMatchObject({ status: 422, code: "ESCALA_WORKFORCE_UNREVIEWABLE_IMPORT" });
    await expect(previewEscalaWorkforceFphi105(admin, report("", "03")))
      .rejects.toMatchObject({ status: 422, code: "ESCALA_WORKFORCE_AMBIGUOUS_REGISTRATION" });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("fecha pela filial anterior o mesmo afastamento após transferência confirmada e projeta o retorno apenas no destino", async () => {
    const file = transferReport();
    const preview = await importEscalaWorkforce(admin, { action: "IMPORT_PREVIEW", purpose: "EMPLOYEES" }, file);
    if (!("preview" in preview) || !preview.preview) throw new Error("Prévia de transferência ausente");
    await expect(importEscalaWorkforce(admin, { action: "IMPORT_APPLY", purpose: "EMPLOYEES",
      expectedRevision: 3, impactHash: preview.preview.impactHash }, file)).resolves.toEqual({ revision: 4, changed: true });
    const transferred = changes();
    expect(transferred.snapshot.people.find(person => person.employee.registration === "0007")).toMatchObject({
      branchCode: "03", previousBranchCodes: ["02"], employee: { id: "pessoa-a", activeFrom: "2026-12-01" },
    });
    db.find.mockResolvedValue(transferred);
    const returned = await previewEscalaWorkforceFphi105(admin, report());
    await expect(confirmEscalaWorkforceFphi105(admin, report(), { expectedRevision: 4, impactHash: returned.impactHash }))
      .resolves.toEqual({ revision: 5, changed: true });
    const final = changes();
    const origin = projectEscalaWorkforceDraft(final.snapshot, "02", "2026-12-01", "2026-12-31");
    const destination = projectEscalaWorkforceDraft(final.snapshot, "03", "2026-12-01", "2026-12-31");
    expect(origin.employees.map(person => person.registration)).toEqual(["0010"]);
    expect(origin.absenceDates.has("0007")).toBe(false);
    expect(destination.absenceDates.get("0007")).toEqual(new Set(["2026-12-09", "2026-12-10", "2026-12-11"]));
    db.find.mockResolvedValue(final);
    const snapshot = await readEscalaWorkforceBranch(admin, "03");
    expect(snapshot.people.find(person => person.employee.registration === "0007")).not.toHaveProperty("previousBranchCodes");
    expect(await previewEscalaWorkforceFphi105(admin, report())).toMatchObject({ changed: false });
  });

  it("não aceita nova ausência, filial desconhecida ou duas filiais para o mesmo evento", async () => {
    const snapshot = fixture();
    snapshot.people[0].branchCode = "03";
    snapshot.people[0].previousBranchCodes = ["02"];
    db.find.mockResolvedValue({ revision: 4, snapshot });
    const unknownEvent = Buffer.from(report().toString().replace("09/12/2026", "10/12/2026"));
    const [, , section, header, row] = report("11/12/2026", "03").toString().split("\r\n");
    const ambiguous = Buffer.concat([report(), Buffer.from(`\r\n${section}\r\n${header}\r\n${row}`)]);
    for (const bad of [unknownEvent, report("11/12/2026", "04"), report(""), ambiguous]) {
      await expect(previewEscalaWorkforceFphi105(admin, bad)).rejects.toMatchObject({ status: 422, code: "ESCALA_WORKFORCE_AMBIGUOUS_REGISTRATION" });
    }
    expect(db.update).not.toHaveBeenCalled();
  });

  it("não grava a reimportação idêntica nem muda uma data de retorno por ausência dessa data no relatório", async () => {
    const snapshot = fixture();
    snapshot.absences[0].endDate = "2026-12-11";
    snapshot.absences[0].source = "MANUAL";
    db.find.mockResolvedValue({ revision: 3, snapshot });
    for (const file of [report(), report("")]) {
      const preview = await previewEscalaWorkforceFphi105(admin, file);
      expect(preview.changed).toBe(false);
      await expect(confirmEscalaWorkforceFphi105(admin, file, { expectedRevision: preview.revision, impactHash: preview.impactHash }))
        .resolves.toEqual({ revision: 3, changed: false });
    }
    expect(db.update).not.toHaveBeenCalled();
    expect(db.audit).not.toHaveBeenCalled();
  });
});
