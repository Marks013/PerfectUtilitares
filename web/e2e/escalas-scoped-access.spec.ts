import { expect, test as base } from "./fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { strFromU8, unzipSync } from "fflate";
import { newEmployee, newInput, changeMixed42Sectors } from "../src/components/escalas/workspace-model";
import type { EscalaInput, EscalaWorkspace } from "../src/lib/escalas/types";
import type { TurnoCatalogSyncResult, TurnoSwapPreviewDto } from "../src/lib/escalas/shift-catalog/contracts";
import { pdfJsServerDocumentOptions } from "../src/lib/pdf/pdfjs-server";
import { downloadBytes, employeeCsv, nominalEntry, operationalCapabilities, ownedAccountScope, prepareBasicExport, readWorkspace, responseWorkspace, syntheticBranch } from "./escalas-access-fixtures";
import { openEscalasArea, revealEscalasControl, selectEscalasWorkspace } from "./escalas-selection";

type OwnedScope = Awaited<ReturnType<typeof ownedAccountScope>>;
type NominalInfrastructure = { scope: OwnedScope; foreign: OwnedScope; second: BrowserContext; other: Page };

function usesIsolatedNominalProfile() {
  return process.env.E2E_MUTATION === "1" && process.env.E2E_SUITE_PHASE === "nominal";
}

async function warmDevelopmentRoutes(admin: Page) {
  if (process.env.E2E_PRODUCTION === "1") return;
  // Warm route compilation only. The invalid GET never reaches the export cache or touches a workspace.
  for (const [path, status] of [["/escala", 200], ["/api/escalas/export", 400]] as const) {
    const response = await admin.request.get(path, { maxRedirects: 0, timeout: 40_000 });
    try { expect(response.status(), "Development warmup " + path).toBe(status); }
    finally { await response.dispose(); }
  }
}

const test = base.extend<{ nominalInfrastructure: NominalInfrastructure }>({
  nominalInfrastructure: [async ({ browser }, use) => {
    const slug = process.env.E2E_EXCLUSIVE_SCOPED_TENANT_SLUG;
    if (!usesIsolatedNominalProfile() || !slug || !/^e2e-[a-z0-9]+-[a-f0-9]{16}$/.test(slug) || process.env.DEFAULT_TENANT_SLUG !== slug) {
      throw new Error("Set a fresh E2E_EXCLUSIVE_SCOPED_TENANT_SLUG and the same DEFAULT_TENANT_SLUG before server boot; never reuse principal");
    }
    const scope = await ownedAccountScope(browser, slug);
    let foreign: OwnedScope | undefined;
    let second: BrowserContext | undefined;
    const failures: unknown[] = [];
    try {
      const [external, secondary, warmup] = await Promise.allSettled([
        ownedAccountScope(browser).then(value => { foreign = value; return value; }),
        (async () => {
          second = await scope.newContext();
          return { second, other: await second.newPage() };
        })(),
        warmDevelopmentRoutes(scope.admin),
      ]);
      if (external.status === "rejected" || secondary.status === "rejected" || warmup.status === "rejected") {
        throw new AggregateError([external, secondary, warmup].flatMap(result => result.status === "rejected" ? [result.reason] : []),
          "Nominal infrastructure setup failed.");
      }
      await use({ scope, foreign: external.value, ...secondary.value });
    } catch (cause) {
      failures.push(cause);
    } finally {
      for (const cleanup of [() => second?.close(), () => foreign?.cleanup(), () => scope.cleanup()]) {
        try { await cleanup(); } catch (cause) { failures.push(cause); }
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Nominal infrastructure setup or cleanup failed.");
  }, { scope: "test", timeout: 120_000 }],
});

// One scenario owns the configured nominal tenant. A serial describe cannot isolate other workers.
// The isolated nominal phase reserves this tenant/source IP before server boot.
test.skip(() => !usesIsolatedNominalProfile(), "Requires an explicitly authorized disposable nominal database");
test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ retries: 0, timeout: 240_000 });

async function pdfText(bytes: Buffer) {
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument(pdfJsServerDocumentOptions(Uint8Array.from(bytes)));
  try {
    const document = await task.promise, parts: string[] = [];
    for (let i = 1; i <= document.numPages; i++) {
      const content = await (await document.getPage(i)).getTextContent();
      parts.push(content.items.filter(item => "str" in item).map(item => item.str).join(" "));
    }
    return parts.join(" ").replace(/\s+/g, " ");
  } finally { await task.destroy(); }
}

