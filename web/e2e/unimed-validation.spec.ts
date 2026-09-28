import { expect, test } from "@playwright/test";
import { calculateUnimed } from "../src/lib/unimed/calculation";

for (const width of [1280, 390]) {
  test(`Unimed validation guides corrections and retries at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const password = process.env.E2E_UNIMED_ADMIN_PASSWORD;
    test.skip(!password, "Isolated Unimed password is required");
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/unimed/acesso");
    const unlock = await page.request.post("/api/unimed/access/session", {
      headers: { origin: new URL(page.url()).origin },
      data: { password },
    });
    expect(unlock.status()).toBe(200);

    await page.route("**/api/unimed/beneficiaries?**", (route) => route.fulfill({
      json: {
        beneficiaries: [{
          id: "feedback-holder", registration: "4954", fullName: "Titular de teste",
          cpf: "12345678901", birthDate: "1990-01-01", inclusionDate: "2026-08-01",
          category: "HOLDER", relationship: null, planCode: "01", planName: "Unimed",
          accommodation: "Enfermaria", hasAddon: false, branch: null,
          pricing: { status: "RESOLVED", age: 36, planCode: "01", companyAmount: "210.00", employeeAmount: "61.26" },
          dependents: [{
            id: "feedback-dependent", fullName: "Dependente de teste", birthDate: "2010-01-01",
            inclusionDate: "2026-08-01", planCode: "01", hasAddon: false,
            pricing: { status: "RESOLVED", age: 16, planCode: "01", companyAmount: "150.00", employeeAmount: "0" },
          }],
        }],
        pricingContext: { referenceDate: "2026-08-20", billingClosure: "OPEN", dataCompetency: { year: 2026, month: 8 }, addonPrices: [] },
      },
    }));
    let requests = 0;
    let fail = false;
    let holdManualPricing = false;
    let releasePricing: (() => void) | undefined;
    await page.route("**/api/unimed/calculation", async (route) => {
      requests += 1;
      if (fail) return route.fulfill({ status: 503, json: { error: "Serviço indisponível. Tente calcular novamente." } });
      const input = route.request().postDataJSON() as {
        dependentIds: string[];
        manualDependents: Array<{ clientId: string; birthDate: string; inclusionDate?: string }>;
      };
      if (holdManualPricing && input.manualDependents.length) {
        await new Promise<void>((resolve) => { releasePricing = resolve; });
      }
      const officialInput = {
        reasonCode: 1, exclusionDate: "2026-08-20", planEnrollmentDate: "2026-08-01",
        billingClosure: "OPEN" as const,
        holder: { invoicePlanAmount: 210, payrollPlanAmount: 61.26, addonAmount: 0 },
        dependents: [
          ...input.dependentIds.map((clientId) => ({ clientId, invoicePlanAmount: 150, addonAmount: 0 })),
          ...input.manualDependents.map((item) => ({
            clientId: item.clientId, planEnrollmentDate: item.inclusionDate,
            invoicePlanAmount: item.birthDate === "2009-01-01" ? 175 : 150,
            addonAmount: 0,
          })),
        ],
      };
      return route.fulfill({ json: { calculation: calculateUnimed(officialInput), officialInput } });
    });

    await page.goto("/unimed");
    const calculate = page.getByRole("button", { name: /^(Recalcular|Calcular) exclusão$/ });
    const feedback = page.getByRole("alert", { name: "Não foi possível concluir" });
    await calculate.click();
    await expect(feedback).toBeFocused();
    await expect(feedback).toBeInViewport();
    await feedback.getByRole("button", { name: "Informe a data de exclusão." }).click();
    await expect(page.locator("#unimed-exclusion")).toBeFocused();

    await page.locator("#unimed-reason").selectOption("1");
    await page.locator("#unimed-enrollment").fill("2026-08-01");
    await page.locator("#unimed-exclusion").fill("2026-08-20");
    await page.getByLabel("Pesquisar beneficiário").fill("4954");
    await page.getByRole("button", { name: "Buscar agora" }).click();
    await page.getByRole("button", { name: /Titular de teste/ }).click();
    await expect(calculate).toHaveText("Recalcular exclusão");
    const selection = page.getByRole("checkbox", { name: "Incluir Dependente de teste no cálculo" });
    await selection.uncheck();
    const before = requests;
    await calculate.click();
    await expect(feedback).toBeFocused();
    await expect(feedback).toBeInViewport();
    await expect(feedback).toContainText("Marque ao menos um dependente");
    await page.screenshot({ path: testInfo.outputPath("unimed-feedback.png") });
    await expect(page.locator("#unimed-reason")).toHaveAttribute("aria-invalid", "false");
    expect(requests).toBe(before);
    await calculate.click();
    await expect(feedback).toBeFocused();
    await feedback.getByRole("button", { name: "Marque ao menos um dependente para esta exclusão." }).click();
    await expect(page.getByRole("group", { name: "Dependentes", exact: true })).toBeFocused();
    await expect(selection).toBeInViewport();
    await selection.check();
    await expect(feedback).toHaveCount(0);
    await expect(selection).toBeFocused();
    await expect(calculate).toHaveText("Recalcular exclusão");

    fail = true;
    await calculate.click();
    await expect(feedback).toBeFocused();
    await expect(feedback).toBeInViewport();
    await expect(feedback).toContainText("Serviço indisponível. Tente calcular novamente.");
    fail = false;
    await calculate.click();
    await expect(feedback).toHaveCount(0);

    await page.getByRole("button", { name: "Adicionar dependente" }).click();
    await calculate.click();
    await feedback.getByRole("button", { name: "Informe o nome do dependente incluído manualmente." }).click();
    const manual = page.locator("details").last();
    await expect(manual).toHaveAttribute("open", "");
    await expect(manual.locator("summary")).toBeFocused();
    await expect(manual).toContainText("Informe o nome do dependente incluído manualmente.");
    await page.getByRole("button", { name: "Remover dependente 2" }).click();
    await expect(feedback).toHaveCount(0);
    await expect(calculate).toHaveText("Recalcular exclusão");
    await selection.uncheck();
    await page.getByRole("button", { name: "Adicionar dependente" }).click();
    const editable = page.locator("details").last();
    await editable.locator("summary").click();
    await editable.getByLabel("Nome", { exact: true }).fill("Dependente manual teste");
    await editable.getByLabel("Inclusão no plano", { exact: true }).fill("2026-08-10");
    holdManualPricing = true;
    await editable.getByLabel("Data de nascimento").fill("2010-01-01");
    await expect.poll(() => Boolean(releasePricing)).toBe(true);
    await editable.getByLabel("CPF").fill("11144477735");
    holdManualPricing = false;
    releasePricing?.();
    await expect(editable.getByLabel("Valor da tabela", { exact: true })).toHaveValue("150,00");
    await expect(calculate).toHaveText("Recalcular exclusão");
    await editable.getByLabel("CPF").fill("52998224725");
    await expect(calculate).toHaveText("Recalcular exclusão");
    await editable.getByLabel("Data de nascimento").fill("2009-01-01");
    await expect(editable.getByLabel("Valor da tabela", { exact: true })).toHaveValue("175,00");
    await editable.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("unimed-manual-pricing.png") });
    await page.getByRole("button", { name: "Limpar formulário" }).click();
    await expect(feedback).toHaveCount(0);
    await expect(page.locator("#unimed-exclusion")).toHaveValue("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
