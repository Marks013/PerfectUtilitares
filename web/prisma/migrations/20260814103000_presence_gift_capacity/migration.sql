-- Quantidade nula = ilimitado. Presentes existentes continuam com quantidade 1.
ALTER TABLE "PresenceGift"
ADD COLUMN "quantity" INTEGER DEFAULT 1;

CREATE TABLE "PresenceGiftReservation" (
    "id" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PresenceGiftReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PresenceGiftReservation_giftId_guestId_key"
ON "PresenceGiftReservation"("giftId", "guestId");

CREATE INDEX "PresenceGiftReservation_giftId_reservedAt_idx"
ON "PresenceGiftReservation"("giftId", "reservedAt");

CREATE INDEX "PresenceGiftReservation_guestId_idx"
ON "PresenceGiftReservation"("guestId");

ALTER TABLE "PresenceGiftReservation"
ADD CONSTRAINT "PresenceGiftReservation_giftId_fkey"
FOREIGN KEY ("giftId") REFERENCES "PresenceGift"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PresenceGiftReservation"
ADD CONSTRAINT "PresenceGiftReservation_guestId_fkey"
FOREIGN KEY ("guestId") REFERENCES "PresenceGuest"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PresenceGiftReservation" ("id", "giftId", "guestId", "reservedAt")
SELECT
    'legacy_' || md5("id" || ':' || "reservedByGuestId"),
    "id",
    "reservedByGuestId",
    COALESCE("reservedAt", CURRENT_TIMESTAMP)
FROM "PresenceGift"
WHERE "reservedByGuestId" IS NOT NULL
ON CONFLICT ("giftId", "guestId") DO NOTHING;
