import { describe, expect, it } from "vitest";
import { escalaCatalogActions } from "./access-contracts";
import type { EscalaClientAccess } from "./access-view";

describe("catalog definition and assignment display contract", () => {
  const operator: EscalaClientAccess = { channel: "USERNAME", roleLabel: "Operador", administrator: false,
    allBranches: false, branches: [{ code: "02", label: "Filial 02", capabilities: ["shift.manage"] }] };
  it("allows an operator to assign on their branch without defining catalog entries", () => {
    expect(escalaCatalogActions(operator, "02")).toEqual({ canDefine: false, canAssign: true });
    expect(escalaCatalogActions(operator, "03")).toEqual({ canDefine: false, canAssign: false });
  });
  it("reserves definition to the administrator without requiring an operational grant", () => {
    expect(escalaCatalogActions({ ...operator, channel: "ACCOUNT", administrator: true, allBranches: true, branches: [] }, "03"))
      .toEqual({ canDefine: true, canAssign: true });
  });
  it("rejects a username masquerading as administrator and incoherent account flags", () => {
    expect(escalaCatalogActions({ ...operator, administrator: true, allBranches: true, branches: [] }, "02"))
      .toEqual({ canDefine: false, canAssign: false });
    expect(escalaCatalogActions({ ...operator, channel: "ACCOUNT", administrator: true, allBranches: false, branches: [] }, "02"))
      .toEqual({ canDefine: false, canAssign: false });
  });
  it("requires one effective canonical branch grant and denies duplicates", () => {
    expect(escalaCatalogActions(operator, "002")).toEqual({ canDefine: false, canAssign: true });
    expect(escalaCatalogActions({ ...operator, branches: [...operator.branches,
      { code: "2", label: "Duplicada", capabilities: [] }] }, "02"))
      .toEqual({ canDefine: false, canAssign: false });
    expect(escalaCatalogActions({ ...operator, branches: [{ code: "02", label: "Leitura", capabilities: ["workspace.read"] }] }, "02"))
      .toEqual({ canDefine: false, canAssign: false });
  });
});
