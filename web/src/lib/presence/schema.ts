import { z } from "zod";

const presenceSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use apenas letras minúsculas, números e hífens.",
  );

export const presenceAccessSchema = z.object({
  eventSlug: presenceSlugSchema,
  guestSlug: presenceSlugSchema,
  token: z
    .string()
    .trim()
    .regex(/^c_[A-Za-z0-9_-]{43}$/, "Convite inválido."),
});

export const presencePublicRouteSchema = z.object({
  eventSlug: presenceSlugSchema,
  guestSlug: presenceSlugSchema,
});

export const presenceConfirmationSchema = z
  .object({
    status: z.enum(["CONFIRMED", "DECLINED"]),
    companionCount: z.number().int().min(0).max(20),
  })
  .superRefine((data, context) => {
    if (data.status === "DECLINED" && data.companionCount !== 0) {
      context.addIssue({
        code: "custom",
        path: ["companionCount"],
        message: "Uma recusa não pode incluir acompanhantes.",
      });
    }
  });

export const presenceGiftRouteSchema = presencePublicRouteSchema.extend({
  giftId: z.string().cuid(),
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);

const optionalPatchText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null));

export const presenceEventCreateSchema = z
  .object({
    eventSlug: presenceSlugSchema,
    title: z.string().trim().min(2).max(120),
    description: optionalText(2_000),
    startsAt: z.iso.datetime({ offset: true }),
    confirmationDeadline: z.iso.datetime({ offset: true }),
    venueName: optionalText(160),
    venueAddress: optionalText(300),
    timeZone: z.string().trim().min(1).max(80).default("America/Sao_Paulo"),
    status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
  })
  .superRefine((data, context) => {
    if (Date.parse(data.confirmationDeadline) > Date.parse(data.startsAt)) {
      context.addIssue({
        code: "custom",
        path: ["confirmationDeadline"],
        message: "O prazo de confirmação deve terminar antes do evento.",
      });
    }
  });

export const presenceGuestCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  guestSlug: presenceSlugSchema,
  companionLimit: z.number().int().min(0).max(20).default(0),
  accessExpiresAt: z.iso.datetime({ offset: true }).optional(),
});

export const presenceEventUpdateSchema = z
  .object({
    eventSlug: presenceSlugSchema.optional(),
    title: z.string().trim().min(2).max(120).optional(),
    description: optionalPatchText(2_000),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    confirmationDeadline: z.iso.datetime({ offset: true }).optional(),
    venueName: optionalPatchText(160),
    venueAddress: optionalPatchText(300),
    timeZone: z.string().trim().min(1).max(80).optional(),
    status: z.enum(["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"]).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Informe ao menos uma alteração.",
  });

export const presenceGuestUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    guestSlug: presenceSlugSchema.optional(),
    companionLimit: z.number().int().min(0).max(20).optional(),
    companionCount: z.number().int().min(0).max(20).optional(),
    rsvpStatus: z.enum(["PENDING", "CONFIRMED", "DECLINED"]).optional(),
    accessExpiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Informe ao menos uma alteração.",
  });

export const presenceGiftCreateSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: optionalText(500),
  externalUrl: z.url().max(2_000).nullable().optional(),
  active: z.boolean().default(true),
});

export const presenceGiftUpdateSchema = z
  .object({
    title: z.string().trim().min(2).max(160).optional(),
    description: optionalPatchText(500),
    externalUrl: z.url().max(2_000).nullable().optional(),
    active: z.boolean().optional(),
    clearReservation: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Informe ao menos uma alteração.",
  });

export const presenceGiftOrderSchema = z.object({
  orderedIds: z.array(z.string().cuid()).min(1).max(500),
});

export function zodPresenceIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
