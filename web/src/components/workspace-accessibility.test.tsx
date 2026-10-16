import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PHOTO_DEFAULTS } from "@/lib/photos/schema";
import { JornadaValidationFormView } from "./jornada-validation-form-view";
import { Photo3x4WorkspaceView } from "./photo-3x4-workspace-view";

type Props = { children?: ReactNode; [key: string]: unknown };

function elements(root: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(root)) return root.flatMap(elements);
  if (!isValidElement<Props>(root)) return [];
  return [root, ...elements(root.props.children)];
}

function text(root: ReactNode): string {
  if (typeof root === "string" || typeof root === "number") return String(root);
  if (Array.isArray(root)) return root.map(text).join("");
  return isValidElement<Props>(root) ? text(root.props.children) : "";
}

const Icon = () => null;

function jornadaModel(errors: Record<string, { message: string }>, mode: string) {
  return {
    CheckCircle2: Icon, Clock3: Icon, Download: Icon, FileSpreadsheet: Icon,
    Info: Icon, Loader2: Icon, ResultCard: Icon, RotateCcw: Icon,
    TableProperties: Icon, Upload: Icon,
    form: {
      formState: { errors },
      register: vi.fn(() => ({})),
      handleSubmit: vi.fn(() => vi.fn()),
    },
    mutation: { isPending: false, isError: false },
    batchMutation: { isPending: false, isError: false },
    horariosField: { name: "horarios" },
    segundaJornadaField: { name: "segundaJornadaHorarios" },
    sabadoField: { name: "sabadoHorarios" },
    batchTopErrors: [],
    interjornadaAtiva: mode === "interjornada",
    canShowSabado: mode === "sabado",
  } as unknown as Parameters<typeof JornadaValidationFormView>[0]["model"];
}

function photoModel(addBorder: boolean, borderWidth: number) {
  return {
    Archive: Icon, ChevronLeft: Icon, ChevronRight: Icon, Cropper: Icon,
    Download: Icon, ImageIcon: Icon, Loader2: Icon, RotateCcw: Icon,
    ScanFace: Icon, Scissors: Icon, SlidersHorizontal: Icon, Upload: Icon, X: Icon,
    PHOTO_DEFAULTS,
    files: [],
    hasFiles: false,
    selectedEditor: { contrast: 1, brightness: 1 },
    watchedAddBorder: addBorder,
    watchedQuality: 92,
    form: {
      watch: vi.fn(() => borderWidth),
      register: vi.fn(() => ({})),
      formState: { errors: {} },
    },
    singlePhotoMutation: {},
    zipMutation: {},
  } as unknown as Parameters<typeof Photo3x4WorkspaceView>[0]["model"];
}

describe("workspace accessibility and output information", () => {
  it.each([
    ["horarios", "jornada-horarios", "principal"],
    ["segundaJornadaHorarios", "jornada-segunda", "interjornada"],
    ["sabadoHorarios", "jornada-sabado", "sabado"],
  ])("associates the %s validation error with its input", (field, id, mode) => {
    const nodes = elements(JornadaValidationFormView({
      model: jornadaModel({ [field]: { message: "Confira os horários." } }, mode),
    }));
    const input = nodes.find(node => node.type === "input" && node.props.id === id);
    expect(input?.props["aria-invalid"]).toBe(true);
    const references = String(input?.props["aria-describedby"]).split(" ");
    expect(references).toContain(`${id}-error`);
    for (const reference of references) {
      expect(nodes.some(node => node.props.id === reference)).toBe(true);
    }
    const error = nodes.find(node => node.props.id === `${id}-error`);
    expect(error?.props.role).toBe("alert");
    expect(text(error)).toContain("Confira os horários.");
  });

  it("does not mark a valid field invalid and preserves its hint", () => {
    const nodes = elements(JornadaValidationFormView({ model: jornadaModel({}, "principal") }));
    const input = nodes.find(node => node.props.id === "jornada-horarios");
    expect(input?.props["aria-invalid"]).toBeUndefined();
    expect(input?.props["aria-describedby"]).toBe("jornada-horarios-hint");
    expect(nodes.find(node => node.props.id === "jornada-horarios-hint")).toBeDefined();
  });

  it.each([
    [true, 5, "364 × 482 px"],
    [false, 5, "354 × 472 px"],
    [true, 80, "514 × 632 px"],
    [true, 0, "Confira a borda"],
    [true, 2.5, "Confira a borda"],
  ])("reports actual dimensions for border=%s width=%s", (addBorder, borderWidth, expected) => {
    const root = Photo3x4WorkspaceView({ model: photoModel(addBorder, borderWidth) });
    const output = elements(root).find(node => node.type === "output");
    expect(text(output)).toBe(expected);
    expect(output?.props["aria-live"]).toBe("polite");
    expect(text(root)).not.toContain("NaN");
  });
});
