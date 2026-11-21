import { createHash, randomUUID } from "node:crypto";
import type { APIResponse, Browser, Download, Locator, Page, Response } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loginAsAdmin } from "./admin-session";
import { openEscalasArea, revealEscalasControl } from "./escalas-selection";
import type { EscalaWorkspace } from "../src/lib/escalas/types";
import type { ImportSyncApplyResult, ImportSyncPreview, ImportSyncPurpose } from "../src/lib/escalas/import-sync-contracts";
import type { EscalaAdministrationView, EscalaApprovedPolicyView, EscalaOperatorAdminHttpCommand, EscalaOperatorView, EscalaPolicyCommand } from "../src/lib/escalas/access-contracts";
import type { EscalaInput } from "../src/lib/escalas/types";

export const operationalCapabilities = ["workspace.read", "workspace.save", "employee.manage", "schedule.generate", "schedule.apply", "shift.manage", "export.schedule.pdf", "export.schedule.xlsx"] as const;

export function syntheticBranch(prefix = "E2E") {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

/** Public provisioning only, deferred until a real test runs in a disposable environment.
 * Invitation delivery must be captured by that environment, never sent to a real recipient.
 * No fallback to an existing tenant: a duplicate slug is an isolation failure.
 */
export async function ownedAccountScope(browser: Browser, tenantSlug = `e2e-${randomUUID()}`) {
  if (process.env.E2E_MUTATION !== "1" || process.env.E2E_OWNED_ACCOUNT_PROVISIONING !== "1") {
    throw new Error("Owned accounts require a disposable database and explicit test-mail provisioning");
  }
  const captureUrl = process.env.E2E_RESEND_CAPTURE_URL, mailBase = process.env.RESEND_API_BASE_URL;
  const localHosts = ["localhost", "127.0.0.1", "[::1]"];
  if (!captureUrl || !mailBase || !localHosts.includes(new URL(captureUrl).hostname)
    || new URL(captureUrl).pathname !== "/__messages" || new URL(captureUrl).origin !== new URL(mailBase).origin) {
    throw new Error("Invitation delivery requires the runner's existing local E2E_RESEND_CAPTURE_URL and RESEND_API_BASE_URL");
  }
  const captureEndpoint = new URL(captureUrl).toString();
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("Playwright baseURL is required");
  if (!localHosts.includes(new URL(baseURL).hostname)) throw new Error("Owned-account provisioning requires the runner's local isolated application");
  const origin = new URL(baseURL).origin;
  const headers = { origin };
  // Match the existing fixtures.ts isolation for every explicit context, including the second nominal session.
  const host = process.env.E2E_EXTERNAL_URL ? new URL(process.env.E2E_EXTERNAL_URL).hostname : "";
  const hash = createHash("sha256").update(test.info().testId).digest();
  const extraHTTPHeaders = { ...test.info().project.use.extraHTTPHeaders,
    ...(["localhost", "127.0.0.1", "[::1]"].includes(host) ? { "x-real-ip": `198.18.${hash[0]}.${hash[1]}` } : {}) };
  const newContext = () => browser.newContext({ baseURL, extraHTTPHeaders, ignoreHTTPSErrors: test.info().project.use.ignoreHTTPSErrors ?? process.env.E2E_PRODUCTION === "1" });
  const rootContext = await newContext();
  const root = await rootContext.newPage();
  await loginAsAdmin(root);
  const tenantResponse = await root.request.post("/api/admin/tenants", { headers, data: { name: "E2E exclusivo", slug: tenantSlug } });
  expect(tenantResponse.status(), "The tenant must be newly created, never reused").toBe(201);
  const tenant = await tenantResponse.json() as { id: string; slug: string };
  expect(tenant.slug).toBe(tenantSlug);
  const identities: string[] = [];
  const contexts: import("@playwright/test").BrowserContext[] = [];
  const workspaces: EscalaWorkspace[] = [];
  const policies: string[] = [];
  const operators: string[] = [];
  const retainedApprovers = new Set<string>();

  async function createUser(role: "ADMIN" | "OPERATOR") {
    const email = `e2e-${randomUUID()}@example.invalid`, password = `E2e!${randomUUID()}`;
    const invitation = await root.request.post("/api/admin/invitations", { headers, data: { tenantId: tenant.id, name: "Conta sintética", email, role } });
    expect(invitation.status()).toBe(201);
    const { inviteUrl } = await invitation.json() as { inviteUrl: string };
    // Never clear the shared capture mailbox: select only this fixture's synthetic recipient.
    await expect.poll(async () => {
      const response = await root.request.get(captureEndpoint); expect(response.status()).toBe(200);
      const messages = await response.json() as { to?: string | string[]; html?: string }[];
      return messages.some(message => (Array.isArray(message.to) ? message.to.includes(email) : message.to === email) && message.html?.includes(inviteUrl));
    }, { message: "The owned invitation must reach the local test mail capture" }).toBe(true);
    const token = new URL(inviteUrl).pathname.split("/").at(-1);
    expect(token).toBeTruthy();
    const accepted = await root.request.post("/api/invitations/accept", { headers, data: { token, password } });
    expect(accepted.status()).toBe(201);
    const user = await accepted.json() as { id: string; tenantId: string; role: string };
    expect(user).toMatchObject({ tenantId: tenant.id, role }); identities.push(user.id);
    const context = await newContext(); contexts.push(context);
    const page = await context.newPage();
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(email); await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    return { page, context, id: user.id };
  }
  const owner = await createUser("ADMIN");
  const admin = owner.page;
  const post = (data: Record<string, unknown>) => admin.request.post("/api/escalas", { headers, data });
  async function administration(command?: EscalaOperatorAdminHttpCommand): Promise<EscalaAdministrationView> {
    const response = command ? await admin.request.post("/api/escalas/access/admin", { headers, data: command }) : await admin.request.get("/api/escalas/access/admin");
    expect(response.status()).toBe(200); return response.json();
  }
  async function setMode(mode: "ADMIN_ONLY" | "SCOPED") {
    const before = await administration();
    const after = await administration({ action: "SET_ACCESS_MODE", mode, expectedVersion: before.policy.version });
    expect(after.policy).toEqual({ mode, version: before.policy.version + 1 }); return after;
  }
  async function createOperator(branchGrants: EscalaOperatorView["branchGrants"]) {
    const username = `pessoa-${randomUUID()}`;
    const result = await administration({ action: "CREATE_OPERATOR", username, displayName: "Pessoa sintética", active: true, branchGrants });
    const operator = result.operators.find(item => item.username === username);
    if (!operator) throw new Error("Created operator missing from canonical list"); operators.push(operator.id); return operator;
  }
  async function approve(input: EscalaInput) {
    const data: EscalaPolicyCommand = { action: "APPROVE", input, origin: null,
      selectedSeedAssignments: input.assignments.filter(day => day.kind === "ABSENCE" || day.kind === "HOLIDAY").map(day => ({ employeeId: day.employeeId, date: day.date, kind: day.kind as "ABSENCE" | "HOLIDAY" })),
      regimeModelSelections: input.employees.map(person => ({ id: `regime-${person.id}`, label: `Regime ${person.registration}`, employeeId: person.id })) };
    // A committed approval can outlive a lost/unreadable acknowledgement. Preserve its possible signer before sending.
    retainedApprovers.add(owner.id);
    const response = await admin.request.post("/api/escalas/approved-policy", { headers, data });
    expect(response.status()).toBe(201); const { policy } = await response.json() as { policy: EscalaApprovedPolicyView }; policies.push(policy.id); return policy;
  }
  async function cleanup() {
    const failures: Error[] = [];
    async function attempt(resource: string, remove: () => Promise<void>) {
      try { await remove(); }
      catch (cause) { failures.push(new Error(`Owned fixture cleanup failed: ${resource}`, { cause })); }
    }
    try {
      // Every mutation is bounded to IDs returned during this fixture; other workers are untouched.
      for (const id of operators) {
        await attempt(`operator ${id}`, async () => {
          const current = (await administration()).operators.find(item => item.id === id);
          if (current) await administration({ action: "UPDATE_OPERATOR", operatorId: id, expectedPermissionVersion: current.permissionVersion, username: current.username, displayName: current.displayName, active: false });
        });
      }
      await attempt("access policy", async () => { await setMode("ADMIN_ONLY"); });
      for (const workspace of workspaces) await attempt(`workspace ${workspace.id}`, () => removeOwnedWorkspace(admin, workspace));
      for (const id of policies) await attempt(`approval ${id}`, async () => {
        expect((await admin.request.post("/api/escalas/approved-policy", { headers, data: { action: "REVOKE", id } })).status()).toBe(200);
      });
      for (const id of identities) await attempt(`account ${id}`, async () => {
        // REVOKE keeps approvedById/FK Restrict. Block this historical identity; never delete it or its tenant indirectly.
        if (retainedApprovers.has(id)) expect((await root.request.patch(`/api/admin/users/${id}`, { headers, data: { status: "BLOCKED" } })).status()).toBe(200);
        else expect((await root.request.delete(`/api/admin/users/${id}`, { headers })).status()).toBe(200);
      });
    } finally {
      for (const [index, context] of contexts.entries()) await attempt(`context ${index}`, () => context.close());
      await attempt("root context", () => rootContext.close());
    }
    // Public APIs cannot remove tenants/catalog/audit records. Dispose the owned test database afterwards.
    if (failures.length) throw new AggregateError(failures, `Owned fixture cleanup failed for ${failures.length} resource(s)`);
  }
  return { admin, origin, headers, tenantId: tenant.id, tenantSlug, newContext, createUser, post, administration, setMode, createOperator, approve,
    trackWorkspace: (workspace: EscalaWorkspace) => { workspaces.push(workspace); return workspace; }, cleanup };
}

export async function nominalEntry(page: Page, username: string) {
  await page.goto("/escala");
  await page.getByLabel("Nome cadastrado", { exact: true }).fill(username);
  await page.getByRole("button", { name: /^(Liberar planejamento|Entrar e abrir um novo acesso|Tentar novamente)$/ }).click();
  await expect(page.getByRole("button", { name: "Bloquear Escalas", exact: true })).toBeVisible();
  const session = await page.request.get("/api/escalas/access/session"); expect(session.status()).toBe(200);
  return session.json() as Promise<import("../src/lib/escalas/access-contracts").EscalaSessionResponse>;
}

export async function responseWorkspace(response: APIResponse, status = 200): Promise<EscalaWorkspace> {
  expect(response.status()).toBe(status);
  return response.json();
}

export async function readWorkspace(page: Page, id: string) {
  return responseWorkspace(await page.request.get("/api/escalas?id=" + encodeURIComponent(id)));
}

/** Delete only the exact draft created by this test, after verifying its branch identity. */
export async function removeOwnedWorkspace(page: Page, owned: Pick<EscalaWorkspace, "id" | "input">) {
  const response = await page.request.get("/api/escalas?id=" + encodeURIComponent(owned.id));
  if (response.status() === 404) return;
  const current = await responseWorkspace(response);
  expect(current.id).toBe(owned.id); expect(current.input.branchCode).toBe(owned.input.branchCode); expect(current.status).toBe("DRAFT");
  expect((await page.request.delete("/api/escalas", { headers: { origin: new URL(page.url()).origin }, data: { workspaceId: current.id, expectedRevision: current.revision } })).status()).toBe(200);
}

export function isImportResponse(response: Response, action: "PREVIEW_REPLACE" | "APPLY_REPLACE") {
  return response.request().method() === "POST" && new URL(response.url()).pathname === "/api/escalas/import"
    && Boolean(response.request().postDataBuffer()?.includes(Buffer.from(`"action":"${action}"`)));
}

export async function importPanel(page: Page, purpose: ImportSyncPurpose): Promise<Locator> {
  await openEscalasArea(page, "team");
  const summary = page.locator("summary").filter({ hasText: purpose === "EMPLOYEES" ? /^Importar e substituir equipe$/ : /^Importar e substituir afastamentos$/ });
  await revealEscalasControl(summary);
  const panel = summary.locator("..");
  if (!await panel.evaluate(element => (element as HTMLDetailsElement).open)) await summary.click();
  return panel;
}

export async function previewReplacement(page: Page, purpose: ImportSyncPurpose, file: { name: string; mimeType: string; buffer: Buffer }, scope?: { startDate: string; endDate: string }) {
  const panel = await importPanel(page, purpose);
  await panel.getByLabel(purpose === "EMPLOYEES" ? "Arquivo de equipe CSV ou XLSX" : "Arquivo de afastamentos CSV", { exact: true }).setInputFiles(file);
  if (scope) {
    await panel.getByLabel("Substituir afastamentos a partir de", { exact: true }).fill(scope.startDate);
    await panel.getByLabel("Substituir afastamentos até", { exact: true }).fill(scope.endDate);
  }
  await panel.getByRole("checkbox", { name: /^Declaro que o arquivo cobre integralmente/ }).check();
  const receiving = page.waitForResponse(response => isImportResponse(response, "PREVIEW_REPLACE"));
  await panel.getByRole("button", { name: purpose === "EMPLOYEES" ? "Conferir substituição de equipe" : "Conferir substituição de afastamentos", exact: true }).click();
  const response = await receiving; expect(response.status()).toBe(200);
  const { preview } = await response.json() as { preview: ImportSyncPreview };
  await expect(panel.getByRole("region", { name: "Conferência da substituição", exact: true })).toBeVisible();
  return { panel, preview };
}

export async function applyReplacement(page: Page, panel: Locator, purpose: ImportSyncPurpose): Promise<ImportSyncApplyResult> {
  const confirmation = panel.getByRole("checkbox", { name: /^Confirmo substituir/ });
  await expect(confirmation).toBeEnabled(); await confirmation.check();
  const receiving = page.waitForResponse(response => isImportResponse(response, "APPLY_REPLACE"));
  await panel.getByRole("button", { name: purpose === "EMPLOYEES" ? "Confirmar e salvar substituição de equipe" : "Confirmar e salvar substituição de afastamentos", exact: true }).click();
  const response = await receiving; expect(response.status()).toBe(200);
  const result: ImportSyncApplyResult = await response.json();
  expect(result.workspace.status).toBe("DRAFT");
  expect(result.workspace.revision).toBe(result.summary.context.revision + 1);
  await expect(page.locator('[data-state="saved"]')).toBeVisible();
  return result;
}

export async function downloadBytes(download: Download) {
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream(); if (!stream) throw new Error("Missing downloaded file stream");
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function employeeCsv(registrations: string[]) {
  return Buffer.from(["Matricula;Nome;Setor;Cargo;CargaSemanal;Horarios;Admissao;RegraDomingos",
    ...registrations.map(registration => `${registration};Pessoa ${registration};Loja;Operador;40;08:00-12:00 / 13:00-17:00;2020-01-01;`)].join("\r\n"));
}

export function absenceCsv(rows: { registration: string; start: string; end: string }[], period = { start: "01/12/2026", end: "31/12/2026" }) {
  return Buffer.from([["Período", period.start, "a", period.end], ["Empresa", "Tipo", "Cadastro", "Nome", "Função", "Admissão", "Afastamento", "CID", "Situação", "Término", "Dias"],
    ...rows.map(row => ["1", "1", row.registration, "Pessoa sintética", "Operador", "01/01/2020", row.start, "SYNTHETIC-MEDICAL-DO-NOT-KEEP", "SYNTHETIC-PRIVATE", "2", "Afastamento", row.end, "1"])]
    .map(row => row.map(value => JSON.stringify(value)).join(",")).join("\r\n"));
}
