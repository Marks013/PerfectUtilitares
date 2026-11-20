import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field } from "./controls";

describe("accessible scheduling fields", () => {
  it("associates label, instructions and error with the actual control", () => {
    const html = renderToStaticMarkup(<Field label="Admissão" hint="Deixe em branco quando desconhecida." error="Data inválida">{(id, accessibility) => <input id={id} {...accessibility} />}</Field>);
    const labelId = html.match(/for="([^"]+)"/)?.[1];
    expect(labelId).toBeTruthy(); expect(html).toContain(`id="${labelId}"`);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(`aria-describedby="${labelId}-hint ${labelId}-error"`);
    expect(html).toContain(`id="${labelId}-hint"`); expect(html).toContain(`id="${labelId}-error"`);
  });
  it("does not reference absent descriptions or mark untouched fields invalid", () => {
    const html = renderToStaticMarkup(<Field label="Nome">{(id, accessibility) => <input id={id} {...accessibility} />}</Field>);
    expect(html).not.toContain("aria-describedby"); expect(html).not.toContain("aria-invalid");
  });
  it("retains the one-argument rendering contract for untouched legacy fields", () => {
    const html = renderToStaticMarkup(<Field label="Campo existente">{id => <select id={id}><option>Opção</option></select>}</Field>);
    expect(html).toContain("Campo existente"); expect(html).toContain("<select");
  });
});
