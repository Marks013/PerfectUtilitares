import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decideEscalaPermission, ESCALA_OPERATOR_CAPABILITIES, type EscalaPrincipal } from "./permissions";
import { classifyEscalaRoute, ESCALA_POLICY_ROUTES, type EscalaRouteRequest } from "./route-policy";

const root = "/api/escalas";
const operator = (capabilities: readonly string[] = ESCALA_OPERATOR_CAPABILITIES): EscalaPrincipal => ({
  kind: "operator", id: "person-a", tenantId: "tenant-a", active: true,
  branchGrants: [{ tenantId: "tenant-a", operatorId: "person-a", branchCode: "01", active: true, capabilities }],
});
const administrator: EscalaPrincipal = {
  kind: "account", id: "admin-a", tenantId: "tenant-a", status: "ACTIVE", role: "ADMIN", branchGrants: [],
};
// Exercises capability composition only. The classifier deliberately does not execute domain checks.
function hasCapabilities(request: EscalaRouteRequest, principal = operator(), branchCode = "01", tenantId = "tenant-a") {
  const policy = classifyEscalaRoute(request);
  return policy.kind === "resource" && policy.allOf.every(capability =>
    decideEscalaPermission({ principal, branchCode, tenantId, mode: "SCOPED" }, capability).allowed);
}
function policy(request: EscalaRouteRequest) {
  const result = classifyEscalaRoute(request);
  if (result.kind !== "resource") throw new Error(`Expected a resource policy: ${request.route} ${request.method}`);
  return result;
}
const command = (action: string): EscalaRouteRequest => ({ route: root, method: "POST", action });
const shift = (action: string): EscalaRouteRequest => ({ route: `${root}/turnos`, method: "POST", action });

