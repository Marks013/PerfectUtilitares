import { createHash, createHmac, randomBytes } from "node:crypto";

const INVITATION_PREFIX = "c_";
const SESSION_PREFIX = "s_";

function presencePepper() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET is required for presence tokens");
  }
  return secret;
}

export function generatePresenceInvitationToken() {
  return `${INVITATION_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function derivePresenceInvitationToken(deliveryId: string) {
  const secret = createHmac("sha256", presencePepper())
    .update(`presence-delivery:${deliveryId}`)
    .digest("base64url");
  return `${INVITATION_PREFIX}${secret}`;
}

export function generatePresenceSessionToken() {
  return `${SESSION_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashPresenceSecret(secret: string) {
  return createHmac("sha256", presencePepper()).update(secret).digest("hex");
}

export function getPresenceCookieName(eventSlug: string, guestSlug: string) {
  const routeHash = createHash("sha256")
    .update(`${eventSlug}/${guestSlug}`)
    .digest("hex")
    .slice(0, 16);
  const prefix = process.env.NODE_ENV === "production" ? "__Host-" : "";
  return `${prefix}pu-presence-${routeHash}`;
}

export function getPresenceCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}
