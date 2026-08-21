"use client";

import {
  AlertCircle,
  ArrowRight,
  Building2,
  Calculator,
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
} from "./unimed-calculation-types";
import {
  AUTOMATIC_CALCULATION_DEBOUNCE_MS,
  buildUnimedCalculationRequest,
  mergeOfficialCalculationInput,
} from "./unimed-calculation-state-model";
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
import type {
  UnimedExclusionReasonOption
} from "./unimed-calculation-workspace-model";
export * from "./unimed-calculation-workspace-model";
import { UnimedCalculationWorkspaceView } from "./unimed-calculation-workspace-view";
import { useUnimedCalculationState } from "./use-unimed-calculation-state";

function reserveDocumentPreviewWindow() {
  let previewWindow: Window | null = null;
  try {
    previewWindow = window.open("about:blank", "_blank");
    if (!previewWindow) return null;

    previewWindow.opener = null;
    previewWindow.document.title = "Preparando documento";
    previewWindow.document.body.style.cssText =
      "margin:0;min-height:100vh;display:grid;place-items:center;background:#111715;color:#f4f7f5;font-family:system-ui,sans-serif";
    const message = previewWindow.document.createElement("p");
    message.textContent = "Seu documento está sendo preparado…";
    message.style.cssText = "font-size:16px;font-weight:700";
    previewWindow.document.body.appendChild(message);
    return previewWindow;
  } catch {
    previewWindow?.close();
    return null;
  }
}

function showDocumentInPreviewWindow(
  previewWindow: Window,
  documentUrl: string,
) {
  previewWindow.document.title = "Documento gerado";
  previewWindow.document.body.style.cssText =
    "margin:0;min-height:100vh;background:#111715";
  const preview = previewWindow.document.createElement("iframe");
  preview.src = documentUrl;
  preview.title = "Documento gerado";
  preview.style.cssText = "display:block;width:100%;height:100vh;border:0";
  previewWindow.document.body.replaceChildren(preview);
}

