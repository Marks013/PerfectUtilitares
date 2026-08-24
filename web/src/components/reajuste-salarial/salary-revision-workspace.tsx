"use client";

import { useMemo, useRef, useState } from "react";
import type {
  SalaryRevisionAnalysis,
  SalaryRevisionScope,
} from "@/lib/reajuste-salarial/salary-revision-types";
import {
  candidatesForRule,
  type SalaryRevisionClientState,
  type SalaryRevisionRuleDraft,
  selectedByOtherRules,
  serializeSalaryRevisionRules,
  validateSalaryRevisionFile,
  validateSalaryRevisionGeneration,
} from "./salary-revision-workspace-model";

function downloadName(header: string | null) {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return header?.match(/filename="?([^";]+)"?/i)?.[1] ?? "reajuste-salarial.pdf";
}

async function responseMessages(response: Response | Blob) {
  try {
    const text = response instanceof Blob ? await response.text() : await response.text();
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
  const [file, setFileState] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<SalaryRevisionAnalysis | null>(null);
  const [percentage, setPercentage] = useState("");
  const [adjustmentScope, setAdjustmentScope] =
    useState<SalaryRevisionScope>("all");
  const [rules, setRules] = useState<SalaryRevisionRuleDraft[]>([]);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<SalaryRevisionClientState>({ status: "idle" });
  const busy = state.status === "analyzing" || state.status === "generating";
  const specialCount = useMemo(
    () => new Set(rules.flatMap((rule) => rule.selectedRegistrations)).size,
    [rules],
  );

  function setFile(next: File | null) {
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
    try {
      const response = await fetch("/api/reajuste-salarial/reajuste/analisar", {
        method: "POST",
        body: data,
      });
      if (!response.ok) {
        setState({ status: "error", messages: await responseMessages(response) });
        return;
      }
      const body = (await response.json()) as { analysis: SalaryRevisionAnalysis };
      setAnalysis(body.analysis);
      setRules([]);
      setState({ status: "ready" });
    } catch {
      setState({ status: "error", messages: ["Falha de conexão durante a análise."] });
    }
  }

  function addRule() {
    setRules((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: `Regra especial ${current.length + 1}`,
        minimumSalary: "",
        maximumSalary: "",
        newSalary: "",
        selectedRegistrations: [],
      },
    ]);
    setState({ status: "ready" });
  }

  function updateRule(id: string, patch: Partial<SalaryRevisionRuleDraft>) {
    setRules((current) =>
      current.map((rule) => {
        if (rule.id !== id) return rule;
        const rangeChanged =
          (patch.minimumSalary !== undefined &&
            patch.minimumSalary !== rule.minimumSalary) ||
          (patch.maximumSalary !== undefined &&
            patch.maximumSalary !== rule.maximumSalary);
        return {
          ...rule,
          ...patch,
          selectedRegistrations: rangeChanged
            ? []
            : patch.selectedRegistrations ?? rule.selectedRegistrations,
        };
      }),
    );
    setState({ status: "ready" });
  }

  function selectRange(id: string) {
    if (!analysis) return;
    setRules((current) =>
      current.map((rule) => {
        if (rule.id !== id) return rule;
        const unavailable = selectedByOtherRules(current, id);
        return {
          ...rule,
          selectedRegistrations: candidatesForRule(analysis, rule)
            .map((employee) => employee.registration)
            .filter((registration) => !unavailable.has(registration)),
        };
      }),
    );
    setState({ status: "ready" });
  }

  function toggleRegistration(id: string, registration: string) {
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
    if (adjustmentScope === "all") {
      data.set("percentage", percentage.trim());
    }
    data.set("rules", serializeSalaryRevisionRules(rules));
    const request = new XMLHttpRequest();
    requestRef.current = request;
    request.open("POST", "/api/reajuste-salarial/reajuste/gerar");
    request.responseType = "blob";
    setState({ status: "generating", progress: 0 });
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      setState({
        status: "generating",
        progress: Math.min(99, Math.round((event.loaded / event.total) * 100)),
      });
    });
    request.upload.addEventListener("load", () => {
      setState({ status: "generating", progress: 100 });
    });
    request.addEventListener("load", async () => {
      requestRef.current = null;
      const blob = request.response as Blob;
      const contentType = request.getResponseHeader("content-type") ?? "";
      if (request.status >= 200 && request.status < 300 && contentType.includes("application/pdf")) {
        const fileName = downloadName(request.getResponseHeader("content-disposition"));
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(url);
        setState({ status: "success", fileName });
        return;
      }
      setState({ status: "error", messages: await responseMessages(blob) });
    });
    request.addEventListener("error", () => {
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
    removeRule: (id: string) => setRules((current) => current.filter((rule) => rule.id !== id)),
    reset,
    rules,
    search,
    selectRange,
    setFile,
    setAdjustmentScope,
    setPercentage,
    setSearch,
    specialCount,
    state,
    toggleRegistration,
    updateRule,
  };
}
