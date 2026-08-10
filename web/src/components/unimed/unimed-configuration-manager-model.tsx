"use client";

import { formatPtBrDecimal } from "@/components/unimed/form-utils";
import { DEFAULT_UNIMED_EMAIL_SUBJECT } from "@/lib/unimed/defaults";
export type AgeBracketForm = {
  localId: string;
  code: string;
  label: string;
  minAge: string;
  maxAge: string;
  sortOrder: string;
};

export type PlanPriceForm = {
  localId: string;
  planCode: string;
  ageBracketCode: string;
  companyAmount: string;
  employeeAmount: string;
};

export type AddonPriceForm = {
  localId: string;
  code: string;
  label: string;
  amount: string;
};

export type ReasonForm = {
  localId: string;
  code: string;
  label: string;
  documentKind: "NONE" | "RN561" | "INACTIVE_TERM";
};

export type ConfigurationForm = {
  validFrom: string;
  billingClosure: "" | "OPEN" | "AUTOMATIC_DAY_25";
  annualAdjustmentPercent: string;
  differencePercent: string;
  ageBrackets: AgeBracketForm[];
  planPrices: PlanPriceForm[];
  addonPrices: AddonPriceForm[];
  reasons: ReasonForm[];
  emailEnabled: boolean;
  emailRecipients: string;
  emailSubjectTemplate: string;
};

export type PriceHistoryPeriod = {
  status: "ACTIVE" | "PREVIOUS";
  validFrom: string;
  validTo: string | null;
  planPrices: Array<{
    planCode: string;
    ageBracketCode: string;
    ageBracketLabel: string;
    minAge: number;
    maxAge: number | null;
    sortOrder: number;
    companyAmount: string;
    employeeAmount: string;
  }>;
  addonPrices: Array<{
    code: string;
    label: string;
    amount: string;
  }>;
};

export type ConfigurationResponse = {
  ageBrackets: Array<{
    code: string;
    label: string;
    minAge: number;
    maxAge: number | null;
    sortOrder: number;
  }>;
  planPrices: Array<{
    planCode: string;
    ageBracketCode: string;
    companyAmount: string;
    employeeAmount: string;
    validFrom: string;
    validTo: string | null;
  }>;
  addonPrices: Array<{
    code: string;
    label: string;
    amount: string;
    validFrom: string;
    validTo: string | null;
  }>;
  billing: {
    closure: "OPEN" | "AUTOMATIC_DAY_25";
    closingDay: number | null;
    validFrom: string;
    validTo: string | null;
  } | null;
  rules: {
    annualAdjustmentPercent: number;
    differencePercent: number;
    validFrom: string;
    validTo: string | null;
  } | null;
  email: {
    enabled: boolean;
    recipients: string[];
    subjectTemplate: string;
  } | null;
  reasons: Array<{
    code: number;
    label: string;
    documentKind: "NONE" | "RN561" | "INACTIVE_TERM";
  }>;
  priceHistory: PriceHistoryPeriod[];
};

export type SaveResponse = {
  validFrom: string;
  ageBrackets: number;
  planPrices: number;
  addonPrices: number;
  reasons: number;
};

export type Feedback =
  | { type: "success"; message: string }
  | { type: "error"; messages: string[] }
  | null;

export const EMPTY_FORM: ConfigurationForm = {
  validFrom: "",
  billingClosure: "",
  annualAdjustmentPercent: "",
  differencePercent: "",
  ageBrackets: [],
  planPrices: [],
  addonPrices: [],
  reasons: [],
  emailEnabled: false,
  emailRecipients: "",
  emailSubjectTemplate: "",
};

function localId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function newAgeBracket(sortOrder: number): AgeBracketForm {
  return {
    localId: localId(),
    code: "",
    label: "",
    minAge: "",
    maxAge: "",
    sortOrder: String(sortOrder),
  };
}

export function newPlanPrice(ageBracketCode = ""): PlanPriceForm {
  return {
    localId: localId(),
    planCode: "UNIFIED",
    ageBracketCode,
    companyAmount: "",
    employeeAmount: "",
  };
}

export function newReason(reasons: ReasonForm[]): ReasonForm {
  const nextCode =
    Math.max(0, ...reasons.map((reason) => Number(reason.code) || 0)) + 1;
  return {
    localId: localId(),
    code: String(nextCode),
    label: "",
    documentKind: "NONE",
  };
}

export function newAddonPrice(): AddonPriceForm {
  return {
    localId: localId(),
    code: "",
    label: "",
    amount: "",
  };
}

export function configurationToForm(data: ConfigurationResponse): ConfigurationForm {
  const validFrom =
    data.billing?.validFrom ??
    data.rules?.validFrom ??
    data.planPrices[0]?.validFrom ??
    data.addonPrices[0]?.validFrom ??
    "";
  const pricesByBracket = new Map<
    string,
    ConfigurationResponse["planPrices"][number]
  >();
  for (const price of data.planPrices) {
    if (!pricesByBracket.has(price.ageBracketCode)) {
      pricesByBracket.set(price.ageBracketCode, price);
    }
  }

  return {
    validFrom,
    billingClosure: data.billing?.closure ?? "",
    annualAdjustmentPercent:
      data.rules?.annualAdjustmentPercent == null
        ? ""
        : formatPtBrDecimal(data.rules.annualAdjustmentPercent),
    differencePercent:
      data.rules?.differencePercent == null
        ? ""
        : formatPtBrDecimal(data.rules.differencePercent),
    ageBrackets: data.ageBrackets.map((bracket) => ({
      localId: localId(),
      code: bracket.code,
      label: bracket.label,
      minAge: String(bracket.minAge),
      maxAge: bracket.maxAge == null ? "" : String(bracket.maxAge),
      sortOrder: String(bracket.sortOrder),
    })),
    planPrices: data.ageBrackets.map((bracket) => {
      const price = pricesByBracket.get(bracket.code);
      return {
        localId: localId(),
        planCode: "UNIFIED",
        ageBracketCode: bracket.code,
        companyAmount: price ? formatPtBrDecimal(price.companyAmount) : "",
        employeeAmount: price ? formatPtBrDecimal(price.employeeAmount) : "",
      };
    }),
    addonPrices: data.addonPrices.map((price) => ({
      localId: localId(),
      code: price.code,
      label: price.label,
      amount: formatPtBrDecimal(price.amount),
    })),
    reasons: data.reasons.map((reason) => ({
      localId: localId(),
      code: String(reason.code),
      label: reason.label,
      documentKind: reason.documentKind,
    })),
    emailEnabled: data.email?.enabled ?? false,
    emailRecipients: data.email?.recipients.join("\n") ?? "",
    emailSubjectTemplate: DEFAULT_UNIMED_EMAIL_SUBJECT,
  };
}

export * from "./unimed-configuration-manager-validation";
export * from "./unimed-configuration-manager-fields";
