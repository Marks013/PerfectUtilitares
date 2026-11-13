import { expect, test } from "./fixtures";
import { loginAsAdmin } from "./admin-session";
import { selectEscalasWorkspace } from "./escalas-selection";
import { newEmployee, newInput } from "../src/components/escalas/workspace-model";
import type { EscalaWorkspace } from "../src/lib/escalas/types";
import type { TurnoCatalogPageDto, TurnoExportManifestDto } from "../src/lib/escalas/shift-catalog/contracts";

test.use({ trace: "off", screenshot: "off", video: "off" });

function registerCatalogChoices() {
test("catalog choices, two files and a revision conflict use real saved data", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires the disposable isolated E2E database");
  test.setTimeout(150_000);
  await loginAsAdmin(page);
  const branch = "9" + Date.now().toString().slice(-7);
  const input = newInput(branch, "Catálogo sintético", "2026-11", 42);
  input.generationMode = "HOURS_ONLY";
  input.shifts = [
    { id: "first", name: "Referência A", segments: [{ kind: "WORK", start: 437, end: 677 }, { kind: "BREAK", start: 677, end: 737 }, { kind: "WORK", start: 737, end: 1001 }] },
    { id: "second", name: "Referência B", segments: [{ kind: "WORK", start: 499, end: 739 }, { kind: "BREAK", start: 739, end: 799 }, { kind: "WORK", start: 799, end: 1063 }] },
    { id: "manual", name: "Referência manual", segments: [{ kind: "WORK", start: 559, end: 799 }, { kind: "BREAK", start: 799, end: 859 }, { kind: "WORK", start: 859, end: 1123 }] },
  ];
  input.employees = [{ ...newEmployee(42, ["first", "second"]), id: "person", registration: "0001", name: "Pessoa de teste", sector: "Loja", role: "Repositor", activeFrom: "2020-01-01" },
    { ...newEmployee(42, ["first"]), id: "excluded", registration: "0002", name: "Pessoa excluída da geração", sector: "Loja", role: "Aprendiz", activeFrom: "2020-01-01", planningEnabled: false, scheduleMode: "TIMED" }];
  input.assignments = [{ employeeId: "person", date: "2026-11-05", kind: "ABSENCE", locked: true }];
  const origin = new URL(page.url()).origin;
  const headers = { origin };
  const create = await page.request.post("/api/escalas", { headers, data: { action: "CREATE", input } });
  expect(create.status()).toBe(201);
  const workspace: EscalaWorkspace = await create.json();
  try {
    const sync = await page.request.post("/api/escalas/turnos", { headers, data: { action: "SYNC", confirm: true, sources: [
      { workspaceId: workspace.id, expectedRevision: workspace.revision, localShiftIds: ["first", "second", "manual"] },
    ] } });
    expect(sync.status()).toBe(201);
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
    await page.goto("/escala");
    await selectEscalasWorkspace(page, workspace);
    const exportPanel = page.locator("details").filter({ has: page.getByText("Exportar turnos TXT da empresa", { exact: true }) });
    await exportPanel.getByText("Exportar turnos TXT da empresa", { exact: true }).click();
    await exportPanel.getByLabel("Mês dos arquivos TXT", { exact: true }).fill("2026-11");
    const branchChoice = exportPanel.getByRole("checkbox", { name: new RegExp("^Filial " + branch + " ·") });
    await expect(branchChoice).toBeChecked();
    for (const choice of await exportPanel.getByRole("checkbox").all()) {
      if (!(await choice.evaluate(element => element.parentElement?.textContent ?? "")).includes("Filial " + branch + " ·")) await choice.uncheck();
    }
    await exportPanel.getByRole("button", { name: "Conferir referências selecionadas", exact: true }).click();
    await exportPanel.getByText("Filial " + branch + " · revisão " + workspace.revision, { exact: true }).click();
    const prepare = exportPanel.getByRole("button", { name: "Gerar conferência dos arquivos", exact: true });
    await expect(prepare).toBeDisabled();
    await exportPanel.getByLabel("Referência de 0001", { exact: true }).selectOption("first");
    const manifestResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/escalas/turnos/export/manifest");
    await prepare.click();
    const manifestResult = await manifestResponse;
    expect(manifestResult.status()).toBe(201);
    const manifest: TurnoExportManifestDto = await manifestResult.json();
    expect(manifest.rowCount).toBe(2);
    expect(manifest.omissions).toEqual([]);
    for (const format of ["TXT1", "TXT2"] as const) {
      const preparing = page.waitForResponse(response => new URL(response.url()).pathname === "/api/escalas/turnos/export" && new URL(response.url()).searchParams.get("format") === format);
      await exportPanel.getByRole("button", { name: "Preparar " + format, exact: true }).click();
      const response = await preparing; expect(response.status()).toBe(200);
      expect(new URL(response.url()).searchParams.get("manifestId")).toBe(manifest.manifestId);
      const downloading = page.waitForEvent("download");
      await exportPanel.getByRole("link", { name: "Baixar " + format, exact: true }).click();
      const download = await downloading;
      const stream = await download.createReadStream(); if (!stream) throw new Error("Expected TXT download stream");
      const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString("utf8").replaceAll(":", "");
      for (const marking of ["0717", "1117", "1217", "1641"]) expect(text).toContain(marking);
      expect(text).toContain(format === "TXT1" ? "0001" : String(firstCode));
      await download.delete();
    }
    const unchanged: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json());
    expect(unchanged.input.assignments).toEqual(input.assignments);
    await page.locator('button[aria-controls="escala-area-team"]').click();
    const team = page.locator("#escala-team-restrictions");
    const teamToggle = team.locator(":scope > summary").filter({ hasText: /^Consultar equipe e restrições individuais$/ });
    await expect(teamToggle).toHaveCount(1);
    await expect(teamToggle).toBeVisible();
    await teamToggle.click();
    await expect(team).toHaveAttribute("open", "");
    await team.getByRole("button", { name: "Trocar turno de Pessoa de teste", exact: true }).click();
    const swap = page.getByRole("region", { name: "Trocar turno de Pessoa de teste", exact: true });
    async function chooseAndPreview(code: number, partial = false) {
      const searching = page.waitForResponse(response => new URL(response.url()).pathname === "/api/escalas/turnos" && new URL(response.url()).searchParams.get("search") === String(code));
      await swap.getByLabel("Buscar no catálogo da empresa", { exact: true }).fill(String(code));
      expect((await searching).status()).toBe(200);
      await swap.getByRole("radio", { name: new RegExp("^" + code + " ·") }).check();
      const previewing = page.waitForResponse(response => response.request().method() === "POST" && response.request().postDataJSON()?.action === "PREVIEW_SWAP");
      if (partial) { await swap.getByLabel("Vigência inicial").fill("2026-11-10"); await swap.getByLabel("Vigência final").fill("2026-11-20"); }
      await swap.getByRole("button", { name: "Conferir troca", exact: true }).click();
      expect((await previewing).status()).toBe(200);
      await expect(swap.getByText(/Sem grade: a troca altera a referência/)).toBeVisible();
    }
    await chooseAndPreview(manualCode, true);
    const applying = page.waitForResponse(response => response.request().method() === "POST" && response.request().postDataJSON()?.action === "APPLY_SWAP");
    await swap.getByRole("button", { name: "Confirmar troca de turno", exact: true }).click();
    expect((await applying).status()).toBe(200);
    await expect.poll(async () => (await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json()) as EscalaWorkspace).revision).toBeGreaterThan(workspace.revision);
    const afterSwap: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json());
    expect(afterSwap.input.assignments).toEqual(input.assignments);
    expect(afterSwap.input.assignments.some(day => day.kind === "WORK")).toBe(false);
    await exportPanel.getByRole("button", { name: "Conferir referências selecionadas", exact: true }).click();
    await exportPanel.getByText("Filial " + branch + " · revisão " + afterSwap.revision, { exact: true }).click();
    const manualChoice = exportPanel.getByLabel("Referência de 0001", { exact: true });
    await expect(manualChoice.locator("option")).toHaveCount(4);
    const manualOption = manualChoice.locator("option").filter({ hasText: "09:19" });
    await expect(manualOption).toHaveCount(1);
    await manualChoice.selectOption(await manualOption.getAttribute("value") ?? "");
    const manualManifestResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/escalas/turnos/export/manifest");
    await exportPanel.getByRole("button", { name: "Gerar conferência dos arquivos", exact: true }).click();
    const manualManifest = await manualManifestResponse; expect(manualManifest.status()).toBe(201);
    const manualResult: TurnoExportManifestDto = await manualManifest.json();
    expect(manualResult.rowCount).toBe(2); expect(manualResult.omissions).toEqual([]);
    const manualTxtResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/escalas/turnos/export" && new URL(response.url()).searchParams.get("format") === "TXT1");
    await exportPanel.getByRole("button", { name: "Preparar TXT1", exact: true }).click();
    expect((await manualTxtResponse).status()).toBe(200);
    const manualDownload = page.waitForEvent("download");
    await exportPanel.getByRole("link", { name: "Baixar TXT1", exact: true }).click();
    const file = await manualDownload; const stream = await file.createReadStream(); if (!stream) throw new Error("Expected TXT download stream");
    const parts: Buffer[] = []; for await (const chunk of stream) parts.push(Buffer.from(chunk));
    const lines = Buffer.concat(parts).toString("utf8").replaceAll(":", "").split(/\r?\n/);
    expect(lines.find(line => line.includes("0001"))).toContain("0919");
    expect(lines.find(line => line.includes("0002"))).toContain("0717"); await file.delete();
    await expect(team.getByRole("button", { name: "Trocar turno de Pessoa de teste", exact: true })).toBeEnabled();
    await team.getByRole("button", { name: "Trocar turno de Pessoa de teste", exact: true }).click();
    await chooseAndPreview(firstCode);
    const saved = await page.request.post("/api/escalas", { headers, data: { action: "SAVE", id: workspace.id, expectedRevision: afterSwap.revision, input: { ...afterSwap.input, branchName: "Catálogo sintético atualizado" } } });
    expect(saved.status()).toBe(200);
    const conflicting = page.waitForResponse(response => response.request().method() === "POST" && response.request().postDataJSON()?.action === "APPLY_SWAP");
    await swap.getByRole("button", { name: "Confirmar troca de turno", exact: true }).click();
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
  }
});
}

