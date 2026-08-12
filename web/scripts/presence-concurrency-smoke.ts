import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaAdapter } from "../src/lib/prisma-adapter";

const prisma = new PrismaClient({ adapter: createPrismaAdapter() });
const suffix = randomUUID().replaceAll("-", "");

try {
  const tenant = await prisma.tenant.create({
    data: { name: "Presence concurrency smoke", slug: `presence-smoke-${suffix}` },
  });
  try {
    const event = await prisma.presenceEvent.create({
      data: {
        tenantId: tenant.id,
        eventSlug: `presence-smoke-${suffix}`,
        title: "Presence concurrency smoke",
        startsAt: new Date(Date.now() + 86_400_000),
        confirmationDeadline: new Date(Date.now() + 43_200_000),
        status: "PUBLISHED",
      },
    });
    const guests = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        prisma.presenceGuest.create({
          data: {
            eventId: event.id,
            name: `Guest ${index + 1}`,
            guestSlug: `guest-${index + 1}`,
            tokenHash: `${suffix}${index.toString().padStart(2, "0")}`,
          },
        }),
      ),
    );
    const gift = await prisma.presenceGift.create({
      data: { eventId: event.id, title: "Concurrent gift" },
    });

    const results = await Promise.all(
      guests.map((guest) =>
        prisma.$transaction(async (tx) => {
          const updated = await tx.presenceGift.updateMany({
            where: {
              id: gift.id,
              eventId: event.id,
              active: true,
              reservedByGuestId: null,
            },
            data: {
              reservedByGuestId: guest.id,
              reservedAt: new Date(),
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) return false;
          await tx.presenceEvent.update({
            where: { id: event.id },
            data: { publicRevision: { increment: 1 } },
          });
          await tx.presenceActivity.create({
            data: {
              eventId: event.id,
              guestId: guest.id,
              action: "RESERVE_GIFT",
              entityType: "PresenceGift",
              entityId: gift.id,
            },
          });
          return true;
        }),
      ),
    );

    const [storedGift, activityCount, storedEvent] = await Promise.all([
      prisma.presenceGift.findUniqueOrThrow({ where: { id: gift.id } }),
      prisma.presenceActivity.count({
        where: { eventId: event.id, entityId: gift.id, action: "RESERVE_GIFT" },
      }),
      prisma.presenceEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ]);
    const winners = results.filter(Boolean).length;
    if (
      winners !== 1 ||
      !storedGift.reservedByGuestId ||
      storedGift.version !== 1 ||
      activityCount !== 1 ||
      storedEvent.publicRevision !== 1
    ) {
      throw new Error(
        `Concurrency invariant failed: ${JSON.stringify({
          winners,
          reserved: Boolean(storedGift.reservedByGuestId),
          giftVersion: storedGift.version,
          activityCount,
          revision: storedEvent.publicRevision,
        })}`,
      );
    }
    console.log("OK: 16 reservas simultâneas produziram exatamente um vencedor.");
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } });
  }
} finally {
  await prisma.$disconnect();
}
