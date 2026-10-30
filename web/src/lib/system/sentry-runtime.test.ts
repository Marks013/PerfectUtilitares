import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("captures real SDK errors and streamed spans with an in-memory transport", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import * as Sentry from "@sentry/node";
    import { nodeProfilingIntegration } from "@sentry/profiling-node";
    import { beforeSendScrubber, sentryDataCollection } from "./src/sentry.shared.ts";
    const envelopes = [];
    const client = Sentry.init({
      dsn: "https://0123456789abcdef0123456789abcdef@telemetry.invalid/1",
      dataCollection: sentryDataCollection,
      beforeSend: beforeSendScrubber,
      tracesSampleRate: 1,
      profileSessionSampleRate: 0,
      profileLifecycle: "trace",
      integrations: [nodeProfilingIntegration()],
      transport: () => ({
        send: async envelope => { envelopes.push(envelope); return { statusCode: 200 }; },
        flush: async () => true,
      }),
    });
    assert(client, "The real SDK must initialize");
    await Sentry.startSpan({ name: "synthetic-regression", op: "test" }, async () => {
      await Sentry.startSpan({ name: "synthetic-child", op: "test.child" }, async () => {
        Sentry.withScope(scope => {
          scope.setUser({ email: "synthetic-secret@example.invalid" });
          scope.setExtras({ token: "synthetic-secret" });
          scope.addBreadcrumb({ message: "synthetic-secret" });
          Sentry.captureException(new Error("Synthetic telemetry regression"));
        });
      });
    });
    assert.equal(await Sentry.flush(5000), true);
    const items = envelopes.flatMap(envelope => envelope[1]);
    const errors = items.filter(item => item[0].type === "event");
    const spans = items.filter(item => ["span", "transaction"].includes(item[0].type));
    assert.equal(errors.length, 1, "One actual error envelope must be delivered");
    assert(spans.length > 0, "Tracing must still deliver actual span envelopes");
    assert.equal(errors[0][1].exception.values[0].value, "Synthetic telemetry regression");
    assert.equal(errors[0][1].user, undefined);
    assert.equal(errors[0][1].breadcrumbs, undefined);
    assert.equal(errors[0][1].extra, undefined);
    assert(!JSON.stringify(envelopes).includes("synthetic-secret"), "Sensitive context must never reach the transport");
    assert.equal(client.getOptions().dataCollection.userInfo, false);
    assert.equal(client.getOptions().dataCollection.cookies, false);
    assert.equal(await Sentry.close(5000), true);
    console.log("telemetry-runtime-ok");
  `], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
    encoding: "utf8",
    timeout: 20_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe("telemetry-runtime-ok");
}, 30_000);
