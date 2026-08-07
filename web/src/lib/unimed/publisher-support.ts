import type { Prisma } from "@/generated/prisma/client";
import type {
  ParsedAddress,
  ParsedBeneficiary,
  ParsedInvoiceItem,
  ParsedUnimedSource,
} from "@/lib/unimed/importer";
import type { CoreImportSource } from "@/lib/unimed/publisher-maintenance";
import type { UnimedReconciliation } from "@/lib/unimed/reconcile";

type CoreParsedRow = ParsedBeneficiary | ParsedInvoiceItem | ParsedAddress;
type CoreParsedSource = ParsedUnimedSource<CoreParsedRow>;

export type PublishUnimedInput = {
  tenantId: string;
  userId?: string;
  moduleSessionId?: string;
  year: number;
  month: number;
  beneficiaries?: ParsedUnimedSource<ParsedBeneficiary>;
  invoiceItems?: ParsedUnimedSource<ParsedInvoiceItem>;
  addresses?: ParsedUnimedSource<ParsedAddress>;
};

export type PublishUnimedResult = {
  idempotent: boolean;
  ready: boolean;
  missingSources: CoreImportSource[];
  competencyId: string;
  batchId: string;
  summary: {
    beneficiaries: number;
    invoiceItems: number;
    addresses: number;
    branches: number;
    skippedRows: number;
    warnings: {
      unmatchedInvoiceItems: number;
      unmatchedDependents: number;
      ambiguousPlanCodes: number;
    };
    warningDetails?: UnimedReconciliation["warningDetails"];
    information: UnimedReconciliation["information"];
  };
};

export class UnimedPublishError extends Error {
  constructor(
    readonly code:
      | "IMPORT_REJECTED"
      | "IMPORT_IN_PROGRESS"
      | "INVALID_ACTOR"
      | "MISSING_BRANCH",
    message: string,
  ) {
    super(message);
    this.name = "UnimedPublishError";
  }
}

export function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function sourceWarningCount<T>(source: ParsedUnimedSource<T>) {
  return source.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "WARNING",
  ).length;
}

export function sourceSummary<T>(source: ParsedUnimedSource<T>) {
  return {
    rows: source.rows.length,
    rejected: source.rejectedCount,
    skipped: source.skippedCount,
    warnings: sourceWarningCount(source),
  };
}

export function hasAddressValue(address: ParsedBeneficiary["address"]) {
  return Object.values(address).some(Boolean);
}

export function snapshotPayload<T>(source: ParsedUnimedSource<T>) {
  return source as unknown as Prisma.InputJsonValue;
}

export function readSnapshot<T>(payload: Prisma.JsonValue): ParsedUnimedSource<T> {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !("rows" in payload) ||
    !Array.isArray(payload.rows) ||
    !("checksum" in payload) ||
    typeof payload.checksum !== "string"
  ) {
    throw new UnimedPublishError(
      "IMPORT_REJECTED",
      "O snapshot normalizado da competência está inválido.",
    );
  }
  return payload as unknown as ParsedUnimedSource<T>;
}

export function requireMapValue<K, V>(
  map: ReadonlyMap<K, V>,
  key: K,
): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new UnimedPublishError(
      "IMPORT_REJECTED",
      "A publicação encontrou dados internos inconsistentes.",
    );
  }
  return value;
}

export function providedSources(input: PublishUnimedInput) {
  const sources: Array<{
    source: CoreImportSource;
    data: CoreParsedSource;
  }> = [];
  if (input.beneficiaries) {
    sources.push({ source: "BENEFICIARIES", data: input.beneficiaries });
  }
  if (input.invoiceItems) {
    sources.push({ source: "INVOICES", data: input.invoiceItems });
  }
  if (input.addresses) {
    sources.push({ source: "ADDRESSES", data: input.addresses });
  }
  return sources;
}

export function incompleteSummary(): PublishUnimedResult["summary"] {
  return {
    beneficiaries: 0,
    invoiceItems: 0,
    addresses: 0,
    branches: 0,
    skippedRows: 0,
    warnings: {
      unmatchedInvoiceItems: 0,
      unmatchedDependents: 0,
      ambiguousPlanCodes: 0,
    },
    information: {
      addressOnlyRows: 0,
      dependentsLinkedByRegistration: 0,
      dependentsLinkedFromPreviousCompetency: 0,
    },
  };
}

