import { describe, expect, it } from "vitest";
import {
  beforeSendScrubber,
  sentryDataCollection,
  sentrySampleRate,
  validatedSentryDsn,
} from "./sentry.shared";

describe("telemetry privacy across Sentry runtimes", () => {
  it("disables sensitive data collection, including the new Sentry 11 defaults", () => {
    expect(sentryDataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
      stackFrameVariables: false,
    });
  });

  it("scrubs explicitly supplied sensitive error context while retaining diagnostics", () => {
    const event = {
      message: "Synthetic error",
      request: {
        cookies: { session: "synthetic-secret" },
        data: "synthetic-body",
        query_string: "token=synthetic-secret",
        url: "https://example.invalid/?token=synthetic-secret",
        headers: {
          Authorization: "synthetic-secret",
          Cookie: "synthetic-secret",
          Referer: "synthetic-secret",
          "X-Forwarded-For": "192.0.2.1",
          "X-Real-IP": "192.0.2.1",
          "Content-Type": "application/json",
        },
      },
      user: { email: "synthetic@example.invalid", ip_address: "192.0.2.1" },
      breadcrumbs: [{ message: "synthetic-secret" }],
      extra: { token: "synthetic-secret" },
    };
    expect(beforeSendScrubber(event)).toEqual({
      message: "Synthetic error",
      request: { headers: { "Content-Type": "application/json" } },
    });
  });

  it.each([undefined, "", "http://example.invalid/1", "not-a-dsn"])(
    "does not enable telemetry with an absent or insecure DSN (%s)",
    (value) => expect(validatedSentryDsn(value)).toBeUndefined(),
  );

  it("accepts HTTPS configuration without altering it", () => {
    expect(validatedSentryDsn(" https://key@example.invalid/1 ")).toBe(
      "https://key@example.invalid/1",
    );
  });

  it("keeps sampling finite and bounded", () => {
    expect(sentrySampleRate(undefined, 0.1)).toBe(0.1);
    expect(sentrySampleRate("invalid", 0.1)).toBe(0.1);
    expect(sentrySampleRate("0.25", 0.1)).toBe(0.25);
    expect(sentrySampleRate("-1", 0.1)).toBe(0);
    expect(sentrySampleRate("2", 0.1)).toBe(1);
  });
});
