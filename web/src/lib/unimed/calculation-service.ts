import { calculateUnimed } from "./calculation";
import { getUnimedCalculationConfiguration } from "./configuration";
import type { UnimedCalculationInput } from "./types";
import type { UnimedCalculationRequest } from "./calculation-request";
import {
  loadUnimedCalculationContext,
  loadUnimedPayrollLoans,
} from "./calculation-repository";
import {
  dateOnly,
  competence,
  nextCompetencyReference,
  officialMoneySet,
  type OfficialMoneySetResult,
} from "./calculation-pricing";

function failure(status: number, code: string, message: string) {
  return { ok: false as const, status, error: { code, message } };
}

export async function runUnimedCalculation(
  tenantId: string,
  input: UnimedCalculationRequest,
) {
  const referenceDate = new Date(`${input.exclusionDate}T00:00:00.000Z`);
  const { reason, competency, configuration, beneficiary } =
    await loadUnimedCalculationContext(tenantId, input, referenceDate);
  if (!reason) {
    return failure(
      422,
      "UNIMED_REASON_NOT_FOUND",
      "O motivo selecionado não está ativo. Atualize a página.",
    );
  }
  if (!competency) {
    return failure(
      422,
      "UNIMED_COMPETENCY_NOT_FOUND",
      "Não existe uma base de beneficiários vigente para a data informada.",
    );
  }
  if (!configuration.billing) {
    return failure(
      422,
      "UNIMED_BILLING_NOT_CONFIGURED",
      "Configure o fechamento da fatura para a data informada.",
    );
  }

  if (!beneficiary) {
    return failure(
      422,
      "UNIMED_BENEFICIARY_NOT_CURRENT",
      "O titular não pertence às duas competências disponíveis. Pesquise o colaborador novamente.",
    );
  }
  if (beneficiary.dependents.length !== input.dependentIds.length) {
    return failure(
      422,
      "UNIMED_DEPENDENT_NOT_LINKED",
      "Um dos dependentes não pertence ao titular selecionado.",
    );
  }
  const dependentById = new Map(
    beneficiary.dependents.map((dependent) => [dependent.id, dependent]),
  );
  const selectedDependents = input.dependentIds.flatMap((dependentId) => {
    const dependent = dependentById.get(dependentId);
    return dependent ? [dependent] : [];
  });

  if (selectedDependents.length !== input.dependentIds.length) {
    return failure(
      422,
      "UNIMED_DEPENDENT_NOT_LINKED",
      "Um dos dependentes não pertence ao titular selecionado.",
    );
  }
  const holderEnrollmentSource =
    input.planEnrollmentDate ?? beneficiary.inclusionDate;
  if (!holderEnrollmentSource) {
    return failure(
      422,
      "UNIMED_ENROLLMENT_DATE_MISSING",
      "A data de inclusão do titular não está disponível na base vigente.",
    );
  }
  const holderEnrollmentDate =
    typeof holderEnrollmentSource === "string"
      ? holderEnrollmentSource
      : dateOnly(holderEnrollmentSource);
  const dependentWithInvalidEnrollment = selectedDependents.find(
    (dependent) =>
      dependent.inclusionDate &&
      dateOnly(dependent.inclusionDate) > input.exclusionDate,
  );
  if (dependentWithInvalidEnrollment) {
    return failure(
      422,
      "UNIMED_DEPENDENT_ENROLLMENT_INVALID",
      "A inclusão do dependente não pode ocorrer após a exclusão.",
    );
  }

  const dependentPricingInputs = [
    ...selectedDependents.map((dependent) => ({
      clientId: dependent.id,
      planEnrollmentDate: dependent.inclusionDate
        ? dateOnly(dependent.inclusionDate)
        : holderEnrollmentDate,
      person: dependent,
    })),
    ...input.manualDependents.map((dependent) => ({
      clientId: dependent.clientId,
      planEnrollmentDate: dependent.inclusionDate ?? holderEnrollmentDate,
      person: {
        birthDate: new Date(`${dependent.birthDate}T00:00:00.000Z`),
        planCode: beneficiary.planCode,
        hasAddon: dependent.hasAddon,
      },
    })),
  ];

  const currentMoney = officialMoneySet({
    holder: beneficiary,
    dependents: dependentPricingInputs.map((dependent) => dependent.person),
    configuration,
    referenceDate,
  });
  if (currentMoney.status === "PRICE_MISSING") {
    return failure(
      422,
      "UNIMED_PRICE_NOT_CONFIGURED",
      `Não há preço oficial único configurado para a competência ${competence(referenceDate)}.`,
    );
  }
  if (currentMoney.status === "ADDON_MISSING") {
    return failure(
      422,
      "UNIMED_ADDON_NOT_CONFIGURED",
      `Configure um único valor de Acessório Funeral para a competência ${competence(referenceDate)}.`,
    );
  }

  const cutoffApplied =
    input.billingClosure === "AUTOMATIC_DAY_25" &&
    referenceDate.getUTCDate() >= 25;
  const nextReferenceDate = nextCompetencyReference(referenceDate);
  let nextMoney: OfficialMoneySetResult | null = null;
  if (cutoffApplied) {
    const nextConfiguration = await getUnimedCalculationConfiguration(
      tenantId,
      nextReferenceDate,
    );
    nextMoney = officialMoneySet({
      holder: beneficiary,
      dependents: dependentPricingInputs.map((dependent) => dependent.person),
      configuration: nextConfiguration,
      referenceDate: nextReferenceDate,
    });
    if (nextMoney.status === "PRICE_MISSING") {
      return failure(
        422,
        "UNIMED_NEXT_PRICE_NOT_CONFIGURED",
        `Não há preço oficial único configurado para a mensalidade de ${competence(nextReferenceDate)}.`,
      );
    }
    if (nextMoney.status === "ADDON_MISSING") {
      return failure(
        422,
        "UNIMED_NEXT_ADDON_NOT_CONFIGURED",
        `Configure um único valor de Acessório Funeral para ${competence(nextReferenceDate)}.`,
      );
    }
  }

  const currentDependents = currentMoney.dependents.map((dependent, index) => ({
    ...dependent,
    clientId: dependentPricingInputs[index].clientId,
    planEnrollmentDate: dependentPricingInputs[index].planEnrollmentDate,
  }));
  const officialInput: UnimedCalculationInput = {
    reasonCode: input.reasonCode,
    exclusionDate: input.exclusionDate,
    planEnrollmentDate: holderEnrollmentDate,
    billingClosure: input.billingClosure,
    holder: currentMoney.holder,
    dependents: currentDependents,
    ...(nextMoney?.status === "RESOLVED"
      ? {
          nextCompetency: {
            holder: nextMoney.holder,
            dependents: nextMoney.dependents.map((dependent, index) => ({
              ...dependent,
              clientId: dependentPricingInputs[index].clientId,
              planEnrollmentDate:
                dependentPricingInputs[index].planEnrollmentDate,
            })),
          },
        }
      : {}),
  };
  const calculation = calculateUnimed(officialInput);
  calculation.documentKind = reason.documentKind;

  const payrollLoans = await loadUnimedPayrollLoans(
    tenantId,
    beneficiary.cpf,
    input.exclusionDate,
  );
  return {
    ok: true as const,
    data: {
      calculation,
      officialInput,
      pricingCompetencies: {
        current: competence(referenceDate),
        next: cutoffApplied ? competence(nextReferenceDate) : null,
      },
      payrollLoans,
    },
  };
}
