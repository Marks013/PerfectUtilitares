import { expect, test } from "@playwright/test";
import type { EscalaWorkspace } from "../src/lib/escalas/types";
import { loginAsAdmin } from "./admin-session";

test.beforeEach(async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Scheduling writes require the disposable isolated E2E database");
  test.setTimeout(150_000);
  await loginAsAdmin(page);
});

test("monthly planning imports, previews real coverage loss, edits, undoes, swaps and safely deletes with persistence", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const branch = `E2E-${suffix}`;
  await page.goto("/escalas");
  await page.getByText("Criar proposta para uma filial", { exact: true }).click();
  await page.getByLabel("Código da filial", { exact: true }).fill(branch);
  await page.getByLabel("Nome da filial (opcional)", { exact: true }).fill("Filial sintética E2E");
  await page.getByLabel("Mês de referência", { exact: true }).fill("2026-11");
  await expect(page.getByLabel("Carga semanal padrão", { exact: true })).toHaveValue("40");
  const creating = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "CREATE");
  await page.getByRole("button", { name: "Iniciar planejamento", exact: true }).click();
  const created = await creating;
  expect(created.status()).toBe(201);
  const original: EscalaWorkspace = await created.json();
  expect(original.input.visibleMonth).toBe("2026-11");
  await expect(page.getByRole("heading", { name: `Filial ${branch} · Filial sintética E2E`, exact: true })).toBeVisible();

  const csv = [
    "Matricula;Nome;Setor;Cargo;CargaSemanal;Horarios;Admissao;RegraDomingos",
    "0001;Ana Sintética;Padaria;Atendente;40;08:00-12:00 / 13:00-17:00;2020-01-01;",
    "0002;Bruno Sintético;Padaria;Atendente;40;08:00-12:00 / 13:00-17:00;2020-01-01;",
  ].join("\r\n");
  await page.getByLabel("Arquivo CSV ou XLSX", { exact: true }).setInputFiles({ name: "equipe-sintetica.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Conferir arquivo", exact: true }).click();
  await expect(page.getByText("Prévia: 2 colaboradores aceitos de 2 linhas.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Aplicar registros aceitos à proposta", exact: true }).click();
  const savingImport = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "SAVE");
  await page.getByRole("button", { name: "Salvar e conferir revisão", exact: true }).click();
  const importedResponse = await savingImport;
  expect(importedResponse.status()).toBe(200);
  const imported: EscalaWorkspace = await importedResponse.json();
  expect(imported.input.employees).toHaveLength(2);
  const ana = imported.input.employees.find((person) => person.registration === "0001");
  const bruno = imported.input.employees.find((person) => person.registration === "0002");
  expect(ana).toBeTruthy(); expect(bruno).toBeTruthy();
  if (!ana || !bruno) throw new Error("Synthetic import did not preserve registrations");
  const origin = new URL(page.url()).origin;
  // A saved draft is seeded through the real API. No solver or authentication response is mocked.
  const preparing = await page.request.post("/api/escalas", {
    headers: { origin }, data: { action: "SAVE", id: imported.id, expectedRevision: imported.revision,
      input: { ...imported.input,
        demands: [{ id: "e2e-required", date: "2026-11-02", sector: "Padaria", start: 480, end: 600, minimum: 1 }],
        assignments: [
          { employeeId: ana.id, date: "2026-11-02", kind: "WORK", shiftId: ana.shiftIds[0] },
          { employeeId: bruno.id, date: "2026-11-02", kind: "OFF" },
        ],
      },
    },
  });
  expect(preparing.status()).toBe(200);
  await page.reload();
  await page.getByLabel("Selecionar filial e período", { exact: true }).selectOption(imported.id);
  const roster = page.getByRole("region", { name: "Grade mensal da filial", exact: true });
  await expect(roster).toBeVisible();
  await expect(roster.getByRole("columnheader")).toHaveCount(31);
  await expect(roster.getByText("01/11/2026 a 30/11/2026", { exact: false })).toBeVisible();
  expect(await roster.locator('button[aria-label*="31/10/2026"]').count()).toBe(0);
  expect(await roster.locator('button[aria-label*="01/12/2026"]').count()).toBe(0);
  const anaCell = roster.getByRole("button", { name: /^Ana Sintética, 02\/11\/2026:/ });
  const brunoCell = roster.getByRole("button", { name: /^Bruno Sintético, 02\/11\/2026:/ });
  await expect(anaCell).toContainText(/^T\d+/);
  const originalCode = await anaCell.locator("span").first().textContent();
  await anaCell.click();
  await page.getByLabel("Situação do dia", { exact: true }).selectOption("OFF");
  await page.getByRole("button", { name: "Conferir alteração", exact: true }).click();
  await expect(page.getByRole("region", { name: "Impacto da alteração", exact: true })).toContainText("0 presente(s), mínimo 1");
  await page.getByRole("button", { name: "Aplicar com conflitos ao rascunho", exact: true }).click();
  await expect(anaCell.locator("span").first()).toHaveText("F");
  await expect(roster.getByRole("link", { name: /02\/11\/2026:.*cobertura/ })).toBeVisible();
  await roster.getByRole("button", { name: "Desfazer última alteração", exact: true }).click();
  await expect(anaCell.locator("span").first()).toHaveText(originalCode ?? "");

  await anaCell.click();
  await page.getByText("Trocar este dia com outro colaborador ou outra data", { exact: true }).click();
  await page.getByLabel("Colaborador para a troca", { exact: true }).selectOption(bruno.id);
  await page.getByLabel("Data para a troca", { exact: true }).selectOption("2026-11-02");
  await page.getByRole("button", { name: "Conferir troca", exact: true }).click();
  await page.getByRole("button", { name: /^(Confirmar alteração|Aplicar com conflitos ao rascunho)$/ }).click();
  await expect(anaCell.locator("span").first()).toHaveText("F");
  await expect(brunoCell.locator("span").first()).toHaveText(originalCode ?? "");
  const savingSwap = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/escalas") && response.request().postDataJSON()?.action === "SAVE");
  await page.getByRole("button", { name: "Salvar e conferir revisão", exact: true }).click();
  expect((await savingSwap).status()).toBe(200);
  const persistedResponse = await page.request.get(`/api/escalas?id=${imported.id}`);
  expect(persistedResponse.status()).toBe(200);
  const persisted: EscalaWorkspace = await persistedResponse.json();
  expect(persisted.input.assignments).toEqual(expect.arrayContaining([
    expect.objectContaining({ employeeId: ana.id, date: "2026-11-02", kind: "OFF", locked: true }),
    expect.objectContaining({ employeeId: bruno.id, date: "2026-11-02", kind: "WORK", shiftId: ana.shiftIds[0], locked: true }),
  ]));
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Excluir planejamento", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Excluir este planejamento?", exact: true });
  await expect(confirmation).toContainText(`Filial ${branch}`);
  await expect(confirmation).toContainText("01/11/2026 a 30/11/2026");
  await confirmation.getByRole("button", { name: "Manter planejamento", exact: true }).click();
  expect((await page.request.get(`/api/escalas?id=${imported.id}`)).status()).toBe(200);
  await page.getByRole("button", { name: "Excluir planejamento", exact: true }).click();
  const deleting = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().endsWith("/api/escalas"));
  await confirmation.getByRole("button", { name: "Confirmar exclusão", exact: true }).click();
  expect((await deleting).status()).toBe(200);
  await expect(page.getByText("Planejamento e revisões excluídos. Os demais períodos foram preservados.", { exact: true })).toBeVisible();
  expect((await page.request.get(`/api/escalas?id=${imported.id}`)).status()).toBe(404);
  const list = await page.request.get("/api/escalas").then((response) => response.json());
  expect(list.workspaces.some((workspace: { id: string }) => workspace.id === imported.id)).toBe(false);
});
