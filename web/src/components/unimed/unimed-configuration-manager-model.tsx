"use client";

import {
  ChevronDown,
  type Settings2,
} from "lucide-react";
import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import {
  formatPtBrDecimal,
  normalizeDecimalInput,
  parsePtBrDecimal,
} from "@/components/unimed/form-utils";
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

export type FieldIssue = { fieldId: string; message: string };
export type FieldErrors = Record<string, string>;

export const ConfigFieldContext = createContext<{
  errors: FieldErrors;
  clear: (fieldId: string) => void;
}>({ errors: {}, clear: () => undefined });

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

export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-xs font-black text-[color:var(--app-fg)]"
    >
      {children}
    </label>
  );
}

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number" | "date";
  inputMode?: "decimal" | "numeric";
  disabled?: boolean;
}) {
  const validation = useContext(ConfigFieldContext);
  const error = validation.errors[id];
  return (
    <>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          validation.clear(id);
          onChange(event.target.value);
        }}
        className={`min-h-11 w-full rounded-xl border bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-70 ${error ? "border-[color:var(--app-coral)] ring-2 ring-[color:var(--app-danger-soft)]" : "border-[color:var(--app-border)] focus:border-[color:var(--app-teal)]"}`}
      />
      {error ? (
        <p
          id={`${id}-error`}
          className="mt-1.5 text-xs font-bold text-[color:var(--app-coral)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}

export function DecimalInput({
  id,
  value,
  onChange,
  prefix = "R$",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
}) {
  const validation = useContext(ConfigFieldContext);
  const error = validation.errors[id];
  return (
    <>
      <div className="relative">
        <span
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-black text-[color:var(--app-fg)]"
          aria-hidden="true"
        >
          {prefix}
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          placeholder="0,00"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            validation.clear(id);
            onChange(normalizeDecimalInput(event.target.value));
          }}
          onBlur={() => {
            const formatted = formatPtBrDecimal(value);
            if (formatted) onChange(formatted);
          }}
          className={`min-h-11 w-full rounded-xl border bg-[color:var(--app-input)] py-2.5 pr-3 pl-10 text-sm font-semibold text-[color:var(--app-fg)] ${error ? "border-[color:var(--app-coral)] ring-2 ring-[color:var(--app-danger-soft)]" : "border-[color:var(--app-border)] focus:border-[color:var(--app-teal)]"}`}
        />
      </div>
      {error ? (
        <p
          id={`${id}-error`}
          className="mt-1.5 text-xs font-bold text-[color:var(--app-coral)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}

export function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Settings2;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-teal)]">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div>
        <h2 className="text-lg font-black text-[color:var(--app-fg)]">
          {title}
        </h2>
        <p className="mt-1 text-sm text-[color:var(--app-muted)]">
          {description}
        </p>
      </div>
    </div>
  );
}

export function ConfigSection({
  children,
  className = "",
  defaultOpen = false,
  description,
  icon,
  id,
  title,
}: {
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  description: string;
  icon: typeof Settings2;
  id: string;
  title: string;
}) {
  return (
    <details
      id={id}
      open={defaultOpen}
      tabIndex={-1}
      className={`group scroll-mt-28 rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 shadow-[var(--app-shadow)] outline-none focus-within:border-[color:var(--app-teal)] sm:p-6 ${className}`}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)] [&::-webkit-details-marker]:hidden">
        <SectionHeading icon={icon} title={title} description={description} />
        <ChevronDown
          className="mt-2 size-5 shrink-0 text-[color:var(--app-fg)] transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="min-w-0 border-t border-[color:var(--app-border)] pt-5">
        {children}
      </div>
    </details>
  );
}
