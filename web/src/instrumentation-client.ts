import * as Sentry from "@sentry/nextjs";
import { beforeSendScrubber, sentrySampleRate } from "./sentry.shared";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: sentrySampleRate(
    process.env.SENTRY_TRACES_SAMPLE_RATE,
    process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  ),
  replaysSessionSampleRate: sentrySampleRate(
    process.env.SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
    0,
  ),
  replaysOnErrorSampleRate: sentrySampleRate(
    process.env.SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
    1.0,
  ),
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
    Sentry.feedbackIntegration({
      colorScheme: "system",
    }),
  ],
  beforeSend: beforeSendScrubber,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
