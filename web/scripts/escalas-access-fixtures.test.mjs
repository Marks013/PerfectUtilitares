import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { transformSync } = require("esbuild");
// Compile the complete, current helper in memory. No copied cleanup, product imports, or real Playwright runtime.
const fixtureSource = readFileSync(new URL("../e2e/escalas-access-fixtures.ts", import.meta.url), "utf8");
const compiled = transformSync(fixtureSource, { loader: "ts", format: "cjs", target: "es2022" }).code;

function partial(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (value && typeof value === "object") partial(actual[key], value);
    else assert.equal(actual[key], value);
  }
}
function expect(actual) {
  return {
    toBe: expected => assert.equal(actual, expected),
    toBeTruthy: () => assert.ok(actual),
    toEqual: expected => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected))),
    toMatchObject: expected => partial(actual, expected),
    toHaveURL: async expected => assert.match(actual.url(), expected),
  };
}
expect.poll = callback => ({ toBe: async expected => assert.equal(await callback(), expected) });

async function harness({ approvalFailure, failures = new Map() } = {}) {
  const origin = "http://127.0.0.1:4315", calls = [], messages = [], invitations = new Map(), identities = new Map();
  const policies = new Map(), workspaces = new Map(), contexts = [], operators = new Map();
  let nextUser = 0, nextPolicy = 0, policyVersion = 0;
  const response = (status, value) => ({ status: () => status, json: async () => value });
  function record(key) {
    calls.push(key);
    const failure = failures.get(key);
    if (failure instanceof Error) throw failure;
    return typeof failure === "number" ? failure : undefined;
  }
  function api(contextName) {
    return {
      async get(url) {
        record(`GET:${url}`);
        if (url === `${origin}/__messages`) return response(200, messages);
        if (url === "/api/escalas/access/admin") return response(200, { policy: { mode: "ADMIN_ONLY", version: policyVersion }, operators: [...operators.values()] });
        if (url.startsWith("/api/escalas?id=")) return response(200, workspaces.get(decodeURIComponent(url.split("=")[1])));
        throw new Error(`Unexpected mock GET: ${url}`);
      },
      async post(url, { data }) {
        if (url === "/api/admin/tenants") { record("CREATE_TENANT"); return response(201, { id: "owned-tenant", slug: data.slug }); }
        if (url === "/api/admin/invitations") {
          const token = `synthetic-token-${invitations.size}`, inviteUrl = `${origin}/convite/${token}`;
          invitations.set(token, data); messages.push({ to: data.email, html: `<a href="${inviteUrl}">Convite</a>` });
          return response(201, { inviteUrl });
        }
        if (url === "/api/invitations/accept") {
          const invited = invitations.get(data.token), id = nextUser++ ? `removable-${nextUser}` : "owned-admin";
          const user = { id, tenantId: invited.tenantId, role: invited.role, status: "ACTIVE" }; identities.set(id, user);
          return response(201, user);
        }
        if (url === "/api/escalas/access/admin") {
          const status = record(`${data.action}:${data.operatorId ?? data.mode}`);
          if (status) return response(status, {});
          if (data.action === "SET_ACCESS_MODE") policyVersion++;
          if (data.action === "CREATE_OPERATOR") {
            const id = `operator-${operators.size + 1}`;
            operators.set(id, { id, username: data.username, displayName: data.displayName, active: true, permissionVersion: 1, branchGrants: data.branchGrants });
          }
          if (data.action === "UPDATE_OPERATOR") operators.set(data.operatorId, { ...operators.get(data.operatorId), active: false });
          return response(200, { policy: { mode: "ADMIN_ONLY", version: policyVersion }, operators: [...operators.values()] });
        }
        if (url === "/api/escalas/approved-policy") {
          if (data.action === "APPROVE") {
            record("APPROVE"); assert.equal(contextName, "context-1");
            const policy = { id: `approval-${++nextPolicy}`, approvedById: "owned-admin", revokedAt: null }; policies.set(policy.id, policy);
            if (approvalFailure === "transport") throw new Error("Synthetic lost approval acknowledgement");
            if (approvalFailure === "decode") return { status: () => 201, json: async () => { throw new Error("Synthetic unreadable acknowledgement"); } };
            return response(201, { policy });
          }
          const status = record(`REVOKE:${data.id}`);
          if (status) return response(status, {});
          policies.get(data.id).revokedAt = "2026-11-14T00:00:00.000Z";
          return response(200, { revoked: true });
        }
        throw new Error(`Unexpected mock POST: ${url}`);
      },
      async patch(url, { data }) {
        const id = url.split("/").at(-1), status = record(`BLOCK:${id}`);
        assert.deepEqual({ ...data }, { status: "BLOCKED" });
        if (status) return response(status, {});
        identities.get(id).status = data.status; return response(200, identities.get(id));
      },
      async delete(url, { data } = {}) {
        if (url === "/api/escalas") {
          const status = record(`REMOVE_WORKSPACE:${data.workspaceId}`);
          if (status) return response(status, {});
          workspaces.delete(data.workspaceId); return response(200, {});
        }
        if (url.startsWith("/api/admin/users/")) {
          const id = url.split("/").at(-1), status = record(`DELETE_USER:${id}`);
          if (status) return response(status, {});
          // Contract stub only: REVOKE retains approvedById; the real route maps the FK refusal to 404.
          if ([...policies.values()].some(policy => policy.approvedById === id)) return response(404, {});
          assert.ok(identities.delete(id)); return response(200, { id });
        }
        throw new Error(`Unexpected mock DELETE: ${url}`);
      },
    };
  }
  const browser = {
    async newContext() {
      const name = `context-${contexts.length}`, request = api(name);
      const context = {
        name, closeAttempted: false,
        async newPage() {
          let url = `${origin}/dashboard`;
          return { request, context: () => context, url: () => url,
            goto: async path => { url = new URL(path, origin).href; },
            locator: () => ({ fill: async () => {} }),
            getByRole: () => ({ click: async () => { url = `${origin}/dashboard`; } }),
          };
        },
        async close() { context.closeAttempted = true; record(`CLOSE:${name}`); },
      };
      contexts.push(context); return context;
    },
  };
  const module = { exports: {} };
  const sandbox = vm.createContext({ module, exports: module.exports, URL, Buffer, AggregateError, Error,
    process: { env: { E2E_MUTATION: "1", E2E_OWNED_ACCOUNT_PROVISIONING: "1", E2E_EXTERNAL_URL: origin,
      E2E_RESEND_CAPTURE_URL: `${origin}/__messages`, RESEND_API_BASE_URL: origin } },
    require(id) {
      if (id === "node:crypto") return require(id);
      if (id === "./fixtures") return { expect, test: { info: () => ({ testId: "pure-cleanup", project: { use: { baseURL: origin } } }) } };
      if (id === "./admin-session") return { loginAsAdmin: async () => {} };
      if (id === "./escalas-selection") return {};
      throw new Error(`Forbidden import in pure fixture test: ${id}`);
    },
  });
  new vm.Script(compiled, { filename: "escalas-access-fixtures.compiled.cjs" }).runInContext(sandbox);
  const scope = await module.exports.ownedAccountScope(browser, "e2e-cleanup-owned");
  const input = { assignments: [], employees: [] };
  function workspace(id) {
    const value = { id, revision: 1, status: "DRAFT", input: { branchCode: `BRANCH-${id}` } }; workspaces.set(id, value); scope.trackWorkspace(value); return value;
  }
  return { scope, input, workspace, calls, policies, identities, contexts, workspaces, operators, failures };
}

