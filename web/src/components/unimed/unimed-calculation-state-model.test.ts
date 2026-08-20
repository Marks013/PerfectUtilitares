import { describe, expect, it } from "vitest";
import type { UnimedCalculationInput } from "@/lib/unimed/types";
import type { FormValues } from "./unimed-calculation-types";
import {
  AUTOMATIC_CALCULATION_DEBOUNCE_MS,
  buildAutomaticCalculationFingerprint,
  buildUnimedCalculationRequest,
  mergeOfficialCalculationInput,
} from "./unimed-calculation-state-model";

function form(overrides: Partial<FormValues> = {}): FormValues {
  return {
    employeeName: "Titular",
    cpf: "12345678901",
    reasonCode: "3",
    exclusionDate: "2026-08-20",
    planEnrollmentDate: "2026-08-01",
    billingClosure: "OPEN",
    holder: {
      invoicePlanAmount: "200,00",
      payrollPlanAmount: "61,26",
      addonAmount: "0,00",
    },
    dependents: [
      {
        id: "official-1",
        source: "OFFICIAL",
        selected: true,
        name: "Dependente oficial",
        birthDate: "2010-01-01",
        inclusionDate: "2025-01-01",
        planCode: "01",
        age: 16,
        hasAddon: false,
        invoicePlanAmount: "120,00",
        addonAmount: "0,00",
      },
      {
        id: "manual-1",
        source: "MANUAL",
        selected: true,
        name: "  Dependente manual  ",
        birthDate: "2010-01-01",
        inclusionDate: "",
        planCode: null,
        age: null,
        hasAddon: true,
        invoicePlanAmount: "150,50",
        addonAmount: "6,12",
      },
      {
        id: "ignored-1",
        source: "OFFICIAL",
        selected: false,
        name: "Não selecionado",
        birthDate: null,
        inclusionDate: "2024-01-01",
        planCode: null,
        age: null,
        hasAddon: false,
        invoicePlanAmount: "999,00",
        addonAmount: "0,00",
      },
    ],
    ...overrides,
  };
}

describe("Unimed automatic calculation state model", () => {
  it("builds the API request from selected official and manual dependents", () => {
    expect(buildUnimedCalculationRequest(form(), "beneficiary-1")).toEqual({
      beneficiaryId: "beneficiary-1",
      dependentIds: ["official-1"],
      manualDependents: [
        {
          clientId: "manual-1",
          fullName: "Dependente manual",
          birthDate: "2010-01-01",
          hasAddon: true,
        },
      ],
      reasonCode: 3,
      exclusionDate: "2026-08-20",
      planEnrollmentDate: "2026-08-01",
    });
  });

  it("uses a stable semantic fingerprint after server normalization", () => {
    const initial = form();
    const normalized = form({
      dependents: initial.dependents.map((dependent) =>
        dependent.id === "manual-1"
          ? {
              ...dependent,
              name: "Dependente manual",
              inclusionDate: "2026-08-01",
              invoicePlanAmount: "150,50",
              addonAmount: "6,12",
            }
          : dependent.id === "official-1"
            ? {
                ...dependent,
                name: "Nome atualizado pela base",
                inclusionDate: "2026-07-01",
                invoicePlanAmount: "130,00",
              }
            : dependent,
      ),
    });

    expect(buildAutomaticCalculationFingerprint(initial, "beneficiary-1")).toBe(
      buildAutomaticCalculationFingerprint(normalized, "beneficiary-1"),
    );
    expect(AUTOMATIC_CALCULATION_DEBOUNCE_MS).toBeGreaterThanOrEqual(400);
  });

  it("waits for required inputs and a selected dependent when needed", () => {
    expect(buildAutomaticCalculationFingerprint(form(), null)).toBeNull();
    expect(
      buildAutomaticCalculationFingerprint(form({ exclusionDate: "" }), "b-1"),
    ).toBeNull();
    expect(
      buildAutomaticCalculationFingerprint(
        form({
          reasonCode: "1",
          dependents: form().dependents.map((dependent) => ({
            ...dependent,
            selected: false,
          })),
        }),
        "b-1",
      ),
    ).toBeNull();
  });

  it("merges official values without changing an unselected dependent", () => {
    const current = form();
    const officialInput = {
      reasonCode: 3,
      exclusionDate: "2026-08-20",
      planEnrollmentDate: "2026-08-02",
      billingClosure: "AUTOMATIC_DAY_25",
      holder: {
        invoicePlanAmount: 210,
        payrollPlanAmount: 61.26,
        addonAmount: 0,
      },
      dependents: [
        {
          clientId: "official-1",
          planEnrollmentDate: "2025-02-01",
          invoicePlanAmount: 130,
          addonAmount: 0,
        },
        {
          clientId: "manual-1",
          planEnrollmentDate: "2026-08-02",
          invoicePlanAmount: 150.5,
          addonAmount: 6.12,
        },
      ],
    } as UnimedCalculationInput;

    const merged = mergeOfficialCalculationInput(current, officialInput);

    expect(merged.planEnrollmentDate).toBe("2026-08-02");
    expect(merged.billingClosure).toBe("AUTOMATIC_DAY_25");
    expect(merged.holder).toEqual({
      invoicePlanAmount: "210,00",
      payrollPlanAmount: "61,26",
      addonAmount: "0,00",
    });
    expect(merged.dependents[0]).toMatchObject({
      inclusionDate: "2025-02-01",
      invoicePlanAmount: "130,00",
    });
    expect(merged.dependents[1]).toMatchObject({
      age: 16,
      inclusionDate: "2026-08-02",
      invoicePlanAmount: "150,50",
      addonAmount: "6,12",
    });
    expect(merged.dependents[2]).toBe(current.dependents[2]);
  });
});
