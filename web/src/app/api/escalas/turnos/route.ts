import { z } from "zod";
import { requireEscalaAccess } from "@/lib/escalas/access.server";
import { allowedBranches } from "@/lib/escalas/access";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { escalaFailure, escalaJson } from "../http";
import { listTurnoCatalog, syncTurnoCatalog } from "@/lib/escalas/shift-catalog/catalog";
import { applyTurnoSwap, previewTurnoSwap } from "@/lib/escalas/shift-catalog/swap";

export const runtime = "nodejs";
const id = z.string().min(1).max(100);
const revision = z.number().int().min(1).max(2_000_000_000);
const clockDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sync = z.object({
  action: z.literal("SYNC"),
  sources: z.array(z.object({
    workspaceId: id,
    expectedRevision: revision,
    localShiftIds: z.array(id).min(1).max(120),
  }).strict()).min(1).max(50),
  confirm: z.literal(true),
}).strict();
const swapCore = {
  workspaceId: id,
  expectedRevision: revision,
  employeeId: id,
  catalogCode: z.number().int().min(1500).max(2_000_000_000),
  effectiveFrom: clockDate,
  effectiveUntil: clockDate,
};
const preview = z.object({ action: z.literal("PREVIEW_SWAP"), ...swapCore }).strict();
const apply = z.object({ action: z.literal("APPLY_SWAP"), ...swapCore, previewId: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) }).strict();
const command = z.discriminatedUnion("action", [sync, preview, apply]);

export async function GET(request: Request) {
  const guard = await requireEscalaAccess();
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const parsed = z.object({
    search: z.string().max(48).default(""),
    cursor: z.coerce.number().int().min(0).max(2_000_000_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  }).strict().safeParse({
    search: params.get("search") ?? "",
    cursor: params.get("cursor") ?? "0",
    limit: params.get("limit") ?? "30",
  });
  if (!parsed.success) return jsonError(400, "TURNO_INVALID_QUERY", "Informe uma busca e uma página válidas.");
  try {
    const grants = await allowedBranches(guard.actor);
    if (grants && grants.length === 0) return jsonError(403, "ESCALA_BRANCH_FORBIDDEN", "Você não possui acesso a filiais desta empresa.");
    const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-turnos-read", limit: 60, windowMs: 60_000 });
    if (limited) return limited;
    return escalaJson(await listTurnoCatalog(guard.actor, parsed.data.search, parsed.data.cursor, parsed.data.limit));
  } catch (error) {
    return escalaFailure(error);
  }
}

export async function POST(request: Request) {
  const guard = await requireEscalaAccess();
  if (!guard.ok) return guard.response;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const contentError = requireContentType(request, ["application/json"]) ?? requireMaxContentLength(request, 512 * 1024);
  if (contentError) return contentError;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = command.safeParse(body.data);
  if (!parsed.success) return jsonError(400, "TURNO_INVALID_COMMAND", "A ação ou os dados da solicitação são inválidos.");
  try {
    const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-turnos-write", limit: 20, windowMs: 60_000 });
    if (limited) return limited;
    const data = parsed.data;
    if (data.action === "SYNC") return escalaJson(await syncTurnoCatalog(guard.actor, data), 201);
    if (data.action === "PREVIEW_SWAP") return escalaJson(await previewTurnoSwap(guard.actor, data));
    return escalaJson(await applyTurnoSwap(guard.actor, data));
  } catch (error) {
    return escalaFailure(error);
  }
}

export function PATCH() { return methodNotAllowed(["GET", "POST"]); }
export function DELETE() { return methodNotAllowed(["GET", "POST"]); }
