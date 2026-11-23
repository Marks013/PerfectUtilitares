import type { EscalaCapability, EscalaExportProjection } from "./permissions";

export const ESCALA_POLICY_ROUTES = Object.freeze([
  "/api/escalas", "/api/escalas/access/session", "/api/escalas/import", "/api/escalas/turnos",
  "/api/escalas/export", "/api/escalas/operational-report",
  "/api/escalas/turnos/export/manifest", "/api/escalas/turnos/export", "/api/escalas/turnos/opcoes",
  "/api/escalas/access/admin", "/api/escalas/approved-policy",
  "/api/escalas/workforce",
] as const);

type Scope = "branch-collection" | "workspace" | "approved-configuration" | "operation"
  | "tenant-catalog" | "workspace-selection" | "own-manifest" | "tenant" | "branch-context" | "input-baseline";
type Check = "administrator" | "current-session" | "active-operator" | "scoped-mode" | "own-session"
  | "filtered-branches" | "canonical-resource" | "current-revision" | "approved-period-policy"
  | "protected-input-diff" | "diff-capabilities" | "canonical-input-baseline" | "owned-operation"
  | "optional-owned-operation" | "authorization-recheck" | "shift-policy-and-locks"
  | "preview-hash" | "selection-revisions" | "upload-boundary"
  | "export-projection-before-cache" | "hours-only-state" | "owned-manifest" | "omission-consent";

export type EscalaRouteRequest = Readonly<{
  route: string; method: string; action?: unknown; purpose?: unknown; format?: unknown;
  projection?: unknown; workspaceId?: unknown;
}>;
type EscalaResourcePolicy = Readonly<{
  kind: "resource"; operation: string; allOf: readonly EscalaCapability[];
  scope: Scope; requiredChecks: readonly Check[]; projection?: EscalaExportProjection;
}>;
export type EscalaRoutePolicy = EscalaResourcePolicy | Readonly<{
  kind: "session"; operation: "inspect" | "enter" | "revoke-own"; requiredChecks: readonly Check[];
}> | Readonly<{ kind: "denied"; reason: "UNKNOWN_ROUTE" | "UNKNOWN_METHOD" | "UNKNOWN_ACTION" | "INVALID_SELECTOR" }>;

const denied = (reason: Extract<EscalaRoutePolicy, { kind: "denied" }>["reason"]): EscalaRoutePolicy =>
  Object.freeze({ kind: "denied", reason });
const resource = (operation: string, allOf: readonly EscalaCapability[], scope: Scope,
  requiredChecks: readonly Check[], projection?: EscalaExportProjection): EscalaResourcePolicy => Object.freeze({
    kind: "resource", operation, allOf: Object.freeze([...allOf]), scope,
    requiredChecks: Object.freeze([...requiredChecks]), ...(projection ? { projection } : {}),
  });
const session = (operation: "inspect" | "enter" | "revoke-own", checks: readonly Check[]): EscalaRoutePolicy =>
  Object.freeze({ kind: "session", operation, requiredChecks: Object.freeze([...checks]) });