async function expectBasicDownloads(page: Page, workspace: EscalaWorkspace, employeeName: string) {
  await openEscalasArea(page, "roster");
  for (const format of ["pdf", "xlsx"] as const) {
    const expected = await prepareBasicExport(page, workspace, format === "pdf" ? "PDF" : "XLSX");
    const link = page.getByRole("link", { name: `Baixar ${format.toUpperCase()}`, exact: true });
    await expect(link).toHaveAttribute("download", new RegExp(`-r${workspace.revision}-both\\.${format}$`));
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15_000 }), link.click()]);
    try {
      const bytes = await downloadBytes(download);
      expect(bytes.equals(expected), `Arquivo ${format}: ${bytes.length} baixados, ${expected.length} enviados`).toBe(true);
      if (format === "pdf") {
        const text = await pdfText(bytes);
        expect(text).toContain(employeeName);
        expect(text).not.toMatch(/Desfalques de cobertura|Capacidade semanal/);
      } else {
        const archive = unzipSync(bytes);
        expect(strFromU8(archive["xl/workbook.xml"])).not.toMatch(/Capacidade|Desfalques|Análises|Analises/);
      }
    } finally { await download.delete(); }
  }
}

function reviewedConfiguration(input: EscalaInput): EscalaInput["policy"] {
  return { ...input.policy, source: "Referência sintética E2E", reviewed: true, reviewedBy: "Conferência administrativa E2E" };
}

async function editName(page: Page, previous: string, next: string) {
  await openEscalasArea(page, "team");
  const edit = page.getByRole("button", { name: `Editar ${previous}`, exact: true, includeHidden: true });
  await revealEscalasControl(edit); await edit.click();
  const form = page.getByRole("form", { name: "Editar colaborador", exact: true });
  await form.getByLabel("Nome completo", { exact: true }).fill(next);
  await form.getByRole("button", { name: "Aplicar cadastro à proposta", exact: true }).click();
}

