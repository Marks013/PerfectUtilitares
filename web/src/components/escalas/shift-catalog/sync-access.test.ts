import { describe, expect, it } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import type { TurnoExportManifestDto } from "@/lib/escalas/shift-catalog/contracts";
import { canSyncCatalogReferences } from "./sync-access";
const workspace = (id: string, canEdit: boolean) => ({ id, canEdit }) as EscalaWorkspace;
const manifest = (...ids: string[]) => ({ omissions: ids.map(workspaceId => ({ workspaceId, reason: "CATALOG_REQUIRED" })) }) as TurnoExportManifestDto;
describe("catalog write capability", () => {
  it("requires edit access to every referenced workspace, not just one", () => {
    const sources = [workspace("a", true), workspace("b", false)];
    expect(canSyncCatalogReferences(manifest("a"), sources)).toBe(true);
    expect(canSyncCatalogReferences(manifest("a", "b"), sources)).toBe(false);
    expect(canSyncCatalogReferences(manifest("foreign"), sources)).toBe(false);
  });
  it("requires no edit capability for workspaces that have nothing to register", () => {
    expect(canSyncCatalogReferences(manifest("a"), [workspace("a", true), workspace("b", false)])).toBe(true);
    expect(canSyncCatalogReferences(null, [workspace("a", true)])).toBe(false);
    expect(canSyncCatalogReferences(manifest(), [workspace("a", true)])).toBe(false);
  });
});