// This scenario mutates a shared tenant catalog. Retrying requires a fresh database or tenant.
test.describe("initial catalog lifecycle", () => {
test.describe.configure({ retries: 0 });
test("global initial catalog is atomic and stale pagination cannot pollute a new search", async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1" || process.env.E2E_EMPTY_TURNO_CATALOG !== "1", "Requires a disposable isolated database with an empty catalog");
  test.setTimeout(150_000);
  await loginAsAdmin(page);
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
      input.employees = input.shifts.map((shift, i) => ({ ...newEmployee(40, [shift.id]), id: `person-${i}`, registration: `${branchIndex + 1}${String(i).padStart(4, "0")}`, name: `Pessoa ${i}`, sector: "Loja", role: "Repositor", activeFrom: "2020-01-01" }));
      const response = await page.request.post("/api/escalas", { headers, data: { action: "CREATE", input } });
      expect(response.status()).toBe(201); workspaces.push(await response.json());
    }
    await page.goto("/escala"); await selectEscalasWorkspace(page, workspaces[0]);
    const panel = page.locator("details").filter({ has: page.getByText("Exportar turnos TXT da empresa", { exact: true }) });
    await panel.getByText("Exportar turnos TXT da empresa", { exact: true }).click();
    await panel.getByLabel("Mês dos arquivos TXT").fill("2026-12");
    for (const checkbox of await panel.getByRole("checkbox").all()) await checkbox.uncheck();
    for (const workspace of [...workspaces].reverse()) await panel.getByRole("checkbox", { name: new RegExp("^Filial " + workspace.input.branchCode + " ·") }).check();
    await panel.getByRole("button", { name: "Conferir referências selecionadas" }).click();
    await panel.getByRole("button", { name: "Gerar conferência dos arquivos" }).click();
    await panel.getByLabel(/Confirmo o cadastro das referências/).check();
    let syncCount = 0;
    page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/escalas/turnos" && request.postDataJSON()?.action === "SYNC") syncCount++; });
    const sync = page.waitForResponse(response => response.request().method() === "POST" && response.request().postDataJSON()?.action === "SYNC");
    await panel.getByRole("button", { name: "Cadastrar turnos necessários" }).click();
    const result = await sync; expect(result.status()).toBe(201);
    expect(result.request().postDataJSON().sources).toHaveLength(2); expect(syncCount).toBe(1);
    const page1 = await page.request.get("/api/escalas/turnos?limit=30").then(response => response.json()) as TurnoCatalogPageDto;
    const page2 = await page.request.get("/api/escalas/turnos?limit=30&cursor=" + encodeURIComponent(page1.nextCursor!)).then(response => response.json()) as TurnoCatalogPageDto;
    const entries = [...page1.entries, ...page2.entries]; expect(entries).toHaveLength(32);
    expect(entries.map(entry => entry.code)).toEqual(Array.from({ length: 32 }, (_, i) => 1500 + i));
    expect(entries.map(entry => entry.markings[0])).toEqual([...entries.map(entry => entry.markings[0])].sort());
    const repeat = await page.request.post("/api/escalas/turnos", { headers, data: result.request().postDataJSON() });
    expect(repeat.status()).toBe(201);
    const repeated = await page.request.get("/api/escalas/turnos?limit=30").then(response => response.json()) as TurnoCatalogPageDto;
    expect(repeated.entries).toEqual(page1.entries);
    await page.locator('button[aria-controls="escala-area-team"]').click();
    const team = page.locator("#escala-team-restrictions");
    const teamToggle = team.locator(":scope > summary").filter({ hasText: /^Consultar equipe e restrições individuais$/ });
    await expect(teamToggle).toHaveCount(1);
    await expect(teamToggle).toBeVisible();
    await teamToggle.click();
    await expect(team).toHaveAttribute("open", "");
    await team.getByRole("button", { name: "Trocar turno de Pessoa 0", exact: true }).click();
    const swap = page.getByRole("region", { name: "Trocar turno de Pessoa 0", exact: true });
    await expect(swap.getByRole("button", { name: "Carregar mais turnos" })).toBeVisible();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let captured!: () => void; const pending = new Promise<void>(resolve => { captured = resolve; });
    await page.route("**/api/escalas/turnos?*", async route => {
      if (!new URL(route.request().url()).searchParams.has("cursor")) return route.continue();
      const response = await route.fetch(); captured(); await gate; await route.fulfill({ response }).catch(() => {});
    });
    const pageSettled = new Promise<void>(resolve => {
      const settled = (request: import("@playwright/test").Request) => {
        const url = new URL(request.url());
        if (url.pathname === "/api/escalas/turnos" && url.searchParams.has("cursor")) {
          page.off("requestfinished", settled); page.off("requestfailed", settled); resolve();
        }
      };
      page.on("requestfinished", settled); page.on("requestfailed", settled);
    });
    await swap.getByRole("button", { name: "Carregar mais turnos" }).click(); await pending;
    const searchB = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === "/api/escalas/turnos" && url.searchParams.get("search") === String(entries[0].code) && !url.searchParams.has("cursor"); });
    await swap.getByLabel("Buscar no catálogo da empresa").fill(String(entries[0].code));
    expect((await searchB).status()).toBe(200);
    const radios = swap.getByRole("radio");
    await expect(radios).toHaveCount(1);
    await expect(radios.first()).toHaveAccessibleName(new RegExp("^" + entries[0].code + " ·"));
    await expect(swap.getByRole("button", { name: "Carregar mais turnos" })).toHaveCount(0);
    release(); await pageSettled; await page.unrouteAll({ behavior: "wait" });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(radios).toHaveCount(1);
    await expect(radios.first()).toHaveAccessibleName(new RegExp("^" + entries[0].code + " ·"));
    await expect(swap.getByRole("button", { name: "Carregar mais turnos" })).toHaveCount(0);
  } finally {
    for (const workspace of workspaces) {
      const current: EscalaWorkspace = await page.request.get("/api/escalas?id=" + workspace.id).then(response => response.json());
      expect(current.status).toBe("DRAFT"); expect(current.input.branchCode).toBe(workspace.input.branchCode);
      expect((await page.request.delete("/api/escalas", { headers, data: { workspaceId: current.id, expectedRevision: current.revision } })).status()).toBe(200);
    }
  }
});
});
registerCatalogChoices();
