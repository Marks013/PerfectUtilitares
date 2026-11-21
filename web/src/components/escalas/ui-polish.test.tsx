import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field } from "./controls";

describe("field error association", () => {
  it("keeps existing instructions and links the nearby error and help to the same invalid input", () => {
    const html = renderToStaticMarkup(<Field label="Matrícula" hint="Mantenha os zeros." error="Matrícula já cadastrada.">{id => <input id={id} aria-describedby="external-help" />}</Field>);
    const input = html.match(/<input[^>]+>/)?.[0] ?? "";
    const help = html.match(/<p id="([^"]+)"[^>]*>Mantenha os zeros\./)?.[1];
    const error = html.match(/<p id="([^"]+)" role="alert"/)?.[1];
    expect(help).toBeDefined(); expect(error).toBeDefined();
    expect(input).toContain(`aria-describedby="external-help ${help} ${error}"`);
    expect(input).toContain('aria-invalid="true"');
    expect(html).toContain(`for="${input.match(/id="([^"]+)"/)?.[1]}"`);
  });
});
