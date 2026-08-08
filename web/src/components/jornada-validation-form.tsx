"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  FileSpreadsheet,
  History,
  Info,
  Loader2,
  RotateCcw,
  TableProperties,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  calcularDuracaoEntrada,
  formatarHorariosEntrada,
} from "@/lib/jornada/input-format";
import {
  AUTO_FORMAT_KEY,
  HISTORY_PAGE_SIZE,
  INTERJORNADA_HELP_TEXT,
  getAutoFormatStorageKey,
  schema,
  type FormValues,
  type ValidationResponse,
  type HistoryRecord,
  historyQueryKey,
  type HistoryItem,
  type PdfPerson,
  getErrorMessage,
  isCombinedResponse,
  joinCodigos,
  sumDurations,
  getCombinedWeeklyHours,
  getCombinedMonthlyHours,
  formatDate,
  getPrimaryMessage,
  getSecondaryMessages,
  isValidPrincipalEightHours,
  groupHistory,
  ResultCard,
  fetchHistory,
  fetchOwnJornadaExceptions,
  createPdfPerson,
  downloadPdf,
  clearOwnHistory,
  deleteSelectedHistory,
  validateBatchSpreadsheet,
  downloadBatchReportPdf
} from "./jornada-validation-form-model";
export * from "./jornada-validation-form-model";
import { JornadaValidationFormView } from "./jornada-validation-form-view";

