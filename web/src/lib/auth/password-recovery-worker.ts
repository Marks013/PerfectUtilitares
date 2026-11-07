import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PgBoss } from "pg-boss";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email/resend";
import { ensurePasswordRecoveryQueue, getRecoveryConfiguration, PASSWORD_RECOVERY_QUEUE, recoveryRequestSchema, type RecoveryRequest } from "@/lib/auth/password-recovery";

export async function readPasswordRecoverySecret() {
  const path = process.env.PASSWORD_RECOVERY_SECRET_FILE;
  if (!path) throw new Error("PASSWORD_RECOVERY_SECRET_REQUIRED");
  let encoded: string;
  try { encoded = (await readFile(path, "utf8")).trim(); }
  catch { throw new Error("PASSWORD_RECOVERY_SECRET_UNAVAILABLE"); }
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new Error("PASSWORD_RECOVERY_SECRET_INVALID");
  const secret = Buffer.from(encoded, "base64url");
  if (secret.length !== 32 || secret.toString("base64url") !== encoded) throw new Error("PASSWORD_RECOVERY_SECRET_INVALID");
  return secret;
}

export function recoveryToken(request: RecoveryRequest, secret: Buffer) {
  if (secret.length !== 32) throw new Error("PASSWORD_RECOVERY_SECRET_INVALID");
  return createHmac("sha256", secret).update(JSON.stringify([
    "perfectutilitares/password-recovery/v1", request.requestId,
    request.userId, request.tenantId, request.securityVersion,
    request.resetStamp, request.issuedAt, request.expiresAt,
  ])).digest("base64url");
}

export async function processPasswordRecovery(payload: unknown, secret: Buffer, now = new Date()) {
  const parsed = recoveryRequestSchema.safeParse(payload);
  if (!parsed.success) return;
  const request = parsed.data;
  if (request.issuedAt > now.getTime() || request.expiresAt <= now.getTime() || !request.userId) return;
  const configuration = getRecoveryConfiguration();
  if (!configuration || request.baseUrl !== configuration.baseUrl || request.from !== configuration.from) {
    throw new Error("PASSWORD_RECOVERY_CONFIGURATION_UNAVAILABLE");
  }
  const user = await prisma.user.findUnique({
    where: { id: request.userId },
    select: { id: true, tenantId: true, status: true, securityVersion: true, email: true, name: true, role: true },
  });
  if (!user?.tenantId || user.status !== "ACTIVE" || user.tenantId !== request.tenantId || user.securityVersion !== request.securityVersion) return;
  const token = recoveryToken(request, secret);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  // Empty update preserves expiry, identity and consumption on at-least-once delivery.
  const invitation = await prisma.userInvitation.upsert({
    where: { tokenHash },
    update: {},
    create: {
      purpose: "PASSWORD_RESET", resetUserId: user.id, resetStamp: request.resetStamp,
      tenantId: user.tenantId, email: user.email, name: user.name, role: user.role,
      tokenHash, expiresAt: new Date(request.expiresAt),
    },
  });
  if (invitation.acceptedAt || invitation.expiresAt <= now || invitation.purpose !== "PASSWORD_RESET" ||
      invitation.resetUserId !== user.id || invitation.resetStamp !== request.resetStamp ||
      invitation.tenantId !== request.tenantId || invitation.expiresAt.getTime() !== request.expiresAt) return;
  try {
    await sendPasswordResetEmail({
      to: invitation.email, name: invitation.name,
      resetUrl: `${request.baseUrl}/convite/${token}`,
      from: request.from, idempotencyKey: `password-recovery/${request.requestId}`,
    });
  } catch (error) {
    const permanent = error instanceof Error && error.message === "RESEND_DELIVERY_REJECTED";
    console.error(JSON.stringify({ event: "password_recovery_delivery_failed", code: permanent ? "REJECTED" : "TRANSIENT" }));
    if (permanent) {
      // A previous timeout may have followed acceptance. Do not invalidate a
      // possibly delivered link; the stored hash expires at the original deadline.
      return;
    }
    // Timeout/network errors may follow provider acceptance: keep the same token
    // and idempotency key for retries rather than invalidating a delivered link.
    throw new Error("PASSWORD_RECOVERY_DELIVERY_RETRY");
  }
}

export async function registerPasswordRecoveryWorker(boss: PgBoss) {
  // Missing key must fail readiness even when email delivery is not configured yet.
  const secret = await readPasswordRecoverySecret();
  await ensurePasswordRecoveryQueue(boss);
  return boss.work<RecoveryRequest>(PASSWORD_RECOVERY_QUEUE, {
    batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2,
  }, async ([job]) => {
    if (!job || job.id !== job.data?.requestId) return;
    try { await processPasswordRecovery(job.data, secret); }
    catch { throw new Error("PASSWORD_RECOVERY_DELIVERY_RETRY"); }
  });
}
