import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { parse } from "@babel/parser";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "@playwright/test";

// Compare actual browser styles against the pre-migration source, independently
// of the existing test suite. The fixture keys survive class-name changes.
const [mode, artifact] = process.argv.slice(2);
assert(["--record", "--compare"].includes(mode) && artifact, "Mode and baseline path required");
const root = process.cwd();
const properties = ["color", "backgroundColor", "borderTopColor", "borderRadius", "boxShadow", "opacity", "outlineColor", "outlineWidth"];
const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" }).trim().split("\n");
const fixtures = new Map();
for (const file of files.filter((file) => /\.tsx?$/.test(file) && !/\.test\.|__tests__/.test(file))) {
  const ast = parse(readFileSync(file, "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] });
  let index = 0;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "StringLiteral" || node.type === "TemplateElement") {
      const text = node.type === "StringLiteral" ? node.value : node.value.raw;
      const key = `${file}:${index++}`;
      if (/(?:bg-|text-|rounded-|shadow-|border-|app-)/.test(text) && !text.includes("\n")) fixtures.set(key, text);
    }
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "comments", "tokens"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast);
}
const baseline = mode === "--compare" ? JSON.parse(readFileSync(artifact, "utf8")) : null;
const selected = baseline ? baseline.keys : [...fixtures.keys()].filter((key) => /(?:neutral-|bg-white|bg-blue-600|bg-red-|bg-green-|bg-emerald-|bg-yellow-|text-red-|text-green-|text-emerald-|text-yellow-|border-red-|border-green-|border-emerald-|rounded-md|rounded-lg|shadow-sm|shadow-lg)/.test(fixtures.get(key)));
assert(selected.length > 100, "Insufficient real component fixtures");
for (const key of selected) assert(fixtures.has(key), `Fixture disappeared: ${key}`);
const result = await postcss([tailwind({ base: root })]).process(readFileSync("src/app/globals.css", "utf8"), { from: path.join(root, "src/app/globals.css") });
// Exercise pseudo-state rules in a large fixture matrix; real pointer/keyboard
// behavior is also checked in the production browser smoke.
const css = result.css.replaceAll(":hover", '[data-css-state="hover"]').replace(/:focus(?![-\w])/g, '[data-css-state="focus"]');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<html><body><main id="fixtures"></main></body></html>');
  await page.addStyleTag({ content: css });
  const values = await page.evaluate(({ entries, properties }) => {
    const output = [];
    const root = document.querySelector("#fixtures");
    for (const theme of ["dark", "light"]) {
      document.documentElement.dataset.theme = theme;
      for (const scope of ["", "app-frame", "auth-card"]) {
        root.className = scope;
        root.replaceChildren();
        for (const [key, classes] of entries) {
          for (const state of ["normal", "hover", "focus", "disabled"]) {
            const node = document.createElement("button");
            node.className = classes;
            node.dataset.cssState = state;
            node.disabled = state === "disabled";
            node.textContent = "Verificar";
            root.append(node);
            const style = getComputedStyle(node);
            output.push({ key: `${key}/${theme}/${scope}/${state}`, values: properties.map((property) => style[property]) });
          }
        }
      }
    }
    return output;
  }, { entries: selected.map((key) => [key, fixtures.get(key)]), properties });
  if (baseline) {
    assert.equal(values.length, baseline.values.length);
    const differences = [];
    values.forEach((row, index) => {
      assert.equal(row.key, baseline.values[index].key);
      row.values.forEach((value, property) => {
        const before = baseline.values[index].values[property];
        if (value !== before) differences.push({ key: row.key, property: properties[property], before, after: value });
      });
    });
    if (differences.length) console.error(JSON.stringify({ differences: differences.length, sample: differences.slice(0, 20) }));
    assert.equal(differences.length, 0, "Theme migration changed computed styles");
  } else {
    writeFileSync(artifact, JSON.stringify({ keys: selected, values }), { mode: 0o600 });
  }
  console.log(JSON.stringify({ mode, fixtures: selected.length, combinations: values.length, properties: properties.length, themes: 2, differences: 0 }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
