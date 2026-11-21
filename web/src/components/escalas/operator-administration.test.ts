import { describe, expect, it } from "vitest";
import type { EscalaOperatorView } from "@/lib/escalas/access-contracts";
import { operatorBranchGrantsForCommand } from "./operator-administration";

describe("operator grant editing boundary", () => {
  it("copies readonly capabilities into the restricted command without changing the received grants", () => {
    const capabilities = Object.freeze(["workspace.read", "shift.manage"] as const);
    const grants: EscalaOperatorView["branchGrants"] = [{ branchCode: "07", active: true, capabilities }];
    const command = operatorBranchGrantsForCommand(grants);
    expect(command).toEqual(grants);
    command[0].capabilities.push("workspace.save");
    expect(grants[0].capabilities).toEqual(["workspace.read", "shift.manage"]);
  });

  it("rejects an administrative capability and preserves every original permission for review", () => {
    const grants: EscalaOperatorView["branchGrants"] = [{ branchCode: "07", active: true, capabilities: Object.freeze(["workspace.read", "settings.manage"]) }];
    expect(() => operatorBranchGrantsForCommand(grants)).toThrow(/07.*settings\.manage.*seleção foi preservada/);
    expect(grants[0].capabilities).toEqual(["workspace.read", "settings.manage"]);
  });
});