const workspaceCommands = new Map<string, EscalaResourcePolicy>([
  ["CREATE", resource("workspace.create", ["workspace.create", "settings.manage"], "approved-configuration",
    ["canonical-resource", "approved-period-policy", "protected-input-diff", "diff-capabilities"])],
  ["CREATE_APPROVED", resource("workspace.create-approved", ["workspace.create"], "approved-configuration",
    ["canonical-resource", "approved-period-policy", "protected-input-diff", "authorization-recheck"])],
  ["APPLY_PROPOSAL", resource("workspace.apply-proposal", ["workspace.save", "schedule.apply"], "workspace",
    ["canonical-resource", "current-revision", "approved-period-policy", "protected-input-diff", "authorization-recheck"])],
  ["ADD_EMPLOYEE", resource("workspace.add-employee", ["workspace.save", "employee.manage"], "workspace",
    ["canonical-resource", "current-revision", "approved-period-policy", "authorization-recheck"])],
  ["REMOVE_EMPLOYEE", resource("workspace.remove-employee", ["workspace.save", "employee.manage"], "workspace",
    ["canonical-resource", "current-revision", "approved-period-policy", "protected-input-diff", "authorization-recheck"])],
  ["ADD_ABSENCE", resource("workspace.add-absence", ["workspace.save", "employee.manage"], "workspace",
    ["canonical-resource", "current-revision", "approved-period-policy", "protected-input-diff", "authorization-recheck"])],
  ["REMOVE_ABSENCE", resource("workspace.remove-absence", ["workspace.save", "employee.manage"], "workspace",
    ["canonical-resource", "current-revision", "approved-period-policy", "protected-input-diff", "authorization-recheck"])],
  ["ADMIN_REBASE", resource("workspace.admin-rebase", ["settings.manage", "workspace.save"], "workspace",
    ["canonical-resource", "current-revision", "approved-period-policy", "authorization-recheck"])],
  ["UPGRADE_CALENDAR", resource("workspace.upgrade-calendar", ["workspace.read", "workspace.save", "workspace.create", "settings.manage"], "workspace",
    ["administrator", "canonical-resource", "current-revision", "authorization-recheck"])],
  ["SAVE", resource("workspace.save", ["workspace.save"], "workspace",
    ["canonical-resource", "current-revision", "protected-input-diff", "diff-capabilities", "shift-policy-and-locks"])],
  // Baseline may be a persisted workspace/revision or an approved configuration for an unsaved draft.
  ["VALIDATE", resource("workspace.validate", ["workspace.save"], "input-baseline",
    ["canonical-input-baseline", "protected-input-diff", "diff-capabilities", "shift-policy-and-locks"])],
  ["START_GENERATION", resource("generation.start", ["schedule.generate"], "workspace",
    ["canonical-resource", "current-revision", "approved-period-policy", "owned-operation", "authorization-recheck"])],
  ["GENERATE", resource("generation.run", ["schedule.generate"], "workspace",
    ["canonical-resource", "current-revision", "approved-period-policy", "optional-owned-operation", "authorization-recheck"])],
  ["CANCEL_GENERATION", resource("generation.cancel", ["schedule.generate"], "operation",
    ["canonical-resource", "owned-operation", "authorization-recheck"])],
  ["GENERATION_STATUS", resource("generation.status", ["schedule.generate"], "operation",
    ["canonical-resource", "owned-operation", "authorization-recheck"])],
  ["PUBLISH", resource("workspace.publish", ["workspace.publish"], "workspace",
    ["canonical-resource", "current-revision", "shift-policy-and-locks"])],
  ["REOPEN_PUBLICATION", resource("workspace.reopen-publication", ["workspace.publish"], "workspace",
    ["canonical-resource", "current-revision", "authorization-recheck"])],
  ["SYNC_WORKFORCE", resource("workspace.sync-workforce", ["workspace.save"], "workspace",
    ["canonical-resource", "current-revision", "approved-period-policy", "authorization-recheck"])],
]);
const shiftCommands = new Map<string, EscalaResourcePolicy>([
  ["SYNC", resource("catalog.sync", ["settings.manage", "shift.manage"], "workspace-selection",
    ["canonical-resource", "selection-revisions"])],
  ["PREVIEW_SWAP", resource("shift.preview-swap", ["shift.manage"], "workspace",
    ["canonical-resource", "current-revision", "shift-policy-and-locks"])],
  ["APPLY_SWAP", resource("shift.apply-swap", ["shift.manage", "workspace.save"], "workspace",
    ["canonical-resource", "current-revision", "preview-hash", "shift-policy-and-locks", "diff-capabilities", "authorization-recheck"])],
]);

