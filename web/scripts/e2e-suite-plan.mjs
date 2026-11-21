// Shared by the runner and Playwright. This module performs no external I/O.
export const nominalSpecs = Object.freeze(["escalas-scoped-access.spec.ts"]);
export const suitePhases = Object.freeze(["general", "nominal"]);

export function phaseSelection(phase) {
  if (!suitePhases.includes(phase)) throw new Error(`Unknown E2E phase: ${phase}`);
  const patterns = nominalSpecs.map((file) => `**/${file}`);
  return phase === "nominal" ? { testMatch: patterns } : { testIgnore: patterns };
}

export function parseSuiteArguments(args) {
  const result = [];
  let list = false;
  const valued = new Set(["--grep", "-g", "--grep-invert", "--project", "--timeout", "--global-timeout", "--max-failures"]);
  const switches = new Set(["--headed", "--forbid-only", "--quiet", "-x"]);
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    const [flag, inline] = argument.split(/=(.*)/s);
    if (argument === "--list") { list = true; continue; }
    if (["--workers", "-j", "--repeat-each", "--retries"].includes(flag)) {
      const value = inline ?? args[++i];
      const expected = flag === "--retries" ? "0" : "1";
      if (value !== expected) throw new Error(`${flag} must be ${expected} in the isolated suite`);
      result.push(flag, value);
    } else if (valued.has(flag)) {
      const value = inline ?? args[++i];
      if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}`);
      result.push(flag, value);
    } else if (switches.has(argument) || !argument.startsWith("-")) {
      result.push(argument);
    } else {
      throw new Error(`Unsupported isolated-suite option: ${argument}`);
    }
  }
  return { args: result, list };
}

export function phaseEnvironment(base, phase, { runId, adminPassword }) {
  phaseSelection(phase);
  if (!/^[a-z0-9-]+$/.test(runId) || !adminPassword) throw new Error("Fresh run ID and password required");
  const env = { ...base };
  // ADMIN_* takes precedence in seed.ts. Remove aliases rather than inheriting
  // an unrelated administrator or nominal tenant from the caller/previous phase.
  for (const key of ["SEED_ADMIN_EMAIL", "SEED_ADMIN_PASSWORD", "SEED_ADMIN_NAME", "E2E_EXCLUSIVE_SCOPED_TENANT_SLUG", "E2E_ESCALAS_RUN_ID", "E2E_ARTIFACT_DIR", "PLAYWRIGHT_JSON_OUTPUT_FILE", "PLAYWRIGHT_HTML_OUTPUT_DIR"]) delete env[key];
  Object.assign(env, {
    ADMIN_EMAIL: `e2e-${phase}-${runId}@example.test`,
    ADMIN_NAME: "E2E Administrator",
    ADMIN_PASSWORD: adminPassword,
    DEFAULT_TENANT_SLUG: "principal",
    DEFAULT_TENANT_NAME: "Principal",
    E2E_SUITE_PHASE: phase,
    E2E_MUTATION: "1",
    E2E_OWNED_ACCOUNT_PROVISIONING: "1",
  });
  const seed = { ...env };
  const runtime = { ...env };
  if (phase === "nominal") {
    runtime.DEFAULT_TENANT_SLUG = `e2e-${runId}`;
    runtime.E2E_EXCLUSIVE_SCOPED_TENANT_SLUG = runtime.DEFAULT_TENANT_SLUG;
  }
  return { seed, runtime };
}

export function listedCases(report) {
  if (report.errors?.length) throw new Error("Playwright collection failed");
  const cases = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) cases.push(`${spec.file}:${spec.line}:${spec.column}:${spec.title}:${test.projectName ?? ""}`);
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  visit(report);
  return cases;
}

export function selectedPhases(listings) {
  const seen = new Set();
  const selected = suitePhases.filter((phase) => {
    if (!Array.isArray(listings[phase])) throw new Error(`Missing collection for ${phase}`);
    for (const key of listings[phase]) {
      if (seen.has(key)) throw new Error(`Duplicate E2E case: ${key}`);
      seen.add(key);
    }
    return listings[phase].length > 0;
  });
  if (!seen.size) throw new Error("No tests selected");
  return selected;
}

// Every exact owned resource gets a cleanup attempt, even after partial failure.
export async function cleanupPhase(steps) {
  const failures = [];
  for (const [resource, cleanup] of steps) {
    try { await cleanup(); } catch { failures.push(resource); }
  }
  if (failures.length) throw new Error(`E2E cleanup failed: ${failures.join(", ")}`);
}
