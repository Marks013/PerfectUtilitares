import * as Sentry from "@sentry/nextjs";
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
  beforeSend: beforeSendScrubber,
});
