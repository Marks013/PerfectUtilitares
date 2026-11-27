import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginForm } from "../login-form";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const foundation = read("../../app/styles/foundation.css");
const utilities = read("../../app/styles/theme-utilities.css");

function contrast(first: string, second: string) {
  const luminance = (hex: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Expected a six-digit hex color, received ${hex}`);
    const channels = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("shared frontend contracts", () => {
  it.each(["dark", "light"])("keeps solid danger text above 4.5:1, including hover, in %s", theme => {
    const block = foundation.match(new RegExp(`html\\[data-theme="${theme}"\\]\\s*\\{([^}]+)`))?.[1];
    if (!block) throw new Error(`Missing ${theme} theme block`);
    const token = (name: string) => {
      const value = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
      if (!value) throw new Error(`Missing ${name} hex token in ${theme} theme`);
      return value;
    };
    const fill = utilities.match(/\.app-bg-danger\s*\{([^}]+)\}/)?.[1];
    if (!fill) throw new Error("Missing shared danger fill rule");
    expect(fill).toMatch(/(?:^|\s)color:\s*var\(--app-action-text\)/);
    expect(contrast(token("--app-action-text"), token("--app-danger"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--app-action-text"), token("--app-danger-hover"))).toBeGreaterThanOrEqual(4.5);
    expect(utilities).toContain(".app-bg-danger:hover:not(:disabled)");
  });
  it("uses the shared confirmation for both history scopes", () => {
    for (const path of ["../jornada-history-table.tsx", "../jornada-validation-form-jornada-history-section.tsx"]) {
      const source = read(path);
      expect(source).not.toContain("window.confirm(");
      expect(source).toContain("<ConfirmAction");
    }
    expect(read("../jornada-validation-form-jornada-history-section.tsx")).toContain("mutateAsync([...selectedHistoryIds])");
  });
  it("bounds dialog height and preserves a scroll path to the actions", () => {
    const css = read("./alert-dialog.module.css");
    expect(css).toContain("max-block-size:");
    expect(css).toContain("overflow-y: auto;");
    expect(css).toContain("safe-area-inset-bottom");
  });
  it("owns login validation and associates explicit server errors", () => {
    const html = renderToStaticMarkup(<LoginForm action={async () => {}} callbackUrl="/conta" passwordMaxLength={72} errorCode="email" errorMessage="Informe um e-mail válido." />);
    expect(html).toMatch(/novalidate/i);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-describedby="login-email-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toContain('name="callbackUrl" value="/conta"');
  });
  it("keeps credential failures generic", () => {
    const html = renderToStaticMarkup(<LoginForm action={async () => {}} callbackUrl="/dashboard" passwordMaxLength={72} errorCode="credentials" errorMessage="E-mail ou senha não conferem." />);
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).toContain("E-mail ou senha não conferem.");
  });
});
