"use client";

import {
  CalendarRange,
  CircleDollarSign,
  Clock3,
  FileCog,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  UsersRound,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  errorMessagesFromBody,
  parsePtBrDecimal,
} from "@/components/unimed/form-utils";
import { DEFAULT_UNIMED_EMAIL_SUBJECT } from "@/lib/unimed/defaults";
import { UnimedNoticeToast } from "./unimed-notice-toast";
import {
  type AgeBracketForm,
  type PlanPriceForm,
  type AddonPriceForm,
  type ReasonForm,
  type ConfigurationForm,
  type ConfigurationResponse,
  type PriceHistoryPeriod,
  type SaveResponse,
  type Feedback,
  type FieldIssue,
  type FieldErrors,
  ConfigFieldContext,
  EMPTY_FORM,
  newAgeBracket,
  newPlanPrice,
  newReason,
  newAddonPrice,
  configurationToForm,
  parseRecipients,
  parseInteger,
  validateForm,
  fieldIssuesFromApiBody,
  issuesToErrors,
  FieldLabel,
  TextInput,
  DecimalInput,
  SectionHeading,
  ConfigSection
} from "./unimed-configuration-manager-model";
export * from "./unimed-configuration-manager-model";
import { UnimedConfigurationManagerView } from "./unimed-configuration-manager-view";

