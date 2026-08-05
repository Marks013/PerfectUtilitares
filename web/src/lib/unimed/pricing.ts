export type UnimedAgeBracketDefinition = {
  code: string;
  minAge: number;
  maxAge: number | null;
};

export type UnimedPlanPriceDefinition = {
  planCode: string;
  ageBracketCode: string;
  companyAmount: string;
  employeeAmount: string;
};

export type UnimedResolvedPlanPrice = {
  status:
    | "RESOLVED"
    | "MISSING_BIRTH_DATE"
    | "MISSING_PLAN_CODE"
    | "MISSING_AGE_BRACKET"
    | "MISSING_PRICE";
  age: number | null;
  ageBracketCode: string | null;
  planCode: string | null;
  companyAmount: string | null;
  employeeAmount: string | null;
};

const YEAR_IN_MILLISECONDS = 365.25 * 24 * 60 * 60 * 1_000;

function normalizedCode(value: string) {
  return value.trim().toLocaleUpperCase("pt-BR");
}

export function approximateUnimedAge(birthDate: Date, referenceDate: Date) {
  return Math.max(
    0,
    Math.floor(
      (referenceDate.getTime() - birthDate.getTime()) / YEAR_IN_MILLISECONDS,
    ),
  );
}

export function resolveUnimedPlanPrice(input: {
  birthDate: Date | null;
  referenceDate: Date;
  planCode: string | null;
  ageBrackets: UnimedAgeBracketDefinition[];
  prices: UnimedPlanPriceDefinition[];
}): UnimedResolvedPlanPrice {
  if (!input.birthDate) {
    return {
      status: "MISSING_BIRTH_DATE",
      age: null,
      ageBracketCode: null,
      planCode: input.planCode?.trim() || null,
      companyAmount: null,
      employeeAmount: null,
    };
  }

  const age = approximateUnimedAge(input.birthDate, input.referenceDate);
  const bracket = input.ageBrackets.find(
    (candidate) =>
      age >= candidate.minAge &&
      (candidate.maxAge === null || age <= candidate.maxAge),
  );
  const planCode = input.planCode?.trim() || null;

  if (!planCode) {
    return {
      status: "MISSING_PLAN_CODE",
      age,
      ageBracketCode: bracket?.code ?? null,
      planCode: null,
      companyAmount: null,
      employeeAmount: null,
    };
  }
  if (!bracket) {
    return {
      status: "MISSING_AGE_BRACKET",
      age,
      ageBracketCode: null,
      planCode,
      companyAmount: null,
      employeeAmount: null,
    };
  }

  const exactMatches = input.prices.filter(
    (price) =>
      normalizedCode(price.planCode) === normalizedCode(planCode) &&
      normalizedCode(price.ageBracketCode) === normalizedCode(bracket.code),
  );
  const bracketMatches = input.prices.filter(
    (price) =>
      normalizedCode(price.ageBracketCode) === normalizedCode(bracket.code),
  );
  if (exactMatches.length > 1) {
    return {
      status: "MISSING_PRICE",
      age,
      ageBracketCode: bracket.code,
      planCode,
      companyAmount: null,
      employeeAmount: null,
    };
  }
  const candidates = exactMatches.length > 0 ? exactMatches : bracketMatches;
  const distinctValues = new Set(
    candidates.map((price) => `${price.companyAmount}|${price.employeeAmount}`),
  );
  if (candidates.length === 0 || distinctValues.size !== 1) {
    return {
      status: "MISSING_PRICE",
      age,
      ageBracketCode: bracket.code,
      planCode,
      companyAmount: null,
      employeeAmount: null,
    };
  }

  return {
    status: "RESOLVED",
    age,
    ageBracketCode: bracket.code,
    planCode,
    companyAmount: candidates[0].companyAmount,
    employeeAmount: candidates[0].employeeAmount,
  };
}
