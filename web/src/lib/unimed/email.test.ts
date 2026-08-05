import { describe, expect, it } from "vitest";
import {
  buildUnimedEmailHtml,
  buildUnimedEmailSubject,
} from "@/lib/unimed/email";

describe("Unimed email", () => {
  it("contains only escaped name and formatted CPF data", () => {
    const html = buildUnimedEmailHtml(
      "Pessoa <script>alert(1)</script>",
      "52998224725",
      new Date("2026-07-31T11:00:00.000Z"),
    );

    expect(html).toContain("Pessoa &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("529.982.247-25");
    expect(html).toContain("font-family: Calibri");
    expect(html).toContain("Bom dia,");
    expect(html).toContain("Segue em anexo.");
    expect(html).toContain("<strong>Titular:</strong>");
    expect(html).toContain("<strong>Departamento Pessoal</strong>");
    expect(html).toContain("Supermercado Planalto - Matriz");
    expect(html).toContain("height: 60px");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("attachment");
  });

  it("keeps the email valid when the signature asset is unavailable", () => {
    const html = buildUnimedEmailHtml(
      "Pessoa Titular",
      "52998224725",
      new Date("2026-07-31T11:00:00.000Z"),
      false,
    );
    expect(html).not.toContain("cid:planalto-signature");
    expect(html).not.toContain("height: 60px");
    expect(html).toContain("Supermercado Planalto - Matriz");
  });

  it("varies the fixed subject without Gmail grouping", () => {
    expect(buildUnimedEmailSubject(1)).toBe("Solicitação de Coparticipação");
    expect(buildUnimedEmailSubject(2)).toBe("Solicitação de Coparticipação.");
    expect(buildUnimedEmailSubject(3)).toBe("Solicitação de Coparticipação..");
    expect(buildUnimedEmailSubject(22)).toBe(
      "Solicitação de Coparticipação (22)",
    );
  });
});