export function useUnimedConfigurationManagerController() {
  const [form, setForm] = useState<ConfigurationForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [priceHistory, setPriceHistory] = useState<PriceHistoryPeriod[]>([]);

  const clearFieldError = useCallback((fieldId: string) => {
    setFieldErrors((current) => {
      if (!current[fieldId]) return current;
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  }, []);

  function focusFirstIssue(issue: FieldIssue | undefined) {
    if (!issue) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const field = document.getElementById(issue.fieldId);
        if (!field) return;
        const collapsedSection = field.closest("details");
        if (collapsedSection instanceof HTMLDetailsElement) {
          collapsedSection.open = true;
        }
        field.scrollIntoView({ behavior: "smooth", block: "center" });
        field.focus({ preventScroll: true });
      });
    });
  }

  const loadConfiguration = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/unimed/configuration", {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as
        | ConfigurationResponse
        | { error?: { message?: string; details?: unknown } }
        | null;
      if (!response.ok || !body || !("ageBrackets" in body)) {
        throw new Error(
          errorMessagesFromBody(
            body && "error" in body ? body : null,
            "Não foi possível carregar as configurações.",
          ).join(" "),
        );
      }
      setForm(configurationToForm(body));
      setPriceHistory(body.priceHistory ?? []);
      setFieldErrors({});
    } catch (error) {
      setFeedback({
        type: "error",
        messages: [
          error instanceof Error
            ? error.message
            : "Não foi possível carregar as configurações.",
        ],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfiguration();
  }, [loadConfiguration]);

  const bracketOptions = useMemo(
    () => form.ageBrackets.filter((bracket) => bracket.code.trim().length > 0),
    [form.ageBrackets],
  );

  function updateAge(
    localId: string,
    field: keyof Omit<AgeBracketForm, "localId">,
    value: string,
  ) {
    setForm((current) => {
      const previousCode = current.ageBrackets.find(
        (bracket) => bracket.localId === localId,
      )?.code;
      return {
        ...current,
        ageBrackets: current.ageBrackets.map((bracket) =>
          bracket.localId === localId
            ? { ...bracket, [field]: value }
            : bracket,
        ),
        planPrices:
          field === "code"
            ? current.planPrices.map((price) =>
                price.ageBracketCode === previousCode
                  ? { ...price, ageBracketCode: value }
                  : price,
              )
            : current.planPrices,
      };
    });
    setFeedback(null);
  }

  function updatePlan(
    localId: string,
    field: keyof Omit<PlanPriceForm, "localId">,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      planPrices: current.planPrices.map((price) =>
        price.localId === localId ? { ...price, [field]: value } : price,
      ),
    }));
    setFeedback(null);
  }

  function updateAddon(
    localId: string,
    field: keyof Omit<AddonPriceForm, "localId">,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      addonPrices: current.addonPrices.map((price) =>
        price.localId === localId ? { ...price, [field]: value } : price,
      ),
    }));
    setFeedback(null);
  }

  function updateReason<K extends "label" | "documentKind">(
    localId: string,
    field: K,
    value: ReasonForm[K],
  ) {
    setForm((current) => ({
      ...current,
      reasons: current.reasons.map((reason) =>
        reason.localId === localId ? { ...reason, [field]: value } : reason,
      ),
    }));
    setFeedback(null);
  }

  async function saveConfiguration() {
    const issues = validateForm(form);
    if (issues.length > 0) {
      setFieldErrors(issuesToErrors(issues));
      setFeedback({
        type: "error",
        messages: ["Revise o campo destacado antes de salvar."],
      });
      focusFirstIssue(issues[0]);
      return;
    }

    setSaving(true);
    setFeedback(null);
    setFieldErrors({});
    const payload = {
      validFrom: form.validFrom,
      billingClosure: form.billingClosure,
      annualAdjustmentPercent: parsePtBrDecimal(form.annualAdjustmentPercent),
      differencePercent: parsePtBrDecimal(form.differencePercent),
      ageBrackets: form.ageBrackets.map((bracket) => ({
        code: bracket.code.trim(),
        label: bracket.label.trim(),
        minAge: parseInteger(bracket.minAge),
        maxAge: bracket.maxAge.trim() ? parseInteger(bracket.maxAge) : null,
        sortOrder: parseInteger(bracket.sortOrder),
      })),
      planPrices: form.planPrices.map((price) => ({
        planCode: price.planCode.trim(),
        ageBracketCode: price.ageBracketCode,
        companyAmount: parsePtBrDecimal(price.companyAmount),
        employeeAmount: parsePtBrDecimal(price.employeeAmount),
      })),
      addonPrices: form.addonPrices.map((price) => ({
        code: price.code.trim(),
        label: price.label.trim(),
        amount: parsePtBrDecimal(price.amount),
      })),
      reasons: form.reasons.map((reason) => ({
        code: parseInteger(reason.code),
        label: reason.label.trim(),
        documentKind: reason.documentKind,
      })),
      email: {
        enabled: form.emailEnabled,
        recipients: parseRecipients(form.emailRecipients),
        subjectTemplate: DEFAULT_UNIMED_EMAIL_SUBJECT,
      },
    };

    try {
      const response = await fetch("/api/unimed/configuration", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as
        | SaveResponse
        | { error?: { message?: string; details?: unknown } }
        | null;
      if (!response.ok || !body || !("validFrom" in body)) {
        const issues = fieldIssuesFromApiBody(body, form);
        if (issues.length > 0) {
          setFieldErrors(issuesToErrors(issues));
          focusFirstIssue(issues[0]);
        }
        setFeedback({
          type: "error",
          messages:
            issues.length > 0
              ? ["Revise o campo destacado antes de salvar."]
              : errorMessagesFromBody(
                  body && "error" in body ? body : null,
                  "Não foi possível salvar as configurações.",
                ),
        });
        return;
      }
      setFeedback({
        type: "success",
        message: `Configuração com vigência em ${new Intl.DateTimeFormat(
          "pt-BR",
          { timeZone: "UTC" },
        ).format(new Date(`${body.validFrom}T00:00:00.000Z`))} salva.`,
      });
      await loadConfiguration();
      setFeedback({
        type: "success",
        message: "Configurações salvas e recarregadas.",
      });
      setFieldErrors({});
    } catch {
      setFeedback({
        type: "error",
        messages: ["Falha de conexão ao salvar as configurações."],
      });
    } finally {
      setSaving(false);
    }
  }



    return { loading, CalendarRange, CircleDollarSign, Clock3, ConfigFieldContext, ConfigSection, DEFAULT_UNIMED_EMAIL_SUBJECT, DecimalInput, FieldLabel, FileCog, Loader2, Mail, Plus, RefreshCw, Save, SectionHeading, Settings2, TextInput, Trash2, UnimedNoticeToast, UsersRound, bracketOptions, clearFieldError, feedback, fieldErrors, form, loadConfiguration, newAddonPrice, newAgeBracket, newPlanPrice, newReason, priceHistory, saveConfiguration, saving, setFeedback, setForm, updateAddon, updateAge, updatePlan, updateReason };
}

export function UnimedConfigurationManager() {
  return <UnimedConfigurationManagerView model={useUnimedConfigurationManagerController()} />;
}