describe("Escalas route authorization contract, before handler integration", () => {
  it("keeps session entry and own-session revocation separate from workspace permissions", () => {
    expect(classifyEscalaRoute({ route: `${root}/access/session`, method: "POST" })).toEqual({
      kind: "session", operation: "enter", requiredChecks: ["active-operator", "scoped-mode"],
    });
    expect(classifyEscalaRoute({ route: `${root}/access/session`, method: "GET" })).toMatchObject({
      kind: "session", operation: "inspect", requiredChecks: ["current-session", "active-operator", "scoped-mode"],
    });
    expect(classifyEscalaRoute({ route: `${root}/access/session`, method: "DELETE" })).toEqual({
      kind: "session", operation: "revoke-own", requiredChecks: ["own-session"],
    });
  });

  it("distinguishes a filtered collection and tenant catalog from an individual workspace", () => {
    expect(policy({ route: root, method: "GET" })).toMatchObject({ scope: "branch-collection", requiredChecks: ["filtered-branches"] });
    expect(policy({ route: `${root}/turnos`, method: "GET" })).toMatchObject({ scope: "tenant-catalog", requiredChecks: ["filtered-branches"] });
    expect(policy({ route: root, method: "GET", workspaceId: "workspace-a" })).toMatchObject({ scope: "workspace", requiredChecks: ["canonical-resource"] });
    for (const workspaceId of [null, "", " ", 1, "a".repeat(101)]) {
      expect(classifyEscalaRoute({ route: root, method: "GET", workspaceId }).kind).toBe("denied");
    }
  });

  it("keeps approved configuration, protected diffs and canonical validation as outstanding gates", () => {
    expect(policy(command("CREATE")).requiredChecks).toEqual(expect.arrayContaining(["approved-period-policy", "protected-input-diff", "diff-capabilities"]));
    expect(policy(command("SAVE")).requiredChecks).toEqual(expect.arrayContaining(["current-revision", "protected-input-diff", "diff-capabilities"]));
    expect(policy(command("VALIDATE"))).toMatchObject({ scope: "input-baseline", requiredChecks: expect.arrayContaining(["canonical-input-baseline"]) });
    expect(policy(command("VALIDATE")).allOf).toEqual(["workspace.save"]);
    expect(classifyEscalaRoute(command("APPLY")).kind).toBe("denied");
  });

  it("allows generation without prematurely requiring the separate apply capability", () => {
    for (const action of ["GENERATE", "START_GENERATION", "CANCEL_GENERATION", "GENERATION_STATUS"]) {
      expect(hasCapabilities(command(action), operator(["schedule.generate"]))).toBe(true);
      expect(policy(command(action)).requiredChecks).toContain("authorization-recheck");
    }
    expect(policy(command("GENERATE")).requiredChecks).toContain("optional-owned-operation");
    for (const action of ["CANCEL_GENERATION", "GENERATION_STATUS"]) {
      expect(policy(command(action))).toMatchObject({ scope: "operation", requiredChecks: ["canonical-resource", "owned-operation", "authorization-recheck"] });
      expect(hasCapabilities(command(action), operator(["workspace.read"]))).toBe(false);
    }
  });

  it("reserves templates and every import preview for administrators before parsing uploads", () => {
    const requests = [
      { route: `${root}/import`, method: "GET" },
      { route: `${root}/import`, method: "POST" },
      { route: `${root}/import`, method: "POST", purpose: "ABSENCES" },
    ];
    for (const request of requests) {
      expect(hasCapabilities(request)).toBe(false);
      expect(hasCapabilities(request, administrator)).toBe(true);
    }
    expect(policy(requests[1]).operation).toBe("import.employees");
    expect(policy(requests[1]).requiredChecks).not.toContain("approved-period-policy");
    expect(policy(requests[2]).requiredChecks).toContain("canonical-input-baseline");
    for (const purpose of [null, "EMPLOYEE", "MANUAL", "", {}]) {
      expect(classifyEscalaRoute({ route: `${root}/import`, method: "POST", purpose }).kind).toBe("denied");
    }
  });

  it("does not reinterpret a one-source catalog SYNC as a manual operator registration", () => {
    expect(policy(shift("SYNC"))).toMatchObject({ allOf: ["settings.manage", "shift.manage"], scope: "workspace-selection" });
    expect(hasCapabilities(shift("SYNC"))).toBe(false);
    expect(hasCapabilities(shift("SYNC"), administrator)).toBe(true);
    expect(classifyEscalaRoute({ ...shift("SYNC"), purpose: "MANUAL" }).kind).toBe("denied");
  });

  it("limits shift alternatives to users with shift permissions in the selected branch", () => {
    const request = { route: `${root}/turnos/opcoes`, method: "GET" };
    expect(policy(request)).toMatchObject({ scope: "workspace", requiredChecks: expect.arrayContaining(["canonical-resource", "current-revision"]) });
    expect(hasCapabilities(request, operator(["workspace.read", "shift.manage"]))).toBe(true);
    expect(hasCapabilities(request, operator(["workspace.read"]))).toBe(false);
    expect(hasCapabilities(request, operator(), "02")).toBe(false);
    expect(hasCapabilities(request, administrator, "01", "tenant-b")).toBe(false);
  });

  it("authorizes calendar upgrade only for the administrator of the workspace company", () => {
    const request = command("UPGRADE_CALENDAR");
    expect(policy(request)).toMatchObject({ scope: "workspace", requiredChecks: expect.arrayContaining(["canonical-resource", "current-revision"]) });
    expect(hasCapabilities(request)).toBe(false);
    expect(hasCapabilities(request, administrator)).toBe(true);
    expect(hasCapabilities(request, administrator, "01", "tenant-b")).toBe(false);
  });

  it("requires all fixed capabilities for applying a swap and retains conditional diff checks", () => {
    expect(hasCapabilities(shift("PREVIEW_SWAP"), operator(["shift.manage"]))).toBe(true);
    expect(hasCapabilities(shift("APPLY_SWAP"), operator(["shift.manage", "workspace.save"]))).toBe(true);
    for (const capabilities of [["shift.manage"], ["workspace.save"], ["employee.manage"]]) {
      expect(hasCapabilities(shift("APPLY_SWAP"), operator(capabilities))).toBe(false);
    }
    expect(policy(shift("APPLY_SWAP")).requiredChecks).toEqual(expect.arrayContaining(["preview-hash", "diff-capabilities", "authorization-recheck"]));
    expect(policy(shift("APPLY_SWAP")).allOf).not.toContain("employee.manage");
  });

  it.each(["pdf", "xlsx"])("allows basic %s only in scope and makes full analysis administrative", format => {
    const request = { route: `${root}/export`, method: "GET", format };
    expect(hasCapabilities(request)).toBe(true);
    expect(hasCapabilities(request, operator(), "02")).toBe(false);
    expect(hasCapabilities(request, operator(), "01", "tenant-b")).toBe(false);
    expect(hasCapabilities({ ...request, projection: "ADMIN_FULL" })).toBe(false);
    expect(hasCapabilities({ ...request, projection: "ADMIN_FULL" }, administrator)).toBe(format === "pdf");
    expect(policy(request).projection).toBe("BASIC_SCHEDULE");
    expect(policy(request).requiredChecks).toContain("export-projection-before-cache");
    expect(policy(request).requiredChecks).toContain("hours-only-state");
    expect(hasCapabilities(request, operator([format === "pdf" ? "export.schedule.xlsx" : "export.schedule.pdf"]))).toBe(false);
    for (const projection of [null, "admin", "", {}]) expect(classifyEscalaRoute({ ...request, projection }).kind).toBe("denied");
  });

  it("keeps reports, manifests and both TXT downloads administrative", () => {
    const requests = [
      { route: `${root}/operational-report`, method: "GET" },
      { route: `${root}/turnos/export/manifest`, method: "POST" },
      ...["TXT1", "TXT2"].map(format => ({ route: `${root}/turnos/export`, method: "GET", format })),
    ];
    for (const request of requests) {
      expect(hasCapabilities(request)).toBe(false);
      expect(hasCapabilities(request, administrator)).toBe(true);
      expect(hasCapabilities(request, administrator, "01", "tenant-b")).toBe(false);
    }
    expect(policy(requests[2]).requiredChecks).toContain("authorization-recheck");
  });

  it("preserves publication for a legacy APPROVER only on its granted branch", () => {
    const approver: EscalaPrincipal = { kind: "account", id: "a", tenantId: "tenant-a", status: "ACTIVE", role: "OPERATOR",
      branchGrants: [{ tenantId: "tenant-a", userId: "a", branchCode: "01", role: "APPROVER" }] };
    expect(hasCapabilities(command("PUBLISH"), approver)).toBe(true);
    expect(hasCapabilities(command("PUBLISH"), approver, "02")).toBe(false);
    expect(hasCapabilities(command("PUBLISH"))).toBe(false);
    expect(hasCapabilities({ route: root, method: "DELETE" }, approver)).toBe(false);
    expect(hasCapabilities({ route: root, method: "DELETE" }, administrator)).toBe(true);
  });

  it("denies unknown routes, actions, methods, cross-route selectors and formats", () => {
    for (const request of [
      { route: `${root}/future`, method: "GET", format: "TXT1" },
      { route: root, method: "get" }, { route: root, method: "HEAD" }, { route: root, method: "OPTIONS" },
      { route: root, method: "POST" }, command("toString"), command("__proto__"), command("FUTURE"),
      shift("MANUAL"), { ...shift("PREVIEW_SWAP"), format: "pdf" },
      { route: `${root}/export`, method: "GET" }, { route: `${root}/export`, method: "GET", format: "TXT1" },
      { route: `${root}/turnos/export`, method: "GET", format: "pdf" },
      { route: `${root}/export`, method: "GET", format: "pdf", action: "PUBLISH" },
    ]) expect(classifyEscalaRoute(request).kind).toBe("denied");
  });

  it("returns immutable policies and no positive authorization verdict", () => {
    const result = policy(command("SAVE"));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.allOf)).toBe(true);
    expect(Object.isFrozen(result.requiredChecks)).toBe(true);
    expect(result).not.toHaveProperty("allowed");
    expect(classifyEscalaRoute(command("SAVE"))).toEqual(result);
  });
});

