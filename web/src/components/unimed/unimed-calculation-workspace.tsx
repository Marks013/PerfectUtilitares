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
  UnimedBeneficiary,
  UnimedPricingContext,
} from "./unimed-beneficiary-search";
import { ResultMetric } from "./unimed-calculation-fields";
import { UnimedCalculationIdentificationSection } from "./unimed-calculation-identification-section";
import { UnimedCalculationMovementSection } from "./unimed-calculation-movement-section";
import { UnimedCalculationValuesSection } from "./unimed-calculation-values-section";
import type {
  DocumentJobResponse,
  UnimedCalculationApiResponse,
  UnimedCalculationRequest,
} from "./unimed-calculation-types";
import {
  MAX_DEPENDENTS,
  dateInput,
  defaultMoney,
  formatCompetencyResult,
  formatCpf,
  formatMoneyResult,
  pricingIssue,
  readApiError,
  validateForm,
  waitForDocumentPoll,
} from "./unimed-calculation-utils";
import {
  UnimedPrintSummary,
} from "./unimed-print-summary";
import { UnimedNoticeToast } from "./unimed-notice-toast";
import type {
  UnimedExclusionReasonOption
} from "./unimed-calculation-workspace-model";
export * from "./unimed-calculation-workspace-model";
import { UnimedCalculationWorkspaceView } from "./unimed-calculation-workspace-view";
import { useUnimedCalculationState } from "./use-unimed-calculation-state";


export function useUnimedCalculationWorkspaceController({
  reasons = DEFAULT_UNIMED_EXCLUSION_REASONS,
}: {
  reasons?: readonly UnimedExclusionReasonOption[];
}) {
  const { formId, form, setForm, errors, setErrors, result, setResult, payrollLoans, setPayrollLoans, includePayrollLoans, apiError, setApiError, isCalculating, setIsCalculating, selectedBeneficiary, setSelectedBeneficiary, dataCompetency, setDataCompetency, emailDialogOpen, setEmailDialogOpen, emailConfirmed, setEmailConfirmed, emailError, setEmailError, isSendingEmail, setIsSendingEmail, documentError, setDocumentError, generatedDocument, setGeneratedDocument, isGeneratingDocument, setIsGeneratingDocument, documentProgress, setDocumentProgress, isRefreshingPricing, setIsRefreshingPricing, pricingWarnings, setPricingWarnings, notice, setNotice, calculationRequestSequence, calculationAbortController, documentRequestSequence, documentAbortController, generatedDocumentUrl, pricingRequestSequence, pricingAbortController, lastAutomaticCalculationFingerprint, lastReminderFingerprint, emailRequest, selectedReason, documentRequired, documentReady, automaticCalculationFingerprint, updatePayrollLoansPrintPreference, invalidateDocument, invalidateCalculation, invalidatePricingRefresh, updateForm, updateHolder, updateDependent, blurMoney, blurDependentMoney, resetWorkspace } = useUnimedCalculationState({ reasons });

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
  }, [automaticCalculationFingerprint, isRefreshingPricing, lastAutomaticCalculationFingerprint]);

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

    return { AlertCircle, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, ArrowRight, Building2, Calculator, Check, CircleDollarSign, FileText, Loader2, Mail, Printer, ResultMetric, RotateCcw, UnimedCalculationIdentificationSection, UnimedCalculationMovementSection, UnimedCalculationValuesSection, UnimedNoticeToast, UnimedPrintSummary, apiError, blurDependentMoney, blurMoney, calculate, clearSelectedBeneficiary, dataCompetency, documentError, documentProgress, documentReady, documentRequired, emailConfirmed, emailDialogOpen, emailError, errors, form, formId, formatCompetencyResult, formatMoneyResult, generateDocument, includePayrollLoans, isCalculating, isGeneratingDocument, isRefreshingPricing, isSendingEmail, notice, openGeneratedDocument, payrollLoans, pricingWarnings, reasons, resetWorkspace, result, selectBeneficiary, selectedBeneficiary, selectedReason, sendEmail, setEmailDialogOpen, setNotice, updateDependent, updateExclusionDate, updateForm, updateHolder, updatePayrollLoansPrintPreference };
}

export function UnimedCalculationWorkspace(props: Parameters<typeof useUnimedCalculationWorkspaceController>[0]) {
  return <UnimedCalculationWorkspaceView model={useUnimedCalculationWorkspaceController(props)} />;
}
