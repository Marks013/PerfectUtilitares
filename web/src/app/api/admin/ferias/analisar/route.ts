import { methodNotAllowed } from "@/lib/api/security";
import { handleFeriasRequest } from "@/lib/ferias/route-handler";

export const runtime = "nodejs";

export function POST(request: Request) {
  return handleFeriasRequest(request, false);
}

export function GET() { return methodNotAllowed(["POST"]); }
export function PUT() { return methodNotAllowed(["POST"]); }
export function PATCH() { return methodNotAllowed(["POST"]); }
export function DELETE() { return methodNotAllowed(["POST"]); }
