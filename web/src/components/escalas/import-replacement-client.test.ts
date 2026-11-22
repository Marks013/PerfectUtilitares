import { afterEach, describe, expect, it, vi } from "vitest";
import { requestImportReplacement, validateImportPreview, IMPORT_REPLACEMENT_TIMEOUT } from "./import-replacement-client";
import type { ImportSyncCommand, ImportSyncPreview } from "@/lib/escalas/import-sync-contracts";
import type { EscalaWorkspace } from "@/lib/escalas/types";

const file = new File(["arquivo sintético"], "fonte.csv", { type: "text/csv" });
const workspace = { id: "plan", revision: 3, status: "DRAFT", input: { branchCode: "07", startDate: "2026-11-30", endDate: "2027-01-03", visibleMonth: "2026-12", employees: [{ id: "old", registration: "0007" }], assignments: [{ employeeId: "old", date: "2026-11-30", kind: "ABSENCE" }, { employeeId: "old", date: "2027-01-03", kind: "ABSENCE" }] } } as EscalaWorkspace;
const command: ImportSyncCommand = { action: "PREVIEW_REPLACE", purpose: "EMPLOYEES", workspaceId: "plan", expectedRevision: 3, startDate: "2026-11-30", endDate: "2027-01-03", completeScopeConfirmed: true };
function preview(): ImportSyncPreview {
  return { contractVersion: 1, purpose: "EMPLOYEES", layout: "FPRE136", context: { workspaceId: "plan", revision: 3, branchCode: "07", workspaceStartDate: command.startDate, workspaceEndDate: command.endDate, visibleMonth: "2026-12", status: "DRAFT" }, scope: { startDate: command.startDate, endDate: command.endDate }, coverage: { completeScopeConfirmed: true, sourcePeriod: null, basis: "ADMIN_DECLARATION" }, fileHash: "a".repeat(64), expectedImpactHash: "b".repeat(64), canApply: true,
    impact: { people: { added: [{ id: "new", registration: "0008", name: "Nova pessoa", fields: ["name"] }], updated: [], removed: [{ id: "old", registration: "0007", name: "Pessoa anterior", fields: [] }], unchanged: [] }, absences: { added: [], removed: [], unchanged: [] }, assignments: [], references: [] },
    blockers: [], warnings: [], counts: { addedPeople: 1, updatedPeople: 0, removedPeople: 1, unchangedPeople: 0, addedAbsenceDays: 0, removedAbsenceDays: 0, unchangedAbsenceDays: 0, assignmentChanges: 0, blockers: 0 }, effect: { nextStatus: "DRAFT", needsRegeneration: true, approvalInvalidated: true, approvedPolicyVersionIdBefore: "policy", approvedPolicyVersionIdAfter: null } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("administrative replacement boundary", () => {
  it("keeps removals, textual identities, technical borders and approval consequences", () => {
    expect(validateImportPreview(preview(), command, workspace).impact.people.removed[0].registration).toBe("0007");
    expect(validateImportPreview(preview(), command, workspace).effect.approvalInvalidated).toBe(true);
  });
  it("accepts exact absence scope and removals without treating it as team replacement", () => {
    const p = preview(); p.purpose = "ABSENCES"; p.layout = "FPHI105"; p.impact.people = { added: [], updated: [], removed: [], unchanged: [] }; p.counts.addedPeople = 0; p.counts.removedPeople = 0;
    p.scope = { startDate: "2026-12-01", endDate: "2026-12-31" }; p.impact.absences.removed = [{ employeeId: "old", registration: "0007", date: "2026-12-02" }]; p.counts.removedAbsenceDays = 1;
    p.impact.absences.added = [{ employeeId: "new", registration: "0008", date: "2026-12-03" }]; p.counts.addedAbsenceDays = 1;
    p.impact.absences.unchanged = [{ employeeId: "old", registration: "0007", date: "2026-11-30" }, { employeeId: "old", registration: "0007", date: "2027-01-03" }]; p.counts.unchangedAbsenceDays = 2;
    expect(validateImportPreview(p, { ...command, purpose: "ABSENCES", ...p.scope }, workspace).counts.removedAbsenceDays).toBe(1);
    for (const bad of [{ ...p.impact.absences.unchanged[0], date: "2026-11-29" }, { ...p.impact.absences.unchanged[0], employeeId: "another-workspace-person" }, { ...p.impact.absences.unchanged[0], registration: "7" }, { ...p.impact.absences.unchanged[0], date: "2026-12-01" }]) {
      const invalid = structuredClone(p); invalid.impact.absences.unchanged[0] = bad;
      expect(() => validateImportPreview(invalid, { ...command, purpose: "ABSENCES", ...p.scope }, workspace)).toThrow();
    }
    const addedOutside = structuredClone(p); addedOutside.impact.absences.added[0].date = "2026-11-30";
    expect(() => validateImportPreview(addedOutside, { ...command, purpose: "ABSENCES", ...p.scope }, workspace)).toThrow();
    const changedOutside = structuredClone(p); changedOutside.impact.assignments = [{ employeeId: "old", registration: "0007", date: "2026-11-30", previousKind: "ABSENCE", nextKind: null, previousShiftId: null, nextShiftId: null }]; changedOutside.counts.assignmentChanges = 1;
    expect(() => validateImportPreview(changedOutside, { ...command, purpose: "ABSENCES", ...p.scope }, workspace)).toThrow();
    p.impact.absences.removed[0].date = "2026-11-30";
    expect(() => validateImportPreview(p, { ...command, purpose: "ABSENCES", ...p.scope }, workspace)).toThrow();
  });
  it("rejects stale context, layout, counts and forged apply eligibility", () => {
    for (const alter of [(p: ImportSyncPreview) => { p.context.revision++; }, (p: ImportSyncPreview) => { p.counts.removedPeople = 0; }, (p: ImportSyncPreview) => { p.layout = "UNRECOGNIZED"; }, (p: ImportSyncPreview) => { p.coverage.completeScopeConfirmed = false; }, (p: ImportSyncPreview) => { p.blockers = [{ code: "SOURCE_PARTIAL", message: "Parcial" }]; p.counts.blockers = 1; }]) {
      const p = preview(); alter(p); expect(() => validateImportPreview(p, command, workspace)).toThrow();
    }
  });
  it("preserves blocked partial-source preview for explanation", () => {
    const p = preview(); p.canApply = false; p.blockers = [{ code: "SOURCE_PARTIAL", message: "Arquivo incompleto" }]; p.counts.blockers = 1;
    expect(validateImportPreview(p, command, workspace).canApply).toBe(false);
  });
  it("never enables a zero-result removal batch or another source scope", () => {
    const p = preview(); p.impact.people.added = []; p.counts.addedPeople = 0;
    expect(() => validateImportPreview(p, command, workspace)).toThrow();
    expect(() => validateImportPreview(preview(), { ...command, startDate: "2026-12-01" }, workspace)).toThrow();
  });
  it("sends only file and canonical JSON command, and verifies source bytes", async () => {
    const p = preview(); p.fileHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), b => b.toString(16).padStart(2,"0")).join("");
    const fetcher = vi.fn(async (_url, init) => { const form = init.body as FormData; expect([...form.keys()]).toEqual(["file", "command"]); expect(JSON.parse(form.get("command") as string)).toEqual(command); return Response.json({ preview: p }); });
    vi.stubGlobal("fetch", fetcher);
    expect(await requestImportReplacement(file, command, workspace, new AbortController().signal)).toEqual({ preview: p });
    p.fileHash = "0".repeat(64);
    await expect(requestImportReplacement(file, command, workspace, new AbortController().signal)).rejects.toThrow();
  });
  it("rejects a missing payload and caps uploads at 512 KiB before reaching fetch", async () => {
    const fetcher = vi.fn(async () => Response.json({}, { status: 409 }));
    vi.stubGlobal("fetch", fetcher);
    for (const size of [0, 512 * 1024 + 1]) {
      const invalid = new File([new Uint8Array(size)], "origem.csv", { type: "text/csv" });
      await expect(requestImportReplacement(invalid, command, workspace, new AbortController().signal)).rejects.toThrow("até 512 KB");
    }
    expect(fetcher).not.toHaveBeenCalled();
    await expect(requestImportReplacement(new File([new Uint8Array(512 * 1024)], "limite.csv"), command, workspace,
      new AbortController().signal)).rejects.toThrow("A revisão mudou");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    ["sem corpo", () => new Response(null, { status: 401 }), "Confira o acesso e tente novamente."],
    ["com JSON", () => Response.json({ error: { message: "Acesso encerrado" } }, { status: 401 }), "Acesso encerrado"],
  ] as const)("requests unlock once for HTTP 401 %s without replaying the replacement", async (_, response, message) => {
    const events = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: events });
    const fetcher = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetcher);
    const apply: ImportSyncCommand = { ...command, action: "APPLY_REPLACE", completeScopeConfirmed: true,
      confirm: true, expectedImpactHash: "b".repeat(64) };
    await expect(requestImportReplacement(file, apply, workspace, new AbortController().signal)).rejects.toThrow(message);
    expect(events).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "escalas:unlock-required" }));
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("bounds noncooperative transport and never processes its late unauthorized response", async () => {
    vi.useFakeTimers(); const events = vi.fn(); vi.stubGlobal("window", { dispatchEvent: events });
    let resolve: (value: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    const pending = requestImportReplacement(file, command, workspace, new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow(); await vi.advanceTimersByTimeAsync(IMPORT_REPLACEMENT_TIMEOUT + 1); await rejected;
    resolve(Response.json({ error: { message: "old" } }, { status: 401 })); await Promise.resolve(); expect(events).not.toHaveBeenCalled();
  });
  it("stops cancelled body parsing before a session event and exposes revision conflict", async () => {
    const events = vi.fn(); vi.stubGlobal("window", { dispatchEvent: events }); const abort = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => { abort.abort(); return {}; } })));
    await expect(requestImportReplacement(file, command, workspace, abort.signal)).rejects.toThrow(); expect(events).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 409 })));
    await expect(requestImportReplacement(file, command, workspace, new AbortController().signal)).rejects.toThrow("revisão mudou");
  });
});
