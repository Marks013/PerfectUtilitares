import { describe, expect, it } from "vitest";
import { ESCALA_OPERATOR_MAX_BRANCH_GRANTS, parseEscalaOperatorAdminCommand } from "./operator-admin-input";
import { ESCALA_OPERATOR_CAPABILITIES } from "./permissions";

const grant = () => ({ branchCode: " 001 ", active: true, capabilities: ["workspace.read", "export.schedule.pdf"] });
const create = () => ({ action: "CREATE_OPERATOR", username: "  ＪＯA\u0303O  Silva ", displayName: " João   Silva ", active: false, branchGrants: [grant()] });
const update = () => ({ action: "UPDATE_OPERATOR", operatorId: "operator-1", expectedPermissionVersion: 3, username: "MARIA", displayName: "Maria", active: true });
const replace = () => ({ action: "REPLACE_BRANCH_GRANTS", operatorId: "operator-1", expectedPermissionVersion: 3, branchGrants: [grant()] });
const revoke = () => ({ action: "REVOKE_SESSIONS", operatorId: "operator-1", expectedPermissionVersion: 3 });
const rejected = (input: unknown) => {
  expect(parseEscalaOperatorAdminCommand(input)).toMatchObject({ ok: false, code: "INVALID_OPERATOR_COMMAND" });
};

