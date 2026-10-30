import { createHash } from "node:crypto";
import { test as base, expect } from "@playwright/test";

/** Keep production rate limits intact while isolating unrelated disposable-DB tests. */
export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use, info) => {
    const isolated = process.env.E2E_MUTATION === "1" && process.env.E2E_EXTERNAL_URL;
    const host = isolated ? new URL(process.env.E2E_EXTERNAL_URL as string).hostname : "";
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return use(extraHTTPHeaders);
    const hash = createHash("sha256").update(info.testId).digest();
    await use({ ...extraHTTPHeaders, "x-real-ip": "198.18." + hash[0] + "." + hash[1] });
  },
});
export { expect };
export type { Page, Route, Response } from "@playwright/test";
