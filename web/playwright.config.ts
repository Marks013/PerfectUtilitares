import { defineConfig, devices } from "@playwright/test";
import { createRequire } from "node:module";

// Node 24 loads this pure ESM helper synchronously; no generated declarations.
const { phaseSelection } = createRequire(import.meta.url)("./scripts/e2e-suite-plan.mjs") as {
  phaseSelection: (phase: string) => { testMatch?: string[]; testIgnore?: string[] };
};
const phase = process.env.E2E_SUITE_PHASE;
const artifacts = process.env.E2E_ARTIFACT_DIR;
if (phase && !process.env.E2E_EXTERNAL_URL) throw new Error("Isolated phases require their runner-owned application");

const externalUrl = process.env.E2E_EXTERNAL_URL?.replace(/\/$/, "");
const localPort = process.env.E2E_PORT || "3002";
const baseURL = externalUrl || `http://127.0.0.1:${localPort}`;

export default defineConfig({
  testDir: "./e2e",
  ...(phase ? phaseSelection(phase) : {}),
  ...(artifacts ? { outputDir: `${artifacts}/test-results` } : {}),
  fullyParallel: false,
  workers: 1,
  retries: phase === "nominal" ? 0 : process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: artifacts ? [[process.env.CI ? "github" : "line"], ["json"]] : process.env.CI ? "github" : "line",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // The isolated production runner uses an ephemeral localhost certificate.
    ignoreHTTPSErrors: process.env.E2E_PRODUCTION === "1",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: externalUrl
    ? undefined
    : {
        command: `PORT=${localPort} HOSTNAME=127.0.0.1 node .next/standalone/server.js`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