test("an approver is blocked and retained; the other owned account and draft are removed", async () => {
  const h = await harness(); await h.scope.createUser("OPERATOR"); h.workspace("draft-1");
  await h.scope.approve(h.input); await h.scope.cleanup();
  assert.equal(h.identities.get("owned-admin").status, "BLOCKED");
  assert.equal(h.identities.size, 1); assert.equal(h.workspaces.size, 0);
  assert.ok(h.policies.get("approval-1").revokedAt);
  assert.ok(!h.calls.includes("DELETE_USER:owned-admin"));
  assert.ok(h.calls.includes("DELETE_USER:removable-2"));
  assert.ok(h.contexts.every(context => context.closeAttempted));
});

for (const approvalFailure of ["transport", "decode"]) {
  test(`an uncertain approval (${approvalFailure}) retains its signer even without a returned policy ID`, async () => {
    const h = await harness({ approvalFailure }); await h.scope.createUser("OPERATOR");
    await assert.rejects(h.scope.approve(h.input), /Synthetic/); await h.scope.cleanup();
    assert.equal(h.identities.get("owned-admin").status, "BLOCKED");
    assert.equal(h.identities.size, 1); assert.equal(h.policies.size, 1);
    assert.equal(h.policies.get("approval-1").revokedAt, null);
    assert.ok(!h.calls.includes("DELETE_USER:owned-admin"));
    assert.ok(h.calls.includes("DELETE_USER:removable-2"));
    assert.ok(h.contexts.every(context => context.closeAttempted));
    assert.ok(!h.calls.some(call => call.includes("DELETE_TENANT")));
  });
}

