import { z } from "zod";

type Role = "ADMIN" | "OPERATOR";
export type UserStatus = "ACTIVE" | "BLOCKED" | "BANNED";

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  _count?: { users: number };
};

export type ManagedUser = {
  id: string;
  tenantId: string | null;
  tenant: Pick<Tenant, "id" | "name" | "slug"> | null;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type Invitation = {
  id: string;
  tenantId: string;
  tenant: Pick<Tenant, "name" | "slug">;
  email: string;
  name: string;
  role: Role;
  expiresAt: string | Date;
  acceptedAt: string | Date | null;
  createdAt: string | Date;
  inviteUrl?: string;
};

type ApiErrorBody = {
  error?: string | { message?: string };
};

export type UsersManagerProps = {
  initialUsers: ManagedUser[];
  initialTenants: Tenant[];
  initialInvitations: Invitation[];
  currentUserId: string;
};

const tenantIdField = z.string().min(1, "Selecione uma empresa.");
const emailField = z
  .string()
  .trim()
  .min(1, "Informe o e-mail.")
  .email("Informe um e-mail válido, como nome@empresa.com.")
  .max(254, "O e-mail deve ter no máximo 254 caracteres.")
  .transform((value) => value.toLowerCase());
const nameField = z
  .string()
  .trim()
  .min(2, "Informe o nome com pelo menos 2 caracteres.")
  .max(120, "O nome deve ter no máximo 120 caracteres.");

export const userEditSchema = z.object({
  tenantId: tenantIdField,
  email: emailField,
  name: nameField,
  role: z.enum(["ADMIN", "OPERATOR"]),
  status: z.enum(["ACTIVE", "BLOCKED", "BANNED"]),
});

export const invitationFormSchema = z.object({
  tenantId: tenantIdField,
  email: emailField,
  name: nameField,
  role: z.enum(["ADMIN", "OPERATOR"]),
});

export const tenantFormSchema = z.object({
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

export type UserEditInput = z.input<typeof userEditSchema>;
export type UserEditValues = z.output<typeof userEditSchema>;
export type InvitationFormInput = z.input<typeof invitationFormSchema>;
export type InvitationFormValues = z.output<typeof invitationFormSchema>;
export type TenantFormInput = z.input<typeof tenantFormSchema>;
export type TenantFormValues = z.output<typeof tenantFormSchema>;

export function userEditDefaults(
  user: ManagedUser,
  tenantId = "",
): UserEditInput {
  return {
    tenantId: user.tenantId ?? tenantId,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
  };
}

export function invitationDefaults(tenantId = ""): InvitationFormInput {
  return {
    tenantId,
    email: "",
    name: "",
    role: "OPERATOR",
  };
}

export function sortUsers(users: ManagedUser[]) {
  const statusOrder: Record<UserStatus, number> = {
    ACTIVE: 0,
    BLOCKED: 1,
    BANNED: 2,
  };

  return [...users].sort((a, b) => {
    if (a.status !== b.status) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    return a.name.localeCompare(b.name);
  });
}

export function userStatusLabel(status: UserStatus) {
  return {
    ACTIVE: "Ativo",
    BLOCKED: "Bloqueado",
    BANNED: "Banido",
  }[status];
}

export function userStatusClass(status: UserStatus) {
  return {
    ACTIVE: "border-green-200 bg-green-50 text-green-700",
    BLOCKED: "border-amber-200 bg-amber-50 text-amber-800",
    BANNED: "border-red-200 bg-red-50 text-red-700",
  }[status];
}

export function sortTenants(tenants: Tenant[]) {
  return [...tenants].sort((a, b) => a.name.localeCompare(b.name));
}

export function makeSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function getErrorMessage(
  response: Response,
  fallback = "Falha na operação",
) {
  try {
    const data = (await response.json()) as ApiErrorBody;
    if (typeof data.error === "string") return data.error;
    return data.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function getFormErrorMessages(errors: Record<string, unknown>) {
  return Object.values(errors)
    .map((error) => {
      if (!error || typeof error !== "object" || !("message" in error)) {
        return null;
      }

      const message = (error as { message?: unknown }).message;
      return typeof message === "string" ? message : null;
    })
    .filter((message): message is string => Boolean(message));
}

export function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
