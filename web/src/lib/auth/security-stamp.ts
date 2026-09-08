import { createHmac } from "node:crypto";

type SecurityState = {
  id: string;
  passwordHash: string;
  email: string;
  role: string;
  status: string;
  tenantId: string | null;
  updatedAt: Date;
};

// Never expose the password hash in a token. Account mutations invalidate this stamp.
export function getSecurityStamp(user: SecurityState) {
  const secret = process.env.AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET obrigatório em produção");
  }
  return createHmac("sha256", secret ?? "local-security-stamp")
    .update(JSON.stringify([
      user.id, user.passwordHash, user.email, user.role, user.status,
      user.tenantId, user.updatedAt.toISOString(),
    ]))
    .digest("hex");
}
