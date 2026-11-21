import { describe, expect, it, vi } from "vitest";
import { approvedPoliciesFor, operationalCommand, startOperatorSession } from "./operational-client";

describe("operational UI HTTP contract", () => {
  it("enters by registered name and requires a scoped context before opening the UI", async () => {
    const context = { channel: "USERNAME", administrator: false, allBranches: false, roleLabel: "Filial", branches: [] };
    const send = vi.fn<typeof fetch>(async () => Response.json({ access: { role: "OPERATIONAL", expiresAt: "2027-01-01T00:00:00.000Z" }, context }));
    expect((await startOperatorSession(" Pessoa ", send)).context).toEqual(context);
    expect(JSON.parse(send.mock.calls[0]?.[1]?.body as string)).toEqual({ username: "Pessoa" });
    await expect(startOperatorSession("Pessoa", async () => Response.json({ access: { role: "OPERATIONAL" } }))).rejects.toThrow();
  });
  it("queries the exact approved technical period, discards revoked/other-period policies and keeps model labels", async () => {
    const target = { branchCode: "07", startDate: "2026-11-30", endDate: "2027-01-03" };
    const policy = { ...target, id: "approved", version: 2, approvedAt: "2026-11-13", revokedAt: null, visibleMonth: "2026-12", regimeModels: [{ id: "model", label: "Caixa manhã" }] };
    const send = vi.fn<typeof fetch>(async () => Response.json({ policies: [policy, { ...policy, id: "revoked", revokedAt: "2026-11-14" }, { ...policy, id: "other", branchCode: "08" }] }));
    expect(await approvedPoliciesFor(target, new AbortController().signal, send)).toEqual([policy]);
    expect(String(send.mock.calls[0][0])).toContain("startDate=2026-11-30");
    expect(String(send.mock.calls[0][0])).toContain("endDate=2027-01-03");
  });
  it("preserves an administrative account returned by the server instead of replacing its precedence with username access", async () => {
    const context = { channel: "ACCOUNT", administrator: true, allBranches: true, roleLabel: "Administrador", branches: [] };
    expect((await startOperatorSession("Pessoa", async () => Response.json({ access: { role: "ACCOUNT" }, context }))).context).toEqual(context);
  });
  it("submits a server model and CAS without inventing employee IDs, contracts, dates or shift definitions", async () => {
    const command = { action: "ADD_EMPLOYEE" as const, id: "plan", expectedRevision: 8, regimeModelId: "model", name: "Pessoa", registration: "001" };
    const send = vi.fn<typeof fetch>(async () => Response.json({ id: "plan", revision: 9 }));
    expect(await operationalCommand(command, undefined, send)).toEqual({ id: "plan", revision: 9 });
    expect(JSON.parse(send.mock.calls[0]?.[1]?.body as string)).toEqual(command);
  });
  it("preserves structured approval and permission errors instead of claiming save succeeded", async () => {
    await expect(operationalCommand({ action: "CREATE_APPROVED", approvedPolicyVersionId: "revoked" }, undefined,
      async () => Response.json({ error: { code: "ESCALA_CONFIG_REVOKED", message: "Configuração revogada." } }, { status: 409 })))
      .rejects.toMatchObject({ code: "ESCALA_CONFIG_REVOKED", status: 409 });
  });
});
