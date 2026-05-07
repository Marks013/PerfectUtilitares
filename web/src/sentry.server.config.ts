import * as Sentry from "@sentry/nextjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { beforeSendScrubber, sentrySampleRate } from "./sentry.shared";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: sentrySampleRate(
    process.env.SENTRY_TRACES_SAMPLE_RATE,
    process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  ),
  profilesSampleRate: sentrySampleRate(
    process.env.SENTRY_PROFILES_SAMPLE_RATE,
    process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  ),
  integrations: [nodeProfilingIntegration()],
  beforeSend: beforeSendScrubber,
});
