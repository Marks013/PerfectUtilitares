"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { DEFAULT_UNIMED_EXCLUSION_REASONS } from "@/lib/unimed/defaults";
import type { UnimedCalculationResult } from "@/lib/unimed/types";
import type {
  UnimedBeneficiary,
  UnimedPricingContext,
} from "./unimed-beneficiary-search";
import type {
  DependentValues,
  FieldErrors,
  FormValues,
  MoneyField,
  GeneratedDocument,
} from "./unimed-calculation-types";
import {
  INITIAL_FORM,
  PAYROLL_LOANS_PRINT_STORAGE_KEY,
  formatMoneyInput,
} from "./unimed-calculation-utils";
import type {
  UnimedPayrollLoanSummary,
} from "./unimed-print-summary";
import type {
  UnimedExclusionReasonOption
} from "./unimed-calculation-workspace-model";
export * from "./unimed-calculation-workspace-model";

export function useUnimedCalculationState({
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
  const calculationRequestSequence = useRef(0);
  const calculationAbortController = useRef<AbortController | null>(null);
  const documentRequestSequence = useRef(0);
  const documentAbortController = useRef<AbortController | null>(null);
  const generatedDocumentUrl = useRef<string | null>(null);
  const lastAutomaticCalculationFingerprint = useRef<string | null>(null);
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
    if (!selectedBeneficiary || !form.reasonCode || !form.exclusionDate) {
      return null;
    }
    const dependents = form.dependents
      .filter((dependent) => dependent.selected)
      .map((dependent) => ({
        id: dependent.id,
        source: dependent.source,
        name: dependent.name.trim(),
        inclusionDate: dependent.inclusionDate,
        invoicePlanAmount: dependent.invoicePlanAmount,
        addonAmount: dependent.addonAmount,
      }));
    if (form.reasonCode === "1" && dependents.length === 0) return null;

    return JSON.stringify({
      beneficiaryId: selectedBeneficiary.id,
      dependents,
      reasonCode: Number(form.reasonCode),
      exclusionDate: form.exclusionDate,
      planEnrollmentDate: form.planEnrollmentDate,
    });
  }, [
    form.dependents,
    form.exclusionDate,
    form.planEnrollmentDate,
    form.reasonCode,
    selectedBeneficiary,
  ]);

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
      if (generatedDocumentUrl.current) {
        URL.revokeObjectURL(generatedDocumentUrl.current);
      }
    },
    [],
  );

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
      setSelectedBeneficiary(null);
      setDataCompetency(null);
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
    value: DependentValues[keyof Omit<DependentValues, "id">],
  ) {
    invalidateCalculation();
    invalidateDocument();
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
  }
  return { formId, form, setForm, errors, setErrors, result, setResult, payrollLoans, setPayrollLoans, includePayrollLoans, setIncludePayrollLoans, apiError, setApiError, isCalculating, setIsCalculating, selectedBeneficiary, setSelectedBeneficiary, dataCompetency, setDataCompetency, emailDialogOpen, setEmailDialogOpen, emailConfirmed, setEmailConfirmed, emailError, setEmailError, isSendingEmail, setIsSendingEmail, documentError, setDocumentError, generatedDocument, setGeneratedDocument, isGeneratingDocument, setIsGeneratingDocument, documentProgress, setDocumentProgress, calculationRequestSequence, calculationAbortController, documentRequestSequence, documentAbortController, generatedDocumentUrl, lastAutomaticCalculationFingerprint, emailRequest, selectedReason, reasonCode, documentRequired, documentReady, automaticCalculationFingerprint, updatePayrollLoansPrintPreference, invalidateDocument, invalidateCalculation, updateForm, updateHolder, updateDependent, blurMoney, blurDependentMoney, resetWorkspace };
}
