import { NextResponse } from "next/server";
import {
  enforcePersistentRateLimit,
  methodNotAllowed,
} from "@/lib/api/security";
import { authenticateUnimedExcelDevice } from "@/lib/unimed/excel-device";
import { createUnimedExcelSnapshot } from "@/lib/unimed/excel-snapshot";

export const runtime = "nodejs";

function setSnapshotHeaders(response: NextResponse, etag: string) {
  response.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  response.headers.set("ETag", etag);
  response.headers.set("Vary", "Authorization, Accept-Encoding");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export async function GET(request: Request) {
  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "unimed-excel-snapshot",
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const access = await authenticateUnimedExcelDevice(request);
  if (!access.ok) return access.response;

  const snapshot = await createUnimedExcelSnapshot(access.tenantId);
  const etag = `"${snapshot.snapshotVersion}"`;
  if (request.headers.get("if-none-match") === etag) {
    return setSnapshotHeaders(new NextResponse(null, { status: 304 }), etag);
  }

  return setSnapshotHeaders(NextResponse.json(snapshot), etag);
}

export function POST() {
  return methodNotAllowed(["GET"]);
}

export function PUT() {
  return methodNotAllowed(["GET"]);
}

export function DELETE() {
  return methodNotAllowed(["GET"]);
}