const selectors = ["action", "purpose", "format", "projection", "workspaceId"] as const;
function expectedSelectors(request: EscalaRouteRequest): readonly typeof selectors[number][] {
  if (request.route === "/api/escalas") return request.method === "POST" ? ["action"] : request.method === "GET" ? ["workspaceId"] : [];
  if (request.route === "/api/escalas/turnos/opcoes" && request.method === "GET") return ["workspaceId"];
  if (request.route === "/api/escalas/turnos" && request.method === "POST") return ["action"];
  if (["/api/escalas/access/admin", "/api/escalas/approved-policy"].includes(request.route) && request.method === "POST") return ["action"];
  if (request.route === "/api/escalas/import" && request.method === "POST") return ["purpose"];
  if (request.route === "/api/escalas/workforce" && request.method === "POST") return ["action", "purpose"];
  if (request.route === "/api/escalas/export" && request.method === "GET") return ["format", "projection"];
  if (request.route === "/api/escalas/turnos/export" && request.method === "GET") return ["format"];
  return [];
}

/**
 * Classifies canonical route metadata; never authorizes a request. All requiredChecks remain mandatory.
 * HTTP parsing/origin/rate limits and resource resolution remain the caller's responsibility.
 * In particular, SAVE/CREATE need capabilities derived from a trusted diff, not client-supplied flags.
 */
