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
  request?: { cookies?: unknown; headers?: Record<string, unknown> };
  user?: { email?: unknown; ip_address?: unknown };
};

export function beforeSendScrubber<T extends ScrubbableEvent>(event: T): T {
  if (!event || typeof event !== "object") {
    return event;
  }

  if (event.request) {
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
    }
  }

  if (event.user) {
    delete event.user.ip_address;
  }

  return event;
}
