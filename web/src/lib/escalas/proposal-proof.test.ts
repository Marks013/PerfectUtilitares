import { afterEach, describe, expect, it, vi } from "vitest";
import { signEscalaProposal, verifyEscalaProposal, type EscalaProposalScope } from "./proposal-proof";
import type { EscalaInput } from "./types";
afterEach(() => vi.unstubAllEnvs());
describe("server signed proposal scope", () => {
  const scope: EscalaProposalScope = { tenantId: "t", principal: "operator:o", session: "session", workspaceId: "w",
    revision: 1, approvalId: "approval", accessVersion: "version-1" };
  const input = { assignments: [] } as unknown as EscalaInput;
  function proof() { vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", "synthetic-proposal-test-material-000000"); return signEscalaProposal(scope, input, 1000); }
  it("accepts exact content and scope without calling a solver", () => {
    expect(() => verifyEscalaProposal(proof(), scope, structuredClone(input), 2000)).not.toThrow();
  });
  it.each(Object.keys(scope) as (keyof EscalaProposalScope)[])("rejects changed %s", key => {
    const changed = { ...scope, [key]: key === "revision" ? 2 : "other" };
    expect(() => verifyEscalaProposal(proof(), changed, input, 2000)).toThrow("não corresponde");
  });
  it("rejects expiry, modified content, tampered signature and oversized input", () => {
    const value = proof();
    expect(() => verifyEscalaProposal(value, scope, input, 901000)).toThrow();
    expect(() => verifyEscalaProposal(value, scope, { ...input, needsRegeneration: false }, 2000)).toThrow();
    expect(() => verifyEscalaProposal(value + "x", scope, input, 2000)).toThrow();
    expect(() => verifyEscalaProposal("a".repeat(4097), scope, input, 2000)).toThrow();
  });
  it("does not use a missing or weak secret to issue a proposal", () => {
    vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", "");
    expect(() => signEscalaProposal(scope, input)).toThrow("não está disponível");
  });
});
