CREATE TYPE "PresenceEventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');
CREATE TYPE "PresenceRsvpStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');
CREATE TYPE "PresenceDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

CREATE TABLE "PresenceEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdById" TEXT,
    "eventSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "venueName" TEXT,
    "venueAddress" TEXT,
    "confirmationDeadline" TIMESTAMP(3) NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "status" "PresenceEventStatus" NOT NULL DEFAULT 'DRAFT',
    "theme" JSONB,
    "publicRevision" INTEGER NOT NULL DEFAULT 0,
    "retentionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PresenceEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PresenceGuest" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "guestSlug" TEXT NOT NULL,
    "rsvpStatus" "PresenceRsvpStatus" NOT NULL DEFAULT 'PENDING',
    "companionLimit" INTEGER NOT NULL DEFAULT 0,
    "companionCount" INTEGER NOT NULL DEFAULT 0,
    "tokenHash" TEXT NOT NULL,
    "accessVersion" INTEGER NOT NULL DEFAULT 1,
    "accessExpiresAt" TIMESTAMP(3),
    "tokenRevokedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PresenceGuest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PresenceGuest_companion_counts_check" CHECK (
      "companionLimit" >= 0 AND "companionCount" >= 0 AND "companionCount" <= "companionLimit"
    )
);

CREATE TABLE "PresenceGuestSession" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "sessionHash" TEXT NOT NULL,
    "accessVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PresenceGuestSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PresenceGift" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "externalUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reservedByGuestId" TEXT,
    "reservedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PresenceGift_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PresenceGift_position_check" CHECK ("position" >= 0),
    CONSTRAINT "PresenceGift_reservation_check" CHECK (
      ("reservedByGuestId" IS NULL AND "reservedAt" IS NULL)
      OR ("reservedByGuestId" IS NOT NULL AND "reservedAt" IS NOT NULL)
    )
);

CREATE TABLE "PresenceDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "guestId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "PresenceDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PresenceDelivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PresenceDelivery_attempt_count_check" CHECK ("attemptCount" >= 0)
);

CREATE TABLE "PresenceActivity" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "guestId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PresenceActivity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PresenceEvent_eventSlug_key" ON "PresenceEvent"("eventSlug");
CREATE INDEX "PresenceEvent_tenantId_status_idx" ON "PresenceEvent"("tenantId", "status");
CREATE INDEX "PresenceEvent_createdById_idx" ON "PresenceEvent"("createdById");
CREATE INDEX "PresenceEvent_retentionUntil_idx" ON "PresenceEvent"("retentionUntil");

CREATE UNIQUE INDEX "PresenceGuest_tokenHash_key" ON "PresenceGuest"("tokenHash");
CREATE UNIQUE INDEX "PresenceGuest_eventId_guestSlug_key" ON "PresenceGuest"("eventId", "guestSlug");
CREATE UNIQUE INDEX "PresenceGuest_eventId_email_key" ON "PresenceGuest"("eventId", "email");
CREATE INDEX "PresenceGuest_eventId_rsvpStatus_idx" ON "PresenceGuest"("eventId", "rsvpStatus");
CREATE INDEX "PresenceGuest_accessExpiresAt_idx" ON "PresenceGuest"("accessExpiresAt");

CREATE UNIQUE INDEX "PresenceGuestSession_sessionHash_key" ON "PresenceGuestSession"("sessionHash");
CREATE INDEX "PresenceGuestSession_guestId_revokedAt_expiresAt_idx" ON "PresenceGuestSession"("guestId", "revokedAt", "expiresAt");
CREATE INDEX "PresenceGuestSession_expiresAt_idx" ON "PresenceGuestSession"("expiresAt");

CREATE INDEX "PresenceGift_eventId_active_position_idx" ON "PresenceGift"("eventId", "active", "position");
CREATE INDEX "PresenceGift_reservedByGuestId_idx" ON "PresenceGift"("reservedByGuestId");

CREATE UNIQUE INDEX "PresenceDelivery_eventId_idempotencyKey_key" ON "PresenceDelivery"("eventId", "idempotencyKey");
CREATE INDEX "PresenceDelivery_eventId_status_nextAttemptAt_idx" ON "PresenceDelivery"("eventId", "status", "nextAttemptAt");
CREATE INDEX "PresenceDelivery_guestId_idx" ON "PresenceDelivery"("guestId");

CREATE INDEX "PresenceActivity_eventId_createdAt_idx" ON "PresenceActivity"("eventId", "createdAt");
CREATE INDEX "PresenceActivity_guestId_createdAt_idx" ON "PresenceActivity"("guestId", "createdAt");
CREATE INDEX "PresenceActivity_actorUserId_createdAt_idx" ON "PresenceActivity"("actorUserId", "createdAt");

ALTER TABLE "PresenceEvent" ADD CONSTRAINT "PresenceEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PresenceEvent" ADD CONSTRAINT "PresenceEvent_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PresenceGuest" ADD CONSTRAINT "PresenceGuest_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "PresenceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PresenceGuestSession" ADD CONSTRAINT "PresenceGuestSession_guestId_fkey"
  FOREIGN KEY ("guestId") REFERENCES "PresenceGuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PresenceGift" ADD CONSTRAINT "PresenceGift_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "PresenceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PresenceGift" ADD CONSTRAINT "PresenceGift_reservedByGuestId_fkey"
  FOREIGN KEY ("reservedByGuestId") REFERENCES "PresenceGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PresenceDelivery" ADD CONSTRAINT "PresenceDelivery_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "PresenceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PresenceDelivery" ADD CONSTRAINT "PresenceDelivery_guestId_fkey"
  FOREIGN KEY ("guestId") REFERENCES "PresenceGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PresenceActivity" ADD CONSTRAINT "PresenceActivity_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "PresenceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PresenceActivity" ADD CONSTRAINT "PresenceActivity_guestId_fkey"
  FOREIGN KEY ("guestId") REFERENCES "PresenceGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PresenceActivity" ADD CONSTRAINT "PresenceActivity_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
