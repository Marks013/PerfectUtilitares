import { expect, test } from "./fixtures";
import { openEscalasArea, revealEscalasControl, selectEscalasWorkspace } from "./escalas-selection";
import { downloadBytes, ownedAccountScope } from "./escalas-access-fixtures";
import { newEmployee, newInput } from "../src/components/escalas/workspace-model";
import type { EscalaWorkspace } from "../src/lib/escalas/types";
import type { TurnoCatalogPageDto, TurnoSwapPreviewDto } from "../src/lib/escalas/shift-catalog/contracts";
import type { TurnoCatalogOptionsDto, TurnoSelectionManifestDto } from "../src/lib/escalas/shift-catalog/flow-contracts";
import type { APIResponse, Locator, Page } from "@playwright/test";
import { parse } from "csv-parse/sync";

test.use({ trace: "off", screenshot: "off", video: "off" });

async function queryReferences(panel: Locator, workspaces: EscalaWorkspace[]) {
  await panel.getByLabel("O que deseja exportar?", { exact: true }).selectOption("EMPLOYEES");
  await panel.getByLabel("Mês dos planejamentos", { exact: true }).fill("2026-12");
  for (const workspace of workspaces) await panel.getByLabel(`Planejamento da filial ${workspace.input.branchCode}`, { exact: true }).selectOption(workspace.id);
  await panel.getByRole("button", { name: "Consultar itens", exact: true }).click();
  await expect(panel.getByRole("button", { name: /^Selecionar todos os/ })).toBeVisible();
}

async function markFilter(panel: Locator, label: string, name: string | RegExp) {
  const group = panel.getByRole("group", { name: label, exact: true, includeHidden: true });
  await revealEscalasControl(group);
  await group.getByRole("checkbox", { name, exact: typeof name === "string" }).check();
}

async function conferFile(page: Page, panel: Locator) {
  const receiving = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/escalas/turnos/export/manifest");
  await panel.getByRole("button", { name: "Conferir seleção para arquivo", exact: true }).click();
  const response = await receiving; expect(response.status()).toBe(201);
  return response.json() as Promise<TurnoSelectionManifestDto>;
}

async function expectTxt(page: Page, panel: Locator, manifest: TurnoSelectionManifestDto, format: "TXT1" | "TXT2") {
  const receiving = page.waitForResponse(response => new URL(response.url()).pathname === "/api/escalas/turnos/export" && new URL(response.url()).searchParams.get("format") === format);
  await panel.getByRole("button", { name: format === "TXT1" ? "Preparar arquivo de colaboradores (TXT1)" : "Preparar definições de turnos (TXT2)", exact: true }).click();
  const response = await receiving; expect(response.status()).toBe(200); expect(new URL(response.url()).searchParams.get("manifestId")).toBe(manifest.manifestId);
  const downloading = page.waitForEvent("download"); await panel.getByRole("link", { name: `Baixar ${format} conferido`, exact: true }).click();
  const download = await downloading;
  try {
    const bytes = await downloadBytes(download); expect(bytes).toEqual(await response.body());
    const text = bytes.toString("utf8"); expect(text.endsWith("\r\n")).toBe(true); expect(text).not.toMatch(/(?<!\r)\n/);
    const rows = parse(text, { skip_empty_lines: true }) as string[][];
    if (format === "TXT1") {
      if (manifest.mode !== "EMPLOYEES") throw new Error("TXT1 requires explicit employee selection");
      expect(rows).toEqual(manifest.rows.map(row => [row.registration, ...row.markings]));
      expect(rows.map(row => row[0])).toContain("0001");
    } else {
      const definitions = [...new Map(manifest.rows.map(row => [row.code, row])).values()].sort((a,b) => a.code-b.code);
      expect(rows).toEqual(definitions.map(row => [String(row.code), row.markings.join(" "), ...row.markings]));
    }
    return rows;
  } finally { await download.delete(); }
}

