"use client";

import {
  AlertCircle,
  Archive,
  CalendarDays,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  FileText,
  Loader2,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
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
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  type ImportResponse,
  type PayrollLoanResponse,
  type ImportState,
  type PayrollLoanState,
  type ConfirmationTarget,
  fileKey,
  mergeFiles,
  selectedMonthLabel,
  FileGroup,
  SummaryMetric
} from "./unimed-import-workspace-model";
export * from "./unimed-import-workspace-model";
import { UnimedImportWorkspaceView } from "./unimed-import-workspace-view";

export function useUnimedImportWorkspaceController() {
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
    beneficiaryFiles.forEach((file) => {
      data.append("beneficiaryFiles", file, file.name);
    });
    invoiceFiles.forEach((file) => {
      data.append("invoiceFiles", file, file.name);
    });
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

    return { AlertCircle, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Archive, CalendarDays, CheckCircle2, Database, FileGroup, FileSpreadsheet, FileText, Loader2, LockKeyhole, RotateCcw, ShieldCheck, SummaryMetric, UsersRound, addressFiles, addressInputRef, baseBytes, baseFiles, beneficiaryFiles, beneficiaryInputRef, bytesLabel, competency, confirmationTarget, fileKey, invoiceFiles, invoiceInputRef, isBusy, isPayrollLoanBusy, mergeFiles, payrollLoanBytes, payrollLoanFiles, payrollLoanInputRef, payrollLoanState, publishBase, publishPayrollLoan, requestConfirmation, reset, selectedBaseSources, selectedMonthLabel, setAddressFiles, setBeneficiaryFiles, setCompetency, setConfirmationTarget, setInvoiceFiles, setPayrollLoanFiles, setPayrollLoanState, setState, state };
}

export function UnimedImportWorkspace() {
  return <UnimedImportWorkspaceView model={useUnimedImportWorkspaceController()} />;
}
