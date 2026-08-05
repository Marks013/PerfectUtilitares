"use client";

import {
  AlertCircle,
  ArrowRight,
  Building2,
  Calculator,
  CalendarDays,
  Check,
  CircleDollarSign,
  FileText,
  Loader2,
  Mail,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DEFAULT_UNIMED_EXCLUSION_REASONS } from "@/lib/unimed/defaults";
import type {
  UnimedCalculationInput,
  UnimedCalculationResult,
} from "@/lib/unimed/types";
import {
  type UnimedBeneficiary,
  UnimedBeneficiarySearch,
  type UnimedPricingContext,
} from "./unimed-beneficiary-search";
import {
  type UnimedPayrollLoanSummary,
  UnimedPrintSummary,
} from "./unimed-print-summary";
import { type UnimedNotice, UnimedNoticeToast } from "./unimed-notice-toast";

type MoneyField = "invoicePlanAmount" | "payrollPlanAmount" | "addonAmount";

type MoneyValues = Record<MoneyField, string>;

type DependentValues = {
  id: string;
  name: string;
  birthDate: string | null;
  planCode: string | null;
  age: number | null;
  hasAddon: boolean;
  invoicePlanAmount: string;
  addonAmount: string;
};

type FormValues = {
  employeeName: string;
  cpf: string;
  reasonCode: string;
  exclusionDate: string;
  planEnrollmentDate: string;
  billingClosure: UnimedCalculationInput["billingClosure"];
  holder: MoneyValues;
  dependents: DependentValues[];
};

type FieldErrors = Partial<
  Record<
    | "employeeName"
    | "cpf"
    | "reasonCode"
    | "exclusionDate"
    | "planEnrollmentDate"
    | MoneyField
    | `dependent-${string}`,
    string
  >
>;

type ApiErrorBody = {
  error?: string | { message?: string };
  details?: Array<{ message?: string }>;
};

type GeneratedDocument = {
  beneficiaryId: string;
  previewUrl: string;
  reasonCode: number;
};

type DocumentJobResponse = {
  job: {
    id: string;
    progress: number;
    status: "QUEUED" | "RUNNING";
  };
};

type UnimedCalculationRequest = {
  beneficiaryId: string;
  dependentIds: string[];
  reasonCode: number;
  exclusionDate: string;
};

type UnimedCalculationApiResponse = {
  calculation: UnimedCalculationResult;
  officialInput: UnimedCalculationInput;
  payrollLoans?: UnimedPayrollLoanSummary | null;
};

export type UnimedExclusionReasonOption = {
  code: number;
  label: string;
  documentKind: "NONE" | "RN561" | "INACTIVE_TERM";
};

const MAX_DEPENDENTS = 6;
const PAYROLL_LOANS_PRINT_STORAGE_KEY =
  "perfectutilitares.unimed.include-payroll-loans.v1";

const INITIAL_FORM: FormValues = {
  employeeName: "",
  cpf: "",
  reasonCode: "",
  exclusionDate: "",
  planEnrollmentDate: "",
  billingClosure: "AUTOMATIC_DAY_25",
  holder: {
    invoicePlanAmount: "",
    payrollPlanAmount: "",
    addonAmount: "",
  },
  dependents: [],
};

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function normalizeMoney(value: string) {
  return value.replace(/[^\d,.-]/g, "");
}

