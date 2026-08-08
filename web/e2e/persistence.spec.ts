import { expect, test, type Page } from "@playwright/test";

const enabled = process.env.E2E_MUTATION === "1";
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(adminEmail!);
  await page.locator('input[name="password"]').fill(adminPassword!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
}

test.beforeEach(() => {
  test.skip(!enabled, "Mutation E2E runs only against an isolated database");
  test.skip(!adminEmail || !adminPassword, "Admin credentials are required");
});

test("administrative and Jornada writes are observable through subsequent reads", async ({
  page,
}) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  const suffix = Date.now().toString(36);

  const tenantResponse = await page.request.post("/api/admin/tenants", {
    headers: { origin },
    data: {
      name: `E2E Tenant ${suffix}`,
      slug: `e2e-${suffix}`,
    },
  });
  expect(tenantResponse.status()).toBe(201);
  const tenant = await tenantResponse.json();

  const tenantListResponse = await page.request.get("/api/admin/tenants");
  expect(tenantListResponse.status()).toBe(200);
  const tenants = await tenantListResponse.json();
  expect(tenants).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: tenant.id })]),
  );

  const ruleResponse = await page.request.post("/api/jornada/regras", {
    headers: { origin },
    data: {
      nome: `Regra E2E ${suffix}`,
      duracaoMinutos: 480,
      horasSemanais: 44,
      horasMensais: 220,
      intervaloMin: 30,
      intervaloMax: 120,
      diasValidos: ["util"],
      active: true,
    },
  });
  expect(ruleResponse.status()).toBe(201);
  const rule = await ruleResponse.json();

  const ruleListResponse = await page.request.get("/api/jornada/regras");
  expect(ruleListResponse.status()).toBe(200);
  const rules = await ruleListResponse.json();
  expect(rules).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: rule.id })]),
  );

  const deleteRuleResponse = await page.request.delete(
    `/api/jornada/regras/${rule.id}`,
    { headers: { origin } },
  );
  expect(deleteRuleResponse.status()).toBe(200);
});

test("a PDF draft persists and is readable through its resource endpoint", async ({
  page,
}) => {
  await login(page);
  const origin = new URL(page.url()).origin;

  const createResponse = await page.request.post("/api/pdf/jobs", {
    headers: { origin },
    data: { operation: "MERGE" },
  });
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json();

  const readResponse = await page.request.get(
    `/api/pdf/jobs/${created.job.id}`,
  );
  expect(readResponse.status()).toBe(200);
  await expect(readResponse.json()).resolves.toMatchObject({
    job: { id: created.job.id, operation: "MERGE", status: "DRAFT" },
  });

  const deleteResponse = await page.request.delete(
    `/api/pdf/jobs/${created.job.id}`,
    { headers: { origin } },
  );
  expect(deleteResponse.status()).toBe(204);
});
