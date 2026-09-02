import { NextResponse } from "next/server";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireAdmin,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { presenceGiftUpdateSchema, zodPresenceIssues } from "@/lib/presence/schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ eventId: string; giftId: string }> };

async function ownedGift(eventId: string, giftId: string, tenantId: string) {
  return prisma.presenceGift.findFirst({
    where: { id: giftId, eventId, event: { tenantId } },
    select: {
      id: true,
      quantity: true,
      reservedManually: true,
      reservedByGuestId: true,
      _count: { select: { reservations: true } },
    },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const tenantId = guard.session.user.tenantId;
  if (!tenantId) return jsonError(403, "ADMIN_TENANT_REQUIRED", "Administrador sem empresa vinculada.");
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await enforcePersistentRateLimit(request, { keyPrefix: "admin-presence-gifts-update", limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;
  const contentLengthError = requireMaxContentLength(request, 8 * 1024);
  if (contentLengthError) return contentLengthError;
  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = presenceGiftUpdateSchema.safeParse(json.data);
  if (!parsed.success) return jsonError(400, "VALIDATION_ERROR", "Revise os dados do presente.", zodPresenceIssues(parsed.error));
  const { eventId, giftId } = await context.params;
  const current = await ownedGift(eventId, giftId, tenantId);
  if (!current) return jsonError(404, "GIFT_NOT_FOUND", "Presente não encontrado.");

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

  const { clearReservation, ...data } = parsed.data;
  const targetQuantity =
    data.quantity === undefined ? current.quantity : data.quantity;
  const selectedReservation = data.reservedByGuestId
    ? await prisma.presenceGiftReservation.findUnique({
        where: { giftId_guestId: { giftId, guestId: data.reservedByGuestId } },
        select: { id: true },
      })
    : null;
  const clearAll =
    Boolean(clearReservation) ||
    (data.reservedByGuestId === null && data.reservedManually === false);

  let reservationCount = clearAll ? 0 : current._count.reservations;
  if (data.reservedByGuestId && !selectedReservation && !clearAll) {
    reservationCount += 1;
  }
  const targetManual = clearAll
    ? false
    : data.reservedByGuestId
      ? false
      : data.reservedManually ?? current.reservedManually;
  const targetUsed = reservationCount + (targetManual ? 1 : 0);

  if (targetQuantity !== null && targetUsed > targetQuantity) {
    return jsonError(
      409,
      "GIFT_CAPACITY_TOO_SMALL",
      `A quantidade não pode ser menor que as ${targetUsed} escolha(s) atuais.`,
    );
  }

  const gift = await prisma.$transaction(async (tx) => {
    if (clearAll) {
      await tx.presenceGiftReservation.deleteMany({ where: { giftId } });
    } else if (data.reservedByGuestId) {
      await tx.presenceGiftReservation.upsert({
        where: { giftId_guestId: { giftId, guestId: data.reservedByGuestId } },
        update: {},
        create: { giftId, guestId: data.reservedByGuestId, reservedAt: new Date() },
      });
    }

    const updated = await tx.presenceGift.update({
      where: { id: current.id },
      data: {
        ...data,
        ...(data.reservedByGuestId
          ? { reservedManually: false, reservedAt: new Date() }
          : data.reservedManually === false
            ? { reservedByGuestId: null, reservedAt: null }
            : data.reservedManually
              ? { reservedAt: new Date() }
              : {}),
        ...(clearReservation
          ? { reservedByGuestId: null, reservedManually: false, reservedAt: null, version: { increment: 1 } }
          : {}),
      },
      select: {
        id: true, categoryId: true, emoji: true, title: true, description: true,
        externalUrl: true, position: true, active: true, quantity: true,
        reservedManually: true, reservedAt: true,
        reservedByGuest: { select: { id: true, name: true } },
        _count: { select: { reservations: true } },
      },
    });
    await tx.presenceActivity.create({
      data: {
        eventId,
        actorUserId: guard.session.user.id,
        action: clearReservation ? "RELEASE" : "UPDATE",
        entityType: "PresenceGift",
        entityId: updated.id,
      },
    });
    await tx.presenceEvent.update({
      where: { id: eventId },
      data: { publicRevision: { increment: 1 } },
    });
    return updated;
  });

  const reservedCount =
    gift._count.reservations + (gift.reservedManually ? 1 : 0);
  const { _count, ...giftData } = gift;
  return NextResponse.json({
    ...giftData,
    reservedCount,
    availableCount:
      gift.quantity === null ? null : Math.max(0, gift.quantity - reservedCount),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const tenantId = guard.session.user.tenantId;
  if (!tenantId) return jsonError(403, "ADMIN_TENANT_REQUIRED", "Administrador sem empresa vinculada.");
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await enforcePersistentRateLimit(request, { keyPrefix: "admin-presence-gifts-delete", limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const { eventId, giftId } = await context.params;
  const gift = await ownedGift(eventId, giftId, tenantId);
  if (!gift) return jsonError(404, "GIFT_NOT_FOUND", "Presente não encontrado.");
  if (gift._count.reservations > 0 || gift.reservedManually) {
    return jsonError(409, "GIFT_RESERVED", "Libere as escolhas antes de excluir este presente.");
  }
  await prisma.$transaction([
    prisma.presenceGift.delete({ where: { id: gift.id } }),
    prisma.presenceEvent.update({ where: { id: eventId }, data: { publicRevision: { increment: 1 } } }),
  ]);
  return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "private, no-store" } });
}
export function GET() { return methodNotAllowed(["PATCH", "DELETE"]); }
export function POST() { return methodNotAllowed(["PATCH", "DELETE"]); }
