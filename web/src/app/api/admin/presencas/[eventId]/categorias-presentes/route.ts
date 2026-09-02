import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
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
import { normalizePresenceGiftCategoryName } from "@/lib/presence/gift-category";
import {
  presenceGiftCategoryCreateSchema,
  presenceGiftCategoryOrderSchema,
  zodPresenceIssues,
} from "@/lib/presence/schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ eventId: string }> };

async function eventForAdmin(eventId: string, tenantId: string) {
  return prisma.presenceEvent.findFirst({
    where: { id: eventId, tenantId },
    select: { id: true },
  });
}

async function input(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return { ok: false as const, response: originError };
  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return { ok: false as const, response: contentTypeError };
  const lengthError = requireMaxContentLength(request, 8 * 1024);
  if (lengthError) return { ok: false as const, response: lengthError };
  return readJsonBody(request);
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const tenantId = guard.session.user.tenantId;
  if (!tenantId) return jsonError(403, "ADMIN_TENANT_REQUIRED", "Administrador sem empresa vinculada.");
  const limited = await enforcePersistentRateLimit(request, { keyPrefix: "admin-presence-gift-categories-create", limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await input(request);
  if (!body.ok) return body.response;
  const parsed = presenceGiftCategoryCreateSchema.safeParse(body.data);
  if (!parsed.success) return jsonError(400, "VALIDATION_ERROR", "Revise os dados da categoria.", zodPresenceIssues(parsed.error));
  const { eventId } = await context.params;
  if (!(await eventForAdmin(eventId, tenantId))) return jsonError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");

  try {
    const last = await prisma.presenceGiftCategory.aggregate({ where: { eventId }, _max: { position: true } });
    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.presenceGiftCategory.create({
        data: {
          eventId,
          name: parsed.data.name,
          normalizedName: normalizePresenceGiftCategoryName(parsed.data.name),
          emoji: parsed.data.emoji,
          position: (last._max.position ?? -1) + 1,
        },
        select: { id: true, name: true, emoji: true, position: true, _count: { select: { gifts: true } } },
      });
      await tx.presenceEvent.update({ where: { id: eventId }, data: { publicRevision: { increment: 1 } } });
      await tx.presenceActivity.create({ data: { eventId, actorUserId: guard.session.user.id, action: "CREATE", entityType: "PresenceGiftCategory", entityId: created.id } });
      return created;
    });
    return NextResponse.json(category, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return jsonError(409, "GIFT_CATEGORY_EXISTS", "Já existe uma categoria com este nome.");
    }
    throw error;
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const tenantId = guard.session.user.tenantId;
  if (!tenantId) return jsonError(403, "ADMIN_TENANT_REQUIRED", "Administrador sem empresa vinculada.");
  const limited = await enforcePersistentRateLimit(request, { keyPrefix: "admin-presence-gift-categories-order", limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await input(request);
  if (!body.ok) return body.response;
  const parsed = presenceGiftCategoryOrderSchema.safeParse(body.data);
  if (!parsed.success) return jsonError(400, "VALIDATION_ERROR", "Revise a ordem das categorias.", zodPresenceIssues(parsed.error));
  if (new Set(parsed.data.orderedIds).size !== parsed.data.orderedIds.length) return jsonError(400, "DUPLICATE_CATEGORY", "A ordem contém categorias repetidas.");
  const { eventId } = await context.params;
  if (!(await eventForAdmin(eventId, tenantId))) return jsonError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
  const count = await prisma.presenceGiftCategory.count({ where: { eventId, id: { in: parsed.data.orderedIds } } });
  if (count !== parsed.data.orderedIds.length) return jsonError(400, "INVALID_CATEGORY_ORDER", "A ordem inclui uma categoria de outro evento.");
  await prisma.$transaction([
    ...parsed.data.orderedIds.map((id, position) => prisma.presenceGiftCategory.update({ where: { id }, data: { position } })),
    prisma.presenceEvent.update({ where: { id: eventId }, data: { publicRevision: { increment: 1 } } }),
    prisma.presenceActivity.create({ data: { eventId, actorUserId: guard.session.user.id, action: "REORDER", entityType: "PresenceGiftCategory" } }),
  ]);
  return NextResponse.json({ reordered: count }, { headers: { "Cache-Control": "private, no-store" } });
}

export function GET() { return methodNotAllowed(["POST", "PATCH"]); }
export function DELETE() { return methodNotAllowed(["POST", "PATCH"]); }
