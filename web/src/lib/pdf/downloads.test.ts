import { describe, expect, it } from "vitest";
import {
  createAttachmentHeader,
  uniqueDownloadName,
} from "@/lib/pdf/downloads";

describe("pdf downloads", () => {
  it("creates an ASCII fallback and UTF-8 file name", () => {
    const header = createAttachmentHeader("Relatório final.pdf");

    expect(header).toContain('filename="Relat_rio final.pdf"');
    expect(header).toContain("filename*=UTF-8''Relat%C3%B3rio%20final.pdf");
  });

  it("keeps names unique inside a ZIP", () => {
    const names = new Set<string>();

    expect(uniqueDownloadName("resultado.pdf", names)).toBe("resultado.pdf");
    expect(uniqueDownloadName("resultado.pdf", names)).toBe("resultado-2.pdf");
    expect(uniqueDownloadName("../resultado.pdf", names)).toBe(
      "resultado-3.pdf",
    );
  });
});
