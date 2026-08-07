"use client";

import {
  AlertCircle,
  ArrowRight,
  Building2,
  Calculator,
  Check,
  CircleDollarSign,
  FileText,
  Loader2,
  Mail,
  Printer,
  RotateCcw,
} from "lucide-react";
import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useEffectEvent,
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
import type { UnimedCalculationResult } from "@/lib/unimed/types";
import type {
  UnimedBeneficiary,
  UnimedPricingContext,
} from "./unimed-beneficiary-search";
import { ResultMetric } from "./unimed-calculation-fields";
import { UnimedCalculationIdentificationSection } from "./unimed-calculation-identification-section";
import { UnimedCalculationMovementSection } from "./unimed-calculation-movement-section";
import { UnimedCalculationValuesSection } from "./unimed-calculation-values-section";
import type {
  DependentValues,
  FieldErrors,
  FormValues,
  MoneyField,
  GeneratedDocument,
  DocumentJobResponse,
  UnimedCalculationApiResponse,
  UnimedCalculationRequest,
  UnimedExclusionReasonOption as UnimedExclusionReasonOptionData,
} from "./unimed-calculation-types";
import {
  INITIAL_FORM,
  MAX_DEPENDENTS,
  PAYROLL_LOANS_PRINT_STORAGE_KEY,
  dateInput,
  defaultMoney,
  formatCompetencyResult,
  formatCpf,
  formatMoneyInput,
  formatMoneyResult,
  parseMoney,
  pricingIssue,
  readApiError,
  validateForm,
  waitForDocumentPoll,
} from "./unimed-calculation-utils";
import {
  type UnimedPayrollLoanSummary,
  UnimedPrintSummary,
} from "./unimed-print-summary";
import { type UnimedNotice, UnimedNoticeToast } from "./unimed-notice-toast";

export type UnimedExclusionReasonOption = UnimedExclusionReasonOptionData;

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

  const runAutomaticCalculation = useEffectEvent(() =>
    runCalculation({
      generateRequiredDocument: true,
      silent: true,
    }),
  );

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
      void runAutomaticCalculation();
    }, 450);

    return () => window.clearTimeout(timeout);
    // The normalized fingerprint contains every calculation input.
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
          <UnimedCalculationIdentificationSection
            form={form}
            errors={errors}
            selectedBeneficiary={selectedBeneficiary}
            pricingWarnings={pricingWarnings}
            selectBeneficiary={selectBeneficiary}
            clearSelectedBeneficiary={clearSelectedBeneficiary}
            updateForm={updateForm}
          />

          <UnimedCalculationMovementSection
            form={form}
            errors={errors}
            reasons={reasons}
            updateForm={updateForm}
            updateExclusionDate={updateExclusionDate}
          />

          <UnimedCalculationValuesSection
            form={form}
            errors={errors}
            selectedBeneficiary={selectedBeneficiary}
            updateForm={updateForm}
            updateHolder={updateHolder}
            blurMoney={blurMoney}
            updateDependent={updateDependent}
            blurDependentMoney={blurDependentMoney}
          />
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
                  <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    <ResultMetric
                      label="Estorno ao funcionário"
                      value={formatMoneyResult(result.employeeFullRefund)}
                      emphasis
                    />
                    <ResultMetric
                      label="Estorno à empresa"
                      value={formatMoneyResult(result.companyFullRefund)}
                      emphasis
                    />
                  </dl>
                  <div className="mt-4 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4">
                    <p className="text-xs font-black tracking-wide text-[color:var(--app-muted)] uppercase">
                      Memória do cálculo
                    </p>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-[color:var(--app-muted)]">
                          Proporcional de {formatCompetencyResult(result.currentCompetency)} ({result.refundDays} dias)
                        </dt>
                        <dd className="font-black text-[color:var(--app-fg)]">
                          {formatMoneyResult(result.currentCompetencyRefund)}
                        </dd>
                      </div>
                      {result.cutoffApplied && result.nextCompetency ? (
                        <div className="flex justify-between gap-3">
                          <dt className="text-[color:var(--app-muted)]">
                            Mensalidade de {formatCompetencyResult(result.nextCompetency)} ({result.nextCompetencyDays} dias)
                          </dt>
                          <dd className="font-black text-[color:var(--app-fg)]">
                            {formatMoneyResult(result.nextCompetencyRefund)}
                          </dd>
                        </div>
                      ) : null}
                      <div className="flex justify-between gap-3 border-t border-[color:var(--app-border)] pt-2">
                        <dt className="font-black text-[color:var(--app-fg)]">
                          Total estornado em fatura ({result.totalRefundDays} dias)
                        </dt>
                        <dd className="font-black text-[color:var(--app-fg)]">
                          {formatMoneyResult(result.invoiceRefund)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                    <div className="rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3">
                      <span className="block text-xl font-black text-[color:var(--app-fg)]">
                        {result.totalRefundDays}
                      </span>
                      <span className="text-xs text-[color:var(--app-muted)]">
                        dias devolvidos em fatura
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
                  id: selectedBeneficiary?.id ?? "holder",
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
                  id: dependent.id,
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