describe("Escalas administrative operator input (not authorization)", () => {
  it("parses explicit creation without mutating the input or adding access", () => {
    const input = create();
    const before = structuredClone(input);
    expect(parseEscalaOperatorAdminCommand(input)).toEqual({ ok: true, command: {
      action: "CREATE_OPERATOR", usernameNormalized: "joão silva", displayName: "João Silva", active: false,
      branchGrants: [{ branchCode: "01", active: true, capabilities: ["workspace.read", "export.schedule.pdf"] }],
    } });
    expect(input).toEqual(before);
  });

  it("parses a complete profile update with a version precondition", () => {
    expect(parseEscalaOperatorAdminCommand(update())).toEqual({ ok: true, command: {
      action: "UPDATE_OPERATOR", operatorId: "operator-1", expectedPermissionVersion: 3,
      usernameNormalized: "maria", displayName: "Maria", active: true,
    } });
  });

  it("accepts explicit revocation and grant removal as distinct commands", () => {
    expect(parseEscalaOperatorAdminCommand(revoke())).toEqual({ ok: true, command: revoke() });
    expect(parseEscalaOperatorAdminCommand({ ...replace(), branchGrants: [] })).toEqual({
      ok: true, command: { ...replace(), branchGrants: [] },
    });
  });

  it("allows inactive preparation and empty capabilities without granting defaults", () => {
    expect(parseEscalaOperatorAdminCommand({ ...create(), branchGrants: [] })).toMatchObject({ ok: true, command: { active: false, branchGrants: [] } });
    expect(parseEscalaOperatorAdminCommand({ ...replace(), branchGrants: [{ ...grant(), active: false, capabilities: [] }] }))
      .toMatchObject({ ok: true, command: { branchGrants: [{ active: false, capabilities: [] }] } });
  });

  it("preserves explicit multiple branches and orders only capabilities by their fixed catalog", () => {
    const result = parseEscalaOperatorAdminCommand({ ...replace(), branchGrants: [
      { branchCode: " Loja-A ", active: true, capabilities: [...ESCALA_OPERATOR_CAPABILITIES].reverse() },
      { ...grant(), branchCode: "000" },
    ] });
    expect(result).toMatchObject({ ok: true, command: { branchGrants: [
      { branchCode: "Loja-A", capabilities: [...ESCALA_OPERATOR_CAPABILITIES] }, { branchCode: "00" },
    ] } });
  });

  it("requires explicit active flags and collections on creation", () => {
    for (const field of ["username", "displayName", "active", "branchGrants"] as const) {
      const { [field]: _omitted, ...partial } = create();
      rejected(partial);
    }
    for (const field of ["branchCode", "active", "capabilities"] as const) {
      const { [field]: _omitted, ...partial } = grant();
      rejected({ ...create(), branchGrants: [partial] });
    }
  });

  it("rejects omitted or incomplete update profiles", () => {
    for (const field of ["username", "displayName", "active"] as const) {
      const { [field]: _omitted, ...partial } = update();
      rejected(partial);
    }
  });

  it("rejects administrative powers in every grant instead of silently removing them", () => {
    for (const capability of ["access.manage", "settings.manage", "import.manage", "export.integration", "report.analytics", "workspace.publish", "workspace.delete", "future.capability"]) {
      rejected({ ...replace(), branchGrants: [{ ...grant(), capabilities: ["workspace.read", capability] }] });
    }
  });

  it("rejects tenant, roles, identity and stored versions supplied through payloads", () => {
    for (const command of [create(), update(), replace(), revoke()]) {
      for (const field of ["tenantId", "role", "id", "permissionVersion", "accessPolicyVersion", "mode", "usernameNormalized", "actorId"]) {
        rejected({ ...command, [field]: "forged" });
      }
    }
    for (const field of ["tenantId", "operatorId", "id", "role"]) {
      rejected({ ...create(), branchGrants: [{ ...grant(), [field]: "forged" }] });
    }
  });

  it("rejects unsupported actions and fields belonging to a different command", () => {
    for (const action of ["DELETE_OPERATOR", "SET_MODE", "CREATE", "", null]) rejected({ ...revoke(), action });
    rejected({ ...create(), operatorId: "operator-1" });
    rejected({ ...create(), expectedPermissionVersion: 1 });
    rejected({ ...update(), branchGrants: [] });
    rejected({ ...revoke(), active: false });
  });

  it("rejects duplicate branches after numeric canonicalization, including inactive duplicates", () => {
    for (const branchCode of ["1", "01", "0001", " 01 "]) {
      rejected({ ...replace(), branchGrants: [grant(), { ...grant(), branchCode, active: false }] });
    }
    rejected({ ...replace(), branchGrants: [{ ...grant(), branchCode: "Loja-A" }, { ...grant(), branchCode: " Loja-A " }] });
  });

  it("rejects duplicate, nested or non-string capabilities", () => {
    for (const capabilities of [["workspace.read", "workspace.read"], [null], [["workspace.read"]], [true], [1], "workspace.read", null]) {
      rejected({ ...replace(), branchGrants: [{ ...grant(), capabilities }] });
    }
  });

  it("requires a positive PostgreSQL Int version without string or boolean coercion", () => {
    for (const expectedPermissionVersion of [undefined, null, 0, -1, 1.5, "3", true, Number.NaN, Infinity, 2_147_483_648]) {
      for (const command of [update(), replace(), revoke()]) rejected({ ...command, expectedPermissionVersion });
    }
    expect(parseEscalaOperatorAdminCommand({ ...revoke(), expectedPermissionVersion: 2_147_483_647 })).toMatchObject({ ok: true });
  });

  it("does not canonicalize or infer target operator IDs", () => {
    for (const operatorId of ["", " operator-1 ", "operator/1", "operator\n1", "x".repeat(101), 1, null]) rejected({ ...revoke(), operatorId });
    expect(parseEscalaOperatorAdminCommand({ ...revoke(), operatorId: "synthetic_operator:1" })).toMatchObject({ ok: true });
  });

  it("uses the login normalizer for names and never interprets ADMIN as a role", () => {
    expect(parseEscalaOperatorAdminCommand({ ...create(), username: "ADMIN" }))
      .toMatchObject({ ok: true, command: { usernameNormalized: "admin", active: false } });
    for (const username of [null, "", "\u3164", "Ana\u034f", "a".repeat(65), "ﬃ".repeat(22)]) rejected({ ...create(), username });
  });

  it("normalizes the display label without lowercasing or truncation", () => {
    expect(parseEscalaOperatorAdminCommand({ ...create(), displayName: " Ｍaria\u00a0 D'Ávila " }))
      .toMatchObject({ ok: true, command: { displayName: "Maria D'Ávila" } });
    expect(parseEscalaOperatorAdminCommand({ ...create(), displayName: "á".repeat(120) })).toMatchObject({ ok: true });
    for (const displayName of ["", "  ", "a".repeat(121), "ﬃ".repeat(41), " ".repeat(513), 3, null]) rejected({ ...create(), displayName });
  });

  it("rejects controls, invisible labels and malformed Unicode in display names and branches", () => {
    for (const hidden of ["\n", "\t", "\0", "\u200b", "\u202e", "\u2028", "\ud800", "\u034f", "\u3164", "\ufe0f"]) {
      rejected({ ...create(), displayName: `Ana${hidden}` });
      rejected({ ...create(), branchGrants: [{ ...grant(), branchCode: `01${hidden}` }] });
    }
    for (const branchCode of ["", " ", "x".repeat(161), " ".repeat(641), null, 1]) rejected({ ...replace(), branchGrants: [{ ...grant(), branchCode }] });
  });

  it("rejects non-JSON-shaped commands and boolean coercion", () => {
    for (const value of [null, undefined, 1, true, "CREATE_OPERATOR", [], [create()]]) rejected(value);
    for (const active of [undefined, null, 0, 1, "false", "true"]) {
      rejected({ ...create(), active });
      rejected({ ...create(), branchGrants: [{ ...grant(), active }] });
    }
    for (const branchGrants of [null, {}, true, "01", [null], [[grant()]]]) rejected({ ...create(), branchGrants });
  });

  it("bounds collections before inspecting oversized entries", () => {
    const oversized = new Array(ESCALA_OPERATOR_MAX_BRANCH_GRANTS + 1);
    Object.defineProperty(oversized, 0, { get: () => { throw new Error("must not traverse oversized grants"); } });
    expect(parseEscalaOperatorAdminCommand({ ...create(), branchGrants: oversized }))
      .toMatchObject({ ok: false, issues: [{ path: "branchGrants" }] });
    const oversizedCapabilities = new Array(ESCALA_OPERATOR_CAPABILITIES.length + 1);
    Object.defineProperty(oversizedCapabilities, 0, { get: () => { throw new Error("must not traverse oversized capabilities"); } });
    rejected({ ...replace(), branchGrants: [{ ...grant(), capabilities: oversizedCapabilities }] });
    expect(parseEscalaOperatorAdminCommand({ ...replace(), branchGrants: Array.from({ length: ESCALA_OPERATOR_MAX_BRANCH_GRANTS }, (_, i) => ({ ...grant(), branchCode: String(i) })) }))
      .toMatchObject({ ok: true });
  });

  it("returns bounded field errors without exposing rejected values or unknown property names", () => {
    const result = parseEscalaOperatorAdminCommand({ ...create(), "private-unknown-key": "private-value", username: "a".repeat(65) });
    expect(result).toMatchObject({ ok: false, issues: [{ path: "username", reason: "INVALID_VALUE" }, { path: "", reason: "UNKNOWN_FIELDS" }] });
    expect(JSON.stringify(result)).not.toMatch(/private-unknown-key|private-value|aaaa/);
    const invalidMany = parseEscalaOperatorAdminCommand({ ...create(), branchGrants: Array.from({ length: 30 }, () => ({ branchCode: "", active: "bad", capabilities: ["secret-invalid"] })) });
    expect(invalidMany.ok).toBe(false);
    if (!invalidMany.ok) expect(invalidMany.issues.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(invalidMany)).not.toContain("secret-invalid");
  });
});