export function classifyEscalaRoute(request: EscalaRouteRequest): EscalaRoutePolicy {
  if (!ESCALA_POLICY_ROUTES.some(route => route === request.route)) return denied("UNKNOWN_ROUTE");
  const expected = expectedSelectors(request);
  if (selectors.some(key => request[key] !== undefined && !expected.includes(key))) return denied("INVALID_SELECTOR");
  if (request.route === "/api/escalas/access/session") {
    if (request.method === "GET") return session("inspect", ["current-session", "active-operator", "scoped-mode"]);
    if (request.method === "POST") return session("enter", ["active-operator", "scoped-mode"]);
    if (request.method === "DELETE") return session("revoke-own", ["own-session"]);
    return denied("UNKNOWN_METHOD");
  }
  if (request.route === "/api/escalas/access/admin") {
    if (request.method === "GET") return resource("access.list", ["access.manage"], "tenant", ["current-session"]);
    if (request.method !== "POST") return denied("UNKNOWN_METHOD");
    if (typeof request.action !== "string" || !["CREATE_OPERATOR", "UPDATE_OPERATOR", "REPLACE_BRANCH_GRANTS", "REVOKE_SESSIONS", "SET_ACCESS_MODE"].includes(request.action)) return denied("UNKNOWN_ACTION");
    return resource("access.administer", ["access.manage"], "tenant", ["current-session", "authorization-recheck"]);
  }
  if (request.route === "/api/escalas/approved-policy") {
    if (request.method === "GET") return resource("configuration.list", ["workspace.read"], "approved-configuration", ["canonical-resource"]);
    if (request.method !== "POST") return denied("UNKNOWN_METHOD");
    if (request.action !== "APPROVE" && request.action !== "REVOKE") return denied("UNKNOWN_ACTION");
    return resource("configuration.administer", ["settings.manage"], "approved-configuration", ["canonical-resource", "authorization-recheck"]);
  }
  if (request.route === "/api/escalas") {
    if (request.method === "POST") return typeof request.action === "string"
      ? workspaceCommands.get(request.action) ?? denied("UNKNOWN_ACTION") : denied("UNKNOWN_ACTION");
    if (request.method === "GET") {
      if (request.workspaceId === undefined) return resource("workspace.list", ["workspace.read"], "branch-collection", ["filtered-branches"]);
      if (typeof request.workspaceId !== "string" || !request.workspaceId.trim() || request.workspaceId.length > 100) return denied("INVALID_SELECTOR");
      return resource("workspace.read", ["workspace.read"], "workspace", ["canonical-resource"]);
    }
    if (request.method === "DELETE") return resource("workspace.delete", ["workspace.delete"], "workspace", ["canonical-resource", "current-revision"]);
    return denied("UNKNOWN_METHOD");
  }
  if (request.route === "/api/escalas/import") {
    if (request.method === "GET") return resource("import.template", ["import.manage"], "tenant", []);
    if (request.method !== "POST") return denied("UNKNOWN_METHOD");
    const purpose = request.purpose === undefined ? "EMPLOYEES" : request.purpose;
    if (purpose !== "EMPLOYEES" && purpose !== "ABSENCES") return denied("INVALID_SELECTOR");
    // Administrative preparation can precede policy approval. It must not require the snapshot it is preparing.
    return purpose === "EMPLOYEES"
      ? resource("import.employees", ["import.manage"], "tenant", ["upload-boundary"])
      : resource("import.absences", ["import.manage"], "branch-context", ["canonical-input-baseline", "upload-boundary"]);
  }
  if (request.route === "/api/escalas/workforce") {
    if (request.method === "GET") return resource("workforce.read", ["employee.manage"], "branch-context", ["canonical-resource"]);
    if (request.method !== "POST") return denied("UNKNOWN_METHOD");
    if (request.action === "IMPORT_PREVIEW" || request.action === "IMPORT_APPLY") {
      if (request.purpose !== "EMPLOYEES" && request.purpose !== "ABSENCES") return denied("INVALID_SELECTOR");
      return resource("workforce.import", ["import.manage"], "tenant",
        ["administrator", "upload-boundary", "current-revision", "preview-hash", "authorization-recheck"]);
    }
    if (request.purpose !== undefined) return denied("INVALID_SELECTOR");
    if (typeof request.action !== "string" || !["CREATE_PERSON", "UPDATE_PERSON", "SET_ABSENCE", "REMOVE_ABSENCE", "SET_RETURN_DATE", "DISMISS_PERSON"].includes(request.action)) return denied("UNKNOWN_ACTION");
    return resource("workforce.edit", ["employee.manage"], "branch-context",
      ["canonical-resource", "current-revision", "authorization-recheck"]);
  }
  if (request.route === "/api/escalas/turnos/opcoes") return request.method === "GET"
    ? resource("shift.catalog-options", ["workspace.read", "shift.manage"], "workspace",
      ["canonical-resource", "current-revision", "approved-period-policy", "authorization-recheck"])
    : denied("UNKNOWN_METHOD");
  if (request.route === "/api/escalas/turnos") {
    if (request.method === "GET") return resource("catalog.read", ["workspace.read"], "tenant-catalog", ["filtered-branches"]);
    if (request.method === "POST") return typeof request.action === "string"
      ? shiftCommands.get(request.action) ?? denied("UNKNOWN_ACTION") : denied("UNKNOWN_ACTION");
    return denied("UNKNOWN_METHOD");
  }
  if (request.route === "/api/escalas/export") {
    if (request.method !== "GET") return denied("UNKNOWN_METHOD");
    if (request.format !== "pdf" && request.format !== "xlsx") return denied("INVALID_SELECTOR");
    const projection = request.projection === undefined ? "BASIC_SCHEDULE" : request.projection;
    if (projection !== "BASIC_SCHEDULE" && projection !== "ADMIN_FULL") return denied("INVALID_SELECTOR");
    if (projection === "ADMIN_FULL" && request.format !== "pdf") return denied("INVALID_SELECTOR");
    const allOf: EscalaCapability[] = [`export.schedule.${request.format}`];
    if (projection === "ADMIN_FULL") allOf.push("report.analytics");
    return resource("schedule.export", allOf, "workspace",
      ["canonical-resource", "current-revision", "export-projection-before-cache", "hours-only-state"], projection);
  }
  if (request.route === "/api/escalas/operational-report") return request.method === "GET"
    ? resource("report.analytics", ["report.analytics"], "workspace", ["canonical-resource", "current-revision", "hours-only-state"])
    : denied("UNKNOWN_METHOD");
  if (request.route === "/api/escalas/turnos/export/manifest") return request.method === "POST"
    ? resource("integration.manifest", ["export.integration"], "workspace-selection", ["canonical-resource", "selection-revisions", "owned-manifest"])
    : denied("UNKNOWN_METHOD");
  if (request.route !== "/api/escalas/turnos/export") return denied("UNKNOWN_ROUTE");
  if (request.method !== "GET") return denied("UNKNOWN_METHOD");
  if (request.format !== "TXT1" && request.format !== "TXT2") return denied("INVALID_SELECTOR");
  return resource("integration.download", ["export.integration"], "own-manifest",
    ["owned-manifest", "selection-revisions", "omission-consent", "authorization-recheck"]);
}
