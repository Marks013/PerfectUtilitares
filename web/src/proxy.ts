import { NextResponse, type NextRequest } from "next/server";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function requestIdFor(request: NextRequest) {
  const received = request.headers.get("x-request-id")?.trim();
  return received && REQUEST_ID_PATTERN.test(received)
    ? received
    : crypto.randomUUID();
}

function nonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes));
}

function contentSecurityPolicy(value: string) {
  const developmentEval =
    process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${value}' 'strict-dynamic' blob:${developmentEval}`,
    "script-src-attr 'none'",
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const requestId = requestIdFor(request);
  const requestNonce = nonce();
  const policy = contentSecurityPolicy(requestNonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  requestHeaders.set("x-nonce", requestNonce);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("x-request-id", requestId);
  response.headers.delete("Server");
  response.headers.delete("X-Powered-By");
  return response;
}

export const config = {
  matcher: [
    "/((?!api/pdf/jobs/[^/]+/(?:files|images|documents)(?:/|$)|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|mediapipe/face-detection-frame.html|.*\\.(?:css|js|map|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|wasm)$).*)",
  ],
};
