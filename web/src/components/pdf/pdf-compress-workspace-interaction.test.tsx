"use client";
// PERFECT_PDF_REVALIDATION_V1_2

import { readFileSync } from "node:fs";
import {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import { PdfCompressWorkspaceView } from "./pdf-compress-workspace-view";
import {
  COLOR_OPTIONS,
  formatBytes,
  getColorModeLabel,
  getContentKindLabel,
  getDetectedDpiLabel,
  getFileKey,
  METHOD_OPTIONS,
  QUALITY_OPTIONS,
  resolveCompressionCompletion,
  type CompressionSettings,
  type PdfOutput,
  type WorkState,
} from "./pdf-compress-workspace-model";

type ViewModel = Parameters<typeof PdfCompressWorkspaceView>[0]["model"];

type LooseProps = {
  children?: ReactNode;
  [key: string]: unknown;
};

function visit(
  node: ReactNode,
  callback: (element: ReactElement<LooseProps>) => void,
): void {
  if (Array.isArray(node)) {
    for (const child of node) visit(child, callback);
    return;
  }
  if (!isValidElement<LooseProps>(node)) return;
  callback(node);
  visit(node.props.children, callback);
}

function findElement(
  root: ReactNode,
  predicate: (element: ReactElement<LooseProps>) => boolean,
): ReactElement<LooseProps> {
  let found: ReactElement<LooseProps> | null = null;
  visit(root, (element) => {
    if (!found && predicate(element)) found = element;
  });
  if (!found) throw new Error("Elemento esperado não encontrado.");
  return found;
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement<LooseProps>(node)) return "";
  return textContent(node.props.children);
}

function makeOutput(
  outcome: "COMPRESSED" | "UNCHANGED",
  id = "output-1",
): PdfOutput {
  return {
    id,
    kind: "OUTPUT",
    originalName: "documento.pdf",
    sizeBytes: outcome === "COMPRESSED" ? "500" : "1000",
    metadata: {
      compression: {
        sourceArtifactId: "source-1",
        sourceName: "documento.pdf",
        sourceSizeBytes: "1000",
        outcome,
        strategy:
          outcome === "COMPRESSED" ? "IMAGE_RECOMPRESSION" : "SKIP",
      },
    },
  };
}

function makeSettings(): CompressionSettings {
  return {
    preset: "BALANCED",
    method: "AUTO",
    dpi: 150,
    colorMode: "KEEP_DETECTED",
    imageQuality: 72,
    monochromeThreshold: 160,
    userOverrides: {
      method: false,
      dpi: false,
      colorMode: false,
      imageQuality: false,
      monochromeThreshold: false,
    },
  };
}

function makeModel(options?: {
  phase?: WorkState["phase"];
  outputs?: PdfOutput[];
}) {
  const DummyIcon = () => null;
  const file = new File(["x"], "documento.pdf", {
    type: "application/pdf",
    lastModified: 1_700_000_000_000,
  });
  const outputs = options?.outputs ?? [makeOutput("UNCHANGED")];
  const phase = options?.phase ?? "UNCHANGED";
  const updateSettings = vi.fn();
  const applyPreset = vi.fn();

  const model = {
    Archive: DummyIcon,
    ArrowLeft: DummyIcon,
    ChevronDown: DummyIcon,
    Check: DummyIcon,
    Download: DummyIcon,
    FileSearch: DummyIcon,
    FileText: DummyIcon,
    Gauge: DummyIcon,
    Link: "a",
    Loader2: DummyIcon,
    Minimize2: DummyIcon,
    Palette: DummyIcon,
    Printer: DummyIcon,
    ScanLine: DummyIcon,
    ShieldCheck: DummyIcon,
    SlidersHorizontal: DummyIcon,
    Sparkles: DummyIcon,
    Upload: DummyIcon,
    X: DummyIcon,
    COLOR_OPTIONS,
    METHOD_OPTIONS,
    QUALITY_OPTIONS,
    analyses: [],
    analysisProgress: { completed: 0, total: 0 },
    analysisSummary: null,
    analyzing: false,
    applyDocumentRecommendation: vi.fn(),
    applyPreset,
    busy: false,
    error: null,
    files: [file],
    formatBytes,
    getColorModeLabel,
    getContentKindLabel,
    getDetectedDpiLabel,
    getFileKey,
    getInputProps: () => ({}),
    getRootProps: (props: LooseProps) => props,
    inputBytes: file.size,
    isDragActive: false,
    jobId: "job-1",
    outputBytes: outputs.reduce(
      (total, output) => total + Number(output.sizeBytes),
      0,
    ),
    outputs,
    processFiles: vi.fn(async () => undefined),
    removeFile: vi.fn(),
    savedPercent: 0,
    setError: vi.fn(),
    setWarning: vi.fn(),
    settings: makeSettings(),
    updateSettings,
    warning: null,
    work: {
      phase,
      progress: 100,
      detail:
        phase === "PARTIAL"
          ? "Compressão parcialmente concluída"
          : phase === "UNCHANGED"
            ? "Nenhuma redução obtida"
            : "Compressão concluída",
    },
  } as unknown as ViewModel;

  return { model, updateSettings, applyPreset };
}

