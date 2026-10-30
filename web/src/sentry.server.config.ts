import * as Sentry from "@sentry/nextjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import {
  beforeSendScrubber,
  sentryDataCollection,
  sentrySampleRate,
  validatedSentryDsn,
} from "./sentry.shared";

const dsn = validatedSentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  dataCollection: sentryDataCollection,
  tracesSampleRate: sentrySampleRate(
    process.env.SENTRY_TRACES_SAMPLE_RATE,
    process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  ),
  profileSessionSampleRate: sentrySampleRate(
    process.env.SENTRY_PROFILES_SAMPLE_RATE,
    process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  ),
  profileLifecycle: "trace",
  integrations: [nodeProfilingIntegration()],
  beforeSend: beforeSendScrubber,
});
