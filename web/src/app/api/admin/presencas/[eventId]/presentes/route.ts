import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireAdmin,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import {
  presenceGiftCreateSchema,
  presenceGiftOrderSchema,
  zodPresenceIssues,
} from "@/lib/presence/schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ eventId: string }> };

async function ownedEvent(eventId: string, tenantId: string) {
  return prisma.presenceEvent.findFirst({
    where: { id: eventId, tenantId },
    select: { id: true },
  });
}

async function mutationInput(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return { ok: false as const, response: originError };
  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return { ok: false as const, response: contentTypeError };
  const contentLengthError = requireMaxContentLength(request, 16 * 1024);
  if (contentLengthError) return { ok: false as const, response: contentLengthError };
  return readJsonBody(request);
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const tenantId = guard.session.user.tenantId;
  if (!tenantId) return jsonError(403, "ADMIN_TENANT_REQUIRED", "Administrador sem empresa vinculada.");
  const limited = enforceRateLimit(request, { keyPrefix: "admin-presence-gifts-create", limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const input = await mutationInput(request);
  if (!input.ok) return input.response;
  const parsed = presenceGiftCreateSchema.safeParse(input.data);
  if (!parsed.success) return jsonError(400, "VALIDATION_ERROR", "Revise os dados do presente.", zodPresenceIssues(parsed.error));

  const { eventId } = await context.params;
  const event = await ownedEvent(eventId, tenantId);
  if (!event) return jsonError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
  if (parsed.data.categoryId) {
    const category = await prisma.presenceGiftCategory.findFirst({
      where: { id: parsed.data.categoryId, eventId },
      select: { id: true },
    });
    if (!category) return jsonError(400, "INVALID_GIFT_CATEGORY", "Selecione uma categoria deste evento.");
  }
  if (parsed.data.reservedByGuestId) {
    const guest = await prisma.presenceGuest.findFirst({
      where: { id: parsed.data.reservedByGuestId, eventId },
      select: { id: true },
    });
    if (!guest) return jsonError(400, "INVALID_GIFT_GUEST", "Selecione uma pessoa deste evento.");
  }
  const gift = await prisma.$transaction(async (transaction) => {
    const last = await transaction.presenceGift.aggregate({
      where: { eventId },
      _max: { position: true },
    });
    const created = await transaction.presenceGift.create({
      data: {
        eventId,
        ...parsed.data,
        reservedManually:
          parsed.data.reservedManually && !parsed.data.reservedByGuestId,
        reservedAt:
          parsed.data.reservedManually || parsed.data.reservedByGuestId
            ? new Date()
            : null,
        position: (last._max.position ?? -1) + 1,
      },
      select: {
        id: true,
        categoryId: true,
        emoji: true,
        title: true,
        description: true,
        externalUrl: true,
        position: true,
        active: true,
        reservedManually: true,
        reservedAt: true,
      },
    });
    await transaction.presenceActivity.create({
      data: {
        eventId,
        actorUserId: guard.session.user.id,
        action: "CREATE",
        entityType: "PresenceGift",
        entityId: created.id,
      },
    });
    await transaction.presenceEvent.update({
      where: { id: eventId },
      data: { publicRevision: { increment: 1 } },
    });
    return created;
  });
  return NextResponse.json(gift, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const tenantId = guard.session.user.tenantId;
  if (!tenantId) return jsonError(403, "ADMIN_TENANT_REQUIRED", "Administrador sem empresa vinculada.");
  const limited = enforceRateLimit(request, { keyPrefix: "admin-presence-gifts-order", limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const input = await mutationInput(request);
  if (!input.ok) return input.response;
  const parsed = presenceGiftOrderSchema.safeParse(input.data);
  if (!parsed.success) return jsonError(400, "VALIDATION_ERROR", "Revise a ordem dos presentes.", zodPresenceIssues(parsed.error));
  if (new Set(parsed.data.orderedIds).size !== parsed.data.orderedIds.length) {
    return jsonError(400, "DUPLICATE_GIFT", "A lista de ordenação contém itens repetidos.");
  }

  const { eventId } = await context.params;
  const event = await ownedEvent(eventId, tenantId);
  if (!event) return jsonError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
  const [ownedCount, totalCount] = await Promise.all([
    prisma.presenceGift.count({
      where: { eventId, id: { in: parsed.data.orderedIds } },
    }),
    prisma.presenceGift.count({ where: { eventId } }),
  ]);
  if (
    ownedCount !== parsed.data.orderedIds.length ||
    totalCount !== parsed.data.orderedIds.length
  ) {
    return jsonError(
      400,
      "INVALID_GIFT_ORDER",
      "Envie a lista completa de presentes deste evento.",
    );
  }
  await prisma.$transaction([
    ...parsed.data.orderedIds.map((id, position) => prisma.presenceGift.update({ where: { id }, data: { position } })),
    prisma.presenceEvent.update({ where: { id: eventId }, data: { publicRevision: { increment: 1 } } }),
    prisma.presenceActivity.create({ data: { eventId, actorUserId: guard.session.user.id, action: "REORDER", entityType: "PresenceGift" } }),
  ]);
  return NextResponse.json({ reordered: ownedCount }, { headers: { "Cache-Control": "private, no-store" } });
}

export function GET() { return methodNotAllowed(["POST", "PATCH"]); }
export function DELETE() { return methodNotAllowed(["POST", "PATCH"]); }
