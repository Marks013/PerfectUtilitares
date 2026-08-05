"use client";

import {
  AlertCircle,
  Archive,
  CalendarDays,
  Check,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  FileText,
  Loader2,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UsersRound,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
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
import {
  bytesLabel,
  errorMessagesFromBody,
} from "@/components/unimed/form-utils";

const MAX_FILES = 50;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

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

type ImportResponse = {
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

type PayrollLoanResponse = {
  import: PayrollLoanResult;
};

type RequestState<Result> =
  | { status: "idle"; progress: 0 }
  | { status: "uploading"; progress: number }
  | { status: "processing"; progress: 100 }
  | { status: "success"; progress: 100; result: Result }
  | { status: "error"; progress: 0; messages: string[] };

type ImportState = RequestState<PublishResult>;
type PayrollLoanState = RequestState<PayrollLoanResult>;
type ConfirmationTarget = "base" | "payrollLoan";

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function mergeFiles(current: File[], incoming: File[]) {
  const files = new Map(current.map((file) => [fileKey(file), file]));
  incoming.forEach((file) => files.set(fileKey(file), file));
  return [...files.values()];
}

function selectedMonthLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return "não informada";
  return `${match[2]}/${match[1]}`;
}

function FileGroup({
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

function SummaryMetric({ label, value }: { label: string; value: number }) {
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

export function UnimedImportWorkspace() {
  const beneficiaryInputRef = useRef<HTMLInputElement>(null);
  const invoiceInputRef = useRef<HTMLInputElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const payrollLoanInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const payrollLoanRequestRef = useRef<XMLHttpRequest | null>(null);
  const [competency, setCompetency] = useState("");
  const [beneficiaryFiles, setBeneficiaryFiles] = useState<File[]>([]);
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [addressFiles, setAddressFiles] = useState<File[]>([]);
  const [payrollLoanFiles, setPayrollLoanFiles] = useState<File[]>([]);
  const [confirmationTarget, setConfirmationTarget] =
    useState<ConfirmationTarget | null>(null);
  const [state, setState] = useState<ImportState>({
    status: "idle",
    progress: 0,
  });
  const [payrollLoanState, setPayrollLoanState] = useState<PayrollLoanState>({
    status: "idle",
    progress: 0,
  });

  const baseFiles = useMemo(
    () => [...beneficiaryFiles, ...invoiceFiles, ...addressFiles],
    [beneficiaryFiles, invoiceFiles, addressFiles],
  );
  const baseBytes = useMemo(
    () => baseFiles.reduce((total, file) => total + file.size, 0),
    [baseFiles],
  );
  const payrollLoanBytes = payrollLoanFiles[0]?.size ?? 0;
  const csvCount = beneficiaryFiles.length + invoiceFiles.length;
  const isBaseBusy =
    state.status === "uploading" || state.status === "processing";
  const isPayrollLoanBusy =
    payrollLoanState.status === "uploading" ||
    payrollLoanState.status === "processing";
  const isBusy = isBaseBusy || isPayrollLoanBusy;

  const selectedBaseSources = useMemo(() => {
    const sources: string[] = [];
    if (beneficiaryFiles.length > 0) sources.push("Beneficiários");
    if (invoiceFiles.length > 0) sources.push("Faturas");
    if (addressFiles.length > 0) sources.push("Endereços");
    return sources;
  }, [addressFiles.length, beneficiaryFiles.length, invoiceFiles.length]);

  function releaseBaseFiles() {
    setBeneficiaryFiles([]);
    setInvoiceFiles([]);
    setAddressFiles([]);
    if (beneficiaryInputRef.current) beneficiaryInputRef.current.value = "";
    if (invoiceInputRef.current) invoiceInputRef.current.value = "";
    if (addressInputRef.current) addressInputRef.current.value = "";
  }

  function releasePayrollLoanFile() {
    setPayrollLoanFiles([]);
    if (payrollLoanInputRef.current) payrollLoanInputRef.current.value = "";
  }

  function releaseFiles() {
    releaseBaseFiles();
    releasePayrollLoanFile();
  }

  function reset() {
    requestRef.current?.abort();
    payrollLoanRequestRef.current?.abort();
    requestRef.current = null;
    payrollLoanRequestRef.current = null;
    releaseFiles();
    setCompetency("");
    setConfirmationTarget(null);
    setState({ status: "idle", progress: 0 });
    setPayrollLoanState({ status: "idle", progress: 0 });
  }

  function validateCompetency(messages: string[]) {
    const monthMatch = /^(\d{4})-(\d{2})$/.exec(competency);
    const year = Number(monthMatch?.[1]);
    const month = Number(monthMatch?.[2]);
    if (!monthMatch || year < 2020 || year > 2100 || month < 1 || month > 12) {
      messages.push("Informe uma competência válida.");
    }
  }

  function validateBaseSelection() {
    const messages: string[] = [];
    validateCompetency(messages);
    if (baseFiles.length === 0) {
      messages.push("Selecione ao menos uma fonte para importar.");
    }
    if (addressFiles.length > 1) {
      messages.push("Selecione no máximo uma planilha XLSX de endereços.");
    }
    if (
      [...beneficiaryFiles, ...invoiceFiles].some(
        (file) => !file.name.toLowerCase().endsWith(".csv"),
      )
    ) {
      messages.push("Beneficiários e faturas aceitam somente arquivos CSV.");
    }
    if (
      addressFiles.some((file) => !file.name.toLowerCase().endsWith(".xlsx"))
    ) {
      messages.push("Endereços aceitam somente uma planilha XLSX.");
    }
    if (csvCount > MAX_FILES) {
      messages.push(`Use no máximo ${MAX_FILES} arquivos CSV por importação.`);
    }
    if (baseFiles.some((file) => file.size > MAX_FILE_BYTES)) {
      messages.push("Cada arquivo deve ter no máximo 10 MB.");
    }
    if (baseBytes > MAX_TOTAL_BYTES) {
      messages.push("O conjunto de arquivos deve ter no máximo 20 MB.");
    }

    return messages;
  }

  function validatePayrollLoanSelection() {
    const messages: string[] = [];
    validateCompetency(messages);
    if (payrollLoanFiles.length !== 1) {
      messages.push("Selecione uma planilha XLSX de empréstimo consignado.");
    }
    if (
      payrollLoanFiles.some(
        (file) => !file.name.toLowerCase().endsWith(".xlsx"),
      )
    ) {
      messages.push("Empréstimo consignado aceita somente planilha XLSX.");
    }
    if (payrollLoanFiles.some((file) => file.size > MAX_FILE_BYTES)) {
      messages.push("A planilha de empréstimo deve ter no máximo 10 MB.");
    }
    return messages;
  }

  function requestConfirmation(target: ConfirmationTarget) {
    const messages =
      target === "base"
        ? validateBaseSelection()
        : validatePayrollLoanSelection();
    if (messages.length > 0) {
      if (target === "base") {
        setState({ status: "error", progress: 0, messages });
      } else {
        setPayrollLoanState({ status: "error", progress: 0, messages });
      }
      return;
    }
    if (target === "base") {
      setState({ status: "idle", progress: 0 });
    } else {
      setPayrollLoanState({ status: "idle", progress: 0 });
    }
    setConfirmationTarget(target);
  }

  function publishBase() {
    const match = /^(\d{4})-(\d{2})$/.exec(competency);
    if (!match) return;

    setConfirmationTarget(null);
    setState({ status: "uploading", progress: 0 });

    const data = new FormData();
    data.append("year", match[1]);
    data.append("month", String(Number(match[2])));
    beneficiaryFiles.forEach((file) =>
      data.append("beneficiaryFiles", file, file.name),
    );
    invoiceFiles.forEach((file) =>
      data.append("invoiceFiles", file, file.name),
    );
    if (addressFiles[0]) {
      data.append("addressFile", addressFiles[0], addressFiles[0].name);
    }

    const request = new XMLHttpRequest();
    requestRef.current = request;
    request.open("POST", "/api/unimed/imports");
    request.responseType = "json";

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.min(
        99,
        Math.round((event.loaded / event.total) * 100),
      );
      setState({ status: "uploading", progress });
    });
    request.upload.addEventListener("load", () => {
      setState({ status: "processing", progress: 100 });
    });
    request.addEventListener("load", () => {
      const body = request.response as
        | ImportResponse
        | {
            error?: { message?: string; details?: unknown };
          }
        | null;
      requestRef.current = null;
      releaseBaseFiles();

      if (
        request.status >= 200 &&
        request.status < 300 &&
        body &&
        "import" in body
      ) {
        setState({
          status: "success",
          progress: 100,
          result: body.import,
        });
        return;
      }

      setState({
        status: "error",
        progress: 0,
        messages: errorMessagesFromBody(
          body && "error" in body ? body : null,
          "Não foi possível validar e publicar esta importação.",
        ),
      });
    });
    request.addEventListener("error", () => {
      requestRef.current = null;
      releaseBaseFiles();
      setState({
        status: "error",
        progress: 0,
        messages: [
          "Falha de conexão durante a importação. Selecione os arquivos novamente.",
        ],
      });
    });
    request.addEventListener("abort", () => {
      requestRef.current = null;
      releaseBaseFiles();
    });
    request.send(data);
  }

  function publishPayrollLoan() {
    const match = /^(\d{4})-(\d{2})$/.exec(competency);
    const file = payrollLoanFiles[0];
    if (!match || !file) return;

    setConfirmationTarget(null);
    setPayrollLoanState({ status: "uploading", progress: 0 });

    const data = new FormData();
    data.append("year", match[1]);
    data.append("month", String(Number(match[2])));
    data.append("payrollLoanFile", file, file.name);

    const request = new XMLHttpRequest();
    payrollLoanRequestRef.current = request;
    request.open("POST", "/api/unimed/imports/payroll-loans");
    request.responseType = "json";
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      setPayrollLoanState({
        status: "uploading",
        progress: Math.min(99, Math.round((event.loaded / event.total) * 100)),
      });
    });
    request.upload.addEventListener("load", () => {
      setPayrollLoanState({ status: "processing", progress: 100 });
    });
    request.addEventListener("load", () => {
      const body = request.response as
        | PayrollLoanResponse
        | {
            error?: { message?: string; details?: unknown };
          }
        | null;
      payrollLoanRequestRef.current = null;
      releasePayrollLoanFile();

      if (
        request.status >= 200 &&
        request.status < 300 &&
        body &&
        "import" in body
      ) {
        setPayrollLoanState({
          status: "success",
          progress: 100,
          result: body.import,
        });
        return;
      }

      setPayrollLoanState({
        status: "error",
        progress: 0,
        messages: errorMessagesFromBody(
          body && "error" in body ? body : null,
          "Não foi possível validar e importar os empréstimos consignados.",
        ),
      });
    });
    request.addEventListener("error", () => {
      payrollLoanRequestRef.current = null;
      releasePayrollLoanFile();
      setPayrollLoanState({
        status: "error",
        progress: 0,
        messages: [
          "Falha de conexão durante a importação. Selecione a planilha novamente.",
        ],
      });
    });
    request.addEventListener("abort", () => {
      payrollLoanRequestRef.current = null;
      releasePayrollLoanFile();
    });
    request.send(data);
  }

  return (
    <div className="space-y-6">
      <header className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-3 py-1.5 text-xs font-black tracking-wide text-[color:var(--app-teal)] uppercase">
              <Database className="size-3.5" aria-hidden="true" />
              Unimed · Base mensal
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-[color:var(--app-fg)] sm:text-4xl">
              Importar dados por competência
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:var(--app-muted)] sm:text-base">
              Cada fonte pode ser atualizada separadamente. A base só fica
              pronta para uso quando possuir os dados necessários.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-[color:var(--app-success-border)] bg-[color:var(--app-success-soft)] p-4 lg:max-w-sm">
            <LockKeyhole
              className="mt-0.5 size-5 shrink-0 text-[color:var(--app-teal)]"
              aria-hidden="true"
            />
            <p className="text-xs leading-5 text-[color:var(--app-fg)]">
              Originais ficam somente nesta seleção e na requisição ativa. Após
              resposta, referências locais são liberadas.
            </p>
          </div>
        </div>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <section className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-gold)]">
                <CalendarDays className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-black text-[color:var(--app-fg)]">
                  Competência
                </h2>
                <p className="mt-1 text-sm text-[color:var(--app-muted)]">
                  Mês que será validado e publicado.
                </p>
              </div>
            </div>
            <label
              htmlFor="unimed-import-competency"
              className="mt-5 block text-sm font-bold text-[color:var(--app-fg)]"
            >
              Mês e ano
              <span className="ml-1 text-[color:var(--app-coral)]">*</span>
            </label>
            <input
              id="unimed-import-competency"
              type="month"
              min="2020-01"
              max="2100-12"
              value={competency}
              disabled={isBusy}
              onChange={(event) => {
                setCompetency(event.target.value);
                if (state.status === "error") {
                  setState({ status: "idle", progress: 0 });
                }
                if (payrollLoanState.status === "error") {
                  setPayrollLoanState({ status: "idle", progress: 0 });
                }
              }}
              className="mt-2 min-h-11 w-full max-w-xs rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 py-2.5 text-sm font-bold text-[color:var(--app-fg)] focus:border-[color:var(--app-teal)] disabled:opacity-50"
            />
          </section>

          <section className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-6">
            <div className="mb-5">
              <h2 className="text-lg font-black text-[color:var(--app-fg)]">
                Arquivos de origem
              </h2>
              <p className="mt-1 text-sm text-[color:var(--app-muted)]">
                Importe uma ou mais fontes, em qualquer combinação. Máximo de 50
                CSVs, 10 MB por arquivo e 20 MB no conjunto.
              </p>
              <p className="mt-2 text-xs font-semibold text-[color:var(--app-gold)]">
                Atenção: os dois conjuntos usam os mesmos nomes de lojas.
                Confira os cabeçalhos antes de selecionar.
              </p>
            </div>
            <div
              className={`grid gap-4 lg:grid-cols-2 ${
                isBusy ? "pointer-events-none opacity-60" : ""
              }`}
            >
              <FileGroup
                id="unimed-beneficiary-files"
                title="Beneficiários"
                description="Cadastro: deve conter CODIGO, NOME, DATA DE NASCIMENTO, DATA DE INCLUSAO e CNPJ."
                accept=".csv,text/csv"
                multiple
                files={beneficiaryFiles}
                inputRef={beneficiaryInputRef}
                onFiles={(files) =>
                  setBeneficiaryFiles((current) => mergeFiles(current, files))
                }
                onRemove={(key) =>
                  setBeneficiaryFiles((current) =>
                    current.filter((file) => fileKey(file) !== key),
                  )
                }
                icon={UsersRound}
              />
              <FileGroup
                id="unimed-invoice-files"
                title="Faturas"
                description="Coparticipação: deve conter CONTRATO, CARTAO, BENEFICIARIO, ITEM e VALOR."
                accept=".csv,text/csv"
                multiple
                files={invoiceFiles}
                inputRef={invoiceInputRef}
                onFiles={(files) =>
                  setInvoiceFiles((current) => mergeFiles(current, files))
                }
                onRemove={(key) =>
                  setInvoiceFiles((current) =>
                    current.filter((file) => fileKey(file) !== key),
                  )
                }
                icon={FileText}
              />
              <div className="lg:col-span-2">
                <FileGroup
                  id="unimed-address-file"
                  title="Endereços"
                  description="Uma única planilha XLSX com a base de endereços."
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  multiple={false}
                  files={addressFiles}
                  inputRef={addressInputRef}
                  onFiles={(files) => setAddressFiles(files.slice(0, 1))}
                  onRemove={() => setAddressFiles([])}
                  icon={FileSpreadsheet}
                />
              </div>
            </div>
          </section>

          <section className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-6">
            <div className="mb-5">
              <h2 className="text-lg font-black text-[color:var(--app-fg)]">
                Empréstimo Consignado
              </h2>
              <p className="mt-1 text-sm text-[color:var(--app-muted)]">
                Importação independente por competência. Use preferencialmente o
                arquivo bruto, na aba Planilha1. A aba GERAL também é aceita
                quando contém todos os campos essenciais.
              </p>
            </div>
            <div className={isBusy ? "pointer-events-none opacity-60" : ""}>
              <FileGroup
                id="unimed-payroll-loan-file"
                title="Planilha de consignados"
                description="Uma planilha XLSX, com até 10 MB. O vínculo prioriza o CPF e usa a matrícula somente como alternativa segura."
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                multiple={false}
                files={payrollLoanFiles}
                inputRef={payrollLoanInputRef}
                onFiles={(files) => setPayrollLoanFiles(files.slice(0, 1))}
                onRemove={() => setPayrollLoanFiles([])}
                icon={FileSpreadsheet}
              />
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-[color:var(--app-muted)]">
                A importação substitui somente os consignados da competência
                selecionada.
              </p>
              <button
                type="button"
                onClick={() => requestConfirmation("payrollLoan")}
                disabled={isBusy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[color:var(--app-action-blue)] px-4 py-2.5 text-sm font-black text-[color:var(--app-action-text)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-55"
              >
                {isPayrollLoanBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                )}
                Importar consignados
              </button>
            </div>

            {payrollLoanState.status === "uploading" ||
            payrollLoanState.status === "processing" ? (
              <div
                className="mt-4 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 text-sm font-black text-[color:var(--app-fg)]">
                  <Loader2 className="size-4 animate-spin text-[color:var(--app-teal)]" />
                  {payrollLoanState.status === "uploading"
                    ? `${payrollLoanState.progress}% enviado`
                    : "Validando e vinculando contratos"}
                </div>
              </div>
            ) : null}

            {payrollLoanState.status === "error" ? (
              <div
                className="mt-4 rounded-xl border border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)] p-4"
                role="alert"
              >
                <div className="flex items-center gap-2 font-black text-[color:var(--app-fg)]">
                  <AlertCircle className="size-4 text-[color:var(--app-coral)]" />
                  Consignados não importados
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[color:var(--app-muted)]">
                  {payrollLoanState.messages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {payrollLoanState.status === "success" ? (
              <div
                className="mt-4 rounded-xl border border-[color:var(--app-success-border)] bg-[color:var(--app-success-soft)] p-4"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 font-black text-[color:var(--app-fg)]">
                  <CheckCircle2 className="size-5 text-[color:var(--app-lime)]" />
                  {payrollLoanState.result.idempotent
                    ? "Consignados já estavam atualizados"
                    : "Consignados importados"}
                </div>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt className="text-xs text-[color:var(--app-muted)]">
                      Contratos
                    </dt>
                    <dd className="font-black text-[color:var(--app-fg)]">
                      {payrollLoanState.result.summary.payrollLoans.toLocaleString(
                        "pt-BR",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[color:var(--app-muted)]">
                      Total das parcelas
                    </dt>
                    <dd className="font-black text-[color:var(--app-fg)]">
                      {payrollLoanState.result.summary.totalInstallmentAmount.toLocaleString(
                        "pt-BR",
                        { style: "currency", currency: "BRL" },
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[color:var(--app-muted)]">
                      Aba processada
                    </dt>
                    <dd className="font-black text-[color:var(--app-fg)]">
                      {payrollLoanState.result.summary.sourceSheet}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[color:var(--app-muted)]">
                      Vínculos por CPF
                    </dt>
                    <dd className="font-black text-[color:var(--app-fg)]">
                      {payrollLoanState.result.summary.matchedByCpf.toLocaleString(
                        "pt-BR",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[color:var(--app-muted)]">
                      Vínculos por matrícula
                    </dt>
                    <dd className="font-black text-[color:var(--app-fg)]">
                      {payrollLoanState.result.summary.matchedByRegistration.toLocaleString(
                        "pt-BR",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[color:var(--app-muted)]">
                      Sem vínculo
                    </dt>
                    <dd className="font-black text-[color:var(--app-fg)]">
                      {payrollLoanState.result.summary.unmatched.toLocaleString(
                        "pt-BR",
                      )}
                    </dd>
                  </div>
                </dl>
                {payrollLoanState.result.summary.warnings > 0 ? (
                  <p className="mt-3 text-xs font-bold text-[color:var(--app-gold)]">
                    {payrollLoanState.result.summary.warnings.toLocaleString(
                      "pt-BR",
                    )}{" "}
                    alerta(s) de validação.
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-32">
          <section className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)]">
            <h2 className="font-black text-[color:var(--app-fg)]">
              Resumo da seleção
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--app-muted)]">Competência</dt>
                <dd className="font-black text-[color:var(--app-fg)]">
                  {selectedMonthLabel(competency)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--app-muted)]">
                  CSVs beneficiários
                </dt>
                <dd className="font-black tabular-nums text-[color:var(--app-fg)]">
                  {beneficiaryFiles.length}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--app-muted)]">CSVs faturas</dt>
                <dd className="font-black tabular-nums text-[color:var(--app-fg)]">
                  {invoiceFiles.length}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--app-muted)]">XLSX endereço</dt>
                <dd className="font-black tabular-nums text-[color:var(--app-fg)]">
                  {addressFiles.length}
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-[color:var(--app-border)] pt-3">
                <dt className="text-[color:var(--app-muted)]">Tamanho total</dt>
                <dd className="font-black tabular-nums text-[color:var(--app-fg)]">
                  {bytesLabel(baseBytes)}
                </dd>
              </div>
            </dl>

            <div className="mt-5 grid gap-3">
              <button
                type="button"
                onClick={() => requestConfirmation("base")}
                disabled={isBusy}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[color:var(--app-action-blue)] px-4 py-3 text-sm font-black text-[color:var(--app-action-text)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-55"
              >
                {isBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                )}
                Importar fontes selecionadas
              </button>
              <button
                type="button"
                onClick={reset}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2.5 text-sm font-black text-[color:var(--app-fg)]"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Limpar
              </button>
            </div>
          </section>

          {state.status === "uploading" || state.status === "processing" ? (
            <section
              className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)]"
              aria-live="polite"
            >
              <div className="flex items-center gap-3">
                <Loader2
                  className="size-5 animate-spin text-[color:var(--app-teal)]"
                  aria-hidden="true"
                />
                <div>
                  <h2 className="text-sm font-black text-[color:var(--app-fg)]">
                    {state.status === "uploading"
                      ? "Enviando arquivos"
                      : "Validando e conciliando"}
                  </h2>
                  <p className="mt-1 text-xs text-[color:var(--app-muted)]">
                    {state.status === "uploading"
                      ? `${state.progress}% enviado`
                      : "Publicação transacional em andamento."}
                  </p>
                </div>
              </div>
              <div
                className="mt-4 h-2 overflow-hidden rounded-full bg-[color:var(--app-surface-strong)]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={state.progress}
              >
                <div
                  className={`h-full rounded-full bg-[color:var(--app-teal)] transition-[width] ${
                    state.status === "processing" ? "animate-pulse" : ""
                  }`}
                  style={{ width: `${state.progress}%` }}
                />
              </div>
            </section>
          ) : null}

          {state.status === "error" ? (
            <section
              className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)] p-5"
              role="alert"
            >
              <AlertCircle
                className="size-6 text-[color:var(--app-coral)]"
                aria-hidden="true"
              />
              <h2 className="mt-3 font-black text-[color:var(--app-fg)]">
                Importação não publicada
              </h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-5 text-[color:var(--app-muted)]">
                {state.messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>

      {state.status === "success" ? (
        <section
          className="rounded-[var(--app-radius-lg)] border border-[color:var(--app-success-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)] sm:p-6"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2
              className="size-8 shrink-0 text-[color:var(--app-lime)]"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-xl font-black text-[color:var(--app-fg)]">
                {state.result.idempotent
                  ? "Competência já estava publicada"
                  : state.result.ready
                    ? "Competência pronta para uso"
                    : "Fontes importadas com sucesso"}
              </h2>
              <p className="mt-1 text-sm text-[color:var(--app-muted)]">
                {state.result.ready
                  ? "A competência contém todas as fontes necessárias."
                  : "A competência foi preservada como incompleta e ainda não substitui a base ativa."}{" "}
                Arquivos originais liberados da memória do formulário.
              </p>
            </div>
          </div>
          {!state.result.ready && state.result.missingSources.length > 0 ? (
            <div className="mt-4 rounded-xl border border-[color:var(--app-warning-border)] bg-[color:var(--app-warning-soft)] p-4 text-sm text-[color:var(--app-muted)]">
              <div className="font-black text-[color:var(--app-fg)]">
                Fontes ainda necessárias
              </div>
              <p className="mt-1">
                {state.result.missingSources.join(", ")}. Importe cada fonte
                quando estiver disponível; os dados já enviados foram mantidos.
              </p>
            </div>
          ) : null}
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryMetric
              label="beneficiários"
              value={state.result.summary.beneficiaries}
            />
            <SummaryMetric
              label="itens de fatura"
              value={state.result.summary.invoiceItems}
            />
            <SummaryMetric
              label="endereços"
              value={state.result.summary.addresses}
            />
            <SummaryMetric
              label="lojas"
              value={state.result.summary.branches}
            />
            <SummaryMetric
              label="linhas ignoradas"
              value={state.result.summary.skippedRows}
            />
          </div>
          <div className="mt-4 rounded-xl border border-[color:var(--app-warning-border)] bg-[color:var(--app-warning-soft)] p-4">
            <div className="flex items-center gap-2 font-black text-[color:var(--app-fg)]">
              <Archive className="size-4" aria-hidden="true" />
              Alertas de conciliação
            </div>
            <ul className="mt-2 grid gap-1 text-sm text-[color:var(--app-muted)] sm:grid-cols-3">
              <li>
                Faturas sem vínculo:{" "}
                {state.result.summary.warnings.unmatchedInvoiceItems}
              </li>
              <li>
                Dependentes sem vínculo:{" "}
                {state.result.summary.warnings.unmatchedDependents}
              </li>
              <li>
                Planos ambíguos:{" "}
                {state.result.summary.warnings.ambiguousPlanCodes}
              </li>
            </ul>
            {(state.result.summary.warningDetails?.unmatchedInvoiceItems
              .length ?? 0) > 0 ? (
              <details className="mt-3 text-sm text-[color:var(--app-muted)]">
                <summary className="cursor-pointer font-bold text-[color:var(--app-fg)]">
                  Ver faturas sem vínculo
                </summary>
                <p className="mt-2">
                  Estes itens possuem CPF na fatura, mas o CPF não existe na
                  base de beneficiários. O sistema não força associação por nome
                  ou matrícula para evitar vínculo incorreto.
                </p>
                <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
                  {state.result.summary.warningDetails?.unmatchedInvoiceItems.map(
                    (item, index) => (
                      <li
                        key={`${item.sourceKey}:${item.branchCode}:${item.category}:${item.itemDescription}:${index}`}
                      >
                        {item.sourceKey} · {item.branchCode} ·{" "}
                        {item.beneficiaryName} · {item.itemDescription}
                      </li>
                    ),
                  )}
                </ul>
              </details>
            ) : null}
            {(state.result.summary.warningDetails?.unmatchedDependents.length ??
              0) > 0 ? (
              <details className="mt-3 text-sm text-[color:var(--app-muted)]">
                <summary className="cursor-pointer font-bold text-[color:var(--app-fg)]">
                  Ver dependentes sem titular seguro
                </summary>
                <ul className="mt-2 space-y-1">
                  {state.result.summary.warningDetails?.unmatchedDependents.map(
                    (item, index) => (
                      <li key={`${item.sourceKey}:${item.branchCode}:${index}`}>
                        {item.branchCode} · {item.fullName} · sem referência de
                        titular na fatura
                      </li>
                    ),
                  )}
                </ul>
              </details>
            ) : null}
            {(state.result.summary.warningDetails?.ambiguousPlanCodes.length ??
              0) > 0 ? (
              <details className="mt-3 text-sm text-[color:var(--app-muted)]">
                <summary className="cursor-pointer font-bold text-[color:var(--app-fg)]">
                  Ver planos realmente ambíguos
                </summary>
                <ul className="mt-2 space-y-1">
                  {state.result.summary.warningDetails?.ambiguousPlanCodes.map(
                    (item, index) => (
                      <li
                        key={`${item.sourceKey}:${item.branchCode}:${item.planCodes.join("-")}:${index}`}
                      >
                        {item.branchCode} · {item.fullName} ·{" "}
                        {item.planCodes.join(" / ")}
                      </li>
                    ),
                  )}
                </ul>
              </details>
            ) : null}
          </div>
          <div className="mt-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 text-sm text-[color:var(--app-muted)]">
            <div className="font-black text-[color:var(--app-fg)]">
              Banco de endereços complementar
            </div>
            <p className="mt-1">
              {state.result.summary.information.addressOnlyRows} registros
              existem somente no banco de endereços e foram ignorados. Eles não
              criam plano, cobrança ou beneficiário. O CPF faz a correlação
              prioritária; após o vínculo, a matrícula do banco de endereços é
              usada para facilitar a pesquisa do colaborador.
            </p>
          </div>
        </section>
      ) : null}

      <AlertDialog
        open={confirmationTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmationTarget(null);
        }}
      >
        <AlertDialogContent className="border-[color:var(--app-border)] bg-[color:var(--app-card)] text-[color:var(--app-fg)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[color:var(--app-fg)]">
              {confirmationTarget === "payrollLoan"
                ? "Importar empréstimos consignados"
                : "Importar fontes selecionadas"}{" "}
              em {selectedMonthLabel(competency)}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[color:var(--app-muted)]">
              {confirmationTarget === "payrollLoan"
                ? "Os contratos da competência serão substituídos somente após a validação completa da planilha. As demais fontes não serão alteradas."
                : "Somente as fontes indicadas abaixo serão substituídas. Se a competência ainda estiver incompleta, ela será preservada sem substituir a base ativa."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 text-sm">
            <div>
              <dt className="text-xs text-[color:var(--app-subtle)]">
                Arquivos
              </dt>
              <dd className="mt-1 font-black text-[color:var(--app-fg)]">
                {confirmationTarget === "payrollLoan"
                  ? payrollLoanFiles.length
                  : baseFiles.length}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[color:var(--app-subtle)]">
                Tamanho
              </dt>
              <dd className="mt-1 font-black text-[color:var(--app-fg)]">
                {bytesLabel(
                  confirmationTarget === "payrollLoan"
                    ? payrollLoanBytes
                    : baseBytes,
                )}
              </dd>
            </div>
          </dl>
          <div className="rounded-xl border border-[color:var(--app-warning-border)] bg-[color:var(--app-warning-soft)] p-4 text-sm">
            <div className="font-black text-[color:var(--app-fg)]">
              Fontes que serão substituídas
            </div>
            <p className="mt-1 text-[color:var(--app-muted)]">
              {confirmationTarget === "payrollLoan"
                ? "Empréstimo Consignado"
                : selectedBaseSources.join(", ")}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-10 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-surface)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)]">
              Revisar arquivos
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmationTarget === "payrollLoan") {
                  publishPayrollLoan();
                } else {
                  publishBase();
                }
              }}
              className="min-h-10 rounded-xl bg-[color:var(--app-action-blue)] px-4 py-2 text-sm font-black text-[color:var(--app-action-text)]"
            >
              Confirmar importação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