function registerCatalogChoices() {
test("catalog choices, two files and a revision conflict use real saved data", async ({ browser }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires the disposable isolated E2E database");
  test.setTimeout(150_000);
  const scope = await ownedAccountScope(browser); const page = scope.admin;
  const branch = "9" + Date.now().toString().slice(-7);
  const input = newInput(branch, "Catálogo sintético", "2026-12", 42);
  input.generationMode = "HOURS_ONLY";
  input.shifts = [
    { id: "first", name: "Referência A", segments: [{ kind: "WORK", start: 437, end: 677 }, { kind: "BREAK", start: 677, end: 737 }, { kind: "WORK", start: 737, end: 1001 }] },
    { id: "second", name: "Referência B", segments: [{ kind: "WORK", start: 499, end: 739 }, { kind: "BREAK", start: 739, end: 799 }, { kind: "WORK", start: 799, end: 1063 }] },
    { id: "manual", name: "Referência manual", segments: [{ kind: "WORK", start: 559, end: 799 }, { kind: "BREAK", start: 799, end: 859 }, { kind: "WORK", start: 859, end: 1123 }] },
    { id: "after-closing", name: "Referência após o fechamento", segments: [{ kind: "WORK", start: 700, end: 940 }, { kind: "BREAK", start: 940, end: 1000 }, { kind: "WORK", start: 1000, end: 1264 }] },
  ];
  // Keep the legacy shape: a controlled shift was saved before scheduleMode was explicit.
  input.employees = [{ ...newEmployee(42, ["first", "second"]), id: "person", registration: "0001", name: "Pessoa de teste", sector: "Loja", role: "Repositor", activeFrom: "2020-01-01" },
    { ...newEmployee(42, ["first"]), id: "excluded", registration: "0002", name: "Pessoa excluída da geração", sector: "Loja", role: "Aprendiz", activeFrom: "2020-01-01", planningEnabled: false, scheduleMode: "TIMED" }];
  input.assignments = [{ employeeId: "person", date: "2026-12-05", kind: "ABSENCE", locked: true }];
  const origin = new URL(page.url()).origin;
  const headers = { origin };
  const create = await page.request.post("/api/escalas", { headers, data: { action: "CREATE", input } });
  expect(create.status()).toBe(201);
  const workspace = scope.trackWorkspace(await create.json() as EscalaWorkspace);
  try {
    const sync = await page.request.post("/api/escalas/turnos", { headers, data: { action: "SYNC", confirm: true, sources: [
      { workspaceId: workspace.id, expectedRevision: workspace.revision, localShiftIds: ["first", "second", "manual", "after-closing"] },
    ] } });
    const syncBody: unknown = await sync.json().catch(() => null);
    const syncError = syncBody !== null && typeof syncBody === "object" && "error" in syncBody ? syncBody.error : null;
    const errorCode = syncError !== null && typeof syncError === "object" && "code" in syncError
      && typeof syncError.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(syncError.code) ? syncError.code : "UNAVAILABLE";
    expect(sync.status(), "Initial catalog SYNC: " + JSON.stringify({ status: sync.status(), errorCode })).toBe(201);
    async function findCode(search: string, markings: string[]) {
      const response = await page.request.get("/api/escalas/turnos?search=" + encodeURIComponent(search));
      expect(response.status()).toBe(200);
      const result: TurnoCatalogPageDto = await response.json();
      const entry = result.entries.find(item => item.markings.join("|") === markings.join("|"));
      expect(entry).toBeTruthy();
      if (!entry) throw new Error("Expected catalog reference was not returned");
      expect(entry.code).toBeGreaterThanOrEqual(1500);
      return entry.code;
    }
    const firstCode = await findCode("07:17", ["07:17", "11:17", "12:17", "16:41"]);
    await findCode("08:19", ["08:19", "12:19", "13:19", "17:43"]);
    const manualCode = await findCode("09:19", ["09:19", "13:19", "14:19", "18:43"]);
    const afterClosingCode = await findCode("11:40", ["11:40", "15:40", "16:40", "21:04"]);
    await page.goto("/escala");
    await selectEscalasWorkspace(page, workspace);
    await openEscalasArea(page, "roster");
    await expect(page.getByRole("region", { name: "Grade mensal da filial", exact: true })).toHaveCount(0);
    await expect(page.getByText("Nenhum dia de trabalho ou folga foi criado", { exact: false })).toBeVisible();
    const exportPanel = page.getByText("Turnos e arquivos de integração", { exact: true }).locator("..");
    await exportPanel.locator(":scope > summary").click();
    await exportPanel.getByLabel("Mês de referência do arquivo", { exact: true }).fill("2026-12");
    await exportPanel.getByRole("button", { name: "Consultar itens", exact: true }).click();
    await expect(exportPanel.getByRole("button", { name: "Conferir seleção para arquivo", exact: true })).toBeDisabled();
    await markFilter(exportPanel, "Turno", new RegExp("^" + firstCode + " ·"));
    await exportPanel.locator("ul").getByRole("checkbox", { name: /^\d+ · 07:17 \/ 11:17 \/ 12:17 \/ 16:41$/ }).check();
    const catalogManifest = await conferFile(page, exportPanel); expect(catalogManifest.mode).toBe("CATALOG"); expect(catalogManifest.counts.includedCodes).toBe(1);
    await expect(exportPanel.getByRole("button", { name: "Preparar arquivo de colaboradores (TXT1)", exact: true })).toHaveCount(0);
    await expectTxt(page, exportPanel, catalogManifest, "TXT2");
    await queryReferences(exportPanel, [workspace]);
    await markFilter(exportPanel, "Filial", `Filial ${branch}`);
    await markFilter(exportPanel, "Colaborador", / · 0001 · Pessoa de teste$/);
    await markFilter(exportPanel, "Setor", `${branch} · Loja`);
    await markFilter(exportPanel, "Turno", new RegExp("^" + firstCode + " ·"));
    await markFilter(exportPanel, "Matrícula", "0001");
    await expect(exportPanel.getByText(/1 pessoa encontrada · 0 selecionados para conferir/)).toBeVisible();
    await expect(exportPanel.getByRole("button", { name: "Conferir seleção para arquivo", exact: true })).toBeDisabled();
    await markFilter(exportPanel, "Colaborador", / · 0002 · Pessoa excluída da geração$/); await markFilter(exportPanel, "Matrícula", "0002");
    await exportPanel.getByLabel("Referência para 0001", { exact: true }).selectOption("first");
    await exportPanel.getByRole("button", { name: "Selecionar todos os 2 resultados", exact: true }).click();
    const manifest = await conferFile(page, exportPanel);
    expect(manifest.mode).toBe("EMPLOYEES"); expect(manifest.counts.includedEmployees).toBe(2);
    expect(manifest.omissions).toEqual([]);
    for (const format of ["TXT1", "TXT2"] as const) {
      await expectTxt(page, exportPanel, manifest, format);
    }
    const unchanged: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json());
    expect(unchanged.input.assignments).toEqual(input.assignments);
    await page.locator('button[aria-controls="escala-area-team"]').click();
    const team = page.locator("#escala-team-restrictions");
    const teamToggle = team.locator(":scope > summary").filter({ hasText: /^Ver colaboradores e ajustar cadastro$/ });
    await expect(teamToggle).toHaveCount(1);
    await expect(teamToggle).toBeVisible();
    await teamToggle.click();
    await expect(team).toHaveAttribute("open", "");
    await team.getByRole("button", { name: "Trocar turno de Pessoa de teste", exact: true }).click();
    const swap = page.getByRole("region", { name: "Atribuir turno cadastrado a Pessoa de teste", exact: true });
    async function chooseAndPreview(code: number, partial = false) {
      if (partial) { await swap.getByLabel("Aplicar a partir de", { exact: true }).fill("2026-12-10"); await swap.getByLabel("Aplicar até", { exact: true }).fill("2026-12-20"); }
      const searching = page.waitForResponse(response => new URL(response.url()).pathname === "/api/escalas/turnos/opcoes" && new URL(response.url()).searchParams.get("search") === String(code));
      await swap.getByLabel("Buscar turno permitido pelo código ou pelas horas", { exact: true }).fill(String(code));
      const response = await searching; expect(response.status()).toBe(200);
      const options: TurnoCatalogOptionsDto = await response.json();
      expect(options.context).toMatchObject({ workspaceId: workspace.id, employeeId: "person" });
      expect(options.entries.map(entry => entry.code)).toEqual([code]);
      await swap.getByRole("radio", { name: new RegExp("^" + code + " ·") }).check();
      const previewing = page.waitForResponse(response => response.request().method() === "POST" && response.request().postDataJSON()?.action === "PREVIEW_SWAP");
      await swap.getByRole("button", { name: "Conferir atribuição", exact: true }).click();
      const result = await previewing; expect(result.status()).toBe(200);
      await expect(swap.getByText("Altera a referência de horário; não cria dias de trabalho nem folgas.", { exact: true })).toBeVisible();
      return result.json() as Promise<TurnoSwapPreviewDto>;
    }
    const invalidPreview = await chooseAndPreview(afterClosingCode, true);
    expect(invalidPreview.canApply).toBe(false);
    expect(invalidPreview.validationIssues).toContainEqual(expect.objectContaining({ code: "STORE_CLOSING_EXCEEDED" }));
    await expect(swap.getByRole("button", { name: "Confirmar e salvar atribuição", exact: true })).toBeDisabled();
    const invalidApply = await page.request.post("/api/escalas/turnos", { headers, data: {
      action: "APPLY_SWAP", workspaceId: workspace.id, expectedRevision: workspace.revision, employeeId: "person",
      catalogCode: afterClosingCode, effectiveFrom: "2026-12-10", effectiveUntil: "2026-12-20",
      previewId: invalidPreview.previewId, confirm: true,
    } });
    expect(invalidApply.status()).toBe(422);
    expect(await invalidApply.json()).toMatchObject({ error: { code: "TURNO_VALIDATION_FAILED" } });
    const afterRejection: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json());
    expect(afterRejection.revision).toBe(workspace.revision);
    expect(afterRejection.input.assignments).toEqual(unchanged.input.assignments);
    expect(afterRejection.input.employees).toEqual(unchanged.input.employees);
    expect((await chooseAndPreview(manualCode)).canApply).toBe(true);
    const applying = page.waitForResponse(response => response.request().method() === "POST" && response.request().postDataJSON()?.action === "APPLY_SWAP");
    await swap.getByRole("button", { name: "Confirmar e salvar atribuição", exact: true }).click();
    expect((await applying).status()).toBe(200);
    await expect.poll(async () => (await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json()) as EscalaWorkspace).revision).toBeGreaterThan(workspace.revision);
    const afterSwap: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json());
    expect(afterSwap.input.assignments).toEqual(input.assignments);
    expect(afterSwap.input.assignments.some(day => day.kind === "WORK")).toBe(false);
    const swappedScenario = page.getByRole("region", { name: `Filial ${afterSwap.input.branchCode} · ${afterSwap.input.branchName}`, exact: true });
    await expect(swappedScenario.getByText(new RegExp(`· revisão ${afterSwap.revision}$`))).toBeVisible();
    await revealEscalasControl(exportPanel.getByLabel("O que deseja exportar?", { exact: true }));
    await queryReferences(exportPanel, [afterSwap]);
    const manualChoice = exportPanel.getByLabel("Referência para 0001", { exact: true });
    await expect(manualChoice.locator("option")).toHaveCount(4);
    const manualOption = manualChoice.locator("option").filter({ hasText: "09:19" });
    await expect(manualOption).toHaveCount(1);
    await manualChoice.selectOption(await manualOption.getAttribute("value") ?? "");
    await exportPanel.getByRole("checkbox", { name: /^0001 · Pessoa de teste/ }).check();
    await exportPanel.getByRole("checkbox", { name: /^0002 · Pessoa excluída da geração/ }).check();
    const manualResult = await conferFile(page, exportPanel);
    expect(manualResult.counts.includedEmployees).toBe(2); expect(manualResult.omissions).toEqual([]);
    const lines = await expectTxt(page, exportPanel, manualResult, "TXT1");
    expect(lines.find(line => line[0] === "0001")?.slice(1)).toEqual(["09:19", "13:19", "14:19", "18:43"]);
    expect(lines.find(line => line[0] === "0002")?.slice(1)).toEqual(["07:17", "11:17", "12:17", "16:41"]);
    await expect(team.getByRole("button", { name: "Trocar turno de Pessoa de teste", exact: true })).toBeEnabled();
    await team.getByRole("button", { name: "Trocar turno de Pessoa de teste", exact: true }).click();
    expect((await chooseAndPreview(firstCode)).canApply).toBe(true);
    const saved = await page.request.post("/api/escalas", { headers, data: { action: "SAVE", id: workspace.id, expectedRevision: afterSwap.revision, input: { ...afterSwap.input, branchName: "Catálogo sintético atualizado" } } });
    expect(saved.status()).toBe(200);
    const conflicting = page.waitForResponse(response => response.request().method() === "POST" && response.request().postDataJSON()?.action === "APPLY_SWAP");
    await swap.getByRole("button", { name: "Confirmar e salvar atribuição", exact: true }).click();
    expect((await conflicting).status()).toBe(409);
    await expect(swap.getByRole("alert")).toContainText(/revisão|atualize/i);
    const afterConflict: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json());
    expect(afterConflict.input.assignments).toEqual(afterSwap.input.assignments);
    expect(afterConflict.input.employees.find(person => person.id === "person")?.shiftIds).toEqual(afterSwap.input.employees.find(person => person.id === "person")?.shiftIds);
  } finally {
    const response = await page.request.get("/api/escalas?id=" + workspace.id);
    if (response.status() !== 404) {
      expect(response.status()).toBe(200);
      const current: EscalaWorkspace = await response.json();
      expect(current.input.branchCode).toBe(branch);
      expect(current.status).toBe("DRAFT");
      expect((await page.request.delete("/api/escalas", { headers, data: { workspaceId: current.id, expectedRevision: current.revision } })).status()).toBe(200);
    }
    await scope.cleanup();
  }
});
}

