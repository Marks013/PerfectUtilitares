import { describe, expect, it } from "vitest";
import type { ConfigurationForm } from "./unimed-configuration-manager-model";
import {
  fieldIssuesFromApiBody,
  issuesToErrors,
  parseInteger,
  parseRecipients,
  validateForm,
} from "./unimed-configuration-manager-validation";

const validForm: ConfigurationForm = {
  validFrom: "2026-08-01",
  billingClosure: "AUTOMATIC_DAY_25",
  annualAdjustmentPercent: "10,00",
  differencePercent: "5,00",
  ageBrackets: [
    {
      localId: "age-one",
      code: "ALL",
      label: "Todas",
      minAge: "0",
      maxAge: "",
      sortOrder: "1",
    },
  ],
  planPrices: [
    {
      localId: "price-one",
      planCode: "UNIFIED",
      ageBracketCode: "ALL",
      companyAmount: "100,00",
      employeeAmount: "80,00",
    },
  ],
  addonPrices: [
    {
      localId: "addon-one",
      code: "DENTAL",
      label: "Dental",
      amount: "12,00",
    },
  ],
  reasons: [
    {
      localId: "reason-one",
      code: "1",
      label: "Desligamento",
      documentKind: "NONE",
    },
  ],
  emailEnabled: true,
  emailRecipients: "ADMIN@example.test; admin@example.test",
  emailSubjectTemplate: "Subject",
};

describe("Unimed configuration client validation", () => {
  it("accepts a complete canonical form and normalizes recipients", () => {
    expect(validateForm(validForm)).toEqual([]);
    expect(parseRecipients(validForm.emailRecipients)).toEqual([
      "admin@example.test",
    ]);
    expect(parseInteger("42")).toBe(42);
    expect(parseInteger("4.2")).toBeNaN();
  });

  it("returns field-specific errors for malformed and duplicate data", () => {
    const invalid: ConfigurationForm = {
      ...validForm,
      validFrom: "08/01/2026",
      billingClosure: "",
      annualAdjustmentPercent: "-1",
      differencePercent: "101",
      ageBrackets: [
        {
          localId: "age-one",
          code: "DUP",
          label: "",
          minAge: "-1",
          maxAge: "-2",
          sortOrder: "1",
        },
        {
          localId: "age-two",
          code: "DUP",
          label: "Duplicada",
          minAge: "x",
          maxAge: "10",
          sortOrder: "1",
        },
      ],
      planPrices: [
        {
          localId: "price-one",
          planCode: "UNIFIED",
          ageBracketCode: "UNKNOWN",
          companyAmount: "-1",
          employeeAmount: "x",
        },
      ],
      addonPrices: [
        {
          localId: "addon-one",
          code: "",
          label: "",
          amount: "-5",
        },
      ],
      reasons: [
        {
          localId: "reason-one",
          code: "x",
          label: "",
          documentKind: "NONE",
        },
        {
          localId: "reason-two",
          code: "x",
          label: "",
          documentKind: "NONE",
        },
      ],
      emailRecipients: "invalid-address",
    };

    const errors = issuesToErrors(validateForm(invalid));
    expect(errors).toMatchObject({
      "config-valid-from": expect.any(String),
      "config-closure": expect.any(String),
      "config-adjustment": expect.any(String),
      "config-difference": expect.any(String),
      "age-label-age-one": expect.any(String),
      "age-code-age-two": expect.any(String),
      "addon-code-addon-one": expect.any(String),
      "reason-label-reason-one": expect.any(String),
      "config-email-recipients": expect.any(String),
    });
  });

  it("maps API issue paths to stable form controls", () => {
    const body = {
      error: {
        details: [
          { path: "validFrom", message: "date" },
          { path: "ageBrackets.0.maxAge", message: "age" },
          { path: "planPrices.0.employeeAmount", message: "employee" },
          { path: "addonPrices.0.amount", message: "addon" },
          { path: "reasons.0.documentKind", message: "reason" },
          { path: "email.recipients", message: "email" },
          { path: "unknown", message: "ignored" },
          { path: 1, message: "ignored" },
        ],
      },
    };

    expect(fieldIssuesFromApiBody(body, validForm)).toEqual([
      { fieldId: "config-valid-from", message: "date" },
      { fieldId: "age-max-age-one", message: "age" },
      { fieldId: "age-employee-age-one", message: "employee" },
      { fieldId: "addon-amount-addon-one", message: "addon" },
      { fieldId: "reason-document-reason-one", message: "reason" },
      { fieldId: "config-email-recipients", message: "email" },
    ]);
    expect(fieldIssuesFromApiBody(null, validForm)).toEqual([]);
  });
});
