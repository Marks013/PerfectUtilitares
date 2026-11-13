import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTurnoManifest, storeTurnoManifest, syncTurnoCatalog } from "./catalog";

const state = vi.hoisted(() => ({
  entries: new Map<string, { code: number; firstIn: number; firstOut: number; secondIn: number; secondOut: number }[]>(),
  nextCodes: new Map<string, number>(),
  revisions: new Map<string, { revision: number; input: unknown }>(),
  manifest: null as null | { id: string; tenantId: string; payload: unknown; expiresAt: Date; createdByUserId: string | null; createdByAccountSessionId: string | null; createdByModuleSessionId: string | null },
  transaction: vi.fn(),
  getEscala: vi.fn(),
}));
const tx = {
  $queryRaw: vi.fn(async (strings?: TemplateStringsArray) => {
    if (strings?.join("").includes('"EscalaWorkspace"')) {
      return [...state.revisions].map(([id, row]) => ({ id, revision: row.revision }));
    }
    return [];
  }),
  escalaRevision: {
    findUnique: vi.fn(async ({ where }: { where: { tenantId_workspaceId_revision: { workspaceId: string; revision: number } } }) => {
      const { workspaceId, revision } = where.tenantId_workspaceId_revision;
      const row = state.revisions.get(workspaceId);
      return row?.revision === revision ? { input: row.input } : null;
    }),
  },
  turnoExportManifest: {
    create: vi.fn(async ({ data }: { data: Omit<NonNullable<typeof state.manifest>, "id"> }) => {
      state.manifest = { id: "manifest-1", ...data };
      return { id: "manifest-1" };
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = state.manifest;
      if (!row || Object.entries(where).some(([key, value]) => row[key as keyof typeof row] !== value)) return null;
      return { payload: row.payload, expiresAt: row.expiresAt };
    }),
  },
  shiftCatalogSequence: {
    upsert: vi.fn(async ({ where, create }: { where: { tenantId: string }; create: { nextCode: number; tenantId: string } }) => {
      if (!state.nextCodes.has(where.tenantId)) state.nextCodes.set(where.tenantId, create.nextCode);
    }),
    findUnique: vi.fn(async ({ where }: { where: { tenantId: string } }) => ({ nextCode: state.nextCodes.get(where.tenantId) ?? 1500 })),
    update: vi.fn(async ({ where, data }: { where: { tenantId: string }; data: { nextCode: number } }) => {
      state.nextCodes.set(where.tenantId, data.nextCode);
    }),
  },
  shiftCatalogEntry: {
    findMany: vi.fn(async ({ where }: { where: { tenantId: string } }) => state.entries.get(where.tenantId) ?? []),
    create: vi.fn(async ({ data }: { data: { tenantId: string; code: number; firstIn: number; firstOut: number; secondIn: number; secondOut: number } }) => {
      const rows = state.entries.get(data.tenantId) ?? [];
      if (rows.some(row => row.code === data.code || row.firstIn === data.firstIn && row.firstOut === data.firstOut
        && row.secondIn === data.secondIn && row.secondOut === data.secondOut)) throw { code: "P2002" };
      rows.push(data);
      state.entries.set(data.tenantId, rows);
      return data;
    }),
  },
  auditLog: { create: vi.fn(async () => undefined) },
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (callback: (client: typeof tx) => Promise<unknown>) => state.transaction(callback),
    get turnoExportManifest() { return tx.turnoExportManifest; },
  },
}));
vi.mock("../service", () => ({ getEscala: state.getEscala, parseEscalaInput: vi.fn((input: unknown) => input) }));

const actor = (tenantId: string, userId: string | null = "u1", accountSessionId?: string, moduleSessionId?: string) => ({
  userId, tenantId, admin: true, ...(accountSessionId ? { accountSessionId } : {}), ...(moduleSessionId ? { moduleSessionId } : {}),
});
const shift = (id: string, start: number, end: number) => ({ id, name: id, segments: [{ start, end, kind: "WORK" as const }] });
function workspace(id: string, shifts = [shift("a", 480, 720), shift("b", 540, 780)]) {
  return {
    id,
    revision: 3,
    status: "DRAFT",
    canEdit: true,
    input: { visibleMonth: "2026-12", startDate: "2026-11-30", endDate: "2027-01-03", shifts },
  };
}
const sync = (workspaceId: string, localShiftIds: string[]) => syncTurnoCatalog(actor("t1"), {
  action: "SYNC",
  sources: [{ workspaceId, expectedRevision: 3, localShiftIds }],
  confirm: true,
});

