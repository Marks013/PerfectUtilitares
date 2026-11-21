import { renderToStaticMarkup } from "react-dom/server";
import type { Key, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalaClientAccess } from "@/lib/escalas/access-view";
import type { EscalaSessionResponse } from "@/lib/escalas/access-contracts";

const mocks = vi.hoisted(() => ({ account: vi.fn(), module: vi.fn(), policy: vi.fn(), grants: vi.fn(), workspace: vi.fn() }));
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[], deps: [] as (readonly unknown[] | undefined)[], cleanup: [] as ((() => void) | undefined)[],
  effects: [] as (() => void)[], cursor: 0, changed: false,
  buttons: new Map<string, { disabled?: boolean; onClick?: () => void | Promise<void> }>(),
  input: null as null | { onChange: (event: { target: { value: string } }) => void },
  form: null as null | ((event: { preventDefault: () => void }) => Promise<void>),
  protectedKey: null as Key | null,
  inputDisabled: false, focusName: vi.fn(),
}));

// Render the real page/boundary with stateful primitives and real session-client parsing.
// This harness has no browser DOM; focus and visual behavior remain an integration check.
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  const changed = (slot: number, deps?: readonly unknown[]) => !deps || !hooks.deps[slot]
    || deps.length !== hooks.deps[slot]?.length || deps.some((value, index) => !Object.is(value, hooks.deps[slot]?.[index]));
  return { ...actual,
    useState<T>(initial?: T | (() => T)) {
      const slot = hooks.cursor++;
      if (!(slot in hooks.slots)) hooks.slots[slot] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [hooks.slots[slot] as T, (next: T | ((previous: T) => T)) => {
        const value = typeof next === "function" ? (next as (previous: T) => T)(hooks.slots[slot] as T) : next;
        if (!Object.is(hooks.slots[slot], value)) { hooks.slots[slot] = value; hooks.changed = true; }
      }];
    },
    useRef<T>(initial: T) {
      const slot = hooks.cursor++;
      if (!(slot in hooks.slots)) hooks.slots[slot] = { current: initial };
      return hooks.slots[slot];
    },
    useCallback<T>(callback: T, deps: readonly unknown[]) {
      const slot = hooks.cursor++;
      if (changed(slot, deps)) { hooks.slots[slot] = callback; hooks.deps[slot] = deps; }
      return hooks.slots[slot];
    },
    useEffect(effect: () => unknown, deps?: readonly unknown[]) {
      const slot = hooks.cursor++;
      if (changed(slot, deps)) {
        hooks.deps[slot] = deps;
        hooks.effects.push(() => { hooks.cleanup[slot]?.(); const cleanup = effect(); hooks.cleanup[slot] = typeof cleanup === "function" ? cleanup as () => void : undefined; });
      }
    },
  };
});
vi.mock("react/jsx-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const capture = (factory: typeof actual.jsx) => (...args: Parameters<typeof actual.jsx>) => {
    const [type, raw, key] = args;
    if (raw && typeof raw === "object") {
      const props = raw as { children?: unknown; id?: string; "aria-label"?: string; disabled?: boolean; ref?: { current: unknown }; onClick?: () => void | Promise<void>; onChange?: (event: { target: { value: string } }) => void; onSubmit?: (event: { preventDefault: () => void }) => Promise<void> };
      if (type === "button" && typeof props.children === "string") hooks.buttons.set(props.children, props);
      if (type === "input" && props.id === "escala-access-username" && props.onChange) {
        hooks.input = { onChange: props.onChange }; hooks.inputDisabled = Boolean(props.disabled);
        if (props.ref) props.ref.current = { focus: () => hooks.focusName({ disabled: Boolean(props.disabled) }) };
      }
      if (type === "form" && props.onSubmit) hooks.form = props.onSubmit;
      if (type === "div" && props["aria-label"] === "Planejamento de escalas") hooks.protectedKey = key ?? null;
    }
    return factory(...args);
  };
  return { ...actual, jsx: capture(actual.jsx), jsxs: capture(actual.jsxs) };
});
vi.mock("@/auth", () => ({ auth: mocks.account }));
vi.mock("@/lib/prisma", () => ({ prisma: { escalaModuleAccessPolicy: { findUnique: mocks.policy }, escalaBranchAccess: { findMany: mocks.grants } } }));
vi.mock("@/lib/escalas/operator-session-store", async original => ({
  ...await original<typeof import("@/lib/escalas/operator-session-store")>(), getEscalaScopedModuleSession: mocks.module,
}));
vi.mock("@/components/escalas/escalas-workspace", async () => {
  const { useEscalaClientAccess } = await import("@/components/escalas/access-context");
  return { EscalasWorkspace: () => {
    const context = useEscalaClientAccess(); mocks.workspace(context);
    return <p data-channel={context?.channel} data-administrator={String(context?.administrator)}>Planejamento protegido · {context?.branches.map(branch => branch.code).join(",")}</p>;
  } };
});

