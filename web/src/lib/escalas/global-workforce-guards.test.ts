import type { Prisma } from "@/generated/prisma/client";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { describe, expect, it, vi } from "vitest";
import { checkWorkforceWrite, workforceDraftInfo } from "./global-workforce-binding";
import { escalaWorkforceSnapshotSchema } from "./global-workforce-domain";
import { assertTransferredWorkDoesNotOverlap } from "./global-workforce-publication";
import { editDraftAbsences } from "./manual-absence";
import type { EscalaAssignment, EscalaInput } from "./types";

const person = { ...newEmployee(42), id: "sintetico", registration: "0042", name: "Pessoa sintética", sector: "Caixa",
  role: "Operador", activeFrom: "2026-12-01" };
const absence = (day: number, manual = false): EscalaAssignment => ({
  employeeId: person.id, date: `2026-12-${String(day).padStart(2, "0")}`, kind: "ABSENCE", ...(manual ? { absenceSource: "MANUAL" } : {}),
});
const date = "2026-12-05";
function fixture() {
  const input: EscalaInput = { ...newInput("07", "Destino sintético", "2026-12", 42), employees: [person],
    assignments: [absence(3, true), absence(4), absence(5, true), { ...absence(6, true), locked: true }] };
  const snapshot = escalaWorkforceSnapshotSchema.parse({
    version: 1, people: [{ branchCode: "07", employee: person, dismissedFrom: null, previousBranchCodes: ["06"] }],
    catalogs: [{ branchCode: "07", shifts: [] }, { branchCode: "06", shifts: [] }],
    absences: [{ registration: person.registration, startDate: "2026-12-03", endDate: "2026-12-04", source: "FPHI105" }],
  });
  const state = { baseRevision: 2, managedAbsenceKeys: [[person.id, "2026-12-04"]], managedEmploymentEnds: [] };
  const base = { revision: 2, snapshot };
  const findMany = vi.fn(async (_arg: unknown): Promise<unknown[]> => []);
  const tx = { escalaWorkforce: { findUnique: async () => base },
    escalaWorkspace: { findFirst: async () => ({ workforceState: state }), findMany } } as unknown as Prisma.TransactionClient;
  return { tx, findMany, base, input, state, draft: { id: "plano", revision: 3, input, status: "DRAFT" as const } };
}

describe("ajustes antigos com base global ativa", () => {
  it("permite corrigir só o dia manual fora da base após o retorno, sem remover a base ou desbloquear dias", async () => {
    const { tx, input, state, draft, base } = fixture();
    await expect(workforceDraftInfo(tx, "empresa", input, state)).resolves.toEqual({
      needsSync: false, legacyAbsenceDays: [[person.id, date]],
    });
    const command = { action: "REMOVE_ABSENCE" as const, employeeId: person.id, startDate: date, endDate: date };
    const next = editDraftAbsences(input, command, false).input;
    await expect(checkWorkforceWrite(tx, "empresa", draft, next, { absenceCommand: command })).resolves.toMatchObject(base);
    expect(next.assignments).toEqual([absence(3, true), absence(4), { ...absence(6, true), locked: true }]);

    const range = { ...command, startDate: "2026-12-03" };
    await expect(checkWorkforceWrite(tx, "empresa", draft, editDraftAbsences(input, range, true).input, { absenceCommand: range }))
      .rejects.toMatchObject({ code: "ESCALA_WORKFORCE_MANAGED" });
    await expect(checkWorkforceWrite(tx, "empresa", draft, next)).rejects.toMatchObject({ code: "ESCALA_WORKFORCE_MANAGED" });
  });
});

describe("continuidade de uma transferência entre filiais", () => {
  it("recusa sobreposição na origem publicada mesmo sem histórico de transferência na primeira importação", async () => {
    const { tx, input, base, findMany } = fixture();
    delete base.snapshot.people[0].previousBranchCodes;
    const shift = { id: "turno", name: "Turno sintético", segments: [{ start: 1320, end: 1560, kind: "WORK" as const }] };
    const draft = { ...input, assignments: [{ employeeId: person.id, date, kind: "DUTY" as const }] };
    const oldId = "outra-revisao";
    const published: EscalaInput = { ...input, branchCode: "06", branchName: "Origem sintética", shifts: [shift],
      employees: [{ ...person, id: oldId, shiftIds: [shift.id] }],
      assignments: [{ employeeId: oldId, date: "2026-12-04", kind: "WORK", shiftId: shift.id }] };
    findMany.mockResolvedValue([{ branchCode: "06", revisions: [{ input: published }] }]);
    await expect(assertTransferredWorkDoesNotOverlap(tx, "empresa", draft, base.snapshot))
      .rejects.toMatchObject({ code: "ESCALA_TRANSFER_PUBLISHED_OVERLAP", message: expect.stringContaining(date) });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: "empresa", branchCode: { not: "07" } }),
    }));
    const later = { ...draft, assignments: [{ ...draft.assignments[0], date: "2026-12-06" }] };
    await expect(assertTransferredWorkDoesNotOverlap(tx, "empresa", later, base.snapshot)).resolves.toBeUndefined();
  });
});
