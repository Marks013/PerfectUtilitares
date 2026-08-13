-- AlterTable
ALTER TABLE "PresenceGuest" ADD COLUMN "shortCodeHash" TEXT;

-- AlterTable
ALTER TABLE "PresenceGift"
ADD COLUMN "categoryId" TEXT,
ADD COLUMN "emoji" TEXT NOT NULL DEFAULT '🎁',
ADD COLUMN "reservedManually" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PresenceGiftCategory" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🏠',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresenceGiftCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PresenceGuest_shortCodeHash_key" ON "PresenceGuest"("shortCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "PresenceGiftCategory_eventId_normalizedName_key"
ON "PresenceGiftCategory"("eventId", "normalizedName");

-- CreateIndex
CREATE INDEX "PresenceGiftCategory_eventId_position_idx"
ON "PresenceGiftCategory"("eventId", "position");

-- CreateIndex
CREATE INDEX "PresenceGift_categoryId_position_idx" ON "PresenceGift"("categoryId", "position");

-- AddForeignKey
ALTER TABLE "PresenceGiftCategory"
ADD CONSTRAINT "PresenceGiftCategory_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "PresenceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenceGift"
ADD CONSTRAINT "PresenceGift_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "PresenceGiftCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
