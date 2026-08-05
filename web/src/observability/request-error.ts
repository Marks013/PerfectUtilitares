const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const SAFE_ROUTE_PATTERN = /^[A-Za-z0-9_./:[\]-]{1,180}$/;

function headerValue(request: unknown, name: string) {
  if (!request || typeof request !== "object" || !("headers" in request))
    return undefined;
  const headers = request.headers;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (headers && typeof headers === "object") {
    const value = (headers as Record<string, unknown>)[name];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export function logLocalRequestError(
  error: unknown,
  request: unknown,
  context: unknown,
) {
  const requestId = headerValue(request, "x-request-id");
  const route =
    context && typeof context === "object" && "routePath" in context
      ? String(context.routePath)
      : "unknown";
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "request_error",
      requestId:
        requestId && REQUEST_ID_PATTERN.test(requestId)
          ? requestId
          : "unavailable",
      route: SAFE_ROUTE_PATTERN.test(route) ? route : "redacted",
      error: {
        name: /^[A-Za-z][A-Za-z0-9_.-]{0,80}$/.test(name) ? name : "Error",
      },
    }),
  );
}
