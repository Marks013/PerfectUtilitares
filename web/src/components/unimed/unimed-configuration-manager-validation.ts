import { parsePtBrDecimal } from "@/components/unimed/form-utils";
import type { ConfigurationForm } from "./unimed-configuration-manager-model";
import type { FieldErrors, FieldIssue } from "./unimed-configuration-manager-fields";

export function parseRecipients(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,;]+/)
        .map((recipient) => recipient.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function parseInteger(value: string) {
  if (!/^\d+$/.test(value.trim())) return Number.NaN;
  return Number(value);
}

export function validateForm(form: ConfigurationForm) {
  const errors: FieldIssue[] = [];
  const add = (fieldId: string, message: string) =>
    errors.push({ fieldId, message });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.validFrom)) {
    add("config-valid-from", "Informe a data inicial da vigência.");
  }
  if (!form.billingClosure) {
    add("config-closure", "Selecione a regra de fechamento da fatura.");
  }

  const annualAdjustment = parsePtBrDecimal(form.annualAdjustmentPercent);
  const difference = parsePtBrDecimal(form.differencePercent);
  if (
    !Number.isFinite(annualAdjustment) ||
    annualAdjustment < 0 ||
    annualAdjustment > 100
  ) {
    add(
      "config-adjustment",
      "Reajuste anual deve ficar entre 0,00% e 100,00%.",
    );
  }
  if (!Number.isFinite(difference) || difference < 0 || difference > 100) {
    add(
      "config-difference",
      "Percentual de diferença deve ficar entre 0,00% e 100,00%.",
    );
  }

  if (form.ageBrackets.length === 0) {
    add("config-age-brackets-section", "Cadastre ao menos uma faixa etária.");
  }
  for (const [index, bracket] of form.ageBrackets.entries()) {
    const minAge = parseInteger(bracket.minAge);
    const maxAge = bracket.maxAge.trim() ? parseInteger(bracket.maxAge) : null;
    const sortOrder = parseInteger(bracket.sortOrder);
    if (!bracket.code.trim()) {
      add(
        `age-code-${bracket.localId}`,
        `Informe o código da faixa ${index + 1}.`,
      );
    }
    if (!bracket.label.trim()) {
      add(
        `age-label-${bracket.localId}`,
        `Informe o nome da faixa ${index + 1}.`,
      );
    }
    if (!Number.isInteger(minAge) || minAge < 0) {
      add(
        `age-min-${bracket.localId}`,
        `Revise a idade mínima da faixa ${index + 1}.`,
      );
    }
    if (maxAge !== null && (!Number.isInteger(maxAge) || maxAge < minAge)) {
      add(
        `age-max-${bracket.localId}`,
        `Revise a idade máxima da faixa ${index + 1}.`,
      );
    }
    if (!Number.isInteger(sortOrder)) {
      add(
        `age-order-${bracket.localId}`,
        `Revise a ordem da faixa ${index + 1}.`,
      );
    }
  }

  const bracketCodes = new Set<string>();
  const bracketOrders = new Set<string>();
  for (const bracket of form.ageBrackets) {
    const code = bracket.code.trim();
    if (code && bracketCodes.has(code)) {
      add(
        `age-code-${bracket.localId}`,
        "Códigos de faixa etária não podem se repetir.",
      );
    }
    if (bracket.sortOrder && bracketOrders.has(bracket.sortOrder)) {
      add(
        `age-order-${bracket.localId}`,
        "A ordem das faixas não pode se repetir.",
      );
    }
    bracketCodes.add(code);
    bracketOrders.add(bracket.sortOrder);
  }

  if (form.planPrices.length === 0) {
    add("config-age-brackets-section", "Cadastre ao menos um preço de plano.");
  }
  if (form.planPrices.length !== form.ageBrackets.length) {
    add(
      "config-age-brackets-section",
      "Cada faixa etária deve possuir um único preço.",
    );
  }
  for (const [index, price] of form.planPrices.entries()) {
    const bracket = form.ageBrackets.find(
      (item) => item.code.trim() === price.ageBracketCode.trim(),
    );
    if (!bracketCodes.has(price.ageBracketCode)) {
      add(
        bracket ? `age-code-${bracket.localId}` : "config-age-brackets-section",
        `Revise a faixa do preço ${index + 1}.`,
      );
    }
    const companyAmount = parsePtBrDecimal(price.companyAmount);
    const employeeAmount = parsePtBrDecimal(price.employeeAmount);
    if (!Number.isFinite(companyAmount) || companyAmount < 0) {
      add(
        bracket
          ? `age-company-${bracket.localId}`
          : "config-age-brackets-section",
        `Revise o valor de fatura da faixa ${index + 1}.`,
      );
    }
    if (!Number.isFinite(employeeAmount) || employeeAmount < 0) {
      add(
        bracket
          ? `age-employee-${bracket.localId}`
          : "config-age-brackets-section",
        `Revise o valor do titular da faixa ${index + 1}.`,
      );
    }
  }

  for (const [index, addon] of form.addonPrices.entries()) {
    const amount = parsePtBrDecimal(addon.amount);
    if (!addon.code.trim()) {
      add(
        `addon-code-${addon.localId}`,
        `Informe o código do adicional ${index + 1}.`,
      );
    }
    if (!addon.label.trim()) {
      add(
        `addon-label-${addon.localId}`,
        `Informe o nome do adicional ${index + 1}.`,
      );
    }
    if (!Number.isFinite(amount) || amount < 0) {
      add(
        `addon-amount-${addon.localId}`,
        `Revise o valor do adicional ${index + 1}.`,
      );
    }
  }

  if (form.reasons.length === 0) {
    add("config-reasons-section", "Cadastre ao menos um motivo de rescisão.");
  }
  const reasonCodes = new Set<string>();
  const reasonLabels = new Set<string>();
  for (const [index, reason] of form.reasons.entries()) {
    const code = reason.code.trim();
    const label = reason.label.trim().toLocaleLowerCase("pt-BR");
    if (!/^\d{1,4}$/.test(code)) {
      add(
        `reason-label-${reason.localId}`,
        `Revise o código do motivo ${index + 1}.`,
      );
    }
    if (!label) {
      add(
        `reason-label-${reason.localId}`,
        `Informe o nome do motivo ${index + 1}.`,
      );
    }
    if (reasonCodes.has(code) || reasonLabels.has(label)) {
      add(
        `reason-label-${reason.localId}`,
        "Códigos e nomes de motivos não podem se repetir.",
      );
    }
    reasonCodes.add(code);
    reasonLabels.add(label);
  }

  const recipients = parseRecipients(form.emailRecipients);
  if (recipients.length === 0) {
    add(
      "config-email-recipients",
      "Informe ao menos um destinatário de e-mail.",
    );
  }
  if (
    recipients.some(
      (recipient) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient),
    )
  ) {
    add("config-email-recipients", "Revise os destinatários de e-mail.");
  }
  return errors.filter(
    (issue, index) =>
      errors.findIndex(
        (candidate) =>
          candidate.fieldId === issue.fieldId &&
          candidate.message === issue.message,
      ) === index,
  );
}

