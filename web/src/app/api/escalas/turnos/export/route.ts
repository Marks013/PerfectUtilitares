import { z } from "zod";
import { requireEscalaAccess } from "@/lib/escalas/access.server";
import { enforcePersistentRateLimit, jsonError, methodNotAllowed } from "@/lib/api/security";
import { escalaFailure } from "../../http";
import { downloadTurnoExport } from "@/lib/escalas/shift-catalog/export";

export const runtime = "nodejs";
const querySchema = z.object({
  manifestId: z.string().min(1).max(100),
  format: z.enum(["TXT1", "TXT2"]),
  acceptOmissions: z.enum(["true", "false"]).default("false"),
}).strict();

export async function GET(request: Request) {
  const guard = await requireEscalaAccess();
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    manifestId: params.get("manifestId"),
    format: params.get("format"),
    acceptOmissions: params.get("acceptOmissions") ?? "false",
  });
  if (!parsed.success) return jsonError(400, "TURNO_INVALID_EXPORT", "Informe um manifesto e formato TXT válidos.");
  try {
    const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-turnos-download", limit: 12, windowMs: 60_000 });
    if (limited) return limited;
    const result = await downloadTurnoExport(guard.actor, parsed.data.manifestId, parsed.data.format, parsed.data.acceptOmissions === "true");
    return new Response(Buffer.from(result.bytes), { headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="turnos-${result.year}-${String(result.month).padStart(2, "0")}-${parsed.data.format}.txt"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Cookie",
    } });
  } catch (error) {
    return escalaFailure(error);
  }
}

export function POST() { return methodNotAllowed(["GET"]); }
export function PATCH() { return methodNotAllowed(["GET"]); }
export function DELETE() { return methodNotAllowed(["GET"]); }
