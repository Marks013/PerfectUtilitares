import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { compare, hash } from "bcryptjs";
import { z } from "zod";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
  requireSession,
} from "@/lib/api/security";
import { BCRYPT_PASSWORD_MAX_LENGTH } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const accountPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: z.string().min(8).max(BCRYPT_PASSWORD_MAX_LENGTH).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.newPassword && !value.currentPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["currentPassword"],
        message: "Informe a senha atual",
      });
    }

    if (value.currentPassword && !value.newPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["newPassword"],
        message: "Informe a nova senha",
      });
    }
  });

export function GET() {
  return methodNotAllowed(["PATCH", "DELETE"]);
}

export async function PATCH(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) {
    return guard.response;
  }

  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "account-update",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) {
    return contentTypeError;
  }

  const contentLengthError = requireMaxContentLength(request, 8 * 1024);
  if (contentLengthError) {
    return contentLengthError;
  }

  const json = await readJsonBody(request);
  if (!json.ok) {
    return json.response;
  }

  const parsed = accountPatchSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Dados inválidos",
      parsed.error.issues,
    );
  }

  if (!parsed.data.name && !parsed.data.newPassword) {
    return jsonError(400, "EMPTY_UPDATE", "Informe o que deseja alterar");
  }

  const userId = guard.session.user.id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, passwordHash: true },
  });

  if (!user) {
    return jsonError(404, "USER_NOT_FOUND", "Usuário não encontrado");
  }

  const data: { name?: string; passwordHash?: string } = {};
  const metadata: Record<string, boolean> = {};

  if (parsed.data.name && parsed.data.name !== user.name) {
    data.name = parsed.data.name;
    metadata.nameChanged = true;
  }

  if (parsed.data.newPassword) {
    const validPassword = await compare(
      parsed.data.currentPassword ?? "",
      user.passwordHash,
    );

    if (!validPassword) {
      return jsonError(403, "INVALID_PASSWORD", "Senha atual incorreta");
    }

    data.passwordHash = await hash(parsed.data.newPassword, 12);
    metadata.passwordChanged = true;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, name: user.name });
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, name: true, email: true },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "SELF_UPDATE",
      entity: "User",
      entityId: updatedUser.id,
      metadata: metadata satisfies Prisma.InputJsonObject,
    },
  });

  return NextResponse.json({ ok: true, name: updatedUser.name });
}

export async function DELETE(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) {
    return guard.response;
  }

  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "account-delete",
    limit: 5,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  const userId = guard.session.user.id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, tenantId: true, role: true },
  });

  if (!user) {
    return jsonError(404, "USER_NOT_FOUND", "Usuário não encontrado");
  }

  await prisma.auditLog.create({
    data: {
      userId,
      action: "SELF_DELETE",
      entity: "User",
      entityId: user.id,
      metadata: {
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
      },
    },
  });

  await prisma.user.delete({ where: { id: userId } });

  return NextResponse.json({ ok: true });
}
