import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEscala, parseEscalaInput } from "../service";
import type { EscalaActor } from "../access";
import { EscalaError } from "../errors";
import type { TurnoCatalogEntryDto, TurnoCatalogPageDto, TurnoCatalogSyncRequest, TurnoCatalogSyncSource, TurnoCatalogSyncResult } from "./contracts";
import { allocateInitialCatalog, appendCatalogEntries, clockMinutes, markingsFromShift, minutesClock, markingKey } from "./domain";

type CatalogRow = {
  code: number;
  firstIn: number;
  firstOut: number;
  secondIn: number;
  secondOut: number;
};

function rowMarkings(row: CatalogRow) {
  const marks = [row.firstIn, row.firstOut, row.secondIn, row.secondOut].map(minutesClock);
  if (marks.some(value => value === null)) throw new EscalaError(500, "TURNO_CATALOG_CORRUPT", "O catálogo contém um horário inválido.");
  return marks as [string, string, string, string];
}

function toEntry(row: CatalogRow): TurnoCatalogEntryDto {
  const markings = rowMarkings(row);
  return { code: row.code, markings, name: markings.join(" ") };
}

function toMinutes(markings: TurnoCatalogEntryDto["markings"]) {
  return markings.map(value => (clockMinutes(value) as number)) as [number, number, number, number];
}

function retryableTransaction(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error
    && ["P2034", "40001", "40P01"].includes(String(error.code)));
}

async function withTransactionRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= 2 || !retryableTransaction(error)) throw error;
    }
  }
}

export async function listTurnoCatalog(actor: EscalaActor, search: string, cursor: number, requestedLimit: number): Promise<TurnoCatalogPageDto> {
  const pageSize = Math.min(100, Math.max(1, requestedLimit));
  const query = search.trim().slice(0, 48).replace(/[\\%_]/g, "\\$&");
  const pattern = `%${query}%`;
  const rows = await prisma.$queryRaw<CatalogRow[]>`
    SELECT "code", "firstIn", "firstOut", "secondIn", "secondOut"
    FROM "ShiftCatalogEntry"
    WHERE "tenantId" = ${actor.tenantId}
      AND "code" > ${cursor}
      AND (
        ${query} = ''
        OR CAST("code" AS TEXT) ILIKE ${pattern} ESCAPE E'\\\\'
        OR (
          LPAD(("firstIn" / 60)::TEXT, 2, '0') || ':' || LPAD(("firstIn" % 60)::TEXT, 2, '0') || ' ' ||
          LPAD(("firstOut" / 60)::TEXT, 2, '0') || ':' || LPAD(("firstOut" % 60)::TEXT, 2, '0') || ' ' ||
          LPAD(("secondIn" / 60)::TEXT, 2, '0') || ':' || LPAD(("secondIn" % 60)::TEXT, 2, '0') || ' ' ||
          LPAD(("secondOut" / 60)::TEXT, 2, '0') || ':' || LPAD(("secondOut" % 60)::TEXT, 2, '0')
        ) ILIKE ${pattern} ESCAPE E'\\\\'
      )
    ORDER BY "code" ASC
    LIMIT ${pageSize + 1}
  `;
  const hasMore = rows.length > pageSize;
  const entries = rows.slice(0, pageSize).map(toEntry);
  return { entries, nextCursor: hasMore ? String(entries.at(-1)?.code ?? "") : null, pageSize };
}

export async function getTurnoCatalogEntry(actor: EscalaActor, code: number): Promise<TurnoCatalogEntryDto> {
  const row = await prisma.shiftCatalogEntry.findUnique({
    where: { tenantId_code: { tenantId: actor.tenantId, code } },
    select: { code: true, firstIn: true, firstOut: true, secondIn: true, secondOut: true },
  });
  if (!row) throw new EscalaError(404, "TURNO_NOT_FOUND", "O código de turno não existe nesta empresa.");
  return toEntry(row);
}

export async function findTurnoCatalogCode(actor: EscalaActor, markings: TurnoCatalogEntryDto["markings"]): Promise<number | null> {
  const [firstIn, firstOut, secondIn, secondOut] = toMinutes(markings);
  const row = await prisma.shiftCatalogEntry.findUnique({
    where: { tenantId_firstIn_firstOut_secondIn_secondOut: {
      tenantId: actor.tenantId, firstIn, firstOut, secondIn, secondOut,
    } },
    select: { code: true },
  });
  return row?.code ?? null;
}