export function useJornadaValidationFormController({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const hasAccount = userId !== "public";
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [pdfPeopleByKey, setPdfPeopleByKey] = useState<Record<string, PdfPerson[]>>({});
  const [historyPage, setHistoryPage] = useState(1);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [hideInvalidHistory, setHideInvalidHistory] = useState(false);
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchValidarPeriodos, setBatchValidarPeriodos] = useState(true);
  const [batchValidarJornada, setBatchValidarJornada] = useState(true);
  const [batchValidarIntervalos, setBatchValidarIntervalos] = useState(true);
  const [batchUsarHorariosAgrupados, setBatchUsarHorariosAgrupados] =
    useState(false);
  const [batchPdfDetalhado, setBatchPdfDetalhado] = useState(false);
  const [batchPdfError, setBatchPdfError] = useState<string | null>(null);
  const [isBatchPdfExporting, setIsBatchPdfExporting] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      horarios: "",
      segundaJornadaHorarios: "",
      sabadoHorarios: "",
      autoFormatar: true,
      interjornadaAtiva: false,
    },
  });
  const horarios = form.watch("horarios");
  const segundaJornadaHorarios = form.watch("segundaJornadaHorarios");
  const autoFormatar = form.watch("autoFormatar");
  const interjornadaAtiva = form.watch("interjornadaAtiva");
  const duracaoPrincipal = useMemo(
    () => calcularDuracaoEntrada(horarios),
    [horarios],
  );
  const duracaoSegundaJornada = useMemo(
    () => calcularDuracaoEntrada(segundaJornadaHorarios ?? ""),
    [segundaJornadaHorarios],
  );
  const ownExceptionsQuery = useQuery({
    queryKey: ["jornada", "excecoes", "mine"],
    queryFn: fetchOwnJornadaExceptions,
    enabled: hasAccount,
  });
  const hasAuthorizedSaturdayException = (value: string) => {
    const normalized = calcularDuracaoEntrada(value)?.horariosNormalizado;
    return Boolean(
      normalized &&
        (ownExceptionsQuery.data ?? []).some(
          (exception) =>
            exception.active !== false &&
            exception.horariosNormalizado === normalized &&
            exception.sabadoNormalizado,
        ),
    );
  };
  const shouldValidateWithSaturday = (value: string) =>
    isValidPrincipalEightHours(value) || hasAuthorizedSaturdayException(value);
  const canShowSabado =
    !interjornadaAtiva && shouldValidateWithSaturday(horarios);
  const autoFormatStorageKey = getAutoFormatStorageKey(userId);

  useEffect(() => {
    const stored =
      window.localStorage.getItem(autoFormatStorageKey) ??
      window.localStorage.getItem(AUTO_FORMAT_KEY);
    if (stored != null) {
      form.setValue("autoFormatar", stored === "true");
    }
  }, [autoFormatStorageKey, form]);

  useEffect(() => {
    window.localStorage.setItem(autoFormatStorageKey, String(autoFormatar));
  }, [autoFormatStorageKey, autoFormatar]);

  useEffect(() => {
    if (!canShowSabado) {
      form.setValue("sabadoHorarios", "");
    }
  }, [canShowSabado, form]);

  useEffect(() => {
    if (!interjornadaAtiva) {
      form.setValue("segundaJornadaHorarios", "");
    }
  }, [interjornadaAtiva, form]);

  const historicoQuery = useQuery({
    queryKey: historyQueryKey,
    queryFn: fetchHistory,
    enabled: hasAccount,
  });
  const historico = useMemo(
    () => groupHistory(historicoQuery.data ?? []),
    [historicoQuery.data],
  );
  const filteredHistorico = useMemo(
    () =>
      hideInvalidHistory
        ? historico.filter((item) => item.valido)
        : historico,
    [hideInvalidHistory, historico],
  );
  const historyPageCount = Math.max(
    1,
    Math.ceil(filteredHistorico.length / HISTORY_PAGE_SIZE),
  );
  const visibleHistorico = useMemo(
    () =>
      filteredHistorico.slice(
        (historyPage - 1) * HISTORY_PAGE_SIZE,
        historyPage * HISTORY_PAGE_SIZE,
      ),
    [filteredHistorico, historyPage],
  );
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedItemCount = historico.filter((item) =>
    selectedSet.has(item.key),
  ).length;
  const selectedValidCount = historico.filter(
    (item) => item.valido && selectedSet.has(item.key),
  ).length;
  const selectedErrorCount = selectedItemCount - selectedValidCount;
  const selectionMode =
    selectedItemCount === 0
      ? null
      : selectedValidCount === selectedItemCount
      ? "valid"
      : "invalid";
  const bulkSelectionMode =
    selectionMode ??
    (visibleHistorico.length > 0 && visibleHistorico.every((item) => item.valido)
      ? "valid"
      : visibleHistorico.length > 0 &&
        visibleHistorico.every((item) => !item.valido)
      ? "invalid"
      : null);
  const selectedHistoryIds = useMemo(() => {
    const ids = historico
      .filter((item) => selectedSet.has(item.key))
      .flatMap((item) => item.ids);
    return [...new Set(ids)];
  }, [historico, selectedSet]);
  const selectableVisibleHistorico = useMemo(() => {
    if (bulkSelectionMode === "valid") {
      return visibleHistorico.filter((item) => item.valido);
    }
    if (bulkSelectionMode === "invalid") {
      return visibleHistorico.filter((item) => !item.valido);
    }
    return [];
  }, [bulkSelectionMode, visibleHistorico]);
  const allVisibleSelected =
    selectableVisibleHistorico.length > 0 &&
    selectableVisibleHistorico.every((item) => selectedSet.has(item.key));
  const totalValidCount = historico.filter((item) => item.valido).length;
  const totalErrorCount = historico.length - totalValidCount;

  useEffect(() => {
    if (historyPage > historyPageCount) {
      setHistoryPage(historyPageCount);
    }
  }, [historyPage, historyPageCount]);

  function formatField(
    field: "horarios" | "segundaJornadaHorarios" | "sabadoHorarios",
  ) {
    if (!form.getValues("autoFormatar")) return;
    form.setValue(field, formatarHorariosEntrada(form.getValues(field) ?? ""), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function toggleAllVisible() {
    if (!bulkSelectionMode) return;

    if (allVisibleSelected) {
      const visibleKeys = new Set(
        selectableVisibleHistorico.map((item) => item.key),
      );
      setSelectedKeys((current) =>
        current.filter((key) => !visibleKeys.has(key)),
      );
      setPdfPeopleByKey((current) => {
        const next = { ...current };
        visibleKeys.forEach((key) => {
          delete next[key];
        });
        return next;
      });
      return;
    }

    setSelectedKeys((current) => [
      ...new Set([
        ...current,
        ...selectableVisibleHistorico.map((item) => item.key),
      ]),
    ]);
    setPdfPeopleByKey((current) => {
      const next = { ...current };
      selectableVisibleHistorico.forEach((item) => {
        if (item.valido) {
          next[item.key] = next[item.key] ?? [createPdfPerson()];
        }
      });
      return next;
    });
  }

  function toggleOne(item: HistoryItem) {
    if (
      selectionMode === "valid" && !item.valido && !selectedSet.has(item.key)
    ) {
      return;
    }
    if (
      selectionMode === "invalid" && item.valido && !selectedSet.has(item.key)
    ) {
      return;
    }

    setSelectedKeys((current) => {
      const selected = current.includes(item.key);
      if (selected) {
        setPdfPeopleByKey((people) => {
          const next = { ...people };
          delete next[item.key];
          return next;
        });
        return current.filter((key) => key !== item.key);
      }

      if (item.valido) {
        setPdfPeopleByKey((people) => ({
          ...people,
          [item.key]: people[item.key] ?? [createPdfPerson()],
        }));
      }
      return [...current, item.key];
    });
  }

  function addPdfPerson(itemKey: string) {
    setPdfPeopleByKey((current) => ({
      ...current,
      [itemKey]: [...(current[itemKey] ?? []), createPdfPerson()],
    }));
  }

  function removePdfPerson(itemKey: string, personId: string) {
    setPdfPeopleByKey((current) => {
      const currentPeople = current[itemKey] ?? [];
      const nextPeople = currentPeople.filter((person) => person.localId !== personId);
      if (!nextPeople.length) {
        setSelectedKeys((keys) => keys.filter((key) => key !== itemKey));
        const next = { ...current };
        delete next[itemKey];
        return next;
      }

      return {
        ...current,
        [itemKey]: nextPeople,
      };
    });
  }

  function updatePdfPerson(
    itemKey: string,
    personId: string,
    field: keyof Omit<PdfPerson, "localId">,
    value: string,
  ) {
    setPdfPeopleByKey((current) => ({
      ...current,
      [itemKey]: (current[itemKey] ?? [createPdfPerson()]).map((person) =>
        person.localId === personId ? { ...person, [field]: value } : person,
      ),
    }));
  }

  async function exportSelected() {
    setExportError(null);
    setIsExporting(true);
    try {
      const selectedItems = historico.filter(
        (item) => selectedSet.has(item.key) && item.valido,
      );
      const entries = selectedItems.flatMap((item) =>
        (pdfPeopleByKey[item.key] ?? []).map((person) => ({
          ids: item.ids,
          nome: person.nome.trim(),
          matricula: person.matricula.trim(),
          dataAlteracao: person.dataAlteracao,
        })),
      );

      if (
        entries.length === 0 ||
        entries.some((entry) => !entry.nome || !entry.dataAlteracao)
      ) {
        throw new Error("Informe nome e data de alteração para gerar o PDF.");
      }

      await downloadPdf(entries);
    } catch (exception) {
      setExportError(
        exception instanceof Error ? exception.message : "Falha ao exportar PDF",
      );
    } finally {
      setIsExporting(false);
    }
  }

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const horariosFormatados = formatarHorariosEntrada(values.horarios);
      const payload = values.interjornadaAtiva
        ? {
            modo: "interjornada",
            horarios: horariosFormatados,
            horarios2: formatarHorariosEntrada(
              values.segundaJornadaHorarios ?? "",
            ),
            validarInterjornada: true,
          }
        : shouldValidateWithSaturday(horariosFormatados)
        ? {
            modo: "sabado-combinado",
            horarios: horariosFormatados,
            horarios2: formatarHorariosEntrada(values.sabadoHorarios ?? ""),
            validarInterjornada: false,
          }
        : {
            modo: "simples",
            horarios: horariosFormatados,
          };

      const response = await fetch("/api/jornada/validar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      return (await response.json()) as ValidationResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: historyQueryKey });
      setSelectedKeys([]);
      setPdfPeopleByKey({});
    },
  });

  const batchMutation = useMutation({
    mutationFn: validateBatchSpreadsheet,
  });

  function submitBatchValidation() {
    if (!batchFile) return;

    setBatchPdfError(null);
    batchMutation.mutate({
      file: batchFile,
      validarPeriodos: batchValidarPeriodos,
      validarJornada: batchValidarJornada,
      validarIntervalos: batchValidarIntervalos,
      usarHorariosAgrupados: batchUsarHorariosAgrupados,
    });
  }

  async function submitBatchPdfExport() {
    if (!batchFile) return;

    setBatchPdfError(null);
    setIsBatchPdfExporting(true);
    try {
      await downloadBatchReportPdf({
        file: batchFile,
        validarPeriodos: batchValidarPeriodos,
        validarJornada: batchValidarJornada,
        validarIntervalos: batchValidarIntervalos,
        usarHorariosAgrupados: batchUsarHorariosAgrupados,
        pdfDetalhado: batchPdfDetalhado,
      });
    } catch (exception) {
      setBatchPdfError(
        exception instanceof Error
          ? exception.message
          : "Falha ao gerar relatório PDF",
      );
    } finally {
      setIsBatchPdfExporting(false);
    }
  }

  function submitValidation(values: FormValues) {
    if (
      !values.interjornadaAtiva &&
      shouldValidateWithSaturday(values.horarios) &&
      !values.sabadoHorarios?.trim()
    ) {
      form.setError("sabadoHorarios", {
        type: "manual",
        message: "Digite a jornada de sábado com exatamente 04:00.",
      });
      return;
    }

    mutation.mutate(values);
  }
  const clearHistoryMutation = useMutation({
    mutationFn: clearOwnHistory,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: historyQueryKey });
      const previousHistory =
        queryClient.getQueryData<HistoryRecord[]>(historyQueryKey);

      queryClient.setQueryData<HistoryRecord[]>(historyQueryKey, []);
      setSelectedKeys([]);
      setPdfPeopleByKey({});
      setHistoryPage(1);

      return { previousHistory };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousHistory) {
        queryClient.setQueryData(historyQueryKey, context.previousHistory);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: historyQueryKey });
    },
  });
  const selectedDeleteMutation = useMutation({
    mutationFn: deleteSelectedHistory,
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: historyQueryKey });
      const previousHistory =
        queryClient.getQueryData<HistoryRecord[]>(historyQueryKey);
      const idSet = new Set(ids);
      const keysToRemove = new Set(
        historico
          .filter((item) => item.ids.some((id) => idSet.has(id)))
          .map((item) => item.key),
      );

      queryClient.setQueryData<HistoryRecord[]>(historyQueryKey, (current) =>
        (current ?? []).filter((record) => !idSet.has(record.id)),
      );
      setSelectedKeys((current) =>
        current.filter((key) => !keysToRemove.has(key)),
      );
      setPdfPeopleByKey((current) => {
        const next = { ...current };
        keysToRemove.forEach((key) => {
          delete next[key];
        });
        return next;
      });

      return { previousHistory };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousHistory) {
        queryClient.setQueryData(historyQueryKey, context.previousHistory);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: historyQueryKey });
    },
  });

  const horariosField = form.register("horarios");
  const segundaJornadaField = form.register("segundaJornadaHorarios");
  const sabadoField = form.register("sabadoHorarios");
  const batchTopErrors = batchMutation.data?.linhasComErro.slice(0, 12) ?? [];
  const batchRepeated = Object.entries(batchMutation.data?.jornadasRepetidas ?? {})
    .sort(([, left], [, right]) => right - left)
    .slice(0, 6);

    return { AlertTriangle, CheckCircle2, Clock3, Download, FileSpreadsheet, History, INTERJORNADA_HELP_TEXT, Info, Link, Loader2, ResultCard, RotateCcw, TableProperties, Trash2, Upload, addPdfPerson, allVisibleSelected, batchFile, batchMutation, batchPdfDetalhado, batchPdfError, batchRepeated, batchTopErrors, batchUsarHorariosAgrupados, batchValidarIntervalos, batchValidarJornada, batchValidarPeriodos, bulkSelectionMode, canShowSabado, clearHistoryMutation, createPdfPerson, duracaoPrincipal, duracaoSegundaJornada, exportError, exportSelected, filteredHistorico, form, formatDate, formatField, getCombinedMonthlyHours, getCombinedWeeklyHours, getPrimaryMessage, getSecondaryMessages, hasAccount, hideInvalidHistory, historico, historicoQuery, historyPage, historyPageCount, horariosField, interjornadaAtiva, isBatchPdfExporting, isCombinedResponse, isExporting, joinCodigos, mutation, pdfPeopleByKey, removePdfPerson, sabadoField, segundaJornadaField, selectableVisibleHistorico, selectedDeleteMutation, selectedErrorCount, selectedHistoryIds, selectedItemCount, selectedSet, selectedValidCount, selectionMode, setBatchFile, setBatchPdfDetalhado, setBatchPdfError, setBatchUsarHorariosAgrupados, setBatchValidarIntervalos, setBatchValidarJornada, setBatchValidarPeriodos, setHideInvalidHistory, setHistoryPage, submitBatchPdfExport, submitBatchValidation, submitValidation, sumDurations, toggleAllVisible, toggleOne, totalErrorCount, totalValidCount, updatePdfPerson, visibleHistorico };
}

export function JornadaValidationForm(props: Parameters<typeof useJornadaValidationFormController>[0]) {
  return <JornadaValidationFormView model={useJornadaValidationFormController(props)} />;
}
