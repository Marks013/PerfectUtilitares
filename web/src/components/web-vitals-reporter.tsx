"use client";

import { useReportWebVitals } from "next/web-vitals";

const PUBLIC_PATHS = new Set([
  "/dashboard",
  "/jornada/validar",
  "/fotos",
  "/pdf",
  "/privacidade",
  "/cookies",
  "/termos",
  "/contato",
]);

const TRACKED_METRICS = new Set(["CLS", "FCP", "INP", "LCP", "TTFB"]);

export function isPublicPerformancePath(pathname: string) {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/pdf/");
}

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    const pathname = window.location.pathname;
    if (!isPublicPerformancePath(pathname) || !TRACKED_METRICS.has(metric.name)) {
      return;
    }

    const body = JSON.stringify({
      path: pathname,
      metric: metric.name,
      value: metric.value,
      rating: metric.rating,
      navigationType: metric.navigationType,
    });

    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/seo/web-vitals", blob)) return;

    void fetch("/api/seo/web-vitals", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
    });
  });

  return null;
}