describe("turn catalog registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.entries.clear();
    state.nextCodes.clear();
    state.revisions.clear();
    state.manifest = null;
    state.getEscala.mockImplementation(async (_actor, id: string) => {
      const current = state.revisions.get(id);
      if (current) return { ...workspace(id), revision: current.revision, input: current.input };
      const snapshot = workspace(id);
      state.revisions.set(id, { revision: snapshot.revision, input: snapshot.input });
      return snapshot;
    });
    let tail = Promise.resolve();
    state.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
      const predecessor = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await predecessor;
      try { return await callback(tx); }
      finally { release(); }
    });
  });

  it("sorts a confirmed initial December batch numerically before assigning 1500 onward", async () => {
    const initial = workspace("w1", [shift("late", 540, 780), shift("early", 480, 720)]);
    state.revisions.set("w1", { revision: initial.revision, input: initial.input });
    state.getEscala.mockResolvedValueOnce(initial);
    const result = await sync("w1", ["late", "early"]);
    expect(result.entries.map(entry => [entry.code, entry.markings])).toEqual([
      [1500, ["08:00", "12:00", "00:00", "00:00"]],
      [1501, ["09:00", "13:00", "00:00", "00:00"]],
    ]);
    expect(result.createdCount).toBe(2);
  });

  it("continues from the stored counter if the catalog rows have gaps", async () => {
    state.nextCodes.set("t1", 1600);
    const result = await sync("w1", ["a"]);
    expect(result.entries[0].code).toBe(1600);
  });

  it("serializes simultaneous registration of the same marking tuple to one immutable code", async () => {
    const [first, second] = await Promise.all([sync("w1", ["a"]), sync("w1", ["a"])]);
    expect(first.entries[0].code).toBe(1500);
    expect(second.entries[0].code).toBe(1500);
    expect(first.createdCount + second.createdCount).toBe(1);
    expect(state.entries.get("t1")).toHaveLength(1);
  });

  it("retries a transient transaction conflict without allocating a duplicate code", async () => {
    const transaction = state.transaction.getMockImplementation();
    state.transaction.mockImplementationOnce(async () => { throw { code: "P2034" }; });
    const result = await sync("w1", ["a"]);
    expect(result.entries[0].code).toBe(1500);
    expect(state.entries.get("t1")).toHaveLength(1);
    expect(state.transaction).toHaveBeenCalledTimes(2);
    state.transaction.mockImplementation((transaction as NonNullable<typeof transaction>));
  });

  it("isolates sequences and identical markings by tenant", async () => {
    const [first, second] = await Promise.all([
      syncTurnoCatalog(actor("t1"), { action: "SYNC", sources: [{ workspaceId: "w1", expectedRevision: 3, localShiftIds: ["a"] }], confirm: true }),
      syncTurnoCatalog(actor("t2"), { action: "SYNC", sources: [{ workspaceId: "w2", expectedRevision: 3, localShiftIds: ["a"] }], confirm: true }),
    ]);
    expect(first.entries[0].code).toBe(1500);
    expect(second.entries[0].code).toBe(1500);
    expect(state.entries.get("t1")).toHaveLength(1);
    expect(state.entries.get("t2")).toHaveLength(1);
  });

  it("rejects a registration source whose revision commits after preflight and before catalog locking", async () => {
    const initial = workspace("w1");
    state.revisions.set("w1", { revision: initial.revision, input: initial.input });
    let signalRead!: () => void;
    let releaseRead!: () => void;
    const readStarted = new Promise<void>(resolve => { signalRead = resolve; });
    const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    state.getEscala.mockImplementationOnce(async () => {
      signalRead();
      await readGate;
      return initial;
    });

    const registration = sync("w1", ["a"]);
    await readStarted;
    const beforeWrite = (state.revisions.get("w1") as NonNullable<ReturnType<typeof state.revisions.get>>);
    expect(beforeWrite.revision).toBe(3);
    // Model saveEscala's revision CAS and commit while SYNC is between preflight and transaction.
    if (beforeWrite.revision !== 3) throw new Error("CAS lost");
    state.revisions.set("w1", { revision: 4, input: { ...initial.input, shifts: [shift("replacement", 600, 840)] } });
    releaseRead();

    await expect(registration).rejects.toMatchObject({ code: "TURNO_REVISION_CONFLICT" });
    expect(state.entries.get("t1") ?? []).toHaveLength(0);
  });

  it("binds manifests to account or operational session identity", async () => {
    const owner = actor("t1", "u1", "account-session-1");
    const payload = { version: 1 as const, month: 12, year: 2026, selections: [], rowsHash: "hash" };
    const manifestId = await storeTurnoManifest(owner, payload, new Date(Date.now() + 60_000));
    expect(state.manifest).toMatchObject({
      createdByUserId: "u1",
      createdByAccountSessionId: "account-session-1",
      createdByModuleSessionId: null,
    });
    await expect(readTurnoManifest(owner, manifestId)).resolves.toEqual(payload);
    await expect(readTurnoManifest(actor("t1", "u2", "account-session-2"), manifestId)).rejects.toMatchObject({ code: "TURNO_MANIFEST_NOT_FOUND" });
    await expect(readTurnoManifest(actor("t1", "u1", "other-session"), manifestId)).rejects.toMatchObject({ code: "TURNO_MANIFEST_NOT_FOUND" });
    await expect(readTurnoManifest(actor("t2", "u1", "account-session-1"), manifestId)).rejects.toMatchObject({ code: "TURNO_MANIFEST_NOT_FOUND" });

    const operationalOwner = actor("t1", null, undefined, "module-session-1");
    const operationalId = await storeTurnoManifest(operationalOwner, payload, new Date(Date.now() + 60_000));
    await expect(readTurnoManifest(operationalOwner, operationalId)).resolves.toEqual(payload);
    await expect(readTurnoManifest(actor("t1", null, undefined, "module-session-2"), operationalId)).rejects.toMatchObject({ code: "TURNO_MANIFEST_NOT_FOUND" });
  });

  it("does not bootstrap disposable November references", async () => {
    const november = { ...workspace("w1"), input: { ...workspace("w1").input, visibleMonth: "2026-11" } };
    state.revisions.set("w1", { revision: november.revision, input: november.input });
    state.getEscala.mockResolvedValueOnce(november);
    await expect(sync("w1", ["a"])).rejects.toMatchObject({ code: "TURNO_INITIAL_DECEMBER_REQUIRED" });
    expect(state.entries.get("t1") ?? []).toHaveLength(0);
  });
});
