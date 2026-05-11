import { z } from "zod";
import { BCRYPT_PASSWORD_MAX_LENGTH } from "@/lib/auth/password";

const booleanishSchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export const userRoleSchema = z.enum(["ADMIN", "OPERATOR"]);

const fieldLabels: Record<string, string> = {
  tenantId: "Empresa",
  email: "E-mail",
  name: "Nome",
  password: "Senha",
  role: "Perfil",
  token: "Convite",
  isActive: "Status",
  canAccessJornada: "Módulo Jornada",
  canAccessFotos: "Módulo Fotos 3x4",
  slug: "Apelido curto",
};

const tenantIdSchema = z
  .string()
  .min(1, "Selecione uma empresa.")
  .min(8, "Empresa inválida. Selecione uma empresa cadastrada.")
  .max(64, "Empresa inválida. Selecione uma empresa cadastrada.");
const emailSchema = z
  .string()
  .trim()
  .min(1, "Informe o e-mail.")
  .email("Informe um e-mail válido, como nome@empresa.com.")
  .max(254, "O e-mail deve ter no máximo 254 caracteres.")
  .transform((value) => value.toLowerCase());
const nameSchema = z
  .string()
  .trim()
  .min(2, "Informe o nome com pelo menos 2 caracteres.")
  .max(120, "O nome deve ter no máximo 120 caracteres.");
const passwordSchema = z
  .string()
  .min(1, "Informe a senha.")
  .min(8, "A senha deve ter pelo menos 8 caracteres.")
  .max(BCRYPT_PASSWORD_MAX_LENGTH, "A senha deve ter no máximo 72 caracteres.");

export const userCreateSchema = z.object({
  tenantId: tenantIdSchema,
  email: emailSchema,
  name: nameSchema,
  password: passwordSchema,
  role: userRoleSchema.default("OPERATOR"),
  isActive: booleanishSchema.default(true),
  canAccessJornada: booleanishSchema.default(true),
  canAccessFotos: booleanishSchema.default(true),
});

export const userPatchSchema = z
  .object({
    email: emailSchema.optional(),
    tenantId: tenantIdSchema.optional(),
    name: nameSchema.optional(),
    role: userRoleSchema.optional(),
    isActive: booleanishSchema.optional(),
    canAccessJornada: booleanishSchema.optional(),
    canAccessFotos: booleanishSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

export const tenantCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome da empresa com pelo menos 2 caracteres.")
    .max(120, "O nome da empresa deve ter no máximo 120 caracteres."),
  slug: z
    .string()
    .trim()
    .min(2, "Informe um apelido curto com pelo menos 2 caracteres.")
    .max(80, "O apelido curto deve ter no máximo 80 caracteres.")
    .regex(/^[a-z0-9-]+$/, "Use apenas letras minúsculas, números e hífen."),
});

export const invitationCreateSchema = z.object({
  tenantId: tenantIdSchema,
  email: emailSchema,
  name: nameSchema,
  role: userRoleSchema.default("OPERATOR"),
  canAccessJornada: booleanishSchema.default(true),
  canAccessFotos: booleanishSchema.default(true),
});

export const invitationAcceptSchema = z.object({
  token: z
    .string()
    .min(32, "Link de convite inválido. Solicite um novo convite.")
    .max(160, "Link de convite inválido. Solicite um novo convite."),
  password: passwordSchema,
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
    field:
      typeof issue.path[0] === "string"
        ? fieldLabels[issue.path[0]] ?? issue.path[0]
        : undefined,
    message: issue.message,
  }));
}
