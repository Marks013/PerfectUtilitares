"use client";

import {
  AlertCircle,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  FileCog,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  UsersRound,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  errorMessagesFromBody,
  formatPtBrDecimal,
  normalizeDecimalInput,
  parsePtBrDecimal,
} from "@/components/unimed/form-utils";
import { DEFAULT_UNIMED_EMAIL_SUBJECT } from "@/lib/unimed/defaults";
import { UnimedNoticeToast } from "./unimed-notice-toast";

type AgeBracketForm = {
  localId: string;
  code: string;
  label: string;
  minAge: string;
  maxAge: string;
  sortOrder: string;
};

type PlanPriceForm = {
  localId: string;
  planCode: string;
  ageBracketCode: string;
  companyAmount: string;
  employeeAmount: string;
};

type AddonPriceForm = {
  localId: string;
  code: string;
  label: string;
  amount: string;
};

type ReasonForm = {
  localId: string;
  code: string;
  label: string;
  documentKind: "NONE" | "RN561" | "INACTIVE_TERM";
};

type ConfigurationForm = {
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

type ConfigurationResponse = {
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

type SaveResponse = {
  validFrom: string;
  ageBrackets: number;
  planPrices: number;
  addonPrices: number;
  reasons: number;
};

type Feedback =
  | { type: "success"; message: string }
  | { type: "error"; messages: string[] }
  | null;

type FieldIssue = { fieldId: string; message: string };
type FieldErrors = Record<string, string>;

const ConfigFieldContext = createContext<{
  errors: FieldErrors;
  clear: (fieldId: string) => void;
}>({ errors: {}, clear: () => undefined });

const EMPTY_FORM: ConfigurationForm = {
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

function newAgeBracket(sortOrder: number): AgeBracketForm {
  return {
    localId: localId(),
    code: "",
    label: "",
    minAge: "",
    maxAge: "",
    sortOrder: String(sortOrder),
  };
}

function newPlanPrice(ageBracketCode = ""): PlanPriceForm {
  return {
    localId: localId(),
    planCode: "UNIFIED",
    ageBracketCode,
    companyAmount: "",
    employeeAmount: "",
  };
}

function newReason(reasons: ReasonForm[]): ReasonForm {
  const nextCode =
    Math.max(0, ...reasons.map((reason) => Number(reason.code) || 0)) + 1;
  return {
    localId: localId(),
    code: String(nextCode),
    label: "",
    documentKind: "NONE",
  };
}

function newAddonPrice(): AddonPriceForm {
  return {
    localId: localId(),
    code: "",
    label: "",
    amount: "",
  };
}

function configurationToForm(data: ConfigurationResponse): ConfigurationForm {
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

function parseRecipients(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,;]+/)
        .map((recipient) => recipient.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function parseInteger(value: string) {
  if (!/^\d+$/.test(value.trim())) return Number.NaN;
  return Number(value);
}

function validateForm(form: ConfigurationForm) {
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

function fieldIssuesFromApiBody(body: unknown, form: ConfigurationForm) {
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

function issuesToErrors(issues: FieldIssue[]) {
  return issues.reduce<FieldErrors>((current, issue) => {
    if (!current[issue.fieldId]) current[issue.fieldId] = issue.message;
    return current;
  }, {});
}

function FieldLabel({
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

function TextInput({
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

function DecimalInput({
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

function SectionHeading({
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

function ConfigSection({
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

export function UnimedConfigurationManager() {
  const [form, setForm] = useState<ConfigurationForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const clearFieldError = useCallback((fieldId: string) => {
    setFieldErrors((current) => {
      if (!current[fieldId]) return current;
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  }, []);

  function focusFirstIssue(issue: FieldIssue | undefined) {
    if (!issue) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const field = document.getElementById(issue.fieldId);
        if (!field) return;
        const collapsedSection = field.closest("details");
        if (collapsedSection instanceof HTMLDetailsElement) {
          collapsedSection.open = true;
        }
        field.scrollIntoView({ behavior: "smooth", block: "center" });
        field.focus({ preventScroll: true });
      });
    });
  }

  const loadConfiguration = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/unimed/configuration", {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as
        | ConfigurationResponse
        | { error?: { message?: string; details?: unknown } }
        | null;
      if (!response.ok || !body || !("ageBrackets" in body)) {
        throw new Error(
          errorMessagesFromBody(
            body && "error" in body ? body : null,
            "Não foi possível carregar as configurações.",
          ).join(" "),
        );
      }
      setForm(configurationToForm(body));
      setFieldErrors({});
    } catch (error) {
      setFeedback({
        type: "error",
        messages: [
          error instanceof Error
            ? error.message
            : "Não foi possível carregar as configurações.",
        ],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfiguration();
  }, [loadConfiguration]);

  const bracketOptions = useMemo(
    () => form.ageBrackets.filter((bracket) => bracket.code.trim().length > 0),
    [form.ageBrackets],
  );

  function updateAge(
    localId: string,
    field: keyof Omit<AgeBracketForm, "localId">,
    value: string,
  ) {
    setForm((current) => {
      const previousCode = current.ageBrackets.find(
        (bracket) => bracket.localId === localId,
      )?.code;
      return {
        ...current,
        ageBrackets: current.ageBrackets.map((bracket) =>
          bracket.localId === localId
            ? { ...bracket, [field]: value }
            : bracket,
        ),
        planPrices:
          field === "code"
            ? current.planPrices.map((price) =>
                price.ageBracketCode === previousCode
                  ? { ...price, ageBracketCode: value }
                  : price,
              )
            : current.planPrices,
      };
    });
    setFeedback(null);
  }

  function updatePlan(
    localId: string,
    field: keyof Omit<PlanPriceForm, "localId">,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      planPrices: current.planPrices.map((price) =>
        price.localId === localId ? { ...price, [field]: value } : price,
      ),
    }));
    setFeedback(null);
  }

  function updateAddon(
    localId: string,
    field: keyof Omit<AddonPriceForm, "localId">,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      addonPrices: current.addonPrices.map((price) =>
        price.localId === localId ? { ...price, [field]: value } : price,
      ),
    }));
    setFeedback(null);
  }

  function updateReason<K extends "label" | "documentKind">(
    localId: string,
    field: K,
    value: ReasonForm[K],
  ) {
    setForm((current) => ({
      ...current,
      reasons: current.reasons.map((reason) =>
        reason.localId === localId ? { ...reason, [field]: value } : reason,
      ),
    }));
    setFeedback(null);
  }

  async function saveConfiguration() {
    const issues = validateForm(form);
    if (issues.length > 0) {
      setFieldErrors(issuesToErrors(issues));
      setFeedback({
        type: "error",
        messages: ["Revise o campo destacado antes de salvar."],
      });
      focusFirstIssue(issues[0]);
      return;
    }

    setSaving(true);
    setFeedback(null);
    setFieldErrors({});
    const payload = {
      validFrom: form.validFrom,
      billingClosure: form.billingClosure,
      annualAdjustmentPercent: parsePtBrDecimal(form.annualAdjustmentPercent),
      differencePercent: parsePtBrDecimal(form.differencePercent),
      ageBrackets: form.ageBrackets.map((bracket) => ({
        code: bracket.code.trim(),
        label: bracket.label.trim(),
        minAge: parseInteger(bracket.minAge),
        maxAge: bracket.maxAge.trim() ? parseInteger(bracket.maxAge) : null,
        sortOrder: parseInteger(bracket.sortOrder),
      })),
      planPrices: form.planPrices.map((price) => ({
        planCode: price.planCode.trim(),
        ageBracketCode: price.ageBracketCode,
        companyAmount: parsePtBrDecimal(price.companyAmount),
        employeeAmount: parsePtBrDecimal(price.employeeAmount),
      })),
      addonPrices: form.addonPrices.map((price) => ({
        code: price.code.trim(),
        label: price.label.trim(),
        amount: parsePtBrDecimal(price.amount),
      })),
      reasons: form.reasons.map((reason) => ({
        code: parseInteger(reason.code),
        label: reason.label.trim(),
        documentKind: reason.documentKind,
      })),
      email: {
        enabled: form.emailEnabled,
        recipients: parseRecipients(form.emailRecipients),
        subjectTemplate: DEFAULT_UNIMED_EMAIL_SUBJECT,
      },
    };

    try {
      const response = await fetch("/api/unimed/configuration", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as
        | SaveResponse
        | { error?: { message?: string; details?: unknown } }
        | null;
      if (!response.ok || !body || !("validFrom" in body)) {
        const issues = fieldIssuesFromApiBody(body, form);
        if (issues.length > 0) {
          setFieldErrors(issuesToErrors(issues));
          focusFirstIssue(issues[0]);
        }
        setFeedback({
          type: "error",
          messages:
            issues.length > 0
              ? ["Revise o campo destacado antes de salvar."]
              : errorMessagesFromBody(
                  body && "error" in body ? body : null,
                  "Não foi possível salvar as configurações.",
                ),
        });
        return;
      }
      setFeedback({
        type: "success",
        message: `Configuração com vigência em ${new Intl.DateTimeFormat(
          "pt-BR",
          { timeZone: "UTC" },
        ).format(new Date(`${body.validFrom}T00:00:00.000Z`))} salva.`,
      });
      await loadConfiguration();
      setFeedback({
        type: "success",
        message: "Configurações salvas e recarregadas.",
      });
      setFieldErrors({});
    } catch {
      setFeedback({
        type: "error",
        messages: ["Falha de conexão ao salvar as configurações."],
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-[30rem] place-items-center" role="status">
        <div className="text-center">
          <Loader2
            className="mx-auto size-8 animate-spin text-[color:var(--app-teal)]"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-black text-[color:var(--app-fg)]">
            Carregando configurações…
          </p>
        </div>
      </div>
    );
  }

  return (
    <ConfigFieldContext.Provider
      value={{ errors: fieldErrors, clear: clearFieldError }}
    >
      <div className="space-y-6">
        <header className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-3 py-1.5 text-xs font-black tracking-wide text-[color:var(--app-teal)] uppercase">
                <Settings2 className="size-3.5" aria-hidden="true" />
                Unimed · Administração
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-[color:var(--app-fg)] sm:text-4xl">
                Configurações e valores
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:var(--app-muted)] sm:text-base">
                Nova vigência preserva versões anteriores. Valores financeiros
                usam duas casas decimais.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadConfiguration()}
              disabled={saving}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2.5 text-sm font-black text-[color:var(--app-fg)] disabled:opacity-50"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Recarregar
            </button>
          </div>
        </header>

        <UnimedNoticeToast
          notice={
            feedback
              ? {
                  id:
                    feedback.type === "success"
                      ? "config-success"
                      : "config-error",
                  type: feedback.type,
                  title:
                    feedback.type === "success"
                      ? "Configuração atualizada"
                      : "Não foi possível salvar",
                  message:
                    feedback.type === "success"
                      ? feedback.message
                      : feedback.messages.join(" "),
                }
              : null
          }
          onClose={() => setFeedback(null)}
        />

        <nav
          aria-label="Seções das configurações"
          className="sticky top-2 z-10 grid grid-cols-2 gap-2 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-2 shadow-[var(--app-shadow)] sm:grid-cols-3 lg:grid-cols-5"
        >
          {[
            ["config-calculation-section", "Vigência"],
            ["config-age-brackets-section", "Faixas e valores"],
            ["config-addons-section", "Adicionais"],
            ["config-reasons-section", "Motivos"],
            ["config-email-section", "E-mail"],
          ].map(([href, label]) => (
            <a
              key={href}
              href={`#${href}`}
              onClick={() => {
                const section = document.getElementById(href);
                if (section instanceof HTMLDetailsElement) section.open = true;
              }}
              className="flex min-h-10 min-w-0 items-center justify-center rounded-xl px-2 py-2 text-center text-xs font-black text-[color:var(--app-fg)] transition hover:bg-[color:var(--app-surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)]"
            >
              {label}
            </a>
          ))}
        </nav>

        <ConfigSection
          id="config-calculation-section"
          icon={CalendarRange}
          title="Vigência e cálculo"
          description="Define quando esta versão entra em vigor e os percentuais aplicados."
          defaultOpen
        >
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <FieldLabel htmlFor="config-valid-from">
                Início da vigência *
              </FieldLabel>
              <TextInput
                id="config-valid-from"
                type="date"
                value={form.validFrom}
                onChange={(validFrom) => {
                  setForm((current) => ({ ...current, validFrom }));
                  setFeedback(null);
                }}
              />
            </div>
            <div>
              <FieldLabel htmlFor="config-closure">
                Fechamento da fatura *
              </FieldLabel>
              <select
                id="config-closure"
                value={form.billingClosure}
                onChange={(event) => {
                  clearFieldError("config-closure");
                  setForm((current) => ({
                    ...current,
                    billingClosure: event.target.value as
                      "" | "OPEN" | "AUTOMATIC_DAY_25",
                  }));
                  setFeedback(null);
                }}
                aria-invalid={Boolean(fieldErrors["config-closure"])}
                aria-describedby={
                  fieldErrors["config-closure"]
                    ? "config-closure-error"
                    : undefined
                }
                className={`min-h-11 w-full rounded-xl border bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] ${fieldErrors["config-closure"] ? "border-[color:var(--app-coral)] ring-2 ring-[color:var(--app-danger-soft)]" : "border-[color:var(--app-border)] focus:border-[color:var(--app-teal)]"}`}
              >
                <option value="">Selecione</option>
                <option value="OPEN">Fatura aberta</option>
                <option value="AUTOMATIC_DAY_25">
                  Fechamento automático no dia 25
                </option>
              </select>
              {fieldErrors["config-closure"] ? (
                <p
                  id="config-closure-error"
                  className="mt-1.5 text-xs font-bold text-[color:var(--app-coral)]"
                  role="alert"
                >
                  {fieldErrors["config-closure"]}
                </p>
              ) : null}
            </div>
            <div>
              <FieldLabel htmlFor="config-adjustment">
                Reajuste anual *
              </FieldLabel>
              <DecimalInput
                id="config-adjustment"
                prefix="%"
                value={form.annualAdjustmentPercent}
                onChange={(annualAdjustmentPercent) =>
                  setForm((current) => ({
                    ...current,
                    annualAdjustmentPercent,
                  }))
                }
              />
            </div>
            <div>
              <FieldLabel htmlFor="config-difference">
                Diferença de cálculo *
              </FieldLabel>
              <DecimalInput
                id="config-difference"
                prefix="%"
                value={form.differencePercent}
                onChange={(differencePercent) =>
                  setForm((current) => ({ ...current, differencePercent }))
                }
              />
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[color:var(--app-warning-border)] bg-[color:var(--app-warning-soft)] p-3 text-xs leading-5 text-[color:var(--app-fg)]">
            <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Ao salvar nova vigência, versão anterior termina no dia anterior.
          </div>
        </ConfigSection>

        <ConfigSection
          id="config-age-brackets-section"
          icon={UsersRound}
          title="Faixas etárias e valores"
          description="Uma única tabela de preço atende todos os códigos de plano."
          className={
            fieldErrors["config-age-brackets-section"]
              ? "!border-[color:var(--app-coral)] ring-2 ring-[color:var(--app-danger-soft)]"
              : ""
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <button
              type="button"
              onClick={() =>
                setForm((current) => {
                  const bracket = newAgeBracket(current.ageBrackets.length);
                  return {
                    ...current,
                    ageBrackets: [...current.ageBrackets, bracket],
                    planPrices: [
                      ...current.planPrices,
                      newPlanPrice(bracket.code),
                    ],
                  };
                })
              }
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)]"
            >
              <Plus className="size-4" aria-hidden="true" />
              Adicionar faixa
            </button>
          </div>
          {fieldErrors["config-age-brackets-section"] ? (
            <p
              className="mb-4 text-xs font-bold text-[color:var(--app-coral)]"
              role="alert"
            >
              {fieldErrors["config-age-brackets-section"]}
            </p>
          ) : null}
          {form.ageBrackets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] p-5 text-center text-sm text-[color:var(--app-muted)]">
              Nenhuma faixa cadastrada. Valores permanecem vazios até inclusão.
            </p>
          ) : (
            <div className="space-y-3">
              {form.ageBrackets.map((bracket, index) => (
                <div
                  key={bracket.localId}
                  className="grid gap-3 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 sm:grid-cols-2 xl:grid-cols-[0.7fr_1.2fr_0.55fr_0.55fr_0.55fr_0.8fr_0.8fr_auto]"
                >
                  <div>
                    <FieldLabel htmlFor={`age-code-${bracket.localId}`}>
                      Código
                    </FieldLabel>
                    <TextInput
                      id={`age-code-${bracket.localId}`}
                      value={bracket.code}
                      onChange={(value) =>
                        updateAge(bracket.localId, "code", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`age-company-${bracket.localId}`}>
                      Valor fatura
                    </FieldLabel>
                    <DecimalInput
                      id={`age-company-${bracket.localId}`}
                      value={
                        form.planPrices.find(
                          (price) => price.ageBracketCode === bracket.code,
                        )?.companyAmount ?? ""
                      }
                      onChange={(value) => {
                        const price = form.planPrices.find(
                          (item) => item.ageBracketCode === bracket.code,
                        );
                        if (price)
                          updatePlan(price.localId, "companyAmount", value);
                      }}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`age-employee-${bracket.localId}`}>
                      Valor titular
                    </FieldLabel>
                    <DecimalInput
                      id={`age-employee-${bracket.localId}`}
                      value={
                        form.planPrices.find(
                          (price) => price.ageBracketCode === bracket.code,
                        )?.employeeAmount ?? ""
                      }
                      onChange={(value) => {
                        const price = form.planPrices.find(
                          (item) => item.ageBracketCode === bracket.code,
                        );
                        if (price)
                          updatePlan(price.localId, "employeeAmount", value);
                      }}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`age-label-${bracket.localId}`}>
                      Nome
                    </FieldLabel>
                    <TextInput
                      id={`age-label-${bracket.localId}`}
                      value={bracket.label}
                      onChange={(value) =>
                        updateAge(bracket.localId, "label", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`age-min-${bracket.localId}`}>
                      Idade mín.
                    </FieldLabel>
                    <TextInput
                      id={`age-min-${bracket.localId}`}
                      type="number"
                      inputMode="numeric"
                      value={bracket.minAge}
                      onChange={(value) =>
                        updateAge(bracket.localId, "minAge", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`age-max-${bracket.localId}`}>
                      Idade máx.
                    </FieldLabel>
                    <TextInput
                      id={`age-max-${bracket.localId}`}
                      type="number"
                      inputMode="numeric"
                      placeholder="Sem limite"
                      value={bracket.maxAge}
                      onChange={(value) =>
                        updateAge(bracket.localId, "maxAge", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`age-order-${bracket.localId}`}>
                      Ordem
                    </FieldLabel>
                    <TextInput
                      id={`age-order-${bracket.localId}`}
                      type="number"
                      inputMode="numeric"
                      value={bracket.sortOrder}
                      onChange={(value) =>
                        updateAge(bracket.localId, "sortOrder", value)
                      }
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => {
                        const removedCode = bracket.code;
                        setForm((current) => ({
                          ...current,
                          ageBrackets: current.ageBrackets.filter(
                            (item) => item.localId !== bracket.localId,
                          ),
                          planPrices: current.planPrices.filter(
                            (price) => price.ageBracketCode !== removedCode,
                          ),
                        }));
                      }}
                      className="grid size-11 place-items-center rounded-xl border border-[color:var(--app-border)] text-[color:var(--app-coral)] hover:bg-[color:var(--app-danger-soft)]"
                      aria-label={`Remover faixa ${index + 1}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ConfigSection>

        <section className="hidden rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <SectionHeading
              icon={CircleDollarSign}
              title="Preços do plano"
              description="Parcela da empresa e do colaborador por plano e faixa."
            />
            <button
              type="button"
              disabled={bracketOptions.length === 0}
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  planPrices: [
                    ...current.planPrices,
                    newPlanPrice(bracketOptions[0]?.code ?? ""),
                  ],
                }))
              }
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)] disabled:opacity-45"
            >
              <Plus className="size-4" aria-hidden="true" />
              Adicionar preço
            </button>
          </div>
          {form.planPrices.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] p-5 text-center text-sm text-[color:var(--app-muted)]">
              Cadastre faixa etária e depois inclua preços reais.
            </p>
          ) : (
            <div className="space-y-3">
              {form.planPrices.map((price, index) => (
                <div
                  key={price.localId}
                  className="grid gap-3 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 md:grid-cols-2 xl:grid-cols-[1.2fr_1.2fr_1fr_1fr_auto]"
                >
                  <div>
                    <FieldLabel htmlFor={`plan-code-${price.localId}`}>
                      Código/nome do plano
                    </FieldLabel>
                    <TextInput
                      id={`plan-code-${price.localId}`}
                      value={price.planCode}
                      onChange={(value) =>
                        updatePlan(price.localId, "planCode", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`plan-age-${price.localId}`}>
                      Faixa etária
                    </FieldLabel>
                    <select
                      id={`plan-age-${price.localId}`}
                      value={price.ageBracketCode}
                      onChange={(event) =>
                        updatePlan(
                          price.localId,
                          "ageBracketCode",
                          event.target.value,
                        )
                      }
                      className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)]"
                    >
                      <option value="">Selecione</option>
                      {bracketOptions.map((bracket) => (
                        <option key={bracket.localId} value={bracket.code}>
                          {bracket.label || bracket.code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <FieldLabel htmlFor={`plan-company-${price.localId}`}>
                      Empresa
                    </FieldLabel>
                    <DecimalInput
                      id={`plan-company-${price.localId}`}
                      value={price.companyAmount}
                      onChange={(value) =>
                        updatePlan(price.localId, "companyAmount", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`plan-employee-${price.localId}`}>
                      Colaborador
                    </FieldLabel>
                    <DecimalInput
                      id={`plan-employee-${price.localId}`}
                      value={price.employeeAmount}
                      onChange={(value) =>
                        updatePlan(price.localId, "employeeAmount", value)
                      }
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          planPrices: current.planPrices.filter(
                            (item) => item.localId !== price.localId,
                          ),
                        }))
                      }
                      className="grid size-11 place-items-center rounded-xl border border-[color:var(--app-border)] text-[color:var(--app-coral)] hover:bg-[color:var(--app-danger-soft)]"
                      aria-label={`Remover preço ${index + 1}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <ConfigSection
          id="config-addons-section"
          icon={FileCog}
          title="Adicionais"
          description="Valores extras opcionais vinculados ao plano."
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <button
              type="button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  addonPrices: [...current.addonPrices, newAddonPrice()],
                }))
              }
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)]"
            >
              <Plus className="size-4" aria-hidden="true" />
              Adicionar
            </button>
          </div>
          {form.addonPrices.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] p-5 text-center text-sm text-[color:var(--app-muted)]">
              Nenhum adicional configurado.
            </p>
          ) : (
            <div className="space-y-3">
              {form.addonPrices.map((price, index) => (
                <div
                  key={price.localId}
                  className="grid gap-3 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1.5fr_1fr_auto]"
                >
                  <div>
                    <FieldLabel htmlFor={`addon-code-${price.localId}`}>
                      Código
                    </FieldLabel>
                    <TextInput
                      id={`addon-code-${price.localId}`}
                      value={price.code}
                      onChange={(value) =>
                        updateAddon(price.localId, "code", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`addon-label-${price.localId}`}>
                      Nome
                    </FieldLabel>
                    <TextInput
                      id={`addon-label-${price.localId}`}
                      value={price.label}
                      onChange={(value) =>
                        updateAddon(price.localId, "label", value)
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`addon-amount-${price.localId}`}>
                      Valor
                    </FieldLabel>
                    <DecimalInput
                      id={`addon-amount-${price.localId}`}
                      value={price.amount}
                      onChange={(value) =>
                        updateAddon(price.localId, "amount", value)
                      }
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          addonPrices: current.addonPrices.filter(
                            (item) => item.localId !== price.localId,
                          ),
                        }))
                      }
                      className="grid size-11 place-items-center rounded-xl border border-[color:var(--app-border)] text-[color:var(--app-coral)] hover:bg-[color:var(--app-danger-soft)]"
                      aria-label={`Remover adicional ${index + 1}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ConfigSection>

        <ConfigSection
          id="config-reasons-section"
          icon={FileCog}
          title="Motivos de rescisão"
          description="Renomeie, adicione ou exclua motivos e vincule o documento obrigatório."
          className={
            fieldErrors["config-reasons-section"]
              ? "!border-[color:var(--app-coral)] ring-2 ring-[color:var(--app-danger-soft)]"
              : ""
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <button
              type="button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  reasons: [...current.reasons, newReason(current.reasons)],
                }))
              }
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)]"
            >
              <Plus className="size-4" aria-hidden="true" />
              Adicionar motivo
            </button>
          </div>
          {fieldErrors["config-reasons-section"] ? (
            <p
              className="mb-4 text-xs font-bold text-[color:var(--app-coral)]"
              role="alert"
            >
              {fieldErrors["config-reasons-section"]}
            </p>
          ) : null}
          <div className="space-y-3">
            {form.reasons.map((reason, index) => (
              <div
                key={reason.localId}
                className="grid gap-3 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 sm:grid-cols-[0.45fr_1.5fr_1fr_auto]"
              >
                <div>
                  <FieldLabel htmlFor={`reason-code-${reason.localId}`}>
                    Código
                  </FieldLabel>
                  <TextInput
                    id={`reason-code-${reason.localId}`}
                    value={reason.code}
                    onChange={() => undefined}
                    disabled
                  />
                </div>
                <div>
                  <FieldLabel htmlFor={`reason-label-${reason.localId}`}>
                    Motivo
                  </FieldLabel>
                  <TextInput
                    id={`reason-label-${reason.localId}`}
                    value={reason.label}
                    onChange={(value) =>
                      updateReason(reason.localId, "label", value)
                    }
                  />
                </div>
                <div>
                  <FieldLabel htmlFor={`reason-document-${reason.localId}`}>
                    Documento obrigatório
                  </FieldLabel>
                  <select
                    id={`reason-document-${reason.localId}`}
                    value={reason.documentKind}
                    onChange={(event) => {
                      clearFieldError(`reason-document-${reason.localId}`);
                      updateReason(
                        reason.localId,
                        "documentKind",
                        event.target.value as ReasonForm["documentKind"],
                      );
                    }}
                    aria-invalid={Boolean(
                      fieldErrors[`reason-document-${reason.localId}`],
                    )}
                    aria-describedby={
                      fieldErrors[`reason-document-${reason.localId}`]
                        ? `reason-document-${reason.localId}-error`
                        : undefined
                    }
                    className={`min-h-11 w-full rounded-xl border bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] ${fieldErrors[`reason-document-${reason.localId}`] ? "border-[color:var(--app-coral)] ring-2 ring-[color:var(--app-danger-soft)]" : "border-[color:var(--app-border)]"}`}
                  >
                    <option value="NONE">Nenhum</option>
                    <option value="RN561">Formulário RN561</option>
                    <option value="INACTIVE_TERM">Termo de inativo</option>
                  </select>
                  {fieldErrors[`reason-document-${reason.localId}`] ? (
                    <p
                      id={`reason-document-${reason.localId}-error`}
                      className="mt-1.5 text-xs font-bold text-[color:var(--app-coral)]"
                      role="alert"
                    >
                      {fieldErrors[`reason-document-${reason.localId}`]}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        reasons: current.reasons.filter(
                          (item) => item.localId !== reason.localId,
                        ),
                      }))
                    }
                    disabled={form.reasons.length <= 1}
                    className="grid size-11 place-items-center rounded-xl border border-[color:var(--app-border)] text-[color:var(--app-coral)] hover:bg-[color:var(--app-danger-soft)] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`Excluir motivo ${index + 1}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </ConfigSection>

        <ConfigSection
          id="config-email-section"
          icon={Mail}
          title="E-mail"
          description="Destinatários fixos e assunto padrão. Nenhum endereço é presumido."
        >
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4">
            <input
              type="checkbox"
              checked={form.emailEnabled}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  emailEnabled: event.target.checked,
                }))
              }
              className="mt-1 size-4"
            />
            <span>
              <span className="block text-sm font-black text-[color:var(--app-fg)]">
                Habilitar envio de e-mail
              </span>
              <span className="mt-1 block text-xs text-[color:var(--app-muted)]">
                O cálculo continua funcionando quando envio estiver
                desabilitado.
              </span>
            </span>
          </label>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <FieldLabel htmlFor="config-email-recipients">
                Destinatários *
              </FieldLabel>
              <textarea
                id="config-email-recipients"
                rows={5}
                value={form.emailRecipients}
                placeholder={"um@email.com\noutro@email.com"}
                onChange={(event) => {
                  clearFieldError("config-email-recipients");
                  setForm((current) => ({
                    ...current,
                    emailRecipients: event.target.value,
                  }));
                }}
                aria-invalid={Boolean(fieldErrors["config-email-recipients"])}
                aria-describedby={
                  fieldErrors["config-email-recipients"]
                    ? "config-email-recipients-error"
                    : undefined
                }
                className={`w-full resize-y rounded-xl border bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] ${fieldErrors["config-email-recipients"] ? "border-[color:var(--app-coral)] ring-2 ring-[color:var(--app-danger-soft)]" : "border-[color:var(--app-border)] focus:border-[color:var(--app-teal)]"}`}
              />
              {fieldErrors["config-email-recipients"] ? (
                <p
                  id="config-email-recipients-error"
                  className="mt-1.5 text-xs font-bold text-[color:var(--app-coral)]"
                  role="alert"
                >
                  {fieldErrors["config-email-recipients"]}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-[color:var(--app-fg)]">
                Um por linha, ou separados por vírgula.
              </p>
            </div>
            <div>
              <FieldLabel htmlFor="config-email-subject">
                Assunto padrão *
              </FieldLabel>
              <TextInput
                id="config-email-subject"
                value={DEFAULT_UNIMED_EMAIL_SUBJECT}
                onChange={() => undefined}
                disabled
              />
              <p className="mt-2 text-xs text-[color:var(--app-fg)]">
                O primeiro envio do dia usa este assunto. Os seguintes recebem
                pontos automáticos para o Gmail não agrupá-los.
              </p>
            </div>
          </div>
        </ConfigSection>

        <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-shell)] p-4 shadow-[var(--app-shell-shadow)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-[color:var(--app-muted)]">
            Salvar cria ou atualiza versão da vigência informada.
          </p>
          <button
            type="button"
            onClick={() => void saveConfiguration()}
            disabled={saving}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[color:var(--app-action-blue)] px-6 py-3 text-sm font-black text-[color:var(--app-action-text)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-55"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            {saving ? "Salvando…" : "Salvar configurações"}
          </button>
        </div>
      </div>
    </ConfigFieldContext.Provider>
  );
}
