import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

test("manual dependent calculates through the real API without a beneficiary base for the exclusion month", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const password = process.env.E2E_UNIMED_ADMIN_PASSWORD;
  const databaseUrl = process.env.DATABASE_URL;
  test.skip(!password || !databaseUrl, "Requires the isolated E2E runner");
  if (process.env.E2E_MUTATION !== "1" ||
      !/^\/perfectutilitares_e2e_\d+_\d+$/.test(new URL(databaseUrl!).pathname)) {
    throw new Error("This fixture only runs in the disposable E2E database.");
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const id = randomUUID();
  const holderId = `holder-${id}`;
  const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
  try {
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: "principal" } });
    await db.unimedCompetency.create({ data: {
      id, tenantId: tenant.id, year: 2026, month: 9, status: "ACTIVE",
    } });
    await db.unimedBeneficiary.create({ data: {
      id: holderId, tenantId: tenant.id, competencyId: id,
      sourceKey: id, registration: "987650", fullName: "Titular sintético manual",
      cpf: "52998224725", category: "HOLDER", planCode: id,
      inclusionDate: date("2022-08-01"), birthDate: null, hasAddon: true,
    } });
    await db.unimedAgeBracket.create({ data: {
      id, tenantId: tenant.id, code: id, label: "27 anos", minAge: 27, maxAge: 27, sortOrder: 9000,
    } });
    await db.unimedPlanPriceVersion.createMany({ data: [
      { id: `aug-${id}`, tenantId: tenant.id, ageBracketId: id, planCode: id,
        companyAmount: 310, employeeAmount: 310, validFrom: date("2026-08-01"), validTo: date("2026-08-31") },
      { id: `sep-${id}`, tenantId: tenant.id, ageBracketId: id, planCode: id,
        companyAmount: 341, employeeAmount: 341, validFrom: date("2026-09-01") },
    ] });
    await db.unimedBillingSetting.create({ data: {
      id, tenantId: tenant.id, closure: "AUTOMATIC_DAY_25", closingDay: 25, validFrom: date("2026-08-01"),
    } });
    await page.goto("/unimed/acesso");
    expect((await page.request.post("/api/unimed/access/session", {
      headers: { origin: new URL(page.url()).origin }, data: { password },
    })).status()).toBe(200);
    await page.goto("/unimed");
    await page.locator("#unimed-reason").selectOption("1");
    await page.locator("#unimed-exclusion").fill("2026-08-26");
    await page.getByLabel("Pesquisar beneficiário").fill("Titular sintético manual");
    await page.getByRole("button", { name: "Buscar agora" }).click();
    await page.getByRole("button", { name: /Titular sintético manual/ }).click();
    await page.getByRole("button", { name: "Adicionar dependente" }).click();
    const manual = page.locator("details").last();
    if ((await manual.getAttribute("open")) === null) await manual.locator("summary").click();
    await manual.getByLabel("Nome", { exact: true }).fill("Dependente sintético manual");
    await manual.getByLabel("CPF").fill("11144477735");
    await manual.getByLabel("Inclusão no plano", { exact: true }).fill("2026-08-13");
    const calculated = page.waitForResponse((response) => response.url().endsWith("/api/unimed/calculation") &&
      response.request().postDataJSON()?.manualDependents?.[0]?.birthDate === "1999-02-23");
    await manual.getByLabel("Data de nascimento").fill("1999-02-23");
    const response = await calculated;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ calculation: {
      invoiceTotal: "310.00", usedProrata: "140.00", currentCompetencyRefund: "170.00",
      nextCompetencyRefund: "341.00", dependentUsage: [{ usedDays: 14 }],
    } });
    await expect(manual.getByLabel("Valor da tabela", { exact: true })).toHaveValue("310,00");
    await expect(page.getByRole("alert", { name: "Não foi possível concluir" })).toHaveCount(0);
    await manual.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("manual-real-api.png") });
    await page.getByRole("button", { name: "Limpar formulário" }).click();
    await expect(page.locator("#unimed-exclusion")).toHaveValue("");
    await expect(page.getByText("Dependente sintético manual", { exact: true })).toHaveCount(0);
  } finally {
    await db.unimedPlanPriceVersion.deleteMany({ where: { id: { in: [`aug-${id}`, `sep-${id}`] } } });
    await db.unimedAgeBracket.deleteMany({ where: { id } });
    await db.unimedBillingSetting.deleteMany({ where: { id } });
    await db.unimedBeneficiary.deleteMany({ where: { id: holderId } });
    await db.unimedCompetency.deleteMany({ where: { id } });
    await db.$disconnect();
  }
});
