import { describe, expect, it, vi } from "vitest";
import {
  INITIAL_FORM,
  createDependent,
  dateInput,
  defaultMoney,
  formatCompetencyResult,
  formatCpf,
  formatMoneyInput,
  formatMoneyResult,
  normalizeMoney,
  parseMoney,
  pricingIssue,
  readApiError,
  validateForm,
  waitForDocumentPoll,
} from "./unimed-calculation-utils";

describe("unimed calculation utilities", () => {
  it("normalizes, parses and formats real-world monetary input", () => {
    expect(normalizeMoney("R$ 1.234,56")).toBe("1.234,56");
    expect(parseMoney("1.234,56")).toBe(1234.56);
    expect(parseMoney("1.234.567")).toBe(1234567);
    expect(parseMoney("1234.56")).toBe(1234.56);
    expect(parseMoney("1.234")).toBe(1234);
    expect(parseMoney("")).toBeNaN();
    expect(formatMoneyInput("1234,5")).toBe("1.234,50");
    expect(formatMoneyInput("invalid")).toBe("invalid");
    expect(formatMoneyResult("1234.5")).toContain("1.234,50");
    expect(formatMoneyResult("invalid")).toBe("\u2014");
    expect(defaultMoney(null)).toBe("");
    expect(defaultMoney(25)).toBe("25,00");
  });

  it("formats competency, dates and CPF without extra digits", () => {
    expect(formatCompetencyResult("2026-08")).toBe("08/2026");
    expect(formatCompetencyResult(null)).toBe("\u2014");
    expect(formatCompetencyResult("2026")).toBe("2026");
    expect(dateInput("2026-08-09T12:00:00.000Z")).toBe("2026-08-09");
    expect(dateInput(undefined)).toBe("");
    expect(formatCpf("1234567890199")).toBe("123.456.789-01");
  });

  it("creates a dependent with independent safe defaults", () => {
    const dependent = createDependent("2026-08-01");
    expect(dependent.id).toEqual(expect.any(String));
    expect(dependent.id.length).toBeGreaterThan(0);
    expect(dependent).toMatchObject({
      source: "MANUAL",
      name: "",
      birthDate: null,
      inclusionDate: "2026-08-01",
      planCode: null,
      age: null,
      hasAddon: false,
      invoicePlanAmount: "",
      addonAmount: "",
    });
  });

  it("selects the useful API error and falls back on invalid bodies", async () => {
    await expect(
      readApiError(
        new Response(
          JSON.stringify({
            details: [{ message: "Detailed failure" }],
            error: "Generic failure",
          }),
        ),
      ),
    ).resolves.toBe("Detailed failure");
    await expect(
      readApiError(new Response(JSON.stringify({ error: "String failure" }))),
    ).resolves.toBe("String failure");
    await expect(
      readApiError(
        new Response(JSON.stringify({ error: { message: "Object failure" } })),
      ),
    ).resolves.toBe("Object failure");
    await expect(
      readApiError(new Response("not-json"), "Safe fallback"),
    ).resolves.toBe("Safe fallback");
  });

  it("describes every beneficiary pricing failure", () => {
    expect(pricingIssue("MISSING_BIRTH_DATE")).toContain("nascimento");
    expect(pricingIssue("MISSING_PLAN_CODE")).toContain("plano");
    expect(pricingIssue("MISSING_AGE_BRACKET")).toContain("faixa");
    expect(
      pricingIssue("AMBIGUOUS_PRICE" as Parameters<typeof pricingIssue>[0]),
    ).toContain("pre");
  });

  it("validates complete and invalid holder/dependent forms", () => {
    const validForm = {
      ...INITIAL_FORM,
      employeeName: "Maria Silva",
      cpf: "123.456.789-01",
      reasonCode: "01",
      exclusionDate: "2026-08-09",
      planEnrollmentDate: "2026-01-01",
      holder: {
        invoicePlanAmount: "100,00",
        payrollPlanAmount: "50,00",
        addonAmount: "0,00",
      },
      dependents: [
        {
          ...createDependent(),
          id: "dependent-1",
          name: "Dependente manual",
          inclusionDate: "2026-08-01",
          invoicePlanAmount: "80,00",
          addonAmount: "0,00",
        },
      ],
    };
    expect(validateForm(validForm)).toEqual({});

    const errors = validateForm({
      ...validForm,
      employeeName: "A",
      cpf: "123",
      reasonCode: "",
      exclusionDate: "",
      planEnrollmentDate: "",
      holder: {
        invoicePlanAmount: "-1",
        payrollPlanAmount: "invalid",
        addonAmount: "",
      },
      dependents: [
        {
          ...validForm.dependents[0],
          invoicePlanAmount: "-1",
          addonAmount: "invalid",
        },
      ],
    });
    expect(Object.keys(errors)).toEqual(
      expect.arrayContaining([
        "employeeName",
        "cpf",
        "reasonCode",
        "exclusionDate",
        "planEnrollmentDate",
        "invoicePlanAmount",
        "payrollPlanAmount",
        "addonAmount",
        "dependent-dependent-1",
      ]),
    );
    expect(
      validateForm({
        ...validForm,
        planEnrollmentDate: "2026-09-01",
      }).planEnrollmentDate,
    ).toBeDefined();
    expect(
      validateForm({
        ...validForm,
        dependents: [
          {
            ...validForm.dependents[0],
            inclusionDate: "2026-09-01",
          },
        ],
      })["dependent-dependent-1"],
    ).toContain("inclusão do dependente");
  });

  it("resolves polling and aborts without a pending timer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    try {
      const completed = waitForDocumentPoll(25, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(25);
      await expect(completed).resolves.toBeUndefined();

      const controller = new AbortController();
      const aborted = waitForDocumentPoll(100, controller.signal);
      controller.abort();
      await expect(aborted).rejects.toMatchObject({ name: "AbortError" });

      const alreadyAborted = new AbortController();
      alreadyAborted.abort();
      await expect(
        waitForDocumentPoll(100, alreadyAborted.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
