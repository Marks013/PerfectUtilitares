import { describe, expect, it, vi } from "vitest";
import { showUnimedDocumentPreview, unimedDocumentFileName } from "./unimed-document-preview";

describe("Unimed document download names", () => {
  it.each([
    ["RN561", "RN-561 - João da Conceição.pdf"],
    ["INACTIVE_TERM", "Termo de Inativo - João da Conceição.pdf"],
  ] as const)("names %s with the holder and preserves accents", (kind, expected) => {
    expect(unimedDocumentFileName(kind, "João da Conceição")).toBe(expected);
  });

  it("normalizes whitespace and removes invalid filename characters", () => {
    expect(unimedDocumentFileName("RN561", '  Ana / Silva\\Sousa: "Teste"\n  '))
      .toBe("RN-561 - Ana Silva Sousa Teste.pdf");
  });

  it("keeps a usable filename when the holder name is empty", () => {
    expect(unimedDocumentFileName("INACTIVE_TERM", " \n "))
      .toBe("Termo de Inativo - Titular.pdf");
  });

  it("replaces the loading screen with a named download of the same PDF", () => {
    const link = { style: { cssText: "" } };
    const iframe = { style: { cssText: "" } };
    const replaceChildren = vi.fn();
    const previewDocument = {
      title: "Preparando documento",
      body: { style: { cssText: "" }, replaceChildren },
      createElement: vi.fn((tag: string) => {
        if (tag === "a") return link;
        if (tag === "iframe") return iframe;
        throw new Error(`Unexpected element: ${tag}`);
      }),
    };
    const url = "blob:https://perfectutilitares.example/pdf-generated";
    const createObjectURL = vi.fn(() => url);
    const revokeObjectURL = vi.fn();
    const addEventListener = vi.fn();
    const previewWindow = {
      document: previewDocument,
      URL: { createObjectURL, revokeObjectURL },
      addEventListener,
    } as unknown as Window;
    const blob = new Blob(["%PDF-1.7"], { type: "application/pdf" });
    const fileName = "RN-561 - João da Conceição.pdf";

    showUnimedDocumentPreview(previewWindow, blob, fileName);

    expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(blob);
    expect(previewDocument.title).toBe(fileName);
    expect(link).toMatchObject({
      href: url,
      download: fileName,
      textContent: `Baixar PDF — ${fileName}`,
    });
    expect(iframe).toMatchObject({ src: `${url}#toolbar=0`, title: fileName });
    expect(replaceChildren).toHaveBeenCalledWith(link, iframe);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalledWith("pagehide", expect.any(Function), { once: true });
    addEventListener.mock.calls[0][1]();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(url);
  });
});