describe("closed inventory of the current route files and literal action schemas", () => {
  const apiDirectory = path.resolve(import.meta.dirname, "../../app/api/escalas");
  const source = (suffix: string) => readFileSync(path.join(apiDirectory, suffix, "route.ts"), "utf8");
  const actions = (text: string) => [...text.matchAll(/action:\s*z\.literal\("([A-Z_]+)"\)/g)].map(match => match[1]).sort();

  it("requires an explicit classification when a route file is added or removed", () => {
    function collect(directory: string): string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
        ? collect(path.join(directory, entry.name)) : entry.name === "route.ts" ? [path.join(directory, entry.name)] : []);
    }
    const found = collect(apiDirectory).map(file => {
      const suffix = path.relative(apiDirectory, path.dirname(file)).split(path.sep).join("/");
      return suffix ? `${root}/${suffix}` : root;
    }).sort();
    expect(found).toEqual([...ESCALA_POLICY_ROUTES].sort());
  });

  it("classifies every literal action of the two discriminated command schemas", () => {
    const expected = ["CREATE", "CREATE_APPROVED", "APPLY_PROPOSAL", "ADD_EMPLOYEE", "ADMIN_REBASE", "UPGRADE_CALENDAR",
      "SAVE", "VALIDATE", "GENERATE", "START_GENERATION", "CANCEL_GENERATION", "GENERATION_STATUS", "PUBLISH"].sort();
    expect(actions(source(""))).toEqual(expected);
    expect(actions(source("turnos"))).toEqual(["APPLY_SWAP", "PREVIEW_SWAP", "SYNC"]);
    for (const action of expected) expect(classifyEscalaRoute(command(action)).kind).toBe("resource");
    for (const action of actions(source("turnos"))) expect(classifyEscalaRoute(shift(action)).kind).toBe("resource");
  });

  it("detects changes in exported methods and keeps the currently refused methods denied", () => {
    const methods: [string, string[], string[]][] = [
      ["", ["GET", "POST", "DELETE"], ["PATCH"]],
      ["access/session", ["GET", "POST", "DELETE"], ["PATCH"]],
      ["import", ["GET", "POST"], ["DELETE"]],
      ["turnos", ["GET", "POST"], ["PATCH", "DELETE"]],
      ["turnos/opcoes", ["GET"], ["POST", "PATCH", "DELETE"]],
      ["export", ["GET"], ["POST"]],
      ["operational-report", ["GET"], ["POST", "HEAD", "PUT", "PATCH", "DELETE"]],
      ["turnos/export/manifest", ["POST"], ["GET", "PATCH", "DELETE"]],
      ["turnos/export", ["GET"], ["POST", "PATCH", "DELETE"]],
    ];
    for (const [suffix, implemented, refused] of methods) {
      const exported = [...source(suffix).matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|DELETE|PATCH|PUT|HEAD|OPTIONS)\b/g)].map(match => match[1]).sort();
      expect(exported, suffix).toEqual([...implemented, ...refused].sort());
      for (const method of refused) expect(classifyEscalaRoute({ route: suffix ? `${root}/${suffix}` : root, method }).kind).toBe("denied");
    }
  });
});
