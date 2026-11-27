import { expect, test, type Page } from "./fixtures";
import { loginAsAdmin } from "./admin-session";
import { selectEscalasWorkspace } from "./escalas-selection";
import { newEmployee, newInput } from "../src/components/escalas/workspace-model";
import type { EscalaWorkspace } from "../src/lib/escalas/types";

test.beforeEach(() => {
  test.skip(process.env.E2E_MUTATION !== "1", "Only the disposable isolated E2E database may receive these writes");
  test.setTimeout(150_000);
});

async function read(page: Page, id: string): Promise<EscalaWorkspace> {
  const response = await page.request.get(`/api/escalas?id=${id}`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function create(page: Page): Promise<EscalaWorkspace> {
  const input = newInput(`DRAFT-${Date.now().toString(36)}`, "Equipe sintética", "2027-02", 42);
  input.employees = ["A", "B"].map(id => ({
    ...newEmployee(42, input.shifts[0].id), id, registration: id,
    name: `Pessoa ${id}`, sector: "Loja", role: "Repositor", activeFrom: "",
  }));
  expect((await page.request.get("/api/escalas", { timeout: 30_000 })).status()).toBe(200);
  const response = await page.request.post("/api/escalas", {
    headers: { origin: new URL(page.url()).origin }, data: { action: "CREATE", input },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

async function cleanup(page: Page, id: string) {
  const current = await read(page, id);
  const response = await page.request.delete("/api/escalas", {
    headers: { origin: new URL(page.url()).origin },
    data: { workspaceId: id, expectedRevision: current.revision },
  });
  expect(response.status()).toBe(200);
}

test("switching, cancelling and adding never silently discard an unapplied employee edit", async ({ page }) => {
  await loginAsAdmin(page);
  const workspace = await create(page);
  try {
    await page.goto("/escala");
    await selectEscalasWorkspace(page, workspace);
    await page.locator('[aria-controls="escala-area-team"]').click();
    await page.locator("#escala-team-restrictions > summary").click();
    const edit = (name: string) => page.getByRole("button", { name: `Editar ${name}`, exact: true });
    const name = page.getByLabel("Nome completo", { exact: true });
    const dialog = page.getByRole("alertdialog", { name: "Descartar edição não aplicada?" });
    const keep = () => dialog.getByRole("button", { name: "Continuar editando", exact: true }).click();

    await edit("Pessoa A").click();
    await name.fill("Pessoa A editada");
    await edit("Pessoa B").click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Continuar editando", exact: true })).toBeFocused();
    await keep();
    await expect(name).toHaveValue("Pessoa A editada");
    await expect(page.locator("#escala-employee-editor")).toBeFocused();
    expect((await read(page, workspace.id)).input.employees.find(person => person.id === "A")?.name).toBe("Pessoa A");

    await page.getByRole("button", { name: "Cancelar edição", exact: true }).click();
    await expect(dialog).toBeVisible();
    await keep();
    await page.getByRole("button", { name: "Adicionar colaborador", exact: true }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(name).toHaveValue("Pessoa A editada");

    await name.fill("");
    await page.getByRole("button", { name: "Aplicar cadastro à proposta", exact: true }).click();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await edit("Pessoa B").click();
    await expect(dialog).toBeVisible();
    await keep();
    await expect(name).toHaveValue("");

    await name.fill("Pessoa A editada");
    await page.getByRole("button", { name: "Aplicar cadastro à proposta", exact: true }).click();
    await expect(page.locator("#escala-employee-editor")).toHaveCount(0);
    await expect.poll(async () => (await read(page, workspace.id)).input.employees.find(person => person.id === "A")?.name).toBe("Pessoa A editada");
    await expect(page.locator('[data-state="saved"]')).toBeVisible();

    await edit("Pessoa A editada").click();
    await name.fill("Edição a descartar");
    await edit("Pessoa B").click();
    await dialog.getByRole("button", { name: "Descartar edição e continuar", exact: true }).click();
    await expect(name).toHaveValue("Pessoa B");
    await name.fill("Temporário");
    await name.fill("Pessoa B");
    await edit("Pessoa A editada").click();
    await expect(dialog).toHaveCount(0);
    await expect(name).toHaveValue("Pessoa A editada");
    const saved = await read(page, workspace.id);
    expect(saved.revision).toBe(workspace.revision + 1);
    expect(saved.input.employees.find(person => person.id === "B")?.name).toBe("Pessoa B");
  } finally { await cleanup(page, workspace.id); }
});

test("branch context and daily steps precede global administration on desktop and mobile", async ({ page }) => {
  await loginAsAdmin(page);
  const workspace = await create(page);
  try {
    await page.goto("/escala");
    await selectEscalasWorkspace(page, workspace);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 });
      const scenario = page.locator('[aria-labelledby="escala-scenario-title"]');
      const navigation = page.getByRole("navigation", { name: "Etapas do planejamento", exact: true });
      await expect(scenario).toBeVisible();
      await expect(navigation).toBeVisible();
      expect(await navigation.evaluate(element => {
        const context = document.querySelector('[aria-labelledby="escala-scenario-title"]');
        const globalTools = [...document.querySelectorAll("summary")].find(summary => summary.textContent === "Base global de equipes e afastamentos");
        return Boolean(context && globalTools
          && context.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING
          && element.compareDocumentPosition(globalTools) & Node.DOCUMENT_POSITION_FOLLOWING);
      })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
  } finally { await cleanup(page, workspace.id); }
});
