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
import { presenceGiftCategoryUpdateSchema, zodPresenceIssues } from "@/lib/presence/schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ eventId: string; categoryId: string }> };

async function ownedCategory(eventId: string, categoryId: string, tenantId: string) {
  return prisma.presenceGiftCategory.findFirst({
    where: { id: categoryId, eventId, event: { tenantId } },
    select: { id: true },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const tenantId = guard.session.user.tenantId;
  if (!tenantId) return jsonError(403, "ADMIN_TENANT_REQUIRED", "Administrador sem empresa vinculada.");
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await enforcePersistentRateLimit(request, { keyPrefix: "admin-presence-gift-categories-update", limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const typeError = requireContentType(request, ["application/json"]);
  if (typeError) return typeError;
  const lengthError = requireMaxContentLength(request, 8 * 1024);
  if (lengthError) return lengthError;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = presenceGiftCategoryUpdateSchema.safeParse(body.data);
  if (!parsed.success) return jsonError(400, "VALIDATION_ERROR", "Revise os dados da categoria.", zodPresenceIssues(parsed.error));
  const { eventId, categoryId } = await context.params;
  if (!(await ownedCategory(eventId, categoryId, tenantId))) return jsonError(404, "GIFT_CATEGORY_NOT_FOUND", "Categoria não encontrada.");
  try {
    const category = await prisma.$transaction(async (tx) => {
      const updated = await tx.presenceGiftCategory.update({
        where: { id: categoryId },
        data: {
          ...parsed.data,
          ...(parsed.data.name ? { normalizedName: normalizePresenceGiftCategoryName(parsed.data.name) } : {}),
        },
        select: { id: true, name: true, emoji: true, position: true, _count: { select: { gifts: true } } },
      });
      await tx.presenceEvent.update({ where: { id: eventId }, data: { publicRevision: { increment: 1 } } });
      return updated;
    });
    return NextResponse.json(category, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return jsonError(409, "GIFT_CATEGORY_EXISTS", "Já existe uma categoria com este nome.");
    throw error;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const tenantId = guard.session.user.tenantId;
  if (!tenantId) return jsonError(403, "ADMIN_TENANT_REQUIRED", "Administrador sem empresa vinculada.");
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await enforcePersistentRateLimit(request, { keyPrefix: "admin-presence-gift-categories-delete", limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const { eventId, categoryId } = await context.params;
  if (!(await ownedCategory(eventId, categoryId, tenantId))) return jsonError(404, "GIFT_CATEGORY_NOT_FOUND", "Categoria não encontrada.");
  await prisma.$transaction([
    prisma.presenceGiftCategory.delete({ where: { id: categoryId } }),
    prisma.presenceEvent.update({ where: { id: eventId }, data: { publicRevision: { increment: 1 } } }),
    prisma.presenceActivity.create({ data: { eventId, actorUserId: guard.session.user.id, action: "DELETE", entityType: "PresenceGiftCategory", entityId: categoryId } }),
  ]);
  return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "private, no-store" } });
}

export function GET() { return methodNotAllowed(["PATCH", "DELETE"]); }
export function POST() { return methodNotAllowed(["PATCH", "DELETE"]); }
