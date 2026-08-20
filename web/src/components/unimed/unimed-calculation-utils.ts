import type { UnimedBeneficiary } from "./unimed-beneficiary-search";
import type {
  ApiErrorBody,
  DependentValues,
  FieldErrors,
  FormValues,
} from "./unimed-calculation-types";

export const MAX_DEPENDENTS = 6;
export const PAYROLL_LOANS_PRINT_STORAGE_KEY =
  "perfectutilitares.unimed.include-payroll-loans.v1";

export const INITIAL_FORM: FormValues = {
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

export function normalizeMoney(value: string) {
  return value.replace(/[^\d,.-]/g, "");
}

export function parseMoney(value: string) {
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

export function formatMoneyInput(value: string) {
  const parsed = parseMoney(value);
  return Number.isFinite(parsed) ? moneyFormatter.format(parsed) : value;
}

export function formatMoneyResult(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `R$ ${moneyFormatter.format(parsed)}` : "—";
}

export function formatCompetencyResult(value: string | null) {
  if (!value) return "—";
  const [year, month] = value.split("-");
  return year && month ? `${month}/${year}` : value;
}

export function formatCpf(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export function createDependent(
  defaultInclusionDate = "",
): DependentValues {
  return {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source: "MANUAL",
    selected: true,
    name: "",
    birthDate: null,
    inclusionDate: defaultInclusionDate,
    planCode: null,
    age: null,
    hasAddon: false,
    invoicePlanAmount: "",
    addonAmount: "",
  };
}

export async function readApiError(
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

export function waitForDocumentPoll(milliseconds: number, signal: AbortSignal) {
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

export function defaultMoney(value: string | number | null | undefined) {
  if (value === undefined || value === null || value === "") return "";
  return formatMoneyInput(String(value));
}

export function pricingIssue(status: UnimedBeneficiary["pricing"]["status"]) {
  if (status === "MISSING_BIRTH_DATE") return "data de nascimento ausente";
  if (status === "MISSING_PLAN_CODE") return "código do plano ausente";
  if (status === "MISSING_AGE_BRACKET") return "faixa etária não configurada";
  return "preço não encontrado de forma única";
}

export function dateInput(value: string | undefined | null) {
  return value?.slice(0, 10) ?? "";
}

export function validateForm(form: FormValues) {
  const errors: FieldErrors = {};

  if (form.employeeName.trim().length < 3) {
    errors.employeeName = "Informe o nome do colaborador.";
  }
  if (form.cpf.replace(/\D/g, "").length !== 11) {
    errors.cpf = "Informe um CPF com 11 dígitos.";
  }
  if (!form.reasonCode) errors.reasonCode = "Selecione o motivo.";
  if (
    form.reasonCode === "1" &&
    !form.dependents.some((dependent) => dependent.selected)
  ) {
    errors.reasonCode = "Marque ao menos um dependente para esta exclusão.";
  }
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

  form.dependents.filter((dependent) => dependent.selected).forEach((dependent) => {
    if (
      dependent.inclusionDate &&
      form.exclusionDate &&
      dependent.inclusionDate > form.exclusionDate
    ) {
      errors[`dependent-${dependent.id}`] =
        "A inclusão do dependente não pode ocorrer após a exclusão.";
      return;
    }
    if (dependent.source !== "MANUAL") return;
    if (dependent.name.trim().length < 2) {
      errors[`dependent-${dependent.id}`] =
        "Informe o nome do dependente incluído manualmente.";
      return;
    }
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
