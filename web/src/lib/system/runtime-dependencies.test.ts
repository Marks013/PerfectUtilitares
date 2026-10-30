import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Manifest = { dependencies: Record<string, string> };

function manifest(relative: string): Manifest {
  return JSON.parse(readFileSync(path.join(process.cwd(), relative), "utf8"));
}

type Lockfile = {
  packages: Record<string, { version?: string; deprecated?: string }>;
};

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

  for (const runtime of [".", "ops/pdf-worker", "ops/migrator"]) {
    it("keeps " + runtime + " free of obsolete telemetry packages", () => {
      const lock: Lockfile = JSON.parse(
        readFileSync(path.join(process.cwd(), runtime, "package-lock.json"), "utf8"),
      );
      for (const [name, entry] of Object.entries(lock.packages)) {
        if (!name.includes("node_modules/@opentelemetry/")) continue;
        expect(entry.deprecated, name).toBeUndefined();
        expect(name, name).not.toMatch(/\/sdk-trace-(base|node|web)$/);
      }
    });
  }
});
