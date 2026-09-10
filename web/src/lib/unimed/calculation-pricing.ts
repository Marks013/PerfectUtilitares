import type { getUnimedCalculationConfiguration } from "./configuration";
import { resolveUnimedPlanPrice } from "./pricing";

export function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function competence(value: Date) {
  return value.toISOString().slice(0, 7);
}

export function nextCompetencyReference(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
}

type Configuration = Awaited<
  ReturnType<typeof getUnimedCalculationConfiguration>
>;
type PersonForPricing = {
  birthDate: Date | null;
  planCode: string | null;
  hasAddon: boolean;
};

function pricingResolver(configuration: Configuration, referenceDate: Date) {
  const ageBrackets = configuration.ageBrackets.map((bracket) => ({
    code: bracket.code,
    minAge: bracket.minAge,
    maxAge: bracket.maxAge,
  }));
  const prices = configuration.planPrices.map((price) => ({
    planCode: price.planCode,
    ageBracketCode: price.ageBracket.code,
    companyAmount: price.companyAmount.toFixed(2),
    employeeAmount: price.employeeAmount.toFixed(2),
  }));
  return (person: PersonForPricing) =>
    resolveUnimedPlanPrice({
      birthDate: person.birthDate,
      referenceDate,
      planCode: person.planCode,
      ageBrackets,
      prices,
    });
}

function addonAmountFor(
  configuration: Configuration,
  people: PersonForPricing[],
) {
  if (!people.some((person) => person.hasAddon)) return 0;
  if (configuration.addonPrices.length !== 1) return null;
  return configuration.addonPrices[0].amount.toNumber();
}

export function officialMoneySet(input: {
  holder: PersonForPricing;
  dependents: PersonForPricing[];
  configuration: Configuration;
  referenceDate: Date;
}) {
  const resolvePricing = pricingResolver(
    input.configuration,
    input.referenceDate,
  );
  const holderPricing = resolvePricing(input.holder);
  const dependentPricing = input.dependents.map((dependent) => ({
    dependent,
    pricing: resolvePricing(dependent),
  }));
  if (
    holderPricing.status !== "RESOLVED" ||
    dependentPricing.some(({ pricing }) => pricing.status !== "RESOLVED")
  ) {
    return { status: "PRICE_MISSING" as const };
  }
  const addonAmount = addonAmountFor(input.configuration, [
    input.holder,
    ...input.dependents,
  ]);
  if (addonAmount === null) {
    return { status: "ADDON_MISSING" as const };
  }
  return {
    status: "RESOLVED" as const,
    holder: {
      invoicePlanAmount: Number(holderPricing.companyAmount),
      payrollPlanAmount: Number(holderPricing.employeeAmount),
      addonAmount: input.holder.hasAddon ? addonAmount : 0,
    },
    dependents: dependentPricing.map(({ dependent, pricing }) => ({
      invoicePlanAmount: Number(pricing.companyAmount),
      addonAmount: dependent.hasAddon ? addonAmount : 0,
    })),
  };
}

export type OfficialMoneySetResult = ReturnType<typeof officialMoneySet>;
