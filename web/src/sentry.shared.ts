export function sentrySampleRate(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 0), 1);
}

type ScrubbableEvent = {
  breadcrumbs?: unknown;
  extra?: unknown;
  request?: {
    cookies?: unknown;
    data?: unknown;
    headers?: Record<string, unknown>;
    query_string?: unknown;
    url?: unknown;
  };
  user?: { email?: unknown; ip_address?: unknown };
};

export function validatedSentryDsn(value: string | undefined) {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function beforeSendScrubber<T extends ScrubbableEvent>(event: T): T {
  if (!event || typeof event !== "object") {
    return event;
  }

  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    delete event.request.url;
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (
          /^(authorization|cookie|referer|x-forwarded-for|x-real-ip)$/i.test(
            key,
          )
        ) {
          delete event.request.headers[key];
        }
      }
    }
  }
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;

  return event;
}
