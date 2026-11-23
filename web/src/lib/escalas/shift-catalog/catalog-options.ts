import { prisma } from "@/lib/prisma";
import { getEscala } from "../service";
import { requireEscalaCapability, type EscalaActor } from "../access";
import { loadEscalaApproval } from "../approved-policy-service";
import { approvedShiftIdsForEmployee } from "../approved-policy";
import { stableEscalaJson } from "../operational-input-policy";
import { EscalaError } from "../errors";
import { canAssignCatalogShift } from "./reference-choices";
import { clockMinutes, markingKey, markingsFromShift, minutesClock } from "./domain";
import { turnoCatalogOptionsSchema, type TurnoCatalogOptionsRequest, type TurnoCatalogOptionsDto } from "./flow-contracts";
import type { TurnoCatalogEntryDto } from "./contracts";

async function eligibleContext(actor: EscalaActor, request: TurnoCatalogOptionsRequest) {
  const workspace = await getEscala(actor, request.workspaceId);
  await requireEscalaCapability(actor, "shift.manage", workspace.input.branchCode);
  if (workspace.revision !== request.expectedRevision) throw new EscalaError(409, "TURNO_REVISION_CONFLICT", "O planejamento mudou. Atualize as opções.");
  if (workspace.status !== "DRAFT") throw new EscalaError(409, "TURNO_PUBLISHED_IMMUTABLE", "Abra uma proposta em rascunho para atribuir turnos.");
  const employee = workspace.input.employees.find(person => person.id === request.employeeId);
  if (!employee) throw new EscalaError(404, "TURNO_EMPLOYEE_NOT_FOUND", "O colaborador não pertence a esta revisão.");
  if (request.effectiveFrom < workspace.input.startDate || request.effectiveUntil > workspace.input.endDate
    || request.effectiveFrom < employee.activeFrom || (employee.activeUntil && request.effectiveUntil > employee.activeUntil)) {
    throw new EscalaError(400, "TURNO_DATES_OUTSIDE_PLAN", "Confira o período do planejamento e o vínculo da pessoa.");
  }
  let permitted: Set<string> | null = null;
  if (!actor.admin) {
    if (!workspace.approvedPolicyVersionId) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "Solicite a aprovação administrativa deste período.");
    const approval = await loadEscalaApproval(actor, workspace.approvedPolicyVersionId, undefined, workspace.input);
    const ids = approvedShiftIdsForEmployee(approval.snapshot, employee);
    permitted = new Set(approval.snapshot.seed.shifts.flatMap(shift => {
      const result = markingsFromShift(shift);
      return ids.has(shift.id) && result.ok ? [markingKey(result.markings)] : [];
    }));
  }
  if (!canAssignCatalogShift(employee)) permitted = new Set();
  return { workspace, permitted };
}

export async function listTurnoCatalogOptions(actor: EscalaActor, value: TurnoCatalogOptionsRequest): Promise<TurnoCatalogOptionsDto> {
  const parsed = turnoCatalogOptionsSchema.safeParse(value);
  if (!parsed.success) throw new EscalaError(400, "TURNO_INVALID_OPTIONS", "Confira pessoa, revisão, datas e paginação.");
  const request = parsed.data, initial = await eligibleContext(actor, request);
  const tuples = initial.permitted === null ? null : [...initial.permitted].map(key => {
    const [firstIn, firstOut, secondIn, secondOut] = key.split("|").map(value => clockMinutes(value) as number);
    return { firstIn, firstOut, secondIn, secondOut };
  });
  const search = request.search.toLocaleLowerCase("pt-BR");
  // Filtering before paging avoids presenting a global page as a contextual result.
  const entries: TurnoCatalogEntryDto[] = [];
  let cursor = request.cursor;
  if (tuples === null || tuples.length) {
    while (entries.length <= request.limit) {
      const rows = await prisma.shiftCatalogEntry.findMany({ where: { tenantId: actor.tenantId, code: { gt: cursor },
        ...(tuples ? { OR: tuples } : {}) }, orderBy: { code: "asc" }, take: 100,
        select: { code: true, firstIn: true, firstOut: true, secondIn: true, secondOut: true } });
      for (const row of rows) {
        const marks = [row.firstIn, row.firstOut, row.secondIn, row.secondOut].map(minutesClock);
        if (marks.some(mark => mark === null)) throw new EscalaError(500, "TURNO_CATALOG_CORRUPT", "O catálogo contém um horário inválido.");
        const markings = marks as [string, string, string, string];
        if (!initial.permitted || initial.permitted.has(markingKey(markings))) {
          const name = markings.join(" ");
          if (!search || `${row.code} ${name}`.toLocaleLowerCase("pt-BR").includes(search)) entries.push({ code: row.code, name, markings });
        }
      }
      if (rows.length < 100 || entries.length > request.limit) break;
      const next = rows.at(-1)?.code ?? cursor;
      if (next <= cursor) throw new EscalaError(503, "TURNO_OPTIONS_UNAVAILABLE", "Não foi possível continuar a consulta.");
      cursor = next;
    }
  }
  const latest = await eligibleContext(actor, request);
  if (initial.workspace.approvedPolicyVersionId !== latest.workspace.approvedPolicyVersionId
    || stableEscalaJson(initial.permitted === null ? null : [...initial.permitted].sort()) !== stableEscalaJson(latest.permitted === null ? null : [...latest.permitted].sort())) {
    throw new EscalaError(409, "TURNO_OPTIONS_CHANGED", "A configuração mudou. Consulte as opções novamente.");
  }
  const page = entries.slice(0, request.limit);
  return { context: { workspaceId: request.workspaceId, revision: request.expectedRevision, employeeId: request.employeeId,
    effectiveFrom: request.effectiveFrom, effectiveUntil: request.effectiveUntil }, entries: page,
    nextCursor: entries.length > request.limit ? String(page.at(-1)?.code) : null, pageSize: request.limit };
}