describe("PDF compression workspace interaction regressions", () => {
  it("keeps recompression available and wires user overrides after a result", () => {
    const { model, updateSettings, applyPreset } = makeModel();
    const root = PdfCompressWorkspaceView({ model });

    expect(textContent(root)).toContain("Comprimir novamente");
    expect(textContent(root)).toContain("Opções avançadas");

    const advanced = findElement(
      root,
      (element) => element.type === "details",
    );
    expect(advanced.props.open).not.toBe(true);

    const quality = findElement(
      root,
      (element) =>
        element.type === "input" &&
        element.props.type === "range" &&
        element.props.min === 35 &&
        element.props.max === 95,
    );
    const qualityChange = quality.props.onChange;
    expect(typeof qualityChange).toBe("function");
    if (typeof qualityChange === "function") {
      qualityChange({ target: { value: "65" } });
    }
    expect(updateSettings).toHaveBeenCalledWith({ imageQuality: 65 });

    const balanced = findElement(
      root,
      (element) =>
        element.type === "input" &&
        element.props.name === "compression-preset" &&
        element.props.value === "BALANCED",
    );
    const presetChange = balanced.props.onChange;
    expect(typeof presetChange).toBe("function");
    if (typeof presetChange === "function") presetChange();
    expect(applyPreset).toHaveBeenCalledWith("BALANCED");
  });

  it("renders UNCHANGED and PARTIAL as distinct result states", () => {
    const unchangedRoot = PdfCompressWorkspaceView({
      model: makeModel({
        phase: "UNCHANGED",
        outputs: [makeOutput("UNCHANGED")],
      }).model,
    });
    expect(textContent(unchangedRoot)).toContain("Nenhuma redução obtida");
    expect(textContent(unchangedRoot)).toContain("O original foi preservado");

    const partialRoot = PdfCompressWorkspaceView({
      model: makeModel({
        phase: "PARTIAL",
        outputs: [makeOutput("COMPRESSED")],
      }).model,
    });
    expect(textContent(partialRoot)).toContain(
      "Compressão parcialmente concluída",
    );
  });

  it("auto-downloads only when every successful output was compressed", () => {
    expect(
      resolveCompressionCompletion([makeOutput("UNCHANGED")], null),
    ).toMatchObject({
      phase: "UNCHANGED",
      autoDownload: false,
    });

    expect(
      resolveCompressionCompletion(
        [makeOutput("COMPRESSED")],
        "PDF_COMPRESSION_PARTIAL",
      ),
    ).toMatchObject({
      phase: "PARTIAL",
      autoDownload: false,
    });

    expect(
      resolveCompressionCompletion(
        [makeOutput("COMPRESSED"), makeOutput("COMPRESSED", "output-2")],
        null,
      ),
    ).toMatchObject({
      phase: "SUCCEEDED",
      autoDownload: true,
    });

    expect(
      resolveCompressionCompletion(
        [makeOutput("COMPRESSED"), makeOutput("UNCHANGED", "output-2")],
        null,
      ),
    ).toMatchObject({
      phase: "SUCCEEDED",
      autoDownload: false,
    });
  });

  it("invalidates an old result whenever the user changes settings or preset", () => {
    const controllerSource = readFileSync(
      new URL("./pdf-compress-workspace.tsx", import.meta.url),
      "utf8",
    );

    expect(controllerSource).toMatch(
      /function applyPreset[\s\S]*?invalidateResult\(\);/,
    );
    expect(controllerSource).toMatch(
      /function updateSettings[\s\S]*?invalidateResult\(\);/,
    );
    expect(controllerSource).toMatch(
      /function updateSettings[\s\S]*?preset: null/,
    );
    expect(controllerSource).toMatch(
      /function invalidateResult\(\)[\s\S]*?setOutputs\(\[\]\)[\s\S]*?setJobId\(null\)[\s\S]*?phase: "IDLE"/,
    );
  });

});
