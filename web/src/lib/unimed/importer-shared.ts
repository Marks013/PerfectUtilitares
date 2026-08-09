export const UNIMED_IMPORT_LIMITS = {
  maxFiles: 50,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
} as const;

export class UnimedImportValidationError extends Error {
  constructor(
    readonly code:
      | "UNIMED_BENEFICIARY_FILES_INVALID"
      | "UNIMED_INVOICE_FILES_INVALID"
      | "UNIMED_ADDRESS_FILE_INVALID"
      | "UNIMED_PAYROLL_LOAN_FILE_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "UnimedImportValidationError";
  }
}

type ImportSeverity = "ERROR" | "WARNING";

export type UnimedImportDiagnostic = {
  file: string;
  row: number;
  severity: ImportSeverity;
  code: string;
  message: string;
};

export type UnimedImportFile = {
  name: string;
  bytes: Buffer;
};

export type ParsedBeneficiary = {
  sourceKey: string;
  branchCode: string;
  registration: string | null;
  fullName: string;
  cpf: string;
  rg?: string | null;
  birthDate: string;
  inclusionDate: string;
  category: "HOLDER" | "DEPENDENT";
  relationship: string | null;
  planName: string | null;
  accommodation: string | null;
  companyCnpj: string | null;
  address: {
    addressLine: string | null;
    number: string | null;
    complement: string | null;
    district: string | null;
    postalCode: string | null;
    city: string | null;
    state: string | null;
    pis: string | null;
  };
};

export type ParsedInvoiceItem = {
  sourceKey: string;
  branchCode: string;
  contract: string | null;
  registration: string | null;
  cpf: string | null;
  card: string;
  beneficiaryName: string;
  holderName: string | null;
  relationship: string | null;
  category: "HOLDER" | "DEPENDENT";
  accommodation: string | null;
  itemCode: string | null;
  itemDescription: string;
  amount: number;
  planCode: string | null;
};

export type ParsedAddress = {
  registration: string | null;
  fullName: string;
  cpf: string | null;
  addressLine: string | null;
  number: string | null;
  district: string | null;
  postalCode: string | null;
  city: string | null;
  state: string | null;
  pis: string | null;
};

export type ParsedPayrollLoan = {
  sourceKey: string;
  sourceRow: number;
  competence: string;
  cpfNormalized: string | null;
  registration: string | null;
  employeeName: string;
  contractNumber: string;
  installmentAmount: number;
  startCompetence: string;
  endCompetence: string;
  bankCode: string;
  bankName: string;
  totalInstallments: number | null;
  loanAmount: number | null;
  releasedAmount: number | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  companyCnpj: string | null;
};

export type ParsedUnimedSource<T> = {
  fileCount: number;
  checksum: string;
  rows: T[];
  rejectedCount: number;
  skippedCount: number;
  diagnostics: UnimedImportDiagnostic[];
};

export function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

export function normalizeAddressHeader(value: unknown) {
  const normalized = normalizeHeader(value).replace(/[.\u00ba\u00b0]/g, "");
  return ["N", "NO", "NUMERO"].includes(normalized) ? "N" : normalized;
}

export function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function hasOnlyRepeatedDigits(value: string) {
  return /^(\d)\1+$/.test(value);
}

function checkDigit(base: string, weights: number[]) {
  const sum = base
    .split("")
    .reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCpf(value: string) {
  const cpf = digits(value);
  if (cpf.length !== 11 || hasOnlyRepeatedDigits(cpf)) return false;
  const first = checkDigit(cpf.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(
    cpf.slice(0, 9) + first,
    [11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return cpf.endsWith(`${first}${second}`);
}

export function isValidCnpj(value: string) {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || hasOnlyRepeatedDigits(cnpj)) return false;
  const first = checkDigit(
    cnpj.slice(0, 12),
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  const second = checkDigit(
    cnpj.slice(0, 12) + first,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return cnpj.endsWith(`${first}${second}`);
}

export function toIsoDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
    ? null
    : iso;
}

export function canonicalCompetence(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const raw = String(value ?? "").trim();
  const isoMatch = /^(\d{4})-(\d{2})(?:-\d{2})?/.exec(raw);
  if (isoMatch) {
    const month = Number(isoMatch[2]);
    const year = Number(isoMatch[1]);
    return month >= 1 && month <= 12 && year >= 2000 && year <= 2200
      ? `${isoMatch[1]}-${isoMatch[2]}`
      : null;
  }
  const dateMatch = /^\d{2}\/(\d{2})\/(\d{4})$/.exec(raw);
  const match = dateMatch
    ? [dateMatch[0], dateMatch[1], dateMatch[2]]
    : /^(\d{2})\/(\d{4})$/.exec(raw);
  if (!match) return null;
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2200) return null;
  return `${match[2]}-${match[1]}`;
}

export function addCompetenceMonths(competence: string, months: number) {
  const [year, month] = competence.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function positiveInteger(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseBrazilianMoney(value: unknown) {
  const raw = String(value ?? "")
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s+/g, "");
  if (!raw) return null;

  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  const padded = fraction.padEnd(3, "0");
  let cents = BigInt(whole) * 100n + BigInt(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(negative ? -cents : cents) / 100;
}

export function rowError(
  diagnostics: UnimedImportDiagnostic[],
  file: string,
  row: number,
  code: string,
  message: string,
) {
  diagnostics.push({ file, row, severity: "ERROR", code, message });
}

export function rowWarning(
  diagnostics: UnimedImportDiagnostic[],
  file: string,
  row: number,
  code: string,
  message: string,
) {
  diagnostics.push({ file, row, severity: "WARNING", code, message });
}
