import * as Sentry from "@sentry/nextjs";
import { logLocalRequestError } from "./observability/request-error";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = (
  ...args: Parameters<typeof Sentry.captureRequestError>
) => {
  logLocalRequestError(args[0], args[1], args[2]);
  return Sentry.captureRequestError(...args);
};
