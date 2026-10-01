import { methodNotAllowed } from "@/lib/api/security";
import { handleEventAdjustment } from "@/lib/reajuste-salarial/event-adjustment-handler";

export const runtime = "nodejs";
export function GET() { return methodNotAllowed(["POST"]); }
export async function POST(request: Request) { return handleEventAdjustment(request, "analysis"); }
