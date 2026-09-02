import { z } from "zod";

const presenceThemeContractSchema = z.object({
  preset: z.enum(["CELEBRATION", "ELEGANT", "GARDEN", "NIGHT"]),
  cover: z.enum([
    "EVENT_TABLE",
    "WEDDING",
    "BIRTHDAY",
    "KITCHEN_TEA",
    "BABY_SHOWER",
    "NONE",
  ]),
  accent: z.enum(["CORAL", "BLUE", "GREEN", "GOLD"]),
  welcomeTitle: z.string().nullable(),
});

export const presenceStateContractSchema = z.object({
  revision: z.number().int().nonnegative(),
  event: z.object({
    eventSlug: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    startsAt: z.iso.datetime(),
    venueName: z.string().nullable(),
    venueAddress: z.string().nullable(),
    confirmationDeadline: z.iso.datetime(),
    timeZone: z.string(),
    status: z.enum(["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"]),
    theme: presenceThemeContractSchema,
    confirmationOpen: z.boolean(),
  }),
  guest: z.object({
    guestSlug: z.string(),
    name: z.string(),
    rsvpStatus: z.enum(["PENDING", "CONFIRMED", "DECLINED"]),
    adultCount: z.number().int().nonnegative(),
    childCount: z.number().int().nonnegative(),
    respondedAt: z.iso.datetime().nullable(),
  }),
  gifts: z.array(
    z.object({
      id: z.string(),
      categoryId: z.string().nullable(),
      emoji: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      externalUrl: z.string().nullable(),
      position: z.number().int(),
      quantity: z.number().int().positive().nullable(),
      reservedManually: z.boolean(),
      reservedCount: z.number().int().nonnegative(),
      availableCount: z.number().int().nonnegative().nullable(),
      unlimited: z.boolean(),
      reserved: z.boolean(),
      reservedByMe: z.boolean(),
      category: z
        .object({
          id: z.string(),
          name: z.string(),
          emoji: z.string(),
          position: z.number().int(),
        })
        .nullable(),
    }),
  ),
});

export const presenceConfirmationContractSchema = z.object({
  revision: z.number().int().nonnegative(),
  rsvpStatus: z.enum(["CONFIRMED", "DECLINED"]),
  adultCount: z.number().int().nonnegative(),
  childCount: z.number().int().nonnegative(),
});

export const presenceErrorContractSchema = z.object({
  error: z.object({ message: z.string().min(1) }),
});

export type PresenceStateContract = z.infer<typeof presenceStateContractSchema>;
