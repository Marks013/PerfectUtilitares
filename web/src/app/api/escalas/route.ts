import { z } from "zod";
import { enforcePersistentRateLimit, jsonError, methodNotAllowed, readJsonBody, requireContentType, requireMaxContentLength, requireSameOrigin, requireSession } from "@/lib/api/security";
import { branchPermission, escalaActor, requireEscalaPermission } from "@/lib/escalas/access";
import { createEscala, generateEscala, getEscala, listEscalas, parseEscalaInput, saveEscala, suggestEscala } from "@/lib/escalas/service";
import { validateEscala } from "@/lib/escalas/validation";
import { escalaFailure, escalaJson } from "./http";

export const runtime = "nodejs";
export const maxDuration = 120;
const id = z.string().trim().min(1).max(100);
const version = { id, expectedRevision: z.number().int().min(1).max(2_000_000_000) };
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE"), input: z.unknown() }).strict(),
  z.object({ action: z.literal("SAVE"), ...version, input: z.unknown() }).strict(),
  z.object({ action: z.literal("VALIDATE"), input: z.unknown() }).strict(),
  z.object({ action: z.literal("GENERATE"), ...version }).strict(),
  z.object({ action: z.literal("SUGGEST"), ...version, employeeId: id, weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ action: z.literal("PUBLISH"), ...version }).strict(),
]);

export async function GET(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  try {
    const actor = escalaActor(guard.session);
    const requestedId = new URL(request.url).searchParams.get("id");
    if (requestedId !== null) {
      if (!id.safeParse(requestedId).success) return jsonError(400, "ESCALA_INVALID_ID", "Identificador de escala inválido.");
      return escalaJson(await getEscala(actor, requestedId));
    }
    return escalaJson({ workspaces: await listEscalas(actor), canCreate: actor.admin });
  } catch (error) { return escalaFailure(error); }
}

export async function POST(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const contentError = requireContentType(request, ["application/json"]) ?? requireMaxContentLength(request, 4 * 1024 * 1024);
  if (contentError) return contentError;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = command.safeParse(body.data);
  if (!parsed.success) return jsonError(400, "ESCALA_INVALID_COMMAND", "A ação ou os dados da requisição são inválidos.");
  try {
    const actor = escalaActor(guard.session);
    const data = parsed.data;
    const expensive = data.action === "GENERATE" || data.action === "SUGGEST";
    const limited = await enforcePersistentRateLimit(request, { keyPrefix: expensive ? "escalas-solver" : "escalas-write", limit: expensive ? 6 : 30, windowMs: expensive ? 600_000 : 60_000 });
    if (limited) return limited;
    switch (data.action) {
      case "CREATE": return escalaJson(await createEscala(actor, parseEscalaInput(data.input)), 201);
      case "SAVE": return escalaJson(await saveEscala(actor, data.id, data.expectedRevision, parseEscalaInput(data.input)));
      case "VALIDATE": {
        const input = parseEscalaInput(data.input);
        requireEscalaPermission(await branchPermission(actor, input.branchCode), "edit");
        return escalaJson(validateEscala(input));
      }
      case "GENERATE": return escalaJson(await generateEscala(actor, data.id, data.expectedRevision));
      case "SUGGEST": return escalaJson(await suggestEscala(actor, data.id, data.expectedRevision, data.employeeId, data.weekStart));
      case "PUBLISH": {
        const current = await getEscala(actor, data.id);
        return escalaJson(await saveEscala(actor, data.id, data.expectedRevision, current.input, true));
      }
    }
  } catch (error) { return escalaFailure(error); }
}

export function PATCH() { return methodNotAllowed(["GET", "POST"]); }
export function DELETE() { return methodNotAllowed(["GET", "POST"]); }
