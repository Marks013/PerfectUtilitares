import type { UnimedCalculationInput } from "@/lib/unimed/types";
import type {
  FormValues,
  UnimedCalculationRequest,
} from "./unimed-calculation-types";
import { defaultMoney, parseMoney } from "./unimed-calculation-utils";

export const AUTOMATIC_CALCULATION_DEBOUNCE_MS = 450;

export function buildUnimedCalculationRequest(
  form: FormValues,
  beneficiaryId: string,
): UnimedCalculationRequest {
  const selectedDependents = form.dependents.filter(
    (dependent) => dependent.selected,
  );

  return {
    beneficiaryId,
    dependentIds: selectedDependents
      .filter((dependent) => dependent.source === "OFFICIAL")
      .map((dependent) => dependent.id),
    manualDependents: selectedDependents
      .filter((dependent) => dependent.source === "MANUAL")
      .map((dependent) => ({
        clientId: dependent.id,
        fullName: dependent.name.trim(),
        ...(dependent.inclusionDate
          ? { inclusionDate: dependent.inclusionDate }
          : {}),
        invoicePlanAmount: parseMoney(dependent.invoicePlanAmount),
        addonAmount: parseMoney(dependent.addonAmount),
      })),
    reasonCode: Number(form.reasonCode),
    exclusionDate: form.exclusionDate,
    planEnrollmentDate: form.planEnrollmentDate,
  };
}

export function buildAutomaticCalculationFingerprint(
  form: FormValues,
  beneficiaryId: string | null,
) {
  if (!beneficiaryId || !form.reasonCode || !form.exclusionDate) return null;

  const input = buildUnimedCalculationRequest(form, beneficiaryId);
  if (
    form.reasonCode === "1" &&
    input.dependentIds.length === 0 &&
    input.manualDependents.length === 0
  ) {
    return null;
  }

  return JSON.stringify({
    ...input,
    manualDependents: input.manualDependents.map((dependent) => ({
      clientId: dependent.clientId,
      fullName: dependent.fullName,
      inclusionDate: dependent.inclusionDate ?? form.planEnrollmentDate,
      invoicePlanAmount: dependent.invoicePlanAmount,
      addonAmount: dependent.addonAmount,
    })),
  });
}

export function mergeOfficialCalculationInput(
  current: FormValues,
  officialInput: UnimedCalculationInput,
): FormValues {
  const resolvedDependents = new Map(
    officialInput.dependents.flatMap((dependent) =>
      dependent.clientId ? [[dependent.clientId, dependent] as const] : [],
    ),
  );

  return {
    ...current,
    planEnrollmentDate: officialInput.planEnrollmentDate,
    billingClosure: officialInput.billingClosure,
    holder: {
      invoicePlanAmount: defaultMoney(officialInput.holder.invoicePlanAmount),
      payrollPlanAmount: defaultMoney(officialInput.holder.payrollPlanAmount),
      addonAmount: defaultMoney(officialInput.holder.addonAmount),
    },
    dependents: current.dependents.map((dependent) => {
      if (!dependent.selected) return dependent;
      const official = resolvedDependents.get(dependent.id);
      return {
        ...dependent,
        inclusionDate:
          official?.planEnrollmentDate ?? dependent.inclusionDate,
        invoicePlanAmount: defaultMoney(official?.invoicePlanAmount),
        addonAmount: defaultMoney(official?.addonAmount),
      };
    }),
  };
}