test("independent cleanup and every context close continue after intermediate failures, which are aggregated", async () => {
  const h = await harness(); await h.scope.createUser("OPERATOR"); await h.scope.createUser("OPERATOR");
  h.workspace("draft-1"); h.workspace("draft-2"); await h.scope.approve(h.input); await h.scope.approve(h.input);
  await h.scope.createOperator([]); await h.scope.createOperator([]);
  h.failures.set("UPDATE_OPERATOR:operator-1", 500);
  h.failures.set("SET_ACCESS_MODE:ADMIN_ONLY", 500);
  h.failures.set("REMOVE_WORKSPACE:draft-1", 500); h.failures.set("REVOKE:approval-1", 500);
  h.failures.set("DELETE_USER:removable-2", 404); h.failures.set("CLOSE:context-1", new Error("Synthetic close failure"));
  let failure; try { await h.scope.cleanup(); } catch (error) { failure = error; }
  assert.ok(failure instanceof AggregateError); assert.equal(failure.errors.length, 6);
  assert.equal(h.operators.get("operator-1").active, true); assert.equal(h.operators.get("operator-2").active, false);
  assert.ok(h.workspaces.has("draft-1")); assert.ok(!h.workspaces.has("draft-2"));
  assert.equal(h.policies.get("approval-1").revokedAt, null); assert.ok(h.policies.get("approval-2").revokedAt);
  assert.equal(h.identities.get("owned-admin").status, "BLOCKED");
  assert.ok(h.identities.has("removable-2")); assert.ok(!h.identities.has("removable-3"));
  assert.ok(h.contexts.every(context => context.closeAttempted));
  assert.ok(failure.errors.some(error => error.cause?.message.includes("404")));
});

test("without an approval attempt the owned admin remains removable", async () => {
  const h = await harness(); await h.scope.createUser("OPERATOR"); await h.scope.cleanup();
  assert.equal(h.identities.size, 0); assert.ok(h.calls.includes("DELETE_USER:owned-admin"));
  assert.ok(h.contexts.every(context => context.closeAttempted));
});

test("a failed signer block is reported, never replaced by a physical delete, and other resources still close", async () => {
  const h = await harness(); await h.scope.createUser("OPERATOR"); await h.scope.approve(h.input);
  h.failures.set("BLOCK:owned-admin", 500);
  await assert.rejects(h.scope.cleanup(), error => error instanceof AggregateError && error.errors.length === 1);
  assert.ok(!h.calls.includes("DELETE_USER:owned-admin")); assert.ok(h.calls.includes("DELETE_USER:removable-2"));
  assert.ok(h.contexts.every(context => context.closeAttempted));
});