test("nominal access owns its scope, preserves admin configuration, operates the roster and revokes stale contexts and downloads", async ({ page, nominalInfrastructure }) => {
  const { scope, foreign, second, other } = nominalInfrastructure;
  const headers = scope.headers;
  const post = (data: Record<string, unknown>) => page.request.post("/api/escalas", { headers, data });
  let heldRelease = () => {};
  try {
    const input = newInput(syntheticBranch("AUTHORIZED"), "Filial autorizada", "2026-12", 40);
    input.shifts = [{ id: "day", name: "Diurno aprovado", segments: [{ kind: "WORK", start: 480, end: 720 }, { kind: "BREAK", start: 720, end: 780 }, { kind: "WORK", start: 780, end: 1020 }] }];
    input.employees = [{ ...newEmployee(40, "day"), id: "person", registration: "0001", name: "Pessoa nominal", sector: "Loja", role: "Operador", activeFrom: "2020-01-01" }];
    input.policy = { ...reviewedConfiguration(input), holidayDates: ["2026-12-25"], closedDates: ["2026-12-25"] };
    input.employees[0].scheduleMode = "TIMED";
    input.assignments = [{ employeeId: "person", date: "2026-12-09", kind: "ABSENCE", locked: true }, { employeeId: "person", date: "2026-12-25", kind: "HOLIDAY", locked: true }];
    const approved = await scope.approve(input);
    let administrative = newInput(syntheticBranch("ADMIN"), "Configuração administrativa", "2026-12", 42);
    administrative.employees = [{ ...newEmployee(42, administrative.shifts[0].id), id: "admin-person", registration: "0099", name: "Pessoa administrativa", sector: "Loja", role: "Operador", activeFrom: "2020-01-01" }];
    administrative.policy = reviewedConfiguration(administrative);
    administrative.employees[0].scheduleMode = "TIMED";
    administrative = changeMixed42Sectors(administrative, ["Loja"]);
    expect(administrative.mixed42Sectors).toEqual(["Loja"]);
    const adminPolicy = await scope.approve(administrative);
    const adminOnlyWorkspace = scope.trackWorkspace(await responseWorkspace(await scope.post({ action: "CREATE_APPROVED", approvedPolicyVersionId: adminPolicy.id }), 201));
    await scope.admin.goto("/escala"); await selectEscalasWorkspace(scope.admin, adminOnlyWorkspace); await openEscalasArea(scope.admin, "generate");
    await expect(scope.admin.getByLabel("Jornada semanal", { exact: true })).toHaveValue("42");
    const mixed = scope.admin.getByRole("group", { name: "Setores com dias de 8h e 9h", exact: true, includeHidden: true });
    await revealEscalasControl(mixed); await expect(mixed.getByRole("checkbox", { name: "Loja", exact: true })).toBeChecked();
    await expect(mixed.getByRole("checkbox", { name: "Loja", exact: true })).toBeEnabled();
    const operator = await scope.createOperator([{ branchCode: input.branchCode, active: true, capabilities: ["workspace.create", ...operationalCapabilities] }]);
    const otherOperator = await scope.createOperator([{ branchCode: input.branchCode, active: true, capabilities: [...operationalCapabilities] }]);

    // Admission #1: default ADMIN_ONLY fails closed, even for a registered name.
    await page.goto("/escala");
    const username = page.getByLabel("Nome cadastrado", { exact: true });
    await expect(username).toBeFocused();
    await username.fill(operator.username);
    const admission = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/escalas/access/session"
      && response.request().postDataJSON()?.username === operator.username);
    await page.getByRole("button", { name: "Liberar planejamento", exact: true }).click();
    expect((await admission).status()).toBe(401);
    await expect(username).toHaveAttribute("aria-invalid", "true");
    await expect(username).toHaveAttribute("aria-describedby", "escala-access-error escala-access-help");
    await expect(page.locator("#escala-access-error").and(page.getByRole("alert"))).toBeVisible();
    await expect(username).toBeFocused();
    await scope.setMode("SCOPED");
    // Admission #2: the browser supplies only the registered name, never a password or role.
    const access = await nominalEntry(page, operator.username, { reuseOpenForm: true });
    expect(access.access.role).toBe("OPERATIONAL"); expect(access.context.administrator).toBe(false); expect(access.context.allBranches).toBe(false);
    expect(access.context.branches.map(branch => branch.code)).toEqual([input.branchCode]);
    const cookie = (await page.context().cookies()).find(value => value.name === "perfectutilitares.escalas-access");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict" });
    expect((await page.request.get("/api/admin/users")).status()).toBe(401);
    expect((await page.request.get("/api/unimed/access/session")).status()).toBe(401);
    await page.getByText("Iniciar período com configuração aprovada", { exact: true }).click();
    await page.getByLabel("Mês do novo planejamento", { exact: true }).fill("2026-12");
    await page.getByLabel("Configuração aprovada", { exact: true }).selectOption(approved.id);
    const creating = page.waitForResponse(response => response.request().method() === "POST" && response.request().postDataJSON()?.action === "CREATE_APPROVED");
    await page.getByRole("button", { name: "Criar planejamento aprovado", exact: true }).click();
    const createdResponse = await creating; expect(createdResponse.status()).toBe(201);
    let workspace = scope.trackWorkspace(await createdResponse.json() as EscalaWorkspace);
    expect(workspace).toMatchObject({ approvedPolicyVersionId: approved.id, status: "DRAFT" });
    expect(workspace.input.assignments).toEqual(expect.arrayContaining(input.assignments));
    const foreignWorkspace = foreign.trackWorkspace(await responseWorkspace(await foreign.post({ action: "CREATE", input: { ...input, branchName: "Outro tenant sintético" } }), 201));
    expect((await page.request.get(`/api/escalas?id=${foreignWorkspace.id}`)).status()).toBe(404);
    expect((await page.request.get(`/api/escalas/export?id=${foreignWorkspace.id}&revision=${foreignWorkspace.revision}&format=pdf`)).status()).toBe(404);
    for (const action of ["SAVE", "GENERATE"] as const) expect((await post({ action, id: foreignWorkspace.id, expectedRevision: foreignWorkspace.revision, ...(action === "SAVE" ? { input: workspace.input } : {}) })).status()).toBe(404);
    // Operators have no delete capability, so both owned and foreign IDs are denied before lookup.
    const deleteBody = { workspaceId: foreignWorkspace.id, expectedRevision: foreignWorkspace.revision };
    expect((await page.request.delete("/api/escalas", { headers, data: deleteBody })).status()).toBe(403);
    expect((await page.request.delete("/api/escalas", { headers, data: { workspaceId: workspace.id, expectedRevision: workspace.revision } })).status()).toBe(403);
    // The authorized administrator still cannot resolve an ID from another tenant.
    expect((await scope.admin.request.delete("/api/escalas", { headers, data: deleteBody })).status()).toBe(404);
    expect((await readWorkspace(foreign.admin, foreignWorkspace.id)).revision).toBe(foreignWorkspace.revision);
    await selectEscalasWorkspace(page, workspace);
    const list = await page.request.get("/api/escalas").then(response => response.json()) as { workspaces: EscalaWorkspace[] };
    expect(list.workspaces.map(item => item.id)).toEqual([workspace.id]);
    expect((await page.request.get(`/api/escalas?id=${adminOnlyWorkspace.id}`)).status()).toBe(403);
    expect((await post({ action: "GENERATE", id: adminOnlyWorkspace.id, expectedRevision: adminOnlyWorkspace.revision })).status()).toBe(403);
    await openEscalasArea(page, "generate");
    const weeklyHours = page.getByLabel("Jornada semanal", { exact: true });
    await expect(weeklyHours).toHaveValue("40");
    await expect(weeklyHours).toBeDisabled();
    await expect(page.getByText(/^Alternar dias de 8h e 9h/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Relatórios e gráficos PDF", exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.getByText("Turnos e arquivos de integração", { exact: true })).toHaveCount(0);
    await openEscalasArea(page, "team");
    await expect(page.getByText("Importar ou atualizar arquivos da equipe", { exact: true })).toHaveCount(0);

    // Administrative definitions are denied by real routes, with a valid input/revision baseline.
    const alterations: EscalaInput[] = [
      { ...workspace.input, defaultWeeklyHours: 42 }, { ...workspace.input, mixed42Sectors: ["Loja"] },
      { ...workspace.input, shifts: workspace.input.shifts.map(shift => ({ ...shift, name: "Definição indevida" })) },
      { ...workspace.input, policy: { ...workspace.input.policy, maxConsecutiveWorkDays: 4 } },
      { ...workspace.input, assignments: [] },
    ];
    for (const attempted of alterations) {
      const denied = await post({ action: "SAVE", id: workspace.id, expectedRevision: workspace.revision, input: attempted });
      expect(denied.status()).toBe(403); expect(await denied.json()).toMatchObject({ error: { code: "ESCALA_PROTECTED_INPUT" } });
    }
    expect((await readWorkspace(scope.admin, workspace.id)).input).toEqual(workspace.input);
    expect((await page.request.post("/api/escalas/turnos", { headers, data: { action: "SYNC", confirm: true, sources: [{ workspaceId: workspace.id, expectedRevision: workspace.revision, localShiftIds: ["day"] }] } })).status()).toBe(403);
    expect((await page.request.get("/api/escalas/import?purpose=EMPLOYEES")).status()).toBe(403);
    const deniedImport = await page.request.post("/api/escalas/import", { headers, multipart: {
      command: JSON.stringify({ action: "PREVIEW_REPLACE", purpose: "EMPLOYEES", workspaceId: workspace.id, expectedRevision: workspace.revision,
        startDate: workspace.input.startDate, endDate: workspace.input.endDate, completeScopeConfirmed: true }),
      file: { name: "equipe-sintetica.csv", mimeType: "text/csv", buffer: employeeCsv(["0001"]) },
    } });
    expect(deniedImport.status()).toBe(403);
    expect((await page.request.get("/api/escalas/access/admin")).status()).toBe(403);
    expect((await page.request.post("/api/escalas/approved-policy", { headers, data: { action: "REVOKE", id: approved.id } })).status()).toBe(403);
    expect((await post({ action: "PUBLISH", id: workspace.id, expectedRevision: workspace.revision })).status()).toBe(403);

    // The administrator creates the definition. The branch may only assign that existing permitted reference.
    const synced = await scope.admin.request.post("/api/escalas/turnos", { headers, data: { action: "SYNC", confirm: true, sources: [{ workspaceId: workspace.id, expectedRevision: workspace.revision, localShiftIds: ["day"] }] } });
    expect(synced.status()).toBe(201); const catalog = await synced.json() as TurnoCatalogSyncResult;
    expect(catalog.entries).toHaveLength(1); expect(catalog.entries[0].code).toBeGreaterThanOrEqual(1500);
    const swapButton = page.getByRole("button", { name: "Trocar turno de Pessoa nominal", exact: true, includeHidden: true });
    await revealEscalasControl(swapButton); await swapButton.click();
    const swap = page.getByRole("region", { name: "Atribuir turno cadastrado a Pessoa nominal", exact: true });
    await swap.getByRole("radio", { name: new RegExp(`^${catalog.entries[0].code} ·`) }).check();
    const previewing = page.waitForResponse(response => response.request().method() === "POST" && response.request().postDataJSON()?.action === "PREVIEW_SWAP");
    await swap.getByRole("button", { name: "Conferir atribuição", exact: true }).click();
    const swapResponse = await previewing; expect(swapResponse.status()).toBe(200); const preview = await swapResponse.json() as TurnoSwapPreviewDto;
    expect(preview.canApply).toBe(true); expect(preview.validationIssues).toEqual([]);
    const swapping = page.waitForResponse(response => response.request().method() === "POST" && response.request().postDataJSON()?.action === "APPLY_SWAP");
    await swap.getByRole("button", { name: "Confirmar e salvar atribuição", exact: true }).click();
    const swapped = await swapping;
    const swappedBody = await swapped.json();
    const swapCode = typeof swappedBody?.error?.code === "string" && /^[A-Z_]+$/.test(swappedBody.error.code) ? swappedBody.error.code : "UNCLASSIFIED";
    expect(swapped.status(), `APPLY_SWAP public code: ${swapCode}`).toBe(200);
    workspace = swappedBody as EscalaWorkspace;
    expect(workspace.input.assignments).toEqual(expect.arrayContaining(input.assignments));
    expect((await readWorkspace(scope.admin, adminOnlyWorkspace.id)).input.mixed42Sectors).toEqual(["Loja"]);

    // Admission #3: another real module session cannot inspect/cancel the first session's operation.
    await nominalEntry(other, otherOperator.username);
    const started = await post({ action: "START_GENERATION", id: workspace.id, expectedRevision: workspace.revision }); expect(started.status()).toBe(201);
    const { operationId } = await started.json() as { operationId: string };
    for (const action of ["GENERATION_STATUS", "CANCEL_GENERATION"]) {
      expect((await other.request.post("/api/escalas", { headers, data: { action, operationId } })).status()).toBe(404);
    }
    expect(await (await post({ action: "GENERATION_STATUS", operationId })).json()).toMatchObject({ state: "CREATED" });
    expect((await post({ action: "START_GENERATION", id: workspace.id, expectedRevision: workspace.revision })).status()).toBe(429);
    for (let index = 0; index < 2; index++) expect(await (await post({ action: "CANCEL_GENERATION", operationId })).json()).toMatchObject({ state: "CANCELLED" });

    // Recover the protected edit before solving: editing the roster makes a previously generated schedule stale.
    // A real account takes precedence over a valid module cookie and cannot borrow its grants.
    const noGrant = await scope.createUser("OPERATOR");
    if (!cookie) throw new Error("The nominal module credential is missing");
    await noGrant.context.addCookies([cookie]);
    const accountSession = await noGrant.page.request.get("/api/escalas/access/session"); expect(accountSession.status()).toBe(200);
    expect(await accountSession.json()).toMatchObject({ access: { role: "ACCOUNT" }, context: { administrator: false, branches: [] } });
    expect((await noGrant.page.request.get(`/api/escalas?id=${workspace.id}`)).status()).toBe(403);
    await scope.admin.context().addCookies([cookie]);
    expect(await (await scope.admin.request.get("/api/escalas/access/session")).json()).toMatchObject({ access: { role: "ACCOUNT" }, context: { administrator: true, allBranches: true } });
    expect((await scope.admin.request.delete("/api/escalas/access/session", { headers })).status()).toBe(200);
    expect((await scope.admin.request.get("/api/auth/session").then(response => response.json())).user.role).toBe("ADMIN");

    // Expiry is observed on a real protected SAVE. A new access may recover only after an explicit choice.
    // Use the second session's still-live cookie: deleting the admin's copied token revoked the first one.
    await page.context().addCookies((await second.cookies()).filter(item => item.name === "perfectutilitares.escalas-access"));
    const live = (await page.context().cookies()).find(item => item.name === "perfectutilitares.escalas-access"); if (!live) throw new Error("Module cookie missing");
    await page.context().addCookies([{ ...live, expires: Math.floor(Date.now() / 1000) - 10 }]);
    await editName(page, "Pessoa nominal", "Pessoa autorizada");
    await expect(page.getByLabel("Nome cadastrado", { exact: true })).toBeVisible();
    expect((await readWorkspace(scope.admin, workspace.id)).revision).toBe(workspace.revision);
    // Admission #4. No hidden replay after a fresh scope is issued.
    await nominalEntry(page, operator.username, { reuseOpenForm: true }); await selectEscalasWorkspace(page, workspace);
    const recovery = page.getByRole("alert", { name: "Rascunho recuperável", exact: true }); await expect(recovery).toBeVisible();
    expect((await readWorkspace(scope.admin, workspace.id)).revision).toBe(workspace.revision);
    await recovery.getByRole("button", { name: `Restaurar meu rascunho sobre a revisão ${workspace.revision}`, exact: true }).click();
    await expect.poll(async () => (await readWorkspace(scope.admin, workspace.id)).input.employees[0].name).toBe("Pessoa autorizada");
    workspace = await readWorkspace(scope.admin, workspace.id);

    for (let calculation = 0; calculation < 2; calculation++) {
      await openEscalasArea(page, "generate");
      const generating = page.waitForResponse(response => response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/escalas" && response.request().postDataJSON()?.action === "GENERATE"
        && response.request().postDataJSON()?.id === workspace.id, { timeout: 60_000 });
      await page.getByRole("button", { name: "Gerar nova proposta", exact: true }).click();
      const response = await generating;
      const proposal = await response.json();
      const generationCode = typeof proposal?.error?.code === "string" && /^[A-Z_]+$/.test(proposal.error.code) ? proposal.error.code : "UNCLASSIFIED";
      expect(response.status(), `GENERATE public code: ${generationCode}`).toBe(200);
      expect(["FEASIBLE", "OPTIMAL"]).toContain(proposal.result.status); expect(proposal.validation.valid).toBe(true); expect(proposal.proposalProof).toBeTruthy();
      expect(proposal.proposalInput.assignments).toEqual(expect.arrayContaining(input.assignments));
      expect(proposal.proposalInput.assignments.some((day: { kind: string }) => day.kind === "OFF")).toBe(true);
      const applying = page.waitForResponse(response => response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/escalas" && response.request().postDataJSON()?.action === "APPLY_PROPOSAL"
        && response.request().postDataJSON()?.id === workspace.id);
      await page.getByRole("region", { name: "Proposta pronta para revisão", exact: true })
        .getByRole("button", { name: "Aplicar proposta à grade", exact: true }).click();
      const applied = await applying; expect(applied.status()).toBe(200); workspace = await applied.json() as EscalaWorkspace;
      expect(workspace.input.assignments).toEqual(expect.arrayContaining(input.assignments)); expect(workspace.status).toBe("DRAFT");
      if (calculation === 0) {
        const editable = workspace.input.assignments.find(day => day.employeeId === "person" && day.kind === "WORK" && day.locked === false && day.date >= "2026-12-01" && day.date <= "2026-12-31");
        if (!editable) throw new Error("The generated roster must contain a real unlocked workday for the branch to edit");
        await openEscalasArea(page, "roster");
        await page.getByRole("button", { name: new RegExp(`^Pessoa autorizada, ${editable.date.split("-").reverse().join("/")}:`) }).click();
        const editor = page.locator("#escala-day-editor");
        await expect(editor.getByRole("checkbox", { name: "Preservar esta decisão nas próximas gerações", exact: true, includeHidden: true })).toHaveCount(0);
        await editor.getByLabel("Situação do dia", { exact: true }).selectOption("OFF");
        await editor.getByRole("button", { name: "Conferir alteração", exact: true }).click();
        const saving = page.waitForResponse(response => response.request().method() === "POST"
          && new URL(response.url()).pathname === "/api/escalas" && response.request().postDataJSON()?.action === "SAVE"
          && response.request().postDataJSON()?.id === workspace.id);
        await editor.getByRole("button", { name: /^(Confirmar alteração|Aplicar com conflitos ao rascunho)$/ }).click();
        const saved = await saving; expect(saved.status()).toBe(200); workspace = await saved.json() as EscalaWorkspace;
        expect(workspace.input.assignments).toContainEqual({ employeeId: "person", date: editable.date, kind: "OFF", locked: false });
        expect(workspace.input.assignments).toEqual(expect.arrayContaining(input.assignments));
      }
    }

    expect(workspace.input.needsRegeneration).not.toBe(true);
    const exportUrl = (format: "pdf" | "xlsx", projection = "BASIC_SCHEDULE") => `/api/escalas/export?id=${workspace.id}&revision=${workspace.revision}&format=${format}&mode=both&projection=${projection}`;
    // Warm the full administrative PDF first; a later basic request must not receive analytical cached bytes.
    const full = await scope.admin.request.get(exportUrl("pdf", "ADMIN_FULL")); expect(full.status()).toBe(200);
    const [fullText, deniedFull, deniedReport, deniedManifest] = await Promise.all([
      full.body().then(pdfText),
      page.request.get(exportUrl("pdf", "ADMIN_FULL")),
      page.request.get(`/api/escalas/operational-report?workspaceId=${workspace.id}&revision=${workspace.revision}&month=2026-12&section=journeys`),
      page.request.post("/api/escalas/turnos/export/manifest", { headers, data: { month: 12, year: 2026, selections: [{ workspaceId: workspace.id, revision: workspace.revision, employees: [{ employeeId: "person", localShiftId: "day" }] }] } }),
    ]);
    expect(fullText).toContain("Desfalques de cobertura");
    expect(deniedFull.status()).toBe(403);
    expect(deniedReport.status()).toBe(403);
    expect(deniedManifest.status()).toBe(403);
    await expectBasicDownloads(page, workspace, "Pessoa autorizada");

    // Revoke between the visible preparation click and the real request reaching the server; no bytes/download may escape.
    await openEscalasArea(page, "roster");
    let arrived!: () => void; const requestHeld = new Promise<void>(resolve => { arrived = resolve; });
    const release = new Promise<void>(resolve => { heldRelease = resolve; }); let downloads = 0; page.on("download", () => downloads++);
    await page.route("**/api/escalas/export?*", async route => { arrived(); await release; await route.continue(); });
    const rejected = page.waitForResponse(response => new URL(response.url()).pathname === "/api/escalas/export");
    await page.getByRole("button", { name: "Gerar PDF", exact: true }).click(); await requestHeld;
    const current = (await scope.administration()).operators.find(item => item.id === operator.id); if (!current) throw new Error("Owned operator missing");
    await scope.administration({ action: "REPLACE_BRANCH_GRANTS", operatorId: current.id, expectedPermissionVersion: current.permissionVersion,
      branchGrants: [{ branchCode: administrative.branchCode, active: true, capabilities: [...operationalCapabilities] }] });
    heldRelease(); const denied = await rejected; expect(denied.status()).toBe(401); expect(denied.headers()["content-type"]).toContain("application/json");
    expect(await denied.json()).toMatchObject({ error: { code: "ESCALA_ACCESS_REQUIRED" } });
    await page.unrouteAll({ behavior: "wait" }); expect(downloads).toBe(0);
    await expect(page.getByRole("link", { name: "Baixar PDF", exact: true })).toHaveCount(0);
    // Admission #5 opens B only; A and its recovery must never be silently sent under B's context.
    await nominalEntry(page, operator.username, { reuseOpenForm: true }); await selectEscalasWorkspace(page, adminOnlyWorkspace);
    expect((await page.request.get(`/api/escalas?id=${workspace.id}`)).status()).toBe(403);
    await expect(page.getByRole("alert", { name: "Rascunho recuperável", exact: true })).toHaveCount(0);
    expect((await readWorkspace(scope.admin, workspace.id)).revision).toBe(workspace.revision);
    expect((await page.request.post("/api/escalas/access/session", { headers: { origin: "https://foreign.invalid" }, data: { username: operator.username } })).status()).toBe(403);
    expect((await page.request.post("/api/escalas/access/session", { headers, data: { username: "unknown-synthetic-person" } })).status()).toBe(429);
    const last = (await scope.administration()).operators.find(item => item.id === operator.id); if (!last) throw new Error("Owned operator missing");
    await scope.administration({ action: "REVOKE_SESSIONS", operatorId: last.id, expectedPermissionVersion: last.permissionVersion });
    expect((await page.request.get("/api/escalas/access/session")).status()).toBe(401);
    await scope.setMode("ADMIN_ONLY");
    expect((await other.request.get("/api/escalas/access/session")).status()).toBe(401);
  } finally {
    heldRelease();
    if (!page.isClosed()) await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});
