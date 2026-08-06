import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

type SecurityHeaderOptions = {
  xFrameOptions?: "DENY" | "SAMEORIGIN";
};

function createApplicationContentSecurityPolicy() {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "script-src-attr 'none'",
    "worker-src 'self' blob:",
    "connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
  ];

  if (process.env.NODE_ENV === "production") {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

function createFaceDetectionContentSecurityPolicy() {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-eval' blob:",
    "script-src-attr 'none'",
    "worker-src 'self' blob:",
    "connect-src 'self'",
  ].join("; ");
}

function createSecurityHeaders({
  xFrameOptions = "DENY",
}: SecurityHeaderOptions = {}) {
  return [
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
      key: "Content-Security-Policy-Report-Only",
      value: createApplicationContentSecurityPolicy(),
    },
  ];
}

const securityHeaders = createSecurityHeaders();
const faceDetectionFrameHeaders = [
  ...createSecurityHeaders({
    xFrameOptions: "SAMEORIGIN",
  }).filter((header) => header.key !== "Content-Security-Policy-Report-Only"),
  {
    key: "Content-Security-Policy",
    value: createFaceDetectionContentSecurityPolicy(),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@prisma/adapter-pg",
    "archiver",
    "pdfjs-dist",
    "pg",
    "pg-boss",
    "read-excel-file",
  ],
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

const sentryOrg = process.env.SENTRY_ORG?.trim();
const sentryProject = process.env.SENTRY_PROJECT?.trim();
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();
const sentryUploadEnabled = Boolean(
  sentryOrg && sentryProject && sentryAuthToken,
);

const sentryConfig = withSentryConfig(nextConfig, {
  org: sentryOrg,
  project: sentryProject,
  authToken: sentryAuthToken,
  silent: !sentryUploadEnabled,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
});

if (sentryConfig.experimental?.clientTraceMetadata) {
  delete sentryConfig.experimental.clientTraceMetadata;
}

export default sentryConfig;