export async function syncTurnoCatalog(actor: EscalaActor, request: TurnoCatalogSyncRequest): Promise<TurnoCatalogSyncResult> {
  if (!request.confirm || request.sources.length === 0) {
    throw new EscalaError(400, "TURNO_CONFIRMATION_REQUIRED", "Confirme a inclusão explícita dos horários selecionados no catálogo da empresa.");
  }
  const workspaceIds = [...new Set(request.sources.map((source: TurnoCatalogSyncSource) => source.workspaceId))].sort();
  for (const source of request.sources) {
    const workspace = await getEscala(actor, source.workspaceId);
    if (workspace.revision !== source.expectedRevision) throw new EscalaError(409, "TURNO_REVISION_CONFLICT", "A revisão mudou. Atualize as referências antes de cadastrar os turnos.");
    if (!workspace.canEdit) throw new EscalaError(403, "ESCALA_ACTION_FORBIDDEN", "Você não possui permissão para cadastrar turnos desta filial.");
  }

  return withTransactionRetry(() => prisma.$transaction(async tx => {
    const lockedWorkspaces = await tx.$queryRaw<{ id: string; revision: number }[]>`
      SELECT "id", "revision"
      FROM "EscalaWorkspace"
      WHERE "tenantId" = ${actor.tenantId} AND "id" IN (${Prisma.join(workspaceIds)})
      ORDER BY "id" ASC
      FOR UPDATE
    `;
    const revisionByWorkspace = new Map(lockedWorkspaces.map(row => [row.id, row.revision]));
    if (workspaceIds.some(id => !revisionByWorkspace.has(id))) {
      throw new EscalaError(404, "ESCALA_NOT_FOUND", "Uma das referências selecionadas não existe nesta empresa.");
    }

    const candidates = new Map<string, TurnoCatalogEntryDto["markings"]>();
    const sourceMonths: string[] = [];
    for (const source of request.sources) {
      if (revisionByWorkspace.get(source.workspaceId) !== source.expectedRevision) {
        throw new EscalaError(409, "TURNO_REVISION_CONFLICT", "A revisão mudou. Atualize as referências antes de cadastrar os turnos.");
      }
      const version = await tx.escalaRevision.findUnique({
        where: { tenantId_workspaceId_revision: {
          tenantId: actor.tenantId, workspaceId: source.workspaceId, revision: source.expectedRevision,
        } },
        select: { input: true },
      });
      if (!version) throw new EscalaError(404, "ESCALA_REVISION_NOT_FOUND", "A revisão selecionada não existe nesta empresa.");
      const input = parseEscalaInput(version.input);
      sourceMonths.push(input.visibleMonth ?? input.startDate.slice(0, 7));
      const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
      const selected = new Set(source.localShiftIds);
      if (selected.size !== source.localShiftIds.length) throw new EscalaError(400, "TURNO_INVALID_SELECTION", "A seleção contém um turno repetido.");
      for (const id of selected) {
        const shift = shifts.get(id);
        if (!shift) throw new EscalaError(404, "TURNO_REFERENCE_NOT_FOUND", "Um dos horários selecionados não pertence à revisão.");
        const result = markingsFromShift(shift);
        if (!result.ok) throw new EscalaError(422, "TURNO_" + result.reason, "Um dos horários não pode ser representado pelas quatro marcações do TXT.");
        candidates.set(markingKey(result.markings), result.markings);
      }
    }
    if (candidates.size === 0) throw new EscalaError(422, "TURNO_EMPTY_SELECTION", "Selecione pelo menos um horário representável.");

    await tx.shiftCatalogSequence.upsert({
      where: { tenantId: actor.tenantId },
      update: {},
      create: { tenantId: actor.tenantId, nextCode: 1500 },
    });
    await tx.$queryRaw`SELECT "tenantId" FROM "ShiftCatalogSequence" WHERE "tenantId" = ${actor.tenantId} FOR UPDATE`;

    const existingRows = await tx.shiftCatalogEntry.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { code: "asc" },
      select: { code: true, firstIn: true, firstOut: true, secondIn: true, secondOut: true },
    });
    const sequence = await tx.shiftCatalogSequence.findUnique({ where: { tenantId: actor.tenantId }, select: { nextCode: true } });
    const maxExistingCode = Math.max(1499, ...existingRows.map(row => row.code));
    const nextCode = Math.max(sequence?.nextCode ?? 1500, maxExistingCode + 1);
    const isInitialCatalog = existingRows.length === 0 && nextCode === 1500;
    if (isInitialCatalog && sourceMonths.some(month => month !== "2026-12")) {
      throw new EscalaError(409, "TURNO_INITIAL_DECEMBER_REQUIRED", "O primeiro cadastro deve usar referências aceitas de dezembro de 2026.");
    }

    const existing = existingRows.map(toEntry);
    const all = isInitialCatalog
      ? allocateInitialCatalog([...candidates.values()])
      : appendCatalogEntries(existing, [...candidates.values()], nextCode);
    const maxCode = Math.max(nextCode - 1, ...all.map(entry => entry.code));
    const known = new Set(existing.map(entry => markingKey(entry.markings)));
    const created = all.filter(entry => !known.has(markingKey(entry.markings)));
    for (const entry of created) {
      const [firstIn, firstOut, secondIn, secondOut] = toMinutes(entry.markings);
      await tx.shiftCatalogEntry.create({ data: {
        id: randomUUID(), tenantId: actor.tenantId, code: entry.code, firstIn, firstOut, secondIn, secondOut,
      } });
    }
    if (created.length > 0) await tx.auditLog.create({ data: {
      userId: actor.userId,
      action: "UPDATE",
      entity: "EscalaShiftCatalog",
      entityId: actor.tenantId,
      metadata: { tenantId: actor.tenantId, createdCodes: created.map(entry => entry.code), sourceCount: request.sources.length },
    } });
    await tx.shiftCatalogSequence.update({
      where: { tenantId: actor.tenantId },
      data: { nextCode: Math.max(nextCode, maxCode + 1), updatedAt: new Date() },
    });
    const entryByKey = new Map(all.map(entry => [markingKey(entry.markings), entry]));
    const entries = [...candidates.keys()].map(key => (entryByKey.get(key) as NonNullable<ReturnType<typeof entryByKey.get>>)).sort((a, b) => a.code - b.code);
    return { entries, createdCount: created.length, unchangedCount: candidates.size - created.length };
  }));
}

