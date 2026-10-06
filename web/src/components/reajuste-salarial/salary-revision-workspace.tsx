"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  SalaryRevisionAnalysis,
  SalaryRevisionScope,
} from "@/lib/reajuste-salarial/salary-revision-types";
import { salaryRevisionUsesGeneralPercentage } from "@/lib/reajuste-salarial/salary-revision-matching";
import {
  formatClientCents,
  type SalaryRevisionClientState,
  type SalaryRevisionRuleDraft,
  selectSalaryRevisionCandidates,
  serializeSalaryRevisionRules,
  validateSalaryRevisionFile,
  validateSalaryRevisionGeneration,
  updateSalaryRevisionRule,
} from "./salary-revision-workspace-model";
import { downloadBlob } from "./download";

function downloadName(header: string | null) {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return header?.match(/filename="?([^";]+)"?/i)?.[1] ?? "reajuste-salarial.pdf";
}

async function responseMessages(response: Response | Blob) {
  try {
    const text = await response.text();
    const body = JSON.parse(text) as {
      error?: { message?: string; details?: Array<{ message?: string }> };
    };
    const details = body.error?.details
      ?.map((item) => item.message)
      .filter((item): item is string => Boolean(item));
    return details?.length
      ? [body.error?.message ?? "Falha no processamento.", ...details]
      : [body.error?.message ?? "Falha no processamento."];
  } catch {
    return ["Falha no processamento. Tente novamente."];
  }
}

