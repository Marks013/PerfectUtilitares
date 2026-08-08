"use client";

import {
  Check,
  type FileText,
  Trash2,
  UploadCloud,
} from "lucide-react";
import {
  bytesLabel,
} from "@/components/unimed/form-utils";
export const MAX_FILES = 50;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

type PublishResult = {
  idempotent: boolean;
  competencyId: string;
  batchId: string;
  ready: boolean;
  missingSources: string[];
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
    warningDetails?: {
      unmatchedInvoiceItems: Array<{
        sourceKey: string;
        branchCode: string;
        beneficiaryName: string;
        category: "HOLDER" | "DEPENDENT";
        itemDescription: string;
        reason: string;
      }>;
      unmatchedDependents: Array<{
        sourceKey: string;
        branchCode: string;
        fullName: string;
        reason: string;
      }>;
      ambiguousPlanCodes: Array<{
        sourceKey: string;
        branchCode: string;
        fullName: string;
        planCodes: string[];
      }>;
    };
    information: {
      addressOnlyRows: number;
    };
  };
};

export type ImportResponse = {
  import: PublishResult;
};

type PayrollLoanResult = {
  idempotent: boolean;
  competencyId: string;
  batchId: string;
  summary: {
    payrollLoans: number;
    totalInstallmentAmount: number;
    matchedByCpf: number;
    matchedByRegistration: number;
    unmatched: number;
    warnings: number;
    sourceSheet: string;
  };
};

export type PayrollLoanResponse = {
  import: PayrollLoanResult;
};

type RequestState<Result> =
  | { status: "idle"; progress: 0 }
  | { status: "uploading"; progress: number }
  | { status: "processing"; progress: 100 }
  | { status: "success"; progress: 100; result: Result }
  | { status: "error"; progress: 0; messages: string[] };

export type ImportState = RequestState<PublishResult>;
export type PayrollLoanState = RequestState<PayrollLoanResult>;
export type ConfirmationTarget = "base" | "payrollLoan";

export function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function mergeFiles(current: File[], incoming: File[]) {
  const files = new Map(current.map((file) => [fileKey(file), file]));
  incoming.forEach((file) => {
    files.set(fileKey(file), file);
  });
  return [...files.values()];
}

export function selectedMonthLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return "não informada";
  return `${match[2]}/${match[1]}`;
}

export function FileGroup({
  id,
  title,
  description,
  accept,
  multiple,
  files,
  inputRef,
  onFiles,
  onRemove,
  icon: Icon,
}: {
  id: string;
  title: string;
  description: string;
  accept: string;
  multiple: boolean;
  files: File[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: File[]) => void;
  onRemove: (key: string) => void;
  icon: typeof FileText;
}) {
  return (
    <section className="rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-teal)]">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-black text-[color:var(--app-fg)]">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-[color:var(--app-muted)]">
            {description}
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <label
        htmlFor={id}
        className="mt-4 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[color:var(--app-border-strong)] bg-[color:var(--app-input)] px-4 py-4 text-center transition hover:border-[color:var(--app-teal)]"
      >
        <UploadCloud
          className="size-6 text-[color:var(--app-teal)]"
          aria-hidden="true"
        />
        <span className="mt-2 text-sm font-black text-[color:var(--app-fg)]">
          Selecionar {multiple ? "arquivos" : "arquivo"}
        </span>
        <span className="mt-1 text-xs text-[color:var(--app-subtle)]">
          {accept.replaceAll(",", " ou ")}
        </span>
      </label>

      {files.length === 0 ? (
        <p className="mt-3 text-center text-xs text-[color:var(--app-subtle)]">
          Nenhum arquivo selecionado.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {files.map((file) => (
            <li
              key={fileKey(file)}
              className="flex items-center gap-3 rounded-lg border border-[color:var(--app-border)] bg-[color:var(--app-card)] px-3 py-2"
            >
              <Check className="size-4 shrink-0 text-[color:var(--app-lime)]" />
              <span className="min-w-0 flex-1 truncate text-xs font-bold text-[color:var(--app-fg)]">
                {file.name}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-[color:var(--app-subtle)]">
                {bytesLabel(file.size)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(fileKey(file))}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-[color:var(--app-coral)] transition hover:bg-[color:var(--app-danger-soft)]"
                aria-label={`Remover ${file.name}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3">
      <span className="block text-2xl font-black tabular-nums text-[color:var(--app-fg)]">
        {value.toLocaleString("pt-BR")}
      </span>
      <span className="mt-1 block text-xs text-[color:var(--app-muted)]">
        {label}
      </span>
    </div>
  );
}
