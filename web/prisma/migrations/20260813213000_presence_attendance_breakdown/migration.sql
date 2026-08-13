ALTER TABLE "PresenceGuest"
ADD COLUMN "adultCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "childCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "PresenceGuest"
SET
  "adultCount" = CASE
    WHEN "rsvpStatus" = 'CONFIRMED' THEN "companionCount" + 1
    ELSE 0
  END,
  "childCount" = 0;

ALTER TABLE "PresenceGuest"
DROP CONSTRAINT IF EXISTS "PresenceGuest_companion_counts_check";

ALTER TABLE "PresenceGuest"
ADD CONSTRAINT "PresenceGuest_attendance_counts_check" CHECK (
  "adultCount" >= 0 AND "childCount" >= 0
);