export function useSalaryRevisionWorkspaceController() {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const analysisRequest = useRef<AbortController | null>(null);
  const [file, setFileState] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<SalaryRevisionAnalysis | null>(null);
  const [percentage, setPercentage] = useState("");
  const [adjustmentScope, setAdjustmentScope] =
    useState<SalaryRevisionScope>("all");
  const [rules, setRules] = useState<SalaryRevisionRuleDraft[]>([]);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<SalaryRevisionClientState>({ status: "idle" });
  const busy = state.status === "analyzing" || state.status === "generating";
  const usesGeneralPercentage = salaryRevisionUsesGeneralPercentage(adjustmentScope, rules);
  const specialCount = useMemo(
    () => new Set(rules.flatMap((rule) => rule.selectedRegistrations)).size,
    [rules],
  );

  useEffect(
    () => () => {
      requestRef.current?.abort();
      analysisRequest.current?.abort();
    },
    [],
  );

  function setFile(next: File | null) {
    analysisRequest.current?.abort();
    requestRef.current?.abort();
    requestRef.current = null;
    setFileState(next);
    setAnalysis(null);
    setRules([]);
    setState({ status: "idle" });
  }

  function reset() {
    setFile(null);
    setPercentage("");
    setAdjustmentScope("all");
    setSearch("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function analyze() {
    const messages = validateSalaryRevisionFile(file);
    if (messages.length > 0 || !file) {
      setState({ status: "error", messages });
      return;
    }
    setState({ status: "analyzing" });
    const data = new FormData();
    data.set("file", file, file.name);
    analysisRequest.current?.abort();
    const controller = new AbortController();
    analysisRequest.current = controller;
    try {
      const response = await fetch("/api/reajuste-salarial/reajuste/analisar", {
        method: "POST",
        body: data,
        signal: controller.signal,
      });
      if (!response.ok) {
        const messages = await responseMessages(response);
        if (!controller.signal.aborted) setState({ status: "error", messages });
        return;
      }
      const body = (await response.json()) as { analysis: SalaryRevisionAnalysis };
      if (controller.signal.aborted) return;
      setAnalysis(body.analysis);
      setRules([]);
      setState({ status: "ready" });
    } catch {
      if (controller.signal.aborted) return;
      setState({ status: "error", messages: ["Falha de conexão durante a análise."] });
    }
  }

  function addRule() {
    if (busy || !analysis || rules.length >= 20) return;
    setRules((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: `Regra especial ${current.length + 1}`,
        minimumSalary: formatClientCents(analysis.minimumSalaryCents).replace(/^R\$\s*/, ""),
        maximumSalary: formatClientCents(analysis.maximumSalaryCents).replace(/^R\$\s*/, ""),
        newSalary: "",
        calculation: "general_percentage",
        percentage: "",
        roleFilter: "",
        selectedRegistrations: [],
      },
    ]);
    setState({ status: "ready" });
  }

  function updateRule(id: string, patch: Partial<SalaryRevisionRuleDraft>) {
    if (busy) return;
    setRules((current) =>
      current.map((rule) => {
        if (rule.id !== id) return rule;
        return updateSalaryRevisionRule(analysis, rule, patch);
      }),
    );
    setState({ status: "ready" });
  }

  function selectRange(id: string) {
    if (busy || !analysis) return;
    setRules((current) =>
      current.map((rule) => {
        if (rule.id !== id) return rule;
        return {
          ...rule,
          selectedRegistrations: selectSalaryRevisionCandidates(analysis, current, rule, search),
        };
      }),
    );
    setState({ status: "ready" });
  }

  function toggleRegistration(id: string, registration: string) {
    if (busy) return;
    setRules((current) =>
      current.map((rule) => {
        if (rule.id !== id) return rule;
        const selected = new Set(rule.selectedRegistrations);
        if (selected.has(registration)) selected.delete(registration);
        else selected.add(registration);
        return { ...rule, selectedRegistrations: [...selected] };
      }),
    );
    setState({ status: "ready" });
  }

  function generate() {
    const messages = validateSalaryRevisionGeneration(
      file,
      analysis,
      percentage,
      rules,
      adjustmentScope,
    );
    if (messages.length > 0 || !file || !analysis) {
      setState({ status: "error", messages });
      return;
    }
    const data = new FormData();
    data.set("file", file, file.name);
    data.set("fileHash", analysis.fileHash);
    data.set("scope", adjustmentScope);
    if (usesGeneralPercentage) {
      data.set("percentage", percentage.trim());
    }
    data.set("rules", serializeSalaryRevisionRules(rules));
    const request = new XMLHttpRequest();
    requestRef.current = request;
    request.open("POST", "/api/reajuste-salarial/reajuste/gerar");
    request.responseType = "blob";
    setState({ status: "generating", progress: 0 });
    request.upload.addEventListener("progress", (event) => {
      if (requestRef.current !== request) return;
      if (!event.lengthComputable) return;
      setState({
        status: "generating",
        progress: Math.min(99, Math.round((event.loaded / event.total) * 100)),
      });
    });
    request.upload.addEventListener("load", () => {
      if (requestRef.current !== request) return;
      setState({ status: "generating", progress: 99 });
    });
    request.addEventListener("load", async () => {
      if (requestRef.current !== request) return;
      const blob = request.response as Blob;
      const contentType = request.getResponseHeader("content-type") ?? "";
      if (request.status >= 200 && request.status < 300 && contentType.includes("application/pdf")) {
        const fileName = downloadName(request.getResponseHeader("content-disposition"));
        downloadBlob(blob, fileName);
        requestRef.current = null;
        setState({ status: "success", fileName });
        return;
      }
      const messages = await responseMessages(blob);
      if (requestRef.current !== request) return;
      requestRef.current = null;
      setState({ status: "error", messages });
    });
    request.addEventListener("error", () => {
      if (requestRef.current !== request) return;
      requestRef.current = null;
      setState({ status: "error", messages: ["Falha de conexão durante a geração."] });
    });
    request.addEventListener("abort", () => {
      requestRef.current = null;
    });
    request.send(data);
  }

  return {
    addRule,
    adjustmentScope,
    analysis,
    analyze,
    busy,
    file,
    generate,
    inputRef,
    percentage,
    removeRule: (id: string) => {
      if (busy) return;
      setRules((current) => current.filter((rule) => rule.id !== id));
      setState({ status: analysis ? "ready" : "idle" });
    },
    reset,
    rules,
    search,
    selectRange,
    setFile,
    setAdjustmentScope: (scope: SalaryRevisionScope) => {
      setAdjustmentScope(scope);
      setState({ status: analysis ? "ready" : "idle" });
    },
    setPercentage: (value: string) => {
      setPercentage(value);
      setState({ status: analysis ? "ready" : "idle" });
    },
    setSearch,
    specialCount,
    state,
    toggleRegistration,
    updateRule,
    usesGeneralPercentage,
  };
}
