import { defineConfig, devices } from "@playwright/test";

const externalUrl = process.env.E2E_EXTERNAL_URL?.replace(/\/$/, "");
const localPort = process.env.E2E_PORT || "3002";
const baseURL = externalUrl || `http://127.0.0.1:${localPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? "github" : "line",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
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
