-- Extend delivery tracking without changing existing invitation records.
ALTER TYPE "PresenceDeliveryStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "PresenceDeliveryStatus" ADD VALUE 'DELAYED';
ALTER TYPE "PresenceDeliveryStatus" ADD VALUE 'BOUNCED';
ALTER TYPE "PresenceDeliveryStatus" ADD VALUE 'COMPLAINED';
ALTER TYPE "PresenceDeliveryStatus" ADD VALUE 'SUPPRESSED';

CREATE TYPE "PresenceDeliveryKind" AS ENUM ('INVITATION', 'REMINDER');

ALTER TABLE "PresenceEvent"
ADD COLUMN "reminderAt" TIMESTAMP(3),
ADD COLUMN "reminderProcessedAt" TIMESTAMP(3);

ALTER TABLE "PresenceDelivery"
ADD COLUMN "kind" "PresenceDeliveryKind" NOT NULL DEFAULT 'INVITATION',
ADD COLUMN "providerStatus" TEXT,
ADD COLUMN "providerEventAt" TIMESTAMP(3),
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "openedAt" TIMESTAMP(3),
ADD COLUMN "clickedAt" TIMESTAMP(3),
ADD COLUMN "bouncedAt" TIMESTAMP(3),
ADD COLUMN "complainedAt" TIMESTAMP(3);

CREATE TABLE "PresenceWebhookEvent" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT,
  "providerMessageId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PresenceWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PresenceEvent_status_reminderAt_reminderProcessedAt_idx"
ON "PresenceEvent"("status", "reminderAt", "reminderProcessedAt");

CREATE INDEX "PresenceDelivery_providerMessageId_idx"
ON "PresenceDelivery"("providerMessageId");

CREATE INDEX "PresenceWebhookEvent_deliveryId_occurredAt_idx"
ON "PresenceWebhookEvent"("deliveryId", "occurredAt");

CREATE INDEX "PresenceWebhookEvent_providerMessageId_idx"
ON "PresenceWebhookEvent"("providerMessageId");

CREATE INDEX "PresenceWebhookEvent_createdAt_idx"
ON "PresenceWebhookEvent"("createdAt");

ALTER TABLE "PresenceWebhookEvent"
ADD CONSTRAINT "PresenceWebhookEvent_deliveryId_fkey"
FOREIGN KEY ("deliveryId") REFERENCES "PresenceDelivery"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
