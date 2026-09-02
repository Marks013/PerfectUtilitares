import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnimedEmailFeedback } from "./unimed-email-feedback";

describe("UnimedEmailFeedback", () => {
  it("shows server-confirmed delivery as an accessible status", () => {
    const html = renderToStaticMarkup(
      <UnimedEmailFeedback sent error={null} />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("E-mail enviado com sucesso");
  });

  it("stays hidden before delivery or while an error is active", () => {
    expect(
      renderToStaticMarkup(<UnimedEmailFeedback sent={false} error={null} />),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <UnimedEmailFeedback sent error="Falha ao enviar" />,
      ),
    ).toBe("");
  });
});
