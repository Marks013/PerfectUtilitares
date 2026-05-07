import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  methodNotAllowed,
  requireAdmin,
  requireSameOrigin,
} from "@/lib/api/security";

export const runtime = "nodejs";

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "sentry-test",
    limit: 5,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  Sentry.captureMessage("Sentry test event", {
    level: "info",
    tags: { area: "monitoring" },
  });

  return NextResponse.json({ ok: true });
}
