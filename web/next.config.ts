import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

type SecurityHeaderOptions = {
  allowUnsafeEval?: boolean;
  frameAncestors?: string;
  xFrameOptions?: "DENY" | "SAMEORIGIN";
};

function createContentSecurityPolicy({
  allowUnsafeEval = false,
  frameAncestors = "'none'",
}: SecurityHeaderOptions = {}) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `frame-ancestors ${frameAncestors}`,
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline'${allowUnsafeEval || process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""} blob:`,
    "worker-src 'self' blob:",
    "connect-src 'self' https://*.sentry.io",
  ].join("; ");
}

function createSecurityHeaders({
  allowUnsafeEval = false,
  frameAncestors = "'none'",
  xFrameOptions = "DENY",
}: SecurityHeaderOptions = {}) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: xFrameOptions },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Origin-Agent-Cluster", value: "?1" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    {
      key: "Content-Security-Policy",
      value: createContentSecurityPolicy({ allowUnsafeEval, frameAncestors }),
    },
  ];

  if (process.env.NODE_ENV === "production") {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }

  return headers;
}

const securityHeaders = createSecurityHeaders();
const faceDetectionFrameHeaders = createSecurityHeaders({
  allowUnsafeEval: true,
  frameAncestors: "'self'",
  xFrameOptions: "SAMEORIGIN",
});

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["read-excel-file"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/pdfkit/js/data/**/*"],
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        source: "/mediapipe/face-detection-frame.html",
        headers: faceDetectionFrameHeaders,
      },
    ];
  },
};

const sentryConfig = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
});

if (sentryConfig.experimental?.clientTraceMetadata) {
  delete sentryConfig.experimental.clientTraceMetadata;
}

export default sentryConfig;
