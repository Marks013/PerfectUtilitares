import { requireEscalaAccess } from "@/lib/escalas/access.server";
import { z } from "zod";
import { enforcePersistentRateLimit, jsonError, methodNotAllowed, readJsonBody, requireContentType, requireMaxContentLength, requireSameOrigin } from "@/lib/api/security";
import { branchPermission, requireEscalaPermission } from "@/lib/escalas/access";
import { createEscala, deleteEscala, generateEscala, getEscala, listEscalas, parseEscalaInput, saveEscala } from "@/lib/escalas/service";
import { validateEscala } from "@/lib/escalas/validation";
import { solveOwner, startGenerationOperation, runGenerationOperation, cancelGenerationOperation, generationOperationStatus } from "@/lib/escalas/solve-operations";
import { escalaFailure, escalaJson } from "./http";

export const runtime = "nodejs";
export const maxDuration = 120;
const id = z.string().trim().min(1).max(100);
const version = { id, expectedRevision: z.number().int().min(1).max(2_000_000_000) };
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE"), input: z.unknown() }).strict(),
  z.object({ action: z.literal("SAVE"), ...version, input: z.unknown() }).strict(),
  z.object({ action: z.literal("VALIDATE"), input: z.unknown() }).strict(),
  z.object({ action: z.literal("GENERATE"), ...version, operationId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal("START_GENERATION"), ...version }).strict(),
  z.object({ action: z.literal("CANCEL_GENERATION"), operationId: z.uuid() }).strict(),
  z.object({ action: z.literal("GENERATION_STATUS"), operationId: z.uuid() }).strict(),
  z.object({ action: z.literal("PUBLISH"), ...version }).strict(),
]);

export async function GET(request: Request) {
  const guard = await requireEscalaAccess();
  if (!guard.ok) return guard.response;
  try {
    const actor = guard.actor;
    const requestedId = new URL(request.url).searchParams.get("id");
    if (requestedId !== null) {
      if (!id.safeParse(requestedId).success) return jsonError(400, "ESCALA_INVALID_ID", "Identificador de escala inválido.");
      return escalaJson(await getEscala(actor, requestedId));
    }
    return escalaJson({ workspaces: await listEscalas(actor), canCreate: actor.admin || Boolean(actor.moduleSessionId) });
  } catch (error) { return escalaFailure(error); }
}

export async function POST(request: Request) {
  const guard = await requireEscalaAccess();
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
    const actor = guard.actor;
    const data = parsed.data;
    const expensive = data.action === "GENERATE";
    const control = data.action === "CANCEL_GENERATION" || data.action === "GENERATION_STATUS";
    const limited = await enforcePersistentRateLimit(request, { keyPrefix: control ? "escalas-control" : expensive ? "escalas-solver" : "escalas-write", limit: control ? 90 : expensive ? 6 : 30, windowMs: expensive ? 600_000 : 60_000 });
    if (limited) return limited;
    switch (data.action) {
      case "CREATE": return escalaJson(await createEscala(actor, parseEscalaInput(data.input)), 201);
      case "SAVE": return escalaJson(await saveEscala(actor, data.id, data.expectedRevision, parseEscalaInput(data.input)));
      case "VALIDATE": {
        const input = parseEscalaInput(data.input);
        requireEscalaPermission(await branchPermission(actor, input.branchCode), "edit");
        return escalaJson(validateEscala(input));
      }
      case "START_GENERATION": return escalaJson(await startGenerationOperation(actor, solveOwner(request, actor), data.id, data.expectedRevision), 201);
      case "CANCEL_GENERATION": return escalaJson(await cancelGenerationOperation(actor, solveOwner(request, actor), data.operationId));
      case "GENERATION_STATUS": return escalaJson(await generationOperationStatus(actor, solveOwner(request, actor), data.operationId));
      case "GENERATE": return escalaJson(data.operationId
        ? await runGenerationOperation(actor, solveOwner(request, actor), data.operationId, data.id, data.expectedRevision, request.signal)
        : await generateEscala(actor, data.id, data.expectedRevision, { signal: request.signal }));
      case "PUBLISH": {
        const current = await getEscala(actor, data.id);
        return escalaJson(await saveEscala(actor, data.id, data.expectedRevision, current.input, true));
      }
    }
  } catch (error) { return escalaFailure(error); }
}

export function PATCH() { return methodNotAllowed(["GET", "POST", "DELETE"]); }

export async function DELETE(request: Request) {
  const guard = await requireEscalaAccess();
  if (!guard.ok) return guard.response;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const contentError = requireContentType(request, ["application/json"]) ?? requireMaxContentLength(request, 4096);
  if (contentError) return contentError;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = z.object({ workspaceId: id, expectedRevision: version.expectedRevision }).strict().safeParse(body.data);
  if (!parsed.success) return jsonError(400, "ESCALA_INVALID_COMMAND", "Informe o planejamento selecionado e sua revisão atual para excluir.");
  try {
    const actor = guard.actor;
    const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-write", limit: 30, windowMs: 60_000 });
    if (limited) return limited;
    return escalaJson(await deleteEscala(actor, parsed.data.workspaceId, parsed.data.expectedRevision));
  } catch (error) { return escalaFailure(error); }
}
