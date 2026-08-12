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

export function zodPresenceIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
