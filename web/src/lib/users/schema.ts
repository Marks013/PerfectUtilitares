import { z } from "zod";

const booleanishSchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export const userRoleSchema = z.enum(["ADMIN", "OPERATOR"]);

export const userCreateSchema = z.object({
  tenantId: z.string().min(8).max(64),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(8).max(72),
  role: userRoleSchema.default("OPERATOR"),
  isActive: booleanishSchema.default(true),
  canAccessJornada: booleanishSchema.default(true),
  canAccessFotos: booleanishSchema.default(true),
});

export const userPatchSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase())
      .optional(),
    tenantId: z.string().min(8).max(64).optional(),
    name: z.string().trim().min(2).max(120).optional(),
    role: userRoleSchema.optional(),
    isActive: booleanishSchema.optional(),
    canAccessJornada: booleanishSchema.optional(),
    canAccessFotos: booleanishSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo",
  });

export const tenantCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
});

export const invitationCreateSchema = z.object({
  tenantId: z.string().min(8).max(64),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(120),
  role: userRoleSchema.default("OPERATOR"),
  canAccessJornada: booleanishSchema.default(true),
  canAccessFotos: booleanishSchema.default(true),
});

export const invitationAcceptSchema = z.object({
  token: z.string().min(32).max(160),
  password: z.string().min(8).max(72),
});

export type UserCreateInput = z.input<typeof userCreateSchema>;
export type UserCreateValues = z.output<typeof userCreateSchema>;
export type UserPatchInput = z.input<typeof userPatchSchema>;
export type UserPatchValues = z.output<typeof userPatchSchema>;
export type InvitationCreateInput = z.input<typeof invitationCreateSchema>;
export type InvitationCreateValues = z.output<typeof invitationCreateSchema>;

export function zodIssueDetails(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