function parseMoney(value: string) {
  const normalized = normalizeMoney(value).trim();
  if (!normalized) return Number.NaN;

  const hasComma = normalized.includes(",");
  const dotCount = (normalized.match(/\./g) ?? []).length;
  let decimal = normalized;

  if (hasComma) {
    decimal = normalized.replace(/\./g, "").replace(",", ".");
  } else if (dotCount > 1) {
    decimal = normalized.replace(/\./g, "");
  } else if (dotCount === 1) {
    const decimalPlaces = normalized.length - normalized.lastIndexOf(".") - 1;
    if (decimalPlaces > 2) decimal = normalized.replace(".", "");
  }

  const parsed = Number(decimal);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatMoneyInput(value: string) {
  const parsed = parseMoney(value);
  return Number.isFinite(parsed) ? moneyFormatter.format(parsed) : value;
}

function formatMoneyResult(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `R$ ${moneyFormatter.format(parsed)}` : "—";
}

function formatCpf(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

function createDependent(): DependentValues {
  return {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: "",
    birthDate: null,
    planCode: null,
    age: null,
    hasAddon: false,
    invoicePlanAmount: "",
    addonAmount: "",
  };
}

async function readApiError(
  response: Response,
  fallback = "Não foi possível concluir o cálculo. Tente novamente.",
) {
  try {
    const body = (await response.json()) as ApiErrorBody;
    const detail = body.details?.find((item) => item.message)?.message;
    if (detail) return detail;
    if (typeof body.error === "string") return body.error;
    if (body.error?.message) return body.error.message;
  } catch {
    // Resposta sem JSON: usa mensagem segura abaixo.
  }

  return fallback;
}

function waitForDocumentPoll(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Operação cancelada.", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Operação cancelada.", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function defaultMoney(value: string | number | null | undefined) {
  if (value === undefined || value === null || value === "") return "";
  return formatMoneyInput(String(value));
}

function pricingIssue(status: UnimedBeneficiary["pricing"]["status"]) {
  if (status === "MISSING_BIRTH_DATE") return "data de nascimento ausente";
  if (status === "MISSING_PLAN_CODE") return "código do plano ausente";
  if (status === "MISSING_AGE_BRACKET") return "faixa etária não configurada";
  return "preço não encontrado de forma única";
}

function dateInput(value: string | undefined | null) {
  return value?.slice(0, 10) ?? "";
}

function validateForm(form: FormValues) {
  const errors: FieldErrors = {};

  if (form.employeeName.trim().length < 3) {
    errors.employeeName = "Informe o nome do colaborador.";
  }
  if (form.cpf.replace(/\D/g, "").length !== 11) {
    errors.cpf = "Informe um CPF com 11 dígitos.";
  }
  if (!form.reasonCode) errors.reasonCode = "Selecione o motivo.";
  if (!form.exclusionDate) {
    errors.exclusionDate = "Informe a data de exclusão.";
  }
  if (!form.planEnrollmentDate) {
    errors.planEnrollmentDate = "Informe a inclusão no plano.";
  } else if (
    form.exclusionDate &&
    form.planEnrollmentDate > form.exclusionDate
  ) {
    errors.planEnrollmentDate =
      "A inclusão no plano não pode ser posterior à exclusão.";
  }

  (
    [
      ["invoicePlanAmount", "Informe o valor do plano na fatura."],
      ["payrollPlanAmount", "Informe o desconto do plano em folha."],
      [
        "addonAmount",
        "Informe o valor do Acessório Funeral, mesmo quando for zero.",
      ],
    ] as const
  ).forEach(([field, message]) => {
    const value = parseMoney(form.holder[field]);
    if (!Number.isFinite(value) || value < 0) errors[field] = message;
  });

  form.dependents.forEach((dependent) => {
    if (
      !Number.isFinite(parseMoney(dependent.invoicePlanAmount)) ||
      parseMoney(dependent.invoicePlanAmount) < 0
    ) {
      errors[`dependent-${dependent.id}`] =
        "Informe valor de fatura válido para este dependente.";
    }
    if (
      !Number.isFinite(parseMoney(dependent.addonAmount)) ||
      parseMoney(dependent.addonAmount) < 0
    ) {
      errors[`dependent-${dependent.id}`] =
        "Informe Acessório Funeral válido para este dependente.";
    }
  });

  return errors;
}

function FieldLabel({
  htmlFor,
  children,
  required = false,
}: {
  htmlFor: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-sm font-bold text-[color:var(--app-fg)]"
    >
      {children}
      {required ? (
        <span className="ml-1 text-[color:var(--app-coral)]" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p
      id={id}
      className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-[color:var(--app-coral)]"
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

function MoneyInput({
  id,
  label,
  value,
  error,
  onChange,
  onBlur,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  hint?: string;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div>
      <FieldLabel htmlFor={id} required>
        {label}
      </FieldLabel>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-bold text-[color:var(--app-subtle)]">
          R$
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={value}
          onChange={(event) => onChange(normalizeMoney(event.target.value))}
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] py-2.5 pr-3 pl-10 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)] disabled:opacity-60"
        />
      </div>
      {hint && !error ? (
        <p id={hintId} className="mt-2 text-xs text-[color:var(--app-subtle)]">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function ResultMetric({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        emphasis
          ? "rounded-lg border border-[color:var(--app-success-border)] bg-[color:var(--app-success-soft)] p-3"
          : "rounded-lg border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3"
      }
    >
      <dt className="text-xs font-bold tracking-wide text-[color:var(--app-muted)] uppercase">
        {label}
      </dt>
      <dd className="mt-1.5 text-lg font-black tracking-tight text-[color:var(--app-fg)] tabular-nums">
        {value}
      </dd>
    </div>
  );
}

export function UnimedCalculationWorkspace({
  reasons = DEFAULT_UNIMED_EXCLUSION_REASONS,
}: {
  reasons?: readonly UnimedExclusionReasonOption[];
}) {
  const formId = useId();
  const [form, setForm] = useState<FormValues>(INITIAL_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<UnimedCalculationResult | null>(null);
  const [payrollLoans, setPayrollLoans] =
    useState<UnimedPayrollLoanSummary | null>(null);
  const [includePayrollLoans, setIncludePayrollLoans] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [selectedBeneficiary, setSelectedBeneficiary] =
    useState<UnimedBeneficiary | null>(null);
  const [dataCompetency, setDataCompetency] =
    useState<UnimedPricingContext["dataCompetency"]>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [generatedDocument, setGeneratedDocument] =
    useState<GeneratedDocument | null>(null);
  const [isGeneratingDocument, setIsGeneratingDocument] = useState(false);
  const [documentProgress, setDocumentProgress] = useState(0);
  const [isRefreshingPricing, setIsRefreshingPricing] = useState(false);
  const [pricingWarnings, setPricingWarnings] = useState<string[]>([]);
  const [notice, setNotice] = useState<UnimedNotice | null>(null);
  const calculationRequestSequence = useRef(0);
  const calculationAbortController = useRef<AbortController | null>(null);
  const documentRequestSequence = useRef(0);
  const documentAbortController = useRef<AbortController | null>(null);
  const generatedDocumentUrl = useRef<string | null>(null);
  const pricingRequestSequence = useRef(0);
  const pricingAbortController = useRef<AbortController | null>(null);
  const lastAutomaticCalculationFingerprint = useRef<string | null>(null);
  const lastReminderFingerprint = useRef<string | null>(null);
  const emailRequest = useRef<{
    beneficiaryId: string;
    idempotencyKey: string;
  } | null>(null);

  const selectedReason = useMemo(
    () => reasons.find((reason) => reason.code === Number(form.reasonCode)),
    [form.reasonCode, reasons],
  );
  const reasonCode = Number(form.reasonCode);
  const documentRequired =
    selectedReason !== undefined && selectedReason.documentKind !== "NONE";
  const documentReady = Boolean(
    result &&
    selectedBeneficiary &&
    generatedDocument?.beneficiaryId === selectedBeneficiary.id &&
    generatedDocument.reasonCode === reasonCode,
  );
  const automaticCalculationFingerprint = useMemo(() => {
    if (isRefreshingPricing || Object.keys(validateForm(form)).length > 0) {
      return null;
    }
    if (documentRequired && !selectedBeneficiary) return null;

    return JSON.stringify({
      beneficiaryId: selectedBeneficiary?.id ?? null,
      reasonCode: Number(form.reasonCode),
      exclusionDate: form.exclusionDate,
      planEnrollmentDate: form.planEnrollmentDate,
      billingClosure: form.billingClosure,
      holder: {
        invoicePlanAmount: parseMoney(form.holder.invoicePlanAmount),
        payrollPlanAmount: parseMoney(form.holder.payrollPlanAmount),
        addonAmount: parseMoney(form.holder.addonAmount),
      },
      dependents: form.dependents.map((dependent) => ({
        invoicePlanAmount: parseMoney(dependent.invoicePlanAmount),
        addonAmount: parseMoney(dependent.addonAmount),
      })),
    });
  }, [documentRequired, form, isRefreshingPricing, selectedBeneficiary]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(
        PAYROLL_LOANS_PRINT_STORAGE_KEY,
      );
      if (stored === "true" || stored === "false") {
        setIncludePayrollLoans(stored === "true");
      }
    } catch {
      // The preference is optional; private browsing may deny storage access.
    }
  }, []);

  function updatePayrollLoansPrintPreference(value: boolean) {
    setIncludePayrollLoans(value);
    try {
      window.localStorage.setItem(
        PAYROLL_LOANS_PRINT_STORAGE_KEY,
        String(value),
      );
    } catch {
      // Keep the in-memory preference when persistent storage is unavailable.
    }
  }

  useEffect(
    () => () => {
      calculationAbortController.current?.abort();
      documentAbortController.current?.abort();
      pricingAbortController.current?.abort();
      if (generatedDocumentUrl.current) {
        URL.revokeObjectURL(generatedDocumentUrl.current);
      }
    },
    [],
  );

  useEffect(() => {
    const message = apiError ?? documentError ?? emailError;
    if (!message) return;
    setNotice({
      id: `unimed-error-${message}`,
      type: "error",
      title: "Ação não concluída",
      message,
    });
  }, [apiError, documentError, emailError]);

  useEffect(() => {
    if (pricingWarnings.length === 0) return;
    setNotice({
      id: `unimed-info-${pricingWarnings.join("|")}`,
      type: "info",
      title: "Informação para conferência",
      message: pricingWarnings.join(" "),
    });
  }, [pricingWarnings]);

  function invalidateDocument() {
    documentRequestSequence.current += 1;
    documentAbortController.current?.abort();
    documentAbortController.current = null;
    if (generatedDocumentUrl.current) {
      URL.revokeObjectURL(generatedDocumentUrl.current);
      generatedDocumentUrl.current = null;
    }
    setGeneratedDocument(null);
    setDocumentError(null);
    setIsGeneratingDocument(false);
    setDocumentProgress(0);
  }

  function invalidateCalculation() {
    calculationRequestSequence.current += 1;
    calculationAbortController.current?.abort();
    calculationAbortController.current = null;
    lastAutomaticCalculationFingerprint.current = null;
    setIsCalculating(false);
    setPayrollLoans(null);
  }

  function invalidatePricingRefresh() {
    pricingRequestSequence.current += 1;
    pricingAbortController.current?.abort();
    pricingAbortController.current = null;
    setIsRefreshingPricing(false);
  }

  function updateForm<K extends keyof FormValues>(
    field: K,
    value: FormValues[K],
  ) {
    invalidateCalculation();
    setForm((current) => ({ ...current, [field]: value }));
    setResult(null);
    setEmailConfirmed(false);
    setEmailError(null);
    setApiError(null);
    if (
      field === "reasonCode" ||
      field === "employeeName" ||
      field === "cpf" ||
      field === "exclusionDate"
    ) {
      invalidateDocument();
    }
    if (field === "employeeName" || field === "cpf") {
      invalidatePricingRefresh();
      setSelectedBeneficiary(null);
      setDataCompetency(null);
      setPricingWarnings([]);
    }
    if (field in errors) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function updateHolder(field: MoneyField, value: string) {
    invalidateCalculation();
    setForm((current) => ({
      ...current,
      holder: { ...current.holder, [field]: value },
    }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setResult(null);
    setEmailConfirmed(false);
    setEmailError(null);
  }

  function updateDependent(
    id: string,
    field: keyof Omit<DependentValues, "id">,
    value: string,
  ) {
    invalidateCalculation();
    setForm((current) => ({
      ...current,
      dependents: current.dependents.map((dependent) =>
        dependent.id === id ? { ...dependent, [field]: value } : dependent,
      ),
    }));
    setErrors((current) => ({
      ...current,
      [`dependent-${id}`]: undefined,
    }));
    setResult(null);
    setEmailConfirmed(false);
    setEmailError(null);
  }

  function blurMoney(field: MoneyField) {
    const value = form.holder[field];
    if (!value) return;
    updateHolder(field, formatMoneyInput(value));
  }

  function blurDependentMoney(
    dependent: DependentValues,
    field: "invoicePlanAmount" | "addonAmount",
  ) {
    const value = dependent[field];
    if (!value) return;
    updateDependent(dependent.id, field, formatMoneyInput(value));
  }

  function resetWorkspace() {
    invalidateCalculation();
    invalidatePricingRefresh();
    setForm(INITIAL_FORM);
    setErrors({});
    setResult(null);
    setApiError(null);
    setSelectedBeneficiary(null);
    setDataCompetency(null);
    setEmailConfirmed(false);
    setEmailError(null);
    invalidateDocument();
    setEmailDialogOpen(false);
    setPricingWarnings([]);
  }

  function selectBeneficiary(
    beneficiary: UnimedBeneficiary,
    pricingContext: UnimedPricingContext,
    effectiveReferenceDate = form.exclusionDate,
  ) {
    invalidateCalculation();
    const nextWarnings: string[] = [];
    const pricingMatchesExclusionDate =
      Boolean(effectiveReferenceDate) &&
      pricingContext.referenceDate === effectiveReferenceDate;

    if (!pricingMatchesExclusionDate) {
      nextWarnings.push(
        "Preencha a data de exclusão; os valores serão atualizados automaticamente sem remover o cadastro.",
      );
    }
    if (beneficiary.dependents.length > MAX_DEPENDENTS) {
      nextWarnings.push(
        `Cadastro possui ${beneficiary.dependents.length} dependentes; somente os ${MAX_DEPENDENTS} primeiros foram carregados.`,
      );
    }

    const holderPricingResolved =
      pricingMatchesExclusionDate && beneficiary.pricing.status === "RESOLVED";
    if (pricingMatchesExclusionDate && !holderPricingResolved) {
      nextWarnings.push(
        `Titular: valores de plano não preenchidos (${pricingIssue(beneficiary.pricing.status)}).`,
      );
    }

    function addonAmount(hasAddon: boolean, label: string) {
      if (!pricingMatchesExclusionDate) return "";
      if (!hasAddon) return "0,00";
      if (pricingContext.addonPrices.length === 1) {
        return defaultMoney(pricingContext.addonPrices[0].amount);
      }
      nextWarnings.push(
        `${label}: Acessório Funeral não preenchido porque não existe um único preço configurado.`,
      );
      return "";
    }

    const holderAddonAmount = addonAmount(beneficiary.hasAddon, "Titular");
    const nextDependents = beneficiary.dependents
      .slice(0, MAX_DEPENDENTS)
      .map((item) => {
        const dependentPricingResolved =
          pricingMatchesExclusionDate && item.pricing.status === "RESOLVED";
        if (pricingMatchesExclusionDate && !dependentPricingResolved) {
          nextWarnings.push(
            `${item.fullName}: valor por idade não preenchido (${pricingIssue(item.pricing.status)}).`,
          );
        }
        return {
          id: item.id,
          name: item.fullName,
          birthDate: item.birthDate,
          planCode: item.planCode,
          age: item.pricing.age,
          hasAddon: item.hasAddon,
          invoicePlanAmount: dependentPricingResolved
            ? defaultMoney(item.pricing.companyAmount)
            : "",
          addonAmount: addonAmount(item.hasAddon, item.fullName),
        };
      });

    setSelectedBeneficiary(beneficiary);
    setDataCompetency(pricingContext.dataCompetency ?? null);
    setForm((current) => ({
      ...current,
      employeeName: beneficiary.fullName,
      cpf: formatCpf(beneficiary.cpf ?? ""),
      planEnrollmentDate: dateInput(beneficiary.inclusionDate),
      billingClosure:
        pricingMatchesExclusionDate && pricingContext.billingClosure
          ? pricingContext.billingClosure
          : current.billingClosure,
      holder: {
        invoicePlanAmount: holderPricingResolved
          ? defaultMoney(beneficiary.pricing.companyAmount)
          : "",
        payrollPlanAmount: holderPricingResolved
          ? defaultMoney(beneficiary.pricing.employeeAmount)
          : "",
        addonAmount: holderAddonAmount,
      },
      dependents: nextDependents,
    }));
    setErrors({});
    setResult(null);
    setApiError(null);
    setEmailConfirmed(false);
    setEmailError(null);
    invalidateDocument();
    if (pricingMatchesExclusionDate && !pricingContext.billingClosure) {
      nextWarnings.push(
        "Fechamento não retornado pela configuração; confirme a opção manualmente.",
      );
    }
    setPricingWarnings(nextWarnings);
  }

  async function updateExclusionDate(value: string) {
    updateForm("exclusionDate", value);
    invalidatePricingRefresh();
    if (!selectedBeneficiary) return;

    setForm((current) => ({
      ...current,
      holder: {
        invoicePlanAmount: "",
        payrollPlanAmount: "",
        addonAmount: "",
      },
      dependents: current.dependents.map((dependent) => ({
        ...dependent,
        invoicePlanAmount: "",
        addonAmount: "",
      })),
    }));

    if (!value) {
      setPricingWarnings([
        "Informe a data de exclusão para atualizar automaticamente os valores.",
      ]);
      return;
    }

    const identifier =
      selectedBeneficiary.cpf?.replace(/\D/g, "") ||
      selectedBeneficiary.registration?.trim();
    if (!identifier) {
      setPricingWarnings([
        "Cadastro mantido, mas não possui CPF ou matrícula para atualizar os preços.",
      ]);
      return;
    }

    const requestSequence = ++pricingRequestSequence.current;
    const abortController = new AbortController();
    pricingAbortController.current = abortController;
    setIsRefreshingPricing(true);
    setPricingWarnings(["Atualizando valores para a nova data de exclusão…"]);

    try {
      const response = await fetch(
        `/api/unimed/beneficiaries?q=${encodeURIComponent(identifier)}&referenceDate=${encodeURIComponent(value)}`,
        { cache: "no-store", signal: abortController.signal },
      );
      if (!response.ok) {
        throw new Error(
          await readApiError(
            response,
            "Não foi possível atualizar os valores para a nova data.",
          ),
        );
      }
      const body = (await response.json()) as {
        beneficiaries?: UnimedBeneficiary[];
        pricingContext?: UnimedPricingContext;
      };
      if (pricingRequestSequence.current !== requestSequence) return;
      const selectedCpf = selectedBeneficiary.cpf?.replace(/\D/g, "");
      const selectedRegistration = selectedBeneficiary.registration?.trim();
      const refreshed = body.beneficiaries?.find((beneficiary) => {
        if (selectedCpf) {
          return beneficiary.cpf?.replace(/\D/g, "") === selectedCpf;
        }
        if (selectedRegistration) {
          return beneficiary.registration?.trim() === selectedRegistration;
        }
        return beneficiary.id === selectedBeneficiary.id;
      });
      if (!refreshed || !body.pricingContext) {
        throw new Error(
          "Cadastro mantido, mas os preços não foram encontrados para a nova data.",
        );
      }
      selectBeneficiary(refreshed, body.pricingContext, value);
    } catch (error) {
      if (
        abortController.signal.aborted ||
        pricingRequestSequence.current !== requestSequence
      ) {
        return;
      }
      setPricingWarnings([
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar os valores para a nova data.",
      ]);
    } finally {
      if (pricingRequestSequence.current === requestSequence) {
        pricingAbortController.current = null;
        setIsRefreshingPricing(false);
      }
    }
  }

  function clearSelectedBeneficiary() {
    invalidateCalculation();
    invalidatePricingRefresh();
    setSelectedBeneficiary(null);
    setDataCompetency(null);
    setEmailConfirmed(false);
    setEmailError(null);
    invalidateDocument();
    setPricingWarnings([]);
  }

  async function runCalculation(options?: {
    formElement?: HTMLFormElement;
    generateRequiredDocument?: boolean;
    silent?: boolean;
  }) {
    if (isRefreshingPricing) {
      if (!options?.silent) {
        setApiError("Aguarde a atualização automática dos valores.");
      }
      return;
    }
    const nextErrors = validateForm(form);
    if (!options?.silent) setErrors(nextErrors);
    setApiError(null);
    setEmailConfirmed(false);

    if (documentRequired && !selectedBeneficiary) {
      if (!options?.silent) {
        setApiError(
          "Selecione o colaborador na pesquisa para gerar o documento obrigatório.",
        );
      }
      return;
    }

    if (Object.keys(nextErrors).length > 0) {
      const firstInvalid = options?.formElement?.querySelector<HTMLElement>(
        '[aria-invalid="true"]',
      );
      firstInvalid?.focus();
      return;
    }
    if (!selectedBeneficiary) {
      setApiError("Pesquise e selecione um titular da base vigente.");
      return;
    }

    const input: UnimedCalculationRequest = {
      beneficiaryId: selectedBeneficiary.id,
      dependentIds: form.dependents.map((dependent) => dependent.id),
      reasonCode: Number(form.reasonCode),
      exclusionDate: form.exclusionDate,
    };

    calculationAbortController.current?.abort();
    const requestSequence = ++calculationRequestSequence.current;
    const abortController = new AbortController();
    calculationAbortController.current = abortController;
    setIsCalculating(true);
    setResult(null);
    setPayrollLoans(null);
    invalidateDocument();

    try {
      const response = await fetch("/api/unimed/calculation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error(await readApiError(response));
      const body = (await response.json()) as UnimedCalculationApiResponse;
      const calculation = body.calculation;
      const nextPayrollLoans = body.payrollLoans ?? null;
      if (calculationRequestSequence.current !== requestSequence) return;
      setForm((current) => ({
        ...current,
        planEnrollmentDate: body.officialInput.planEnrollmentDate,
        billingClosure: body.officialInput.billingClosure,
        holder: {
          invoicePlanAmount: defaultMoney(
            body.officialInput.holder.invoicePlanAmount,
          ),
          payrollPlanAmount: defaultMoney(
            body.officialInput.holder.payrollPlanAmount,
          ),
          addonAmount: defaultMoney(body.officialInput.holder.addonAmount),
        },
        dependents: current.dependents.map((dependent, index) => ({
          ...dependent,
          invoicePlanAmount: defaultMoney(
            body.officialInput.dependents[index]?.invoicePlanAmount,
          ),
          addonAmount: defaultMoney(
            body.officialInput.dependents[index]?.addonAmount,
          ),
        })),
      }));
      setResult(calculation);
      setPayrollLoans(nextPayrollLoans);
      const reminderFingerprint = JSON.stringify({
        beneficiaryId: selectedBeneficiary?.id ?? null,
        input,
      });
      if (lastReminderFingerprint.current !== reminderFingerprint) {
        lastReminderFingerprint.current = reminderFingerprint;
        setNotice({
          id: `coparticipation-${requestSequence}`,
          type: "info",
          title: "Cálculo concluído",
          message: "Lembrete: solicite a coparticipação por e-mail.",
        });
      }
      if (documentRequired && options?.generateRequiredDocument !== false) {
        await generateDocument(calculation);
      }
    } catch (error) {
      if (
        abortController.signal.aborted ||
        calculationRequestSequence.current !== requestSequence
      ) {
        return;
      }
      setApiError(
        error instanceof Error
          ? error.message
          : "Não foi possível concluir o cálculo.",
      );
    } finally {
      if (calculationRequestSequence.current === requestSequence) {
        calculationAbortController.current = null;
        setIsCalculating(false);
      }
    }
  }

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    lastAutomaticCalculationFingerprint.current =
      automaticCalculationFingerprint;
    await runCalculation({
      formElement: event.currentTarget,
      generateRequiredDocument: true,
    });
  }

  useEffect(() => {
    if (!automaticCalculationFingerprint || isRefreshingPricing) return;
    if (
      lastAutomaticCalculationFingerprint.current ===
      automaticCalculationFingerprint
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      lastAutomaticCalculationFingerprint.current =
        automaticCalculationFingerprint;
      void runCalculation({
        generateRequiredDocument: true,
        silent: true,
      });
    }, 450);

    return () => window.clearTimeout(timeout);
    // The normalized fingerprint contains every calculation input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automaticCalculationFingerprint, isRefreshingPricing]);

  async function sendEmail(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!selectedBeneficiary || !result || isSendingEmail) return;

    setIsSendingEmail(true);
    setEmailError(null);
    const idempotencyKey =
      emailRequest.current?.beneficiaryId === selectedBeneficiary.id
        ? emailRequest.current.idempotencyKey
        : globalThis.crypto.randomUUID();
    emailRequest.current = {
      beneficiaryId: selectedBeneficiary.id,
      idempotencyKey,
    };

    try {
      const response = await fetch("/api/unimed/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beneficiaryId: selectedBeneficiary.id,
          idempotencyKey,
          confirmed: true,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(
            response,
            "Não foi possível enviar o e-mail. Tente novamente.",
          ),
        );
      }

      setEmailConfirmed(true);
      setEmailDialogOpen(false);
      emailRequest.current = null;
    } catch (error) {
      setEmailConfirmed(false);
      setEmailError(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o e-mail.",
      );
    } finally {
      setIsSendingEmail(false);
    }
  }

  async function generateDocument(calculation = result) {
    const requestedReasonCode = Number(form.reasonCode);
    if (
      !selectedBeneficiary ||
      !calculation ||
      !selectedReason ||
      selectedReason.documentKind === "NONE" ||
      isGeneratingDocument
    ) {
      return false;
    }

    const beneficiaryId = selectedBeneficiary.id;
    const requestSequence = ++documentRequestSequence.current;
    documentAbortController.current?.abort();
    const abortController = new AbortController();
    documentAbortController.current = abortController;
    setIsGeneratingDocument(true);
    setDocumentProgress(0);
    setDocumentError(null);
    setGeneratedDocument(null);

    try {
      const response = await fetch("/api/unimed/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beneficiaryId,
          reasonCode: requestedReasonCode,
          confirmed: true,
        }),
        signal: abortController.signal,
      });
      if (response.status !== 202) {
        throw new Error(
          await readApiError(
            response,
            "Não foi possível gerar o documento. Tente novamente.",
          ),
        );
      }

      const queued = (await response
        .json()
        .catch(() => null)) as DocumentJobResponse | null;
      if (!queued?.job?.id) {
        throw new Error(
          "O servidor não confirmou a fila de geração do PDF. Tente novamente.",
        );
      }
      setDocumentProgress(queued.job.progress);

      for (let attempt = 0; attempt < 195; attempt += 1) {
        await waitForDocumentPoll(1_000, abortController.signal);
        const resultResponse = await fetch(
          `/api/unimed/documents/${queued.job.id}`,
          {
            cache: "no-store",
            signal: abortController.signal,
          },
        );
        if (resultResponse.status === 200) {
          const contentType = resultResponse.headers.get("Content-Type") ?? "";
          if (!contentType.toLowerCase().startsWith("application/pdf")) {
            throw new Error("O servidor não devolveu um PDF válido.");
          }
          const blob = await resultResponse.blob();
          if (
            blob.size < 5 ||
            documentRequestSequence.current !== requestSequence
          ) {
            throw new Error("O PDF gerado está vazio ou incompleto.");
          }
          const objectUrl = URL.createObjectURL(blob);
          if (generatedDocumentUrl.current) {
            URL.revokeObjectURL(generatedDocumentUrl.current);
          }
          generatedDocumentUrl.current = objectUrl;
          setDocumentProgress(100);
          setGeneratedDocument({
            beneficiaryId,
            previewUrl: objectUrl,
            reasonCode: requestedReasonCode,
          });
          return true;
        }
        if (resultResponse.status !== 202) {
          throw new Error(
            await readApiError(
              resultResponse,
              "Não foi possível concluir a geração do PDF.",
            ),
          );
        }
        const pending = (await resultResponse
          .json()
          .catch(() => null)) as DocumentJobResponse | null;
        setDocumentProgress(
          Math.max(0, Math.min(99, Number(pending?.job?.progress) || 0)),
        );
      }
      throw new Error("A geração do PDF demorou mais do que o esperado.");
    } catch (error) {
      if (
        abortController.signal.aborted ||
        documentRequestSequence.current !== requestSequence
      ) {
        return false;
      }
      setDocumentError(
        error instanceof Error
          ? error.message
          : "Não foi possível gerar o documento.",
      );
      return false;
    } finally {
      if (documentRequestSequence.current === requestSequence) {
        documentAbortController.current = null;
        setIsGeneratingDocument(false);
      }
    }
  }

  function openGeneratedDocument() {
    if (!generatedDocument?.previewUrl) return;
    const link = document.createElement("a");
    link.href = generatedDocument.previewUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <div className="unimed-sheet-workspace">
      <header className="unimed-sheet-header border border-[color:var(--app-border)]">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <Building2 className="size-6 shrink-0" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-black tracking-wide sm:text-2xl">
              CÁLCULO UNIMED
            </h1>
            <p className="text-xs font-semibold sm:text-sm">
              Ficha de exclusão, conferência financeira e documentos
            </p>
          </div>
        </div>
      </header>

      <div className="unimed-sheet-column-bar" aria-hidden="true">
        <span>COLABORADOR</span>
        <span>MOVIMENTO</span>
        <span>VALORES DO PLANO</span>
        <span>RESULTADO</span>
      </div>

      <form
        id={formId}
        onSubmit={calculate}
        noValidate
        className="unimed-sheet-form grid items-start xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]"
      >
        <div className="unimed-sheet-input-grid">
          <section className="unimed-sheet-panel border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-teal)]">
                <UserRound className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-black text-[color:var(--app-fg)]">
                  1. Identificação
                </h2>
                <p className="mt-1 text-sm text-[color:var(--app-muted)]">
                  Dados usados na conferência e confirmação do e-mail.
                </p>
              </div>
            </div>

            <UnimedBeneficiarySearch
              selected={selectedBeneficiary}
              referenceDate={form.exclusionDate || undefined}
              onSelect={selectBeneficiary}
              onClear={clearSelectedBeneficiary}
            />

            {pricingWarnings.length > 0 ? (
              <div
                className="mt-4 rounded-xl border border-[color:var(--app-gold)] bg-[color:var(--app-warning-soft)] p-4"
                role="status"
              >
                <p className="text-sm font-black text-[color:var(--app-fg)]">
                  Campos que precisam de conferência
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[color:var(--app-muted)]">
                  {pricingWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <div>
                <FieldLabel htmlFor="unimed-name" required>
                  Nome do colaborador
                </FieldLabel>
                <input
                  id="unimed-name"
                  type="text"
                  autoComplete="name"
                  placeholder="Digite o nome completo"
                  value={form.employeeName}
                  onChange={(event) =>
                    updateForm("employeeName", event.target.value)
                  }
                  aria-invalid={Boolean(errors.employeeName)}
                  aria-describedby={
                    errors.employeeName ? "unimed-name-error" : undefined
                  }
                  className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)]"
                />
                <FieldError
                  id="unimed-name-error"
                  message={errors.employeeName}
                />
              </div>
              <div>
                <FieldLabel htmlFor="unimed-cpf" required>
                  CPF do Titular
                </FieldLabel>
                <input
                  id="unimed-cpf"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000.000.000-00"
                  maxLength={14}
                  value={form.cpf}
                  onChange={(event) =>
                    updateForm("cpf", formatCpf(event.target.value))
                  }
                  aria-invalid={Boolean(errors.cpf)}
                  aria-describedby={errors.cpf ? "unimed-cpf-error" : undefined}
                  className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)]"
                />
                <FieldError id="unimed-cpf-error" message={errors.cpf} />
              </div>
            </div>
          </section>

          <section className="unimed-sheet-panel border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-gold)]">
                <CalendarDays className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-black text-[color:var(--app-fg)]">
                  2. Informações complementares
                </h2>
                <p className="mt-1 text-sm text-[color:var(--app-muted)]">
                  Motivo, datas e situação do fechamento da fatura.
                </p>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <FieldLabel htmlFor="unimed-reason" required>
                  Motivo da exclusão
                </FieldLabel>
                <select
                  id="unimed-reason"
                  value={form.reasonCode}
                  onChange={(event) =>
                    updateForm("reasonCode", event.target.value)
                  }
                  aria-invalid={Boolean(errors.reasonCode)}
                  aria-describedby={
                    errors.reasonCode ? "unimed-reason-error" : undefined
                  }
                  className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)]"
                >
                  <option value="">Selecione o motivo</option>
                  {reasons.map((reason) => (
                    <option key={reason.code} value={reason.code}>
                      {reason.code}. {reason.label}
                    </option>
                  ))}
                </select>
                <FieldError
                  id="unimed-reason-error"
                  message={errors.reasonCode}
                />
              </div>

              <div>
                <FieldLabel htmlFor="unimed-enrollment" required>
                  Inclusão no plano
                </FieldLabel>
                <input
                  id="unimed-enrollment"
                  type="date"
                  value={form.planEnrollmentDate}
                  max={form.exclusionDate || undefined}
                  onChange={(event) =>
                    updateForm("planEnrollmentDate", event.target.value)
                  }
                  aria-invalid={Boolean(errors.planEnrollmentDate)}
                  aria-describedby={
                    errors.planEnrollmentDate
                      ? "unimed-enrollment-error"
                      : undefined
                  }
                  className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)]"
                />
                <FieldError
                  id="unimed-enrollment-error"
                  message={errors.planEnrollmentDate}
                />
              </div>

              <div>
                <FieldLabel htmlFor="unimed-exclusion" required>
                  Data de exclusão
                </FieldLabel>
                <input
                  id="unimed-exclusion"
                  type="date"
                  value={form.exclusionDate}
                  min={form.planEnrollmentDate || undefined}
                  onChange={(event) =>
                    void updateExclusionDate(event.target.value)
                  }
                  aria-invalid={Boolean(errors.exclusionDate)}
                  aria-describedby={
                    errors.exclusionDate ? "unimed-exclusion-error" : undefined
                  }
                  className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)]"
                />
                <FieldError
                  id="unimed-exclusion-error"
                  message={errors.exclusionDate}
                />
              </div>

              <fieldset className="md:col-span-2">
                <legend className="mb-2 text-sm font-bold text-[color:var(--app-fg)]">
                  Fechamento da fatura
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      [
                        "AUTOMATIC_DAY_25",
                        "Fechamento automático",
                        "Dia 25 da competência",
                      ],
                      ["OPEN", "Fatura aberta", "Sem fechamento aplicado"],
                    ] as const
                  ).map(([value, title, description]) => (
                    <label
                      key={value}
                      className="flex cursor-pointer gap-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 transition has-[:checked]:border-[color:var(--app-teal)] has-[:checked]:bg-[color:var(--app-success-soft)]"
                    >
                      <input
                        type="radio"
                        name="billing-closure"
                        value={value}
                        checked={form.billingClosure === value}
                        onChange={() => updateForm("billingClosure", value)}
                        className="mt-1 size-4 shrink-0"
                      />
                      <span>
                        <span className="block text-sm font-black text-[color:var(--app-fg)]">
                          {title}
                        </span>
                        <span className="mt-1 block text-xs text-[color:var(--app-muted)]">
                          {description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </section>

          <section className="unimed-sheet-panel border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-lime)]">
                <CircleDollarSign className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-black text-[color:var(--app-fg)]">
                  3. Valores do plano
                </h2>
                <p className="mt-1 text-sm text-[color:var(--app-muted)]">
                  Nenhum preço é presumido. Use valores da competência ativa.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4">
              <p className="mb-3 text-xs font-black tracking-wide text-[color:var(--app-muted)] uppercase">
                Titular
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                <MoneyInput
                  id="unimed-invoice"
                  label="Plano na fatura"
                  value={form.holder.invoicePlanAmount}
                  error={errors.invoicePlanAmount}
                  onChange={(value) => updateHolder("invoicePlanAmount", value)}
                  onBlur={() => blurMoney("invoicePlanAmount")}
                />
                <MoneyInput
                  id="unimed-payroll"
                  label="Plano em folha"
                  value={form.holder.payrollPlanAmount}
                  error={errors.payrollPlanAmount}
                  onChange={(value) => updateHolder("payrollPlanAmount", value)}
                  onBlur={() => blurMoney("payrollPlanAmount")}
                />
                <MoneyInput
                  id="unimed-addon"
                  label="Acessório Funeral"
                  value={form.holder.addonAmount}
                  error={errors.addonAmount}
                  onChange={(value) => updateHolder("addonAmount", value)}
                  onBlur={() => blurMoney("addonAmount")}
                  hint={
                    selectedBeneficiary
                      ? `Identificação automática: ${selectedBeneficiary.hasAddon ? "possui" : "não possui"}.`
                      : "Use 0,00 quando não houver Acessório Funeral."
                  }
                />
              </div>
            </div>

            <div className="mt-7 border-t border-[color:var(--app-border)] pt-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <UsersRound
                    className="size-5 text-[color:var(--app-teal)]"
                    aria-hidden="true"
                  />
                  <div>
                    <h3 className="text-sm font-black text-[color:var(--app-fg)]">
                      Dependentes
                    </h3>
                    <p className="text-xs text-[color:var(--app-muted)]">
                      Até {MAX_DEPENDENTS} dependentes por cálculo.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    updateForm("dependents", [
                      ...form.dependents,
                      createDependent(),
                    ])
                  }
                  disabled={form.dependents.length >= MAX_DEPENDENTS}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)] transition hover:border-[color:var(--app-teal)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Adicionar dependente
                </button>
              </div>

              {form.dependents.length === 0 ? (
                <div className="mt-5 rounded-xl border border-dashed border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-5 text-center text-sm text-[color:var(--app-muted)]">
                  Nenhum dependente incluído neste cálculo.
                </div>
              ) : (
                <div className="mt-5 overflow-hidden rounded-xl border border-[color:var(--app-border)]">
                  {form.dependents.map((dependent, index) => {
                    const dependentError = errors[`dependent-${dependent.id}`];
                    return (
                      <div
                        key={dependent.id}
                        className="border-b border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 last:border-b-0"
                      >
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <h4 className="text-sm font-black text-[color:var(--app-fg)]">
                            Dependente {index + 1}
                          </h4>
                          <button
                            type="button"
                            onClick={() =>
                              updateForm(
                                "dependents",
                                form.dependents.filter(
                                  (item) => item.id !== dependent.id,
                                ),
                              )
                            }
                            className="grid size-9 place-items-center rounded-lg border border-[color:var(--app-border)] text-[color:var(--app-coral)] transition hover:bg-[color:var(--app-danger-soft)]"
                            aria-label={`Remover dependente ${index + 1}`}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </button>
                        </div>
                        <div className="grid gap-4 md:grid-cols-3">
                          <div>
                            <FieldLabel
                              htmlFor={`dependent-${dependent.id}-name`}
                            >
                              Nome
                            </FieldLabel>
                            <input
                              id={`dependent-${dependent.id}-name`}
                              type="text"
                              placeholder="Opcional para o cálculo"
                              value={dependent.name}
                              onChange={(event) =>
                                updateDependent(
                                  dependent.id,
                                  "name",
                                  event.target.value,
                                )
                              }
                              className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)]"
                            />
                          </div>
                          <MoneyInput
                            id={`dependent-${dependent.id}-invoice`}
                            label="Plano na fatura"
                            value={dependent.invoicePlanAmount}
                            error={dependentError}
                            onChange={(value) =>
                              updateDependent(
                                dependent.id,
                                "invoicePlanAmount",
                                value,
                              )
                            }
                            onBlur={() =>
                              blurDependentMoney(dependent, "invoicePlanAmount")
                            }
                          />
                          <MoneyInput
                            id={`dependent-${dependent.id}-addon`}
                            label="Acessório Funeral"
                            value={dependent.addonAmount}
                            error={dependentError}
                            onChange={(value) =>
                              updateDependent(
                                dependent.id,
                                "addonAmount",
                                value,
                              )
                            }
                            onBlur={() =>
                              blurDependentMoney(dependent, "addonAmount")
                            }
                            hint={`Identificação automática: ${dependent.hasAddon ? "possui" : "não possui"}.`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="unimed-sheet-output-grid">
          <section className="unimed-sheet-panel border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-teal)]">
                <Calculator className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-black text-[color:var(--app-fg)]">
                  4. Resultado financeiro
                </h2>
                <p className="mt-1 text-sm text-[color:var(--app-muted)]">
                  Resultado sempre exibido com duas casas decimais.
                </p>
              </div>
            </div>

            <div className="mt-4" aria-live="polite">
              {isCalculating ? (
                <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] p-5 text-center">
                  <div>
                    <Loader2
                      className="mx-auto size-8 animate-spin text-[color:var(--app-teal)]"
                      aria-hidden="true"
                    />
                    <p className="mt-3 text-sm font-black text-[color:var(--app-fg)]">
                      Calculando…
                    </p>
                    <p className="mt-1 text-xs text-[color:var(--app-muted)]">
                      Aplicando regras da competência.
                    </p>
                  </div>
                </div>
              ) : apiError ? (
                <div
                  className="rounded-2xl border border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)] p-5"
                  role="alert"
                >
                  <AlertCircle
                    className="size-7 text-[color:var(--app-coral)]"
                    aria-hidden="true"
                  />
                  <h3 className="mt-3 font-black text-[color:var(--app-fg)]">
                    Cálculo não concluído
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--app-muted)]">
                    {apiError}
                  </p>
                  <button
                    type="submit"
                    className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-card)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)]"
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    Tentar novamente
                  </button>
                </div>
              ) : result ? (
                <div>
                  <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    <ResultMetric
                      label="Valor mensal da fatura"
                      value={formatMoneyResult(result.invoiceTotal)}
                    />
                    <ResultMetric
                      label={`Valor utilizado (${result.usedDays} dias)`}
                      value={formatMoneyResult(result.usedProrata)}
                    />
                    <ResultMetric
                      label={`Estorno proporcional (${result.refundDays} dias)`}
                      value={formatMoneyResult(
                        result.currentCompetencyRefund,
                      )}
                    />
                    {result.cutoffApplied ? (
                      <ResultMetric
                        label="Estorno integral da próxima competência"
                        value={formatMoneyResult(result.nextCompetencyRefund)}
                      />
                    ) : null}
                    <ResultMetric
                      label="Total de valores estornados"
                      value={formatMoneyResult(result.invoiceRefund)}
                      emphasis
                    />
                    <ResultMetric
                      label="Desconto mensal do funcionário"
                      value={formatMoneyResult(result.payrollCharge)}
                    />
                    <ResultMetric
                      label="Estorno ao funcionário"
                      value={formatMoneyResult(result.employeeFullRefund)}
                    />
                    <ResultMetric
                      label="Estorno à empresa"
                      value={formatMoneyResult(result.companyFullRefund)}
                    />
                  </dl>
                  <p className="mt-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3 text-xs leading-5 text-[color:var(--app-muted)]">
                    {result.cutoffApplied
                      ? "Fechamento do dia 25 aplicado: o total estornado soma o proporcional dos dias não utilizados na competência atual e uma mensalidade integral da competência seguinte, que já estava fechada."
                      : "Sem competência adicional: o total estornado corresponde somente aos dias não utilizados na competência atual."}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                    <div className="rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3">
                      <span className="block text-xl font-black text-[color:var(--app-fg)]">
                        {result.refundDays}
                      </span>
                      <span className="text-xs text-[color:var(--app-muted)]">
                        dias de estorno
                      </span>
                    </div>
                    <div className="rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3">
                      <span className="block text-xl font-black text-[color:var(--app-fg)]">
                        {result.contributionMonths}
                      </span>
                      <span className="text-xs text-[color:var(--app-muted)]">
                        meses de contribuição
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-3 py-2.5 text-xs font-bold text-[color:var(--app-muted)]">
                    <FileText
                      className="size-4 shrink-0 text-[color:var(--app-gold)]"
                      aria-hidden="true"
                    />
                    Documento:{" "}
                    {result.documentKind === "RN561"
                      ? "RN561"
                      : result.documentKind === "INACTIVE_TERM"
                        ? "Termo de inativo"
                        : "não aplicável"}
                  </div>
                </div>
              ) : (
                <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] p-6 text-center">
                  <div>
                    <CircleDollarSign
                      className="mx-auto size-9 text-[color:var(--app-subtle)]"
                      aria-hidden="true"
                    />
                    <h3 className="mt-3 font-black text-[color:var(--app-fg)]">
                      Aguardando cálculo
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--app-muted)]">
                      Preencha identificação, regra e valores. Nenhum preço será
                      preenchido por suposição.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 grid gap-3">
              <button
                type="submit"
                disabled={
                  isCalculating || isGeneratingDocument || isRefreshingPricing
                }
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--app-action-blue)] px-5 py-3 text-sm font-black text-[color:var(--app-action-text)] shadow-[0_14px_32px_rgba(20,184,166,0.22)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
              >
                {isCalculating || isRefreshingPricing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Calculator className="size-4" aria-hidden="true" />
                )}
                {isRefreshingPricing
                  ? "Atualizando valores"
                  : documentRequired
                    ? result
                      ? "Recalcular e gerar documento"
                      : "Calcular e gerar documento"
                    : result
                      ? "Recalcular exclusão"
                      : "Calcular exclusão"}
              </button>
              <p className="text-center text-xs font-semibold text-[color:var(--app-muted)]">
                O cálculo é atualizado automaticamente ao alterar data ou
                valores.
              </p>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2.5 text-sm font-bold text-[color:var(--app-fg)]">
                <input
                  type="checkbox"
                  checked={includePayrollLoans}
                  onChange={(event) =>
                    updatePayrollLoansPrintPreference(event.target.checked)
                  }
                  className="size-4 shrink-0 accent-[color:var(--app-teal)]"
                />
                <span>Incluir Empréstimo Consignado no PDF</span>
              </label>
              <button
                type="button"
                onClick={resetWorkspace}
                disabled={isCalculating}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-5 py-2.5 text-sm font-black text-[color:var(--app-fg)] transition hover:border-[color:var(--app-teal)] disabled:opacity-50"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Limpar formulário
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={
                  !result ||
                  isCalculating ||
                  isRefreshingPricing ||
                  (documentRequired && !documentReady)
                }
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-5 py-2.5 text-sm font-black text-[color:var(--app-fg)] transition hover:border-[color:var(--app-gold)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Printer className="size-4" aria-hidden="true" />
                Imprimir duas vias
              </button>
              <button
                type="button"
                onClick={() => {
                  if (documentReady) {
                    openGeneratedDocument();
                    return;
                  }
                  void generateDocument();
                }}
                disabled={
                  !result ||
                  !selectedBeneficiary ||
                  !documentRequired ||
                  isGeneratingDocument
                }
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-5 py-2.5 text-sm font-black text-[color:var(--app-fg)] transition hover:border-[color:var(--app-teal)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isGeneratingDocument ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <FileText className="size-4" aria-hidden="true" />
                )}
                {isGeneratingDocument
                  ? `Gerando PDF${documentProgress > 0 ? ` (${documentProgress}%)` : "…"}`
                  : documentReady
                    ? "Abrir PDF em nova aba"
                    : "Gerar documento obrigatório"}
              </button>
              {documentReady ? (
                <p
                  className="text-center text-xs font-bold text-[color:var(--app-teal)]"
                  role="status"
                >
                  Documento obrigatório pronto. Abra o PDF em nova aba para
                  imprimir ou baixar.
                </p>
              ) : null}
              {documentError ? (
                <p
                  className="text-center text-xs font-semibold text-[color:var(--app-coral)]"
                  role="alert"
                >
                  Documento obrigatório pendente: {documentError} O e-mail de
                  coparticipação continua disponível.
                </p>
              ) : null}
            </div>
          </section>

          <section className="unimed-sheet-panel border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-coral)]">
                <Mail className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-black text-[color:var(--app-fg)]">
                  E-mail de exclusão
                </h2>
                <p className="mt-1 text-xs leading-5 text-[color:var(--app-muted)]">
                  Solicite a planilha de coparticipação para a rescisão. Nenhum
                  anexo será incluído automaticamente.
                </p>
              </div>
            </div>
            {result && !emailConfirmed ? (
              <div
                className="mt-4 rounded-xl border border-[color:var(--app-gold)] bg-[color:var(--app-warning-soft)] p-3 text-sm font-bold text-[color:var(--app-fg)]"
                role="status"
              >
                Lembrete: envie o e-mail solicitando a planilha de
                coparticipação. A geração do documento é uma ação separada e ele
                não será anexado ao e-mail.
              </div>
            ) : null}
            {emailConfirmed ? (
              <div
                className="mt-4 flex items-start gap-2 rounded-xl border border-[color:var(--app-success-border)] bg-[color:var(--app-success-soft)] p-3 text-sm font-bold text-[color:var(--app-fg)]"
                role="status"
              >
                <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                E-mail enviado com sucesso.
              </div>
            ) : null}
            {emailError && !emailDialogOpen ? (
              <div
                className="mt-4 rounded-xl border border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)] p-3 text-sm font-semibold text-[color:var(--app-fg)]"
                role="alert"
              >
                {emailError}
              </div>
            ) : null}
            <button
              type="button"
              disabled={!result || !selectedBeneficiary || isSendingEmail}
              onClick={() => setEmailDialogOpen(true)}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2.5 text-sm font-black text-[color:var(--app-fg)] transition hover:border-[color:var(--app-coral)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {emailConfirmed
                ? "Enviar e-mail novamente"
                : "Confirmar e enviar e-mail"}
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
            {!result || !selectedBeneficiary ? (
              <p className="mt-2 text-center text-xs text-[color:var(--app-subtle)]">
                {!result
                  ? "Disponível após cálculo concluído."
                  : "Selecione um beneficiário na pesquisa para liberar o envio."}
              </p>
            ) : null}
          </section>
        </aside>
      </form>

      <UnimedNoticeToast notice={notice} onClose={() => setNotice(null)} />

      <AlertDialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <AlertDialogContent className="border-[color:var(--app-border)] bg-[color:var(--app-card)] text-[color:var(--app-fg)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[color:var(--app-fg)]">
              Confirmar envio do e-mail?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[color:var(--app-muted)]">
              Esta confirmação solicitará a planilha de coparticipação agora. O
              conteúdo terá nome e CPF, sem documento anexado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="mt-4 space-y-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4">
            <div>
              <dt className="text-xs font-bold text-[color:var(--app-subtle)] uppercase">
                Colaborador
              </dt>
              <dd className="mt-1 break-words text-sm font-black text-[color:var(--app-fg)]">
                {form.employeeName || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-[color:var(--app-subtle)] uppercase">
                CPF
              </dt>
              <dd className="mt-1 text-sm font-black text-[color:var(--app-fg)]">
                {form.cpf || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-[color:var(--app-subtle)] uppercase">
                Motivo
              </dt>
              <dd className="mt-1 text-sm font-black text-[color:var(--app-fg)]">
                {selectedReason
                  ? `${selectedReason.code}. ${selectedReason.label}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-[color:var(--app-subtle)] uppercase">
                Matrícula
              </dt>
              <dd className="mt-1 text-sm font-black text-[color:var(--app-fg)]">
                {selectedBeneficiary?.registration || "—"}
              </dd>
            </div>
          </dl>
          {emailError ? (
            <p
              className="mt-4 rounded-xl border border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)] p-3 text-sm font-semibold text-[color:var(--app-fg)]"
              role="alert"
            >
              {emailError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isSendingEmail}
              className="min-h-10 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)]"
            >
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={sendEmail}
              disabled={isSendingEmail || !selectedBeneficiary || !result}
              className="min-h-10 rounded-xl bg-[color:var(--app-action-blue)] px-4 py-2 text-sm font-black text-[color:var(--app-action-text)]"
            >
              {isSendingEmail ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {isSendingEmail ? "Enviando…" : "Confirmar e enviar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UnimedPrintSummary
        data={
          result
            ? {
                employeeName: form.employeeName,
                cpf: form.cpf,
                registration: selectedBeneficiary?.registration,
                reason: selectedReason
                  ? `${selectedReason.code}. ${selectedReason.label}`
                  : "",
                competency: dataCompetency
                  ? `${dataCompetency.year}-${String(
                      dataCompetency.month,
                    ).padStart(2, "0")}`
                  : form.exclusionDate.slice(0, 7),
                exclusionDate: form.exclusionDate,
                planEnrollmentDate: form.planEnrollmentDate,
                billingClosure: form.billingClosure,
                branchCode:
                  selectedBeneficiary?.branch?.name ??
                  selectedBeneficiary?.branch?.code ??
                  null,
                holder: {
                  registration: selectedBeneficiary?.registration ?? null,
                  name: form.employeeName,
                  birthDate: selectedBeneficiary?.birthDate ?? null,
                  age: selectedBeneficiary?.pricing.age ?? null,
                  planCode: selectedBeneficiary?.planCode ?? null,
                  hasFuneral: selectedBeneficiary?.hasAddon ?? false,
                  invoicePlanAmount: form.holder.invoicePlanAmount,
                  payrollPlanAmount: form.holder.payrollPlanAmount,
                  funeralAmount: form.holder.addonAmount,
                },
                dependents: form.dependents.map((dependent) => ({
                  registration: null,
                  name: dependent.name,
                  birthDate: dependent.birthDate,
                  age: dependent.age,
                  planCode: dependent.planCode,
                  hasFuneral: dependent.hasAddon,
                  invoicePlanAmount: dependent.invoicePlanAmount,
                  payrollPlanAmount: null,
                  funeralAmount: dependent.addonAmount,
                })),
                includePayrollLoans,
                payrollLoans,
                result,
              }
            : null
        }
      />
    </div>
  );
}
