import type { EscalaWorkspace } from "@/lib/escalas/types";
import type { TurnoExportManifestDto } from "@/lib/escalas/shift-catalog/contracts";

export function canSyncCatalogReferences(manifest: TurnoExportManifestDto | null, workspaces: EscalaWorkspace[]) {
  const required = manifest?.omissions.filter(item => item.reason === "CATALOG_REQUIRED") ?? [];
  const editable = new Set(workspaces.filter(workspace => workspace.canEdit).map(workspace => workspace.id));
  return required.length > 0 && required.every(item => editable.has(item.workspaceId));
}