import EscalaPage, { dynamic, metadata } from "./page";
import { EscalaAccessBoundary } from "@/components/escalas/operational-access";
import { EscalasWorkspace } from "@/components/escalas/escalas-workspace";

const expiresAt = "2026-11-21T12:01:00.000Z";
const operatorContext = (branch = "02"): EscalaClientAccess => ({
  channel: "USERNAME", roleLabel: "Operador", administrator: false, allBranches: false,
  branches: [{ code: branch, label: `Filial ${branch}`, capabilities: ["workspace.read", "schedule.generate"] }], expiresAt,
});
const administrator: EscalaClientAccess = { channel: "ACCOUNT", roleLabel: "Administrador", administrator: true, allBranches: true, branches: [] };
const operatorResponse = (branch = "02"): EscalaSessionResponse => ({ access: { role: "OPERATIONAL", expiresAt }, context: operatorContext(branch) });
const malformedContexts: { label: string; context: unknown; access?: "ACCOUNT" }[] = [
  { label: "missing role label", context: { ...operatorContext(), roleLabel: undefined } },
  { label: "blank role label", context: { ...operatorContext(), roleLabel: " " } },
  { label: "invalid administrator type", context: { ...operatorContext(), administrator: "false" } },
  { label: "invalid allBranches type", context: { ...operatorContext(), allBranches: 0 } },
  { label: "unknown channel", context: { ...operatorContext(), channel: "SHARED" } },
  { label: "non-array branches", context: { ...operatorContext(), branches: {} } },
  { label: "null grant", context: { ...operatorContext(), branches: [null] } },
  { label: "incomplete grant", context: { ...operatorContext(), branches: [{ code: "02", label: "Filial 02" }] } },
  { label: "missing code", context: { ...operatorContext(), branches: [{ label: "Filial 02", capabilities: [] }] } },
  { label: "empty code", context: { ...operatorContext(), branches: [{ code: "", label: "Filial", capabilities: [] }] } },
  { label: "noncanonical code", context: { ...operatorContext(), branches: [{ code: "002", label: "Filial 02", capabilities: [] }] } },
  { label: "invalid branch label", context: { ...operatorContext(), branches: [{ code: "02", label: null, capabilities: [] }] } },
  { label: "blank branch label", context: { ...operatorContext(), branches: [{ code: "02", label: " ", capabilities: [] }] } },
  { label: "non-array capabilities", context: { ...operatorContext(), branches: [{ code: "02", label: "Filial 02", capabilities: "workspace.read" }] } },
  { label: "non-string capability", context: { ...operatorContext(), branches: [{ code: "02", label: "Filial 02", capabilities: [1] }] } },
  { label: "sparse capability array", context: { ...operatorContext(), branches: [{ code: "02", label: "Filial 02", capabilities: Array(1) }] } },
  { label: "unknown capability", context: { ...operatorContext(), branches: [{ code: "02", label: "Filial 02", capabilities: ["unknown.action"] }] } },
  { label: "duplicate capability", context: { ...operatorContext(), branches: [{ code: "02", label: "Filial 02", capabilities: ["workspace.read", "workspace.read"] }] } },
  { label: "duplicate branch", context: { ...operatorContext(), branches: [...operatorContext().branches, ...operatorContext().branches] } },
  { label: "canonical alias duplicate", context: { ...operatorContext(), branches: [...operatorContext().branches, { code: "002", label: "Alias", capabilities: [] }] } },
  { label: "unknown context property", context: { ...operatorContext(), principalId: "private-id" } },
  { label: "unknown grant property", context: { ...operatorContext(), branches: [{ ...operatorContext().branches[0], tenantId: "private-id" }] } },
  { label: "invalid expiry type", context: { ...operatorContext(), expiresAt: 1 } },
  { label: "non-ISO expiry", context: { ...operatorContext(), expiresAt: "2026-11-22" } },
  { label: "incoherent expiry", context: { ...operatorContext(), expiresAt: "2026-11-21T12:00:30.000Z" } },
  { label: "nominal administrative flags", context: { ...operatorContext(), administrator: true, allBranches: true } },
  { label: "account global flag without administrator", access: "ACCOUNT", context: { ...administrator, administrator: false } },
  { label: "account administrator without global flag", access: "ACCOUNT", context: { ...administrator, allBranches: false } },
  { label: "non-admin account administrative capability", access: "ACCOUNT", context: { ...operatorContext(), channel: "ACCOUNT", branches: [{ code: "02", label: "Filial 02", capabilities: ["settings.manage"] }] } },
  ...["workspace.publish", "workspace.delete", "import.manage", "export.integration", "report.analytics", "settings.manage", "access.manage"].map(capability => ({
    label: `nominal forbidden ${capability}`, context: { ...operatorContext(), branches: [{ code: "02", label: "Filial 02", capabilities: [capability] }] },
  })),
];
const scope = () => ({
  kind: "resolved", sessionId: "synthetic-session-id", expiresAtMs: Date.parse(expiresAt), permissionVersion: 1, accessPolicyVersion: 1,
  principal: { kind: "operator", id: "synthetic-operator-id", tenantId: "synthetic-tenant-id", active: true,
    branchGrants: [{ tenantId: "synthetic-tenant-id", operatorId: "synthetic-operator-id", branchCode: "002", active: true, capabilities: ["workspace.read", "schedule.generate"] }] },
});
function reply(status: number, body: unknown): Response { return { ok: status >= 200 && status < 300, status, json: async () => body } as Response; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
let tree: ReactElement;
let html: string;
function render() {
  hooks.cursor = 0; hooks.changed = false; hooks.buttons.clear(); hooks.input = null; hooks.form = null; hooks.protectedKey = null;
  html = renderToStaticMarkup(tree);
  for (const effect of hooks.effects.splice(0)) effect();
  return html;
}
async function settle() { for (let index = 0; index < 60; index++) { if (hooks.changed) render(); await Promise.resolve(); } if (hooks.changed) render(); }
async function mount(element: ReactElement) { tree = element; render(); await settle(); }
function fill(value: string) { if (!hooks.input) throw new Error("Username input unavailable"); hooks.input.onChange({ target: { value } }); render(); }
function submit() { if (!hooks.form) throw new Error("Entry form unavailable"); return hooks.form({ preventDefault: vi.fn() }); }
async function click(label: string) { const button = hooks.buttons.get(label); if (!button?.onClick || button.disabled) throw new Error("Action unavailable: " + label); await button.onClick(); await settle(); }
function boundary(context: EscalaClientAccess = operatorContext(), expiry = expiresAt) {
  return <EscalaAccessBoundary initialAccess="MODULE" initialContext={context} initialExpiresAt={expiry}><EscalasWorkspace /></EscalaAccessBoundary>;
}

beforeEach(() => {
  vi.resetAllMocks(); hooks.slots = []; hooks.deps = []; hooks.cleanup = []; hooks.effects = []; hooks.cursor = 0; hooks.changed = false; hooks.inputDisabled = false;
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-21T12:00:00.000Z"));
  mocks.account.mockResolvedValue(null); mocks.module.mockResolvedValue(null); mocks.policy.mockResolvedValue({ mode: "SCOPED" }); mocks.grants.mockResolvedValue([]);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay) }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0));
  vi.stubGlobal("fetch", vi.fn(async () => reply(503, { error: { code: "ESCALA_ACCESS_UNAVAILABLE", message: "synthetic-private-internal-error" } })));
});
afterEach(async () => {
  for (const cleanup of hooks.cleanup) cleanup?.();
  await Promise.resolve(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("real entry page with scoped context", () => {
  it("shows the accessible nominal form without mounting private work for an anonymous visitor", async () => {
    await mount(await EscalaPage());
    expect(html).toContain('for="escala-access-username"'); expect(html).toMatch(/autocomplete="username"/i);
    expect(html).toContain("Nome cadastrado"); expect(html).toContain("não comprova identidade pessoal");
    expect(html).not.toContain("Planejamento protegido"); expect(html).not.toContain("Senha operacional"); expect(mocks.workspace).not.toHaveBeenCalled();
    expect(dynamic).toBe("force-dynamic"); expect(metadata).toEqual({ robots: { index: false, follow: false }, title: "Escalas 5×2" });
  });
  it("preserves the authenticated administrator and never reads or unions the nominal cookie", async () => {
    mocks.account.mockResolvedValue({ user: { id: "admin", tenantId: "account-tenant", status: "ACTIVE", role: "ADMIN" } });
    mocks.module.mockResolvedValue(scope()); await mount(await EscalaPage());
    expect(mocks.workspace).toHaveBeenLastCalledWith(administrator); expect(html).toContain("Planejamento protegido");
    expect(html).not.toContain("Nome cadastrado"); expect(mocks.module).not.toHaveBeenCalled(); expect(mocks.grants).not.toHaveBeenCalled();
  });
  it("keeps a non-admin account scoped instead of promoting it or using the nominal cookie", async () => {
    mocks.account.mockResolvedValue({ user: { id: "account", tenantId: "account-tenant", status: "ACTIVE", role: "OPERATOR" } });
    mocks.grants.mockResolvedValue([{ tenantId: "account-tenant", userId: "account", branchCode: "008", role: "VIEWER" }]);
    mocks.module.mockResolvedValue(scope()); await mount(await EscalaPage());
    expect(mocks.workspace).toHaveBeenLastCalledWith(expect.objectContaining({ channel: "ACCOUNT", administrator: false, allBranches: false, branches: [expect.objectContaining({ code: "08" })] }));
    expect(html).not.toContain("Nome cadastrado"); expect(mocks.module).not.toHaveBeenCalled();
  });
  it.each([{ status: "BLOCKED", tenantId: "company" }, { status: "BANNED", tenantId: "company" }, { status: "ACTIVE", tenantId: null }])("does not fall back after an invalid account: %j", async user => {
    mocks.account.mockResolvedValue({ user: { id: "blocked-account", role: "OPERATOR", ...user } }); mocks.module.mockResolvedValue(scope());
    await mount(await EscalaPage());
    expect(html).toContain("Acesso a Escalas indisponível para esta conta"); expect(html).not.toContain("Nome cadastrado");
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.module).not.toHaveBeenCalled();
  });
  it("mounts a verified nominal session with its canonical branch and no internal identifiers", async () => {
    mocks.module.mockResolvedValue(scope()); await mount(await EscalaPage());
    expect(mocks.workspace).toHaveBeenLastCalledWith(operatorContext()); expect(html).toContain("Bloquear Escalas");
    expect(html).not.toContain("synthetic-session-id"); expect(html).not.toContain("synthetic-operator-id"); expect(html).not.toContain("synthetic-tenant-id");
  });
  it.each(["authentication", "account-context", "nominal-session"])("reports %s infrastructure failure without an anonymous fallback", async source => {
    const failure = new Error("synthetic-private-file-and-stack");
    if (source === "authentication") mocks.account.mockRejectedValue(failure);
    if (source === "account-context") { mocks.account.mockResolvedValue({ user: { id: "account", tenantId: "tenant", status: "ACTIVE", role: "OPERATOR" } }); mocks.policy.mockRejectedValue(failure); }
    if (source === "nominal-session") mocks.module.mockRejectedValue(failure);
    await mount(await EscalaPage());
    expect(html).toContain("O serviço de acesso está indisponível"); expect(html).not.toContain("Nome cadastrado");
    expect(html).not.toContain("synthetic-private"); expect(mocks.workspace).not.toHaveBeenCalled();
    if (source !== "nominal-session") expect(mocks.module).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("real nominal boundary and session client", () => {
  it("submits only username and mounts the returned provider on success", async () => {
    await mount(<EscalaAccessBoundary initialAccess={null}><EscalasWorkspace /></EscalaAccessBoundary>);
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, operatorResponse())); fill("  Operador sintético  ");
    await submit(); await settle();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ username: "Operador sintético" });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/escalas/access/session");
    expect(mocks.workspace).toHaveBeenLastCalledWith(operatorContext()); expect(html).toContain("Planejamento protegido");
    expect(html).not.toContain("Nome cadastrado"); expect(html).not.toContain("tenantId");
  });
  it("uses an account response as the whole context without unioning the submitted name", async () => {
    await mount(<EscalaAccessBoundary initialAccess={null}><EscalasWorkspace /></EscalaAccessBoundary>);
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, { access: { role: "ACCOUNT" }, context: administrator })); fill("Nome sem autoridade");
    await submit(); await settle();
    expect(mocks.workspace).toHaveBeenLastCalledWith(administrator); expect(html).not.toContain("Bloquear Escalas");
    expect(html).not.toContain("Nome sem autoridade");
  });
  it.each([400, 401, 403, 429, 503])("keeps a failed POST %s private and offers retry without mounting the workspace", async status => {
    await mount(<EscalaAccessBoundary initialAccess={null}><EscalasWorkspace /></EscalaAccessBoundary>);
    vi.mocked(fetch).mockResolvedValueOnce(reply(status, { error: { code: "SYNTHETIC", message: "synthetic-private-file-and-stack" } })); fill("Operador");
    await submit(); await settle();
    expect(html).toContain('role="alert"'); expect(html).toContain('aria-invalid="true"'); expect(html).toContain("Tentar novamente");
    expect(html).not.toContain("synthetic-private"); expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it("keeps a 503 DELETE as an unconfirmed lock, preserving the current mounted context", async () => {
    await mount(boundary()); const key = hooks.protectedKey; const locked = vi.fn(); window.addEventListener("escalas:unlock-required", locked);
    vi.mocked(fetch).mockResolvedValueOnce(reply(503, { error: { code: "ESCALA_ACCESS_UNAVAILABLE" } })); await click("Bloquear Escalas");
    expect(html).toContain("Não foi possível confirmar o bloqueio"); expect(html).toContain("Planejamento protegido");
    expect(html).not.toContain("Nome cadastrado"); expect(hooks.protectedKey).toBe(key); expect(locked).not.toHaveBeenCalled();
  });
  it.each([{ status: 204, body: null }, { status: 200, body: null }, { status: 200, body: {} }, { status: 200, body: { revoked: false } },
    { status: 200, body: { revoked: "true" } }, { status: 200, body: true }, { status: 200, body: [] }])("keeps DELETE $status with incompatible confirmation as unconfirmed", async ({ status, body }) => {
    await mount(boundary()); const key = hooks.protectedKey; const locked = vi.fn(); window.addEventListener("escalas:unlock-required", locked);
    vi.mocked(fetch).mockResolvedValueOnce(reply(status, body)); await click("Bloquear Escalas");
    expect(html).toContain("Não foi possível confirmar o bloqueio"); expect(html).toContain("Planejamento protegido");
    expect(html).not.toContain("Nome cadastrado"); expect(hooks.protectedKey).toBe(key); expect(locked).not.toHaveBeenCalled();
  });
  it("keeps invalid DELETE JSON as an unconfirmed lock", async () => {
    await mount(boundary()); const key = hooks.protectedKey;
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError("private parse details"); } } as unknown as Response);
    await click("Bloquear Escalas");
    expect(html).toContain("Não foi possível confirmar o bloqueio"); expect(html).toContain("Planejamento protegido");
    expect(html).not.toContain("private parse details"); expect(hooks.protectedKey).toBe(key);
  });
  it("rechecks the generation after DELETE JSON is read asynchronously", async () => {
    await mount(boundary()); const body = deferred<unknown>();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: () => body.promise } as unknown as Response);
    const lock = hooks.buttons.get("Bloquear Escalas")?.onClick; if (!lock) throw new Error("Lock unavailable");
    const attempt = lock(); await settle();
    await mount(<EscalaAccessBoundary initialAccess="ACCOUNT" initialContext={administrator}><EscalasWorkspace /></EscalaAccessBoundary>);
    body.resolve({ revoked: true }); await attempt; await settle();
    expect(mocks.workspace).toHaveBeenLastCalledWith(administrator); expect(html).not.toContain("Confira o acesso da sua conta");
  });
  it.each(malformedContexts)("rejects $label before mounting an initial provider", async ({ context, access }) => {
    await mount(<EscalaAccessBoundary initialAccess={access ?? "MODULE"} initialContext={context as EscalaClientAccess} initialExpiresAt={access ? undefined : expiresAt}><EscalasWorkspace /></EscalaAccessBoundary>);
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(html).toContain('role="alert"');
    expect(html).toContain(access ? "Confira o acesso da sua conta" : "Nome cadastrado");
  });
  it.each(malformedContexts)("rejects $label from a successful session response", async ({ context, access }) => {
    await mount(<EscalaAccessBoundary initialAccess={null}><EscalasWorkspace /></EscalaAccessBoundary>);
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, { access: { role: access ?? "OPERATIONAL", ...(access ? {} : { expiresAt }) }, context }));
    fill("Operador"); await submit(); await settle();
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(html).toContain('role="alert"'); expect(html).toContain("Tentar novamente");
  });
  it("preserves a legitimate non-admin ACCOUNT context without branches", async () => {
    const empty: EscalaClientAccess = { channel: "ACCOUNT", roleLabel: "Operador", administrator: false, allBranches: false, branches: [] };
    await mount(<EscalaAccessBoundary initialAccess="ACCOUNT" initialContext={empty}><EscalasWorkspace /></EscalaAccessBoundary>);
    expect(mocks.workspace).toHaveBeenLastCalledWith(empty); expect(html).toContain("Planejamento protegido"); expect(html).not.toContain("Nome cadastrado");
  });
  it("preserves canonical textual branch codes and an empty capability list without inventing grants", async () => {
    const context: EscalaClientAccess = { ...operatorContext(), roleLabel: "Administrador", branches: [{ code: "Loja-A", label: "Loja A", capabilities: [] }] };
    await mount(boundary(context));
    expect(mocks.workspace).toHaveBeenLastCalledWith(context); expect(mocks.workspace.mock.calls.at(-1)?.[0].administrator).toBe(false);
    expect(mocks.workspace.mock.calls.at(-1)?.[0].branches[0].capabilities).toEqual([]);
  });
  it("preserves the r2 APPROVER account projection without granting it to USERNAME", async () => {
    mocks.account.mockResolvedValue({ user: { id: "approver", tenantId: "tenant", status: "ACTIVE", role: "OPERATOR" } });
    mocks.grants.mockResolvedValue([{ tenantId: "tenant", userId: "approver", branchCode: "002", role: "APPROVER" }]);
    await mount(await EscalaPage());
    expect(mocks.workspace).toHaveBeenLastCalledWith(expect.objectContaining({ channel: "ACCOUNT", administrator: false, branches: [expect.objectContaining({ code: "02", capabilities: expect.arrayContaining(["workspace.publish"]) })] }));
    expect(mocks.module).not.toHaveBeenCalled();
  });
  it.each(["empty", "wrong-channel", "expired", "forged-admin"])("does not mount a successful response with %s context", async reason => {
    await mount(<EscalaAccessBoundary initialAccess={null}><EscalasWorkspace /></EscalaAccessBoundary>);
    const body = reason === "empty" ? {} : { access: { role: "OPERATIONAL", expiresAt: reason === "expired" ? "2026-11-21T11:59:00.000Z" : expiresAt },
      context: reason === "wrong-channel" ? administrator : { ...operatorContext(), ...(reason === "forged-admin" ? { administrator: true } : {}) } };
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, body)); fill("Operador"); await submit(); await settle();
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(html).toContain('role="alert"'); expect(html).toContain("Tentar novamente");
  });
  it("unmounts private work after confirmed lock and replaces the branch scope on re-entry", async () => {
    await mount(boundary()); const key = hooks.protectedKey;
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, { revoked: true })); await click("Bloquear Escalas");
    expect(html).not.toContain("Planejamento protegido"); expect(html).toContain("Nome cadastrado");
    const callsWhileLocked = mocks.workspace.mock.calls.length; render(); await settle(); expect(mocks.workspace).toHaveBeenCalledTimes(callsWhileLocked);
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, operatorResponse("07"))); fill("Outro acesso"); await submit(); await settle();
    expect(mocks.workspace).toHaveBeenLastCalledWith(operatorContext("07")); expect(hooks.protectedKey).not.toBe(key);
    expect(mocks.workspace.mock.calls.at(-1)?.[0].branches).toHaveLength(1);
  });
  it("cancels a pending entry and ignores its late successful response", async () => {
    await mount(<EscalaAccessBoundary initialAccess={null}><EscalasWorkspace /></EscalaAccessBoundary>);
    const pending = deferred<Response>(); vi.mocked(fetch).mockReturnValueOnce(pending.promise); fill("Operador");
    const attempt = submit(); await settle(); expect(hooks.inputDisabled).toBe(true);
    const focusBeforeCancel = hooks.focusName.mock.calls.length;
    await click("Cancelar tentativa");
    expect(hooks.inputDisabled).toBe(false); expect(hooks.focusName).toHaveBeenCalledTimes(focusBeforeCancel + 1);
    expect(hooks.focusName).toHaveBeenLastCalledWith({ disabled: false });
    pending.resolve(reply(200, operatorResponse())); await attempt; await settle();
    expect(html).toContain("Tentativa cancelada"); expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it("expires the nominal view without running private work while locked", async () => {
    await mount(boundary()); await vi.advanceTimersByTimeAsync(60_001); await settle();
    expect(html).toContain("Nome cadastrado"); expect(html).not.toContain("Planejamento protegido");
  });
  it("does not show a nominal fallback when an account view is locked", async () => {
    await mount(<EscalaAccessBoundary initialAccess="ACCOUNT" initialContext={administrator}><EscalasWorkspace /></EscalaAccessBoundary>);
    window.dispatchEvent(new Event("escalas:unlock-required")); await settle();
    expect(html).toContain("Confira o acesso da sua conta"); expect(html).not.toContain("Nome cadastrado"); expect(html).not.toContain("Planejamento protegido"); expect(fetch).not.toHaveBeenCalled();
  });
  it("hides the old scope immediately when incoming props change, then mounts only the new context", async () => {
    await mount(boundary()); const key = hooks.protectedKey;
    tree = boundary(operatorContext("07")); const first = render();
    expect(first).not.toContain("Planejamento protegido"); await settle();
    expect(mocks.workspace).toHaveBeenLastCalledWith(operatorContext("07")); expect(hooks.protectedKey).not.toBe(key);
  });
  it("ignores a late POST after the server supplies an account context", async () => {
    await mount(<EscalaAccessBoundary initialAccess={null}><EscalasWorkspace /></EscalaAccessBoundary>);
    const pending = deferred<Response>(); vi.mocked(fetch).mockReturnValueOnce(pending.promise); fill("Operador"); const attempt = submit(); await settle();
    await mount(<EscalaAccessBoundary initialAccess="ACCOUNT" initialContext={administrator}><EscalasWorkspace /></EscalaAccessBoundary>);
    pending.resolve(reply(200, operatorResponse("07"))); await attempt; await settle();
    expect(mocks.workspace).toHaveBeenLastCalledWith(administrator); expect(html).not.toContain("Bloquear Escalas");
  });
  it("does not let a late DELETE lock a new account context", async () => {
    await mount(boundary()); const pending = deferred<Response>(); vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const lock = hooks.buttons.get("Bloquear Escalas")?.onClick; if (!lock) throw new Error("Lock unavailable");
    const attempt = lock(); await settle();
    await mount(<EscalaAccessBoundary initialAccess="ACCOUNT" initialContext={administrator}><EscalasWorkspace /></EscalaAccessBoundary>);
    pending.resolve(reply(200, { revoked: true })); await attempt; await settle();
    expect(mocks.workspace).toHaveBeenLastCalledWith(administrator); expect(html).toContain("Planejamento protegido"); expect(html).not.toContain("Confira o acesso da sua conta");
  });
  it("does not mount an account with missing provider context or offer a nominal fallback", async () => {
    await mount(<EscalaAccessBoundary initialAccess="ACCOUNT"><EscalasWorkspace /></EscalaAccessBoundary>);
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(html).toContain("Confira o acesso da sua conta"); expect(html).not.toContain("Nome cadastrado");
  });
  it.each(["missing", "wrong-channel", "expired"])("does not mount a %s initial nominal context", async reason => {
    const context = reason === "missing" ? null : reason === "wrong-channel" ? administrator : operatorContext();
    const expiry = reason === "expired" ? "2026-11-21T11:59:00.000Z" : expiresAt;
    await mount(<EscalaAccessBoundary initialAccess="MODULE" initialContext={context} initialExpiresAt={expiry}><EscalasWorkspace /></EscalaAccessBoundary>);
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(html).toContain("Nome cadastrado");
  });
});