function fieldIdFromApiPath(path: string, form: ConfigurationForm) {
  const parts = path.split(".");
  const rootFields: Record<string, string> = {
    validFrom: "config-valid-from",
    billingClosure: "config-closure",
    annualAdjustmentPercent: "config-adjustment",
    differencePercent: "config-difference",
  };
  if (rootFields[path]) return rootFields[path];

  const index = Number(parts[1]);
  if (parts[0] === "ageBrackets") {
    const bracket = form.ageBrackets[index];
    if (!bracket) return "config-age-brackets-section";
    const field =
      {
        code: "code",
        label: "label",
        minAge: "min",
        maxAge: "max",
        sortOrder: "order",
      }[parts[2] ?? ""] ?? "code";
    return `age-${field}-${bracket.localId}`;
  }
  if (parts[0] === "planPrices") {
    const price = form.planPrices[index];
    const bracket = form.ageBrackets.find(
      (item) => item.code.trim() === price?.ageBracketCode.trim(),
    );
    if (!bracket) return "config-age-brackets-section";
    return parts[2] === "employeeAmount"
      ? `age-employee-${bracket.localId}`
      : `age-company-${bracket.localId}`;
  }
  if (parts[0] === "addonPrices") {
    const addon = form.addonPrices[index];
    if (!addon) return "config-addons-section";
    const field =
      parts[2] === "amount"
        ? "amount"
        : parts[2] === "label"
          ? "label"
          : "code";
    return `addon-${field}-${addon.localId}`;
  }
  if (parts[0] === "reasons") {
    const reason = form.reasons[index];
    if (!reason) return "config-reasons-section";
    return parts[2] === "documentKind"
      ? `reason-document-${reason.localId}`
      : `reason-label-${reason.localId}`;
  }
  if (parts[0] === "email") return "config-email-recipients";
  return null;
}

export function fieldIssuesFromApiBody(body: unknown, form: ConfigurationForm) {
  const details = (
    body as {
      error?: { details?: Array<{ path?: unknown; message?: unknown }> };
    }
  )?.error?.details;
  if (!Array.isArray(details)) return [];
  return details.flatMap((detail) => {
    if (typeof detail.path !== "string" || typeof detail.message !== "string") {
      return [];
    }
    const fieldId = fieldIdFromApiPath(detail.path, form);
    return fieldId ? [{ fieldId, message: detail.message }] : [];
  });
}

export function issuesToErrors(issues: FieldIssue[]) {
  return issues.reduce<FieldErrors>((current, issue) => {
    if (!current[issue.fieldId]) current[issue.fieldId] = issue.message;
    return current;
  }, {});
}
