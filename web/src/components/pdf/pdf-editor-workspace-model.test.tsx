import type { PDFDocumentProxy } from "pdfjs-dist";
import { Children, isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { EditorCanvas } from "./pdf-editor-workspace-model";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()],
  useEffect: vi.fn(),
}));

describe("editor canvas interaction lock", () => {
  it.each([true, false])("honors locked=%s on direct text placement", (locked) => {
    const onAdd = vi.fn();
    const tree = EditorCanvas({
      annotations: [], color: "#000000", document: {} as PDFDocumentProxy,
      fontSize: 18, lineWidth: 3, locked, onAdd, opacity: 0.35,
      page: { id: "page", artifactId: "input", sourcePage: 1, rotation: 0 },
      text: "Anotação", tool: "TEXT",
    });
    const overlay = Children.toArray(tree.props.children).find((child) =>
      isValidElement<{ className: string }>(child) && child.props.className === "pdf-editor-canvas__overlay",
    ) as ReactElement<{ onPointerDown: (event: unknown) => void }>;
    overlay.props.onPointerDown({
      clientX: 25, clientY: 50,
      currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 200 }) },
    });
    expect(onAdd).toHaveBeenCalledTimes(locked ? 0 : 1);
    if (!locked) expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ x: 0.25, y: 0.25, text: "Anotação" }));
  });
});
