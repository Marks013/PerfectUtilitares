-- DropConstraint
ALTER TABLE "PresenceGift"
DROP CONSTRAINT "PresenceGift_reservation_check";

-- AddConstraint
ALTER TABLE "PresenceGift"
ADD CONSTRAINT "PresenceGift_reservation_check" CHECK (
  (
    "reservedManually" = false
    AND "reservedByGuestId" IS NULL
    AND "reservedAt" IS NULL
  )
  OR (
    "reservedManually" = true
    AND "reservedByGuestId" IS NULL
    AND "reservedAt" IS NOT NULL
  )
  OR (
    "reservedManually" = false
    AND "reservedByGuestId" IS NOT NULL
    AND "reservedAt" IS NOT NULL
  )
);