// The future run must own an exclusive empty tenant catalog; serial execution alone does not isolate other workers.
test.describe("initial catalog lifecycle", () => {
test.describe.configure({ retries: 0 });
test("global initial catalog is atomic and stale pagination cannot pollute a new search", async ({ browser }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires a disposable isolated database; this test provisions its own empty tenant");
  test.setTimeout(150_000);
  const scope = await ownedAccountScope(browser); const page = scope.admin;
  const headers = { origin: new URL(page.url()).origin };
  const initial = await page.request.get("/api/escalas/turnos?limit=30");
  expect(initial.status()).toBe(200);
  expect(((await initial.json()) as TurnoCatalogPageDto).entries).toEqual([]);
  const workspaces: EscalaWorkspace[] = [];
  try {
    for (let branchIndex = 0; branchIndex < 2; branchIndex++) {
      const input = newInput((branchIndex ? "8" : "9") + Date.now().toString().slice(-7), "Filial sintética", "2026-12", 40);
      input.generationMode = "HOURS_ONLY";
      input.shifts = Array.from({ length: 16 }, (_, i) => {
        const start = 420 + i * 2 + branchIndex;
        return { id: `shift-${i}`, name: `Referência ${i}`, segments: [{ kind: "WORK" as const, start, end: start + 240 }, { kind: "BREAK" as const, start: start + 240, end: start + 300 }, { kind: "WORK" as const, start: start + 300, end: start + 540 }] };
      });
      input.employees = input.shifts.map((shift, i) => ({ ...newEmployee(40, [shift.id]), id: `person-${i}`, registration: `${branchIndex + 1}${String(i).padStart(4, "0")}`, name: `Pessoa ${i}`, sector: "Loja", role: "Repositor", activeFrom: "2020-01-01", scheduleMode: "TIMED" }));
      const response = await page.request.post("/api/escalas", { headers, data: { action: "CREATE", input } });
      expect(response.status()).toBe(201); workspaces.push(scope.trackWorkspace(await response.json() as EscalaWorkspace));
    }
    await page.goto("/escala"); await selectEscalasWorkspace(page, workspaces[0]);
    const panel = page.getByText("Turnos e arquivos de integração", { exact: true }).locator("..");
    await panel.locator(":scope > summary").click();
    await queryReferences(panel, [...workspaces].reverse());
    await panel.getByRole("button", { name: "Selecionar todos os 32 resultados", exact: true }).click();
    const manifest = await conferFile(page, panel); expect(manifest.omissions).toHaveLength(32);
    await panel.getByLabel(/Confirmo o cadastro das referências/).check();
    let syncCount = 0;
    page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/escalas/turnos" && request.postDataJSON()?.action === "SYNC") syncCount++; });
    const sync = page.waitForResponse(response => response.request().method() === "POST" && response.request().postDataJSON()?.action === "SYNC");
    await panel.getByRole("button", { name: "Cadastrar referências confirmadas", exact: true }).click();
    const result = await sync; expect(result.status()).toBe(201);
    expect(result.request().postDataJSON().sources).toHaveLength(2); expect(syncCount).toBe(1);
    const page1 = await page.request.get("/api/escalas/turnos?limit=30").then(response => response.json()) as TurnoCatalogPageDto;
    if (!page1.nextCursor) throw new Error("The first catalog page must expose the remaining definitions");
    const page2 = await page.request.get("/api/escalas/turnos?limit=30&cursor=" + encodeURIComponent(page1.nextCursor)).then(response => response.json()) as TurnoCatalogPageDto;
    const entries = [...page1.entries, ...page2.entries]; expect(entries).toHaveLength(32);
    expect(entries.map(entry => entry.code)).toEqual(Array.from({ length: 32 }, (_, i) => 1500 + i));
    expect(entries.map(entry => entry.markings[0])).toEqual([...entries.map(entry => entry.markings[0])].sort());
    const repeat = await page.request.post("/api/escalas/turnos", { headers, data: result.request().postDataJSON() });
    expect(repeat.status()).toBe(201);
    const repeated = await page.request.get("/api/escalas/turnos?limit=30").then(response => response.json()) as TurnoCatalogPageDto;
    expect(repeated.entries).toEqual(page1.entries);
    await page.locator('button[aria-controls="escala-area-team"]').click();
    const team = page.locator("#escala-team-restrictions");
    const teamToggle = team.locator(":scope > summary").filter({ hasText: /^Ver colaboradores e ajustar cadastro$/ });
    await expect(teamToggle).toHaveCount(1);
    await expect(teamToggle).toBeVisible();
    await teamToggle.click();
    await expect(team).toHaveAttribute("open", "");
    const initialOptionsResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/escalas/turnos/opcoes" && url.searchParams.get("workspaceId") === workspaces[0].id
        && url.searchParams.get("employeeId") === "person-0" && url.searchParams.get("cursor") === "0";
    });
    await team.getByRole("button", { name: "Trocar turno de Pessoa 0", exact: true }).click();
    const swap = page.getByRole("region", { name: "Atribuir turno cadastrado a Pessoa 0", exact: true });
    const initialOptions = await initialOptionsResponse; expect(initialOptions.status()).toBe(200);
    const initialPage: TurnoCatalogOptionsDto = await initialOptions.json();
    expect(initialPage.context).toEqual({ workspaceId: workspaces[0].id, employeeId: "person-0",
      revision: workspaces[0].revision, effectiveFrom: "2026-12-01", effectiveUntil: "2026-12-31" });
    expect(initialPage.entries).toEqual(entries.slice(0, 30));
    expect(initialPage.nextCursor).toBe(String(entries[29].code));
    await expect(swap.getByRole("button", { name: "Carregar mais turnos permitidos" })).toBeVisible();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let captured!: (response: APIResponse) => void; const pending = new Promise<APIResponse>(resolve => { captured = resolve; });
    await page.route("**/api/escalas/turnos/opcoes?*", async route => {
      if (new URL(route.request().url()).searchParams.get("cursor") === "0") return route.continue();
      const response = await route.fetch(); captured(response); await gate; await route.fulfill({ response }).catch(() => {});
    });
    const pageSettled = new Promise<void>(resolve => {
      const settled = (request: import("@playwright/test").Request) => {
        const url = new URL(request.url());
        if (url.pathname === "/api/escalas/turnos/opcoes" && url.searchParams.get("cursor") !== "0") {
          page.off("requestfinished", settled); page.off("requestfailed", settled); resolve();
        }
      };
      page.on("requestfinished", settled); page.on("requestfailed", settled);
    });
    const radios = swap.getByRole("radio");
    try {
      await swap.getByRole("button", { name: "Carregar mais turnos permitidos" }).click();
      const oldResponse = await pending; expect(oldResponse.status()).toBe(200);
      const oldPage: TurnoCatalogOptionsDto = await oldResponse.json();
      expect(oldPage.entries).toEqual(entries.slice(30));
      expect(oldPage.context).toEqual(initialPage.context);
      const searchB = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === "/api/escalas/turnos/opcoes" && url.searchParams.get("search") === String(entries[0].code) && url.searchParams.get("cursor") === "0"; });
      await swap.getByLabel("Buscar turno permitido pelo código ou pelas horas").fill(String(entries[0].code));
      const searchResult = await searchB; expect(searchResult.status()).toBe(200);
      const searchPage: TurnoCatalogOptionsDto = await searchResult.json();
      expect(searchPage.context).toEqual(initialPage.context);
      expect(searchPage.entries).toEqual([entries[0]]);
      await expect(radios).toHaveCount(1);
      await expect(radios.first()).toHaveAccessibleName(new RegExp("^" + entries[0].code + " ·"));
      await expect(swap.getByRole("button", { name: "Carregar mais turnos permitidos" })).toHaveCount(0);
    } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
    await pageSettled;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(radios).toHaveCount(1);
    await expect(radios.first()).toHaveAccessibleName(new RegExp("^" + entries[0].code + " ·"));
    await expect(swap.getByRole("button", { name: "Carregar mais turnos permitidos" })).toHaveCount(0);
  } finally {
    for (const workspace of workspaces) {
      const current: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json());
      expect(current.status).toBe("DRAFT"); expect(current.input.branchCode).toBe(workspace.input.branchCode);
      expect((await page.request.delete("/api/escalas", { headers, data: { workspaceId: current.id, expectedRevision: current.revision } })).status()).toBe(200);
    }
    await scope.cleanup();
  }
});
});
registerCatalogChoices();