export type TurnoManifestPayload = {
  version: 1;
  month: number;
  year: number;
  selections: { workspaceId: string; revision: number; employees: { employeeId: string; localShiftId: string }[] }[];
  rowsHash: string;
};

function manifestOwner(actor: EscalaActor) {
  if (!actor.userId && !actor.moduleSessionId) {
    throw new EscalaError(403, "TURNO_MANIFEST_OWNER_REQUIRED", "A sessão autenticada não pode criar ou consultar este manifesto.");
  }
  return {
    createdByUserId: actor.userId,
    createdByAccountSessionId: actor.accountSessionId ?? null,
    createdByModuleSessionId: actor.moduleSessionId ?? null,
  };
}

export async function storeTurnoManifest(actor: EscalaActor, payload: TurnoManifestPayload, expiresAt: Date): Promise<string> {
  const created = await prisma.turnoExportManifest.create({
    data: { tenantId: actor.tenantId, ...manifestOwner(actor), payload: payload as Prisma.InputJsonValue, expiresAt },
    select: { id: true },
  });
  return created.id;
}

export async function readTurnoManifest(actor: EscalaActor, manifestId: string) {
  const manifest = await prisma.turnoExportManifest.findFirst({
    where: { id: manifestId, tenantId: actor.tenantId, ...manifestOwner(actor) },
    select: { payload: true, expiresAt: true },
  });
  if (!manifest || manifest.expiresAt <= new Date()) throw new EscalaError(404, "TURNO_MANIFEST_NOT_FOUND", "O manifesto expirou ou não existe.");
  return manifest.payload as unknown as TurnoManifestPayload;
}