export function useUnimedCalculationWorkspaceController({
  reasons = DEFAULT_UNIMED_EXCLUSION_REASONS,
}: {
  reasons?: readonly UnimedExclusionReasonOption[];
}) {
  const { formId, form, setForm, errors, setErrors, result, setResult, payrollLoans, setPayrollLoans, includePayrollLoans, apiError, setApiError, isCalculating, setIsCalculating, selectedBeneficiary, setSelectedBeneficiary, dataCompetency, setDataCompetency, emailDialogOpen, setEmailDialogOpen, emailConfirmed, setEmailConfirmed, emailError, setEmailError, isSendingEmail, setIsSendingEmail, documentError, setDocumentError, documentNotice, setDocumentNotice, generatedDocument, setGeneratedDocument, isGeneratingDocument, setIsGeneratingDocument, documentProgress, setDocumentProgress, calculationRequestSequence, calculationAbortController, documentRequestSequence, documentAbortController, documentGenerationLock, generatedDocumentUrl, lastAutomaticCalculationFingerprint, emailRequest, selectedReason, documentRequired, documentReady, automaticCalculationFingerprint, updatePayrollLoansPrintPreference, invalidateDocument, invalidateCalculation, updateForm, updateHolder, updateDependent, blurMoney, blurDependentMoney, resetWorkspace } = useUnimedCalculationState({ reasons });

  function selectBeneficiary(
    beneficiary: UnimedBeneficiary,
    pricingContext: UnimedPricingContext,
    effectiveReferenceDate = form.exclusionDate,
  ) {
    invalidateCalculation();
    const nextWarnings: string[] = [];
    const previousSelection = new Map(
      form.dependents.map((dependent) => [
        dependent.name.trim().toLocaleUpperCase("pt-BR"),
        dependent.selected,
      ]),
    );
    const sameHolder = Boolean(
      selectedBeneficiary &&
        ((selectedBeneficiary.cpf &&
          selectedBeneficiary.cpf === beneficiary.cpf) ||
          (selectedBeneficiary.registration &&
            selectedBeneficiary.registration === beneficiary.registration)),
    );
    const pricingMatchesExclusionDate =
      Boolean(effectiveReferenceDate) &&
      pricingContext.referenceDate === effectiveReferenceDate;

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
          source: "OFFICIAL" as const,
          selected: sameHolder
            ? (previousSelection.get(
                item.fullName.trim().toLocaleUpperCase("pt-BR"),
              ) ?? true)
            : true,
          name: item.fullName,
          cpf: "",
          birthDate: item.birthDate,
          inclusionDate:
            dateInput(item.inclusionDate) || dateInput(beneficiary.inclusionDate),
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
    setApiError(nextWarnings.length > 0 ? nextWarnings.join(" ") : null);
    setEmailConfirmed(false);
    setEmailError(null);
    invalidateDocument();
  }

  function updateExclusionDate(value: string) {
    updateForm("exclusionDate", value);
  }

  function clearSelectedBeneficiary() {
    invalidateCalculation();
    setSelectedBeneficiary(null);
    setDataCompetency(null);
    setEmailConfirmed(false);
    setEmailError(null);
    invalidateDocument();
  }

  async function runCalculation(options?: {
    formElement?: HTMLFormElement;
    silent?: boolean;
  }) {
    const allErrors = validateForm(form);
    const nextErrors = Object.fromEntries(
      Object.entries(allErrors).filter(([field]) =>
        ["reasonCode", "exclusionDate", "planEnrollmentDate"].includes(field) ||
        field.startsWith("dependent-"),
      ),
    ) as typeof allErrors;
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
      if (!options?.silent) {
        setApiError(
          Object.values(nextErrors).find(
            (message): message is string => typeof message === "string",
          ) ?? "Revise os dados informados.",
        );
      }
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

    const input = buildUnimedCalculationRequest(form, selectedBeneficiary.id);

    calculationAbortController.current?.abort();
    const requestSequence = ++calculationRequestSequence.current;
    const abortController = new AbortController();
    calculationAbortController.current = abortController;
    setIsCalculating(true);
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
      setForm((current) =>
        mergeOfficialCalculationInput(current, body.officialInput),
      );
      setResult(calculation);
      setPayrollLoans(nextPayrollLoans);
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
      silent: true,
    }),
  );

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    lastAutomaticCalculationFingerprint.current =
      automaticCalculationFingerprint;
    await runCalculation({
      formElement: event.currentTarget,
    });
  }

  useEffect(() => {
    if (!automaticCalculationFingerprint) return;
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
    }, AUTOMATIC_CALCULATION_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
    // The normalized fingerprint contains every calculation input.
  }, [automaticCalculationFingerprint, lastAutomaticCalculationFingerprint]);

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
      isGeneratingDocument ||
      documentGenerationLock.current
    ) {
      return false;
    }

    const manualDependents =
      selectedReason.documentKind === "RN561"
        ? form.dependents
            .filter(
              (dependent) =>
                dependent.selected && dependent.source === "MANUAL",
            )
            .map((dependent) => ({
              clientId: dependent.id,
              fullName: dependent.name.trim(),
              cpf: dependent.cpf?.replace(/\D/g, "") ?? "",
            }))
        : [];
    const invalidManualDependent = manualDependents.find(
      (dependent) => dependent.cpf.length !== 11,
    );
    if (invalidManualDependent) {
      setErrors((current) => ({
        ...current,
        [`dependent-${invalidManualDependent.clientId}`]:
          "Informe o CPF do dependente com 11 dígitos para gerar o documento.",
      }));
      setDocumentError(
        `Informe o CPF de ${invalidManualDependent.fullName || "dependente manual"} para gerar o documento.`,
      );
      return false;
    }

    documentGenerationLock.current = true;
    setDocumentNotice(null);
    const previewWindow = reserveDocumentPreviewWindow();
    let previewOpened = false;

    const beneficiaryId = selectedBeneficiary.id;
    const requestSequence = ++documentRequestSequence.current;
    documentAbortController.current?.abort();
    const abortController = new AbortController();
    documentAbortController.current = abortController;
    setIsGeneratingDocument(true);
    setDocumentProgress(1);
    setDocumentError(null);
    setGeneratedDocument(null);

    try {
      const response = await fetch("/api/unimed/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beneficiaryId,
          dependentIds: form.dependents
            .filter(
              (dependent) =>
                dependent.selected && dependent.source === "OFFICIAL",
            )
            .map((dependent) => dependent.id),
          manualDependents,
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
      setDocumentProgress(Math.max(1, queued.job.progress));

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
          setDocumentProgress((current) => Math.max(current, 96));
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
          if (previewWindow && !previewWindow.closed) {
            try {
              showDocumentInPreviewWindow(previewWindow, objectUrl);
              previewOpened = true;
            } catch {
              previewWindow.close();
              setDocumentNotice(
                "Documento pronto. A abertura automática foi bloqueada; use o botão abaixo para abrir.",
              );
            }
          } else {
            setDocumentNotice(
              "Documento pronto. A abertura automática foi bloqueada; use o botão abaixo para abrir.",
            );
          }
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
        const serverProgress = Math.max(
          1,
          Math.min(99, Number(pending?.job?.progress) || 0),
        );
        setDocumentProgress((current) => Math.max(current, serverProgress));
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
      if (!previewOpened && previewWindow && !previewWindow.closed) {
        previewWindow.close();
      }
      if (documentRequestSequence.current === requestSequence) {
        documentGenerationLock.current = false;
        documentAbortController.current = null;
        setIsGeneratingDocument(false);
      }
    }
  }

  function openGeneratedDocument() {
    if (!generatedDocument?.previewUrl) return;
    setDocumentNotice(null);
    const link = document.createElement("a");
    link.href = generatedDocument.previewUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

    return { AlertCircle, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, ArrowRight, Building2, Calculator, CircleDollarSign, FileText, Loader2, Mail, Printer, ResultMetric, RotateCcw, UnimedCalculationIdentificationSection, UnimedCalculationMovementSection, UnimedCalculationValuesSection, UnimedPrintSummary, apiError, blurDependentMoney, blurMoney, calculate, clearSelectedBeneficiary, dataCompetency, documentError, documentNotice, documentProgress, documentReady, documentRequired, emailConfirmed, emailDialogOpen, emailError, errors, form, formId, formatCompetencyResult, formatMoneyResult, generateDocument, includePayrollLoans, isCalculating, isGeneratingDocument, isSendingEmail, openGeneratedDocument, payrollLoans, reasons, resetWorkspace, result, selectBeneficiary, selectedBeneficiary, selectedReason, sendEmail, setEmailDialogOpen, updateDependent, updateExclusionDate, updateForm, updateHolder, updatePayrollLoansPrintPreference };
}

export function UnimedCalculationWorkspace(props: Parameters<typeof useUnimedCalculationWorkspaceController>[0]) {
  return <UnimedCalculationWorkspaceView model={useUnimedCalculationWorkspaceController(props)} />;
}
