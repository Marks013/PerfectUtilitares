import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Manifest = { dependencies: Record<string, string> };

function manifest(relative: string): Manifest {
  return JSON.parse(readFileSync(path.join(process.cwd(), relative), "utf8"));
}

describe("production runtime dependency contracts", () => {
  const application = manifest("package.json");

  for (const runtime of ["ops/pdf-worker", "ops/migrator"]) {
    it("keeps " + runtime + " dependencies aligned with the application", () => {
      const current = manifest(runtime + "/package.json");
      for (const [name, version] of Object.entries(current.dependencies)) {
        const expected = application.dependencies[name];
        if (expected) expect(version, name).toBe(expected);
      }
    });
  }
});
