ALTER TABLE "PresenceDelivery"
ADD COLUMN "providerMessageId" TEXT,
ADD COLUMN "lastAttemptAt" TIMESTAMP(3);
