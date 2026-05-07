"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  Building2,
  MailPlus,
  Pencil,
  Plus,
  Save,
  Trash2,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Role = "ADMIN" | "OPERATOR";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  _count?: { users: number };
};

type ManagedUser = {
  id: string;
  tenantId: string | null;
  tenant: Pick<Tenant, "id" | "name" | "slug"> | null;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  canAccessJornada: boolean;
  canAccessFotos: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type Invitation = {
  id: string;
  tenantId: string;
  tenant: Pick<Tenant, "name" | "slug">;
  email: string;
  name: string;
  role: Role;
  canAccessJornada: boolean;
  canAccessFotos: boolean;
  expiresAt: string | Date;
  acceptedAt: string | Date | null;
  createdAt: string | Date;
};

type ApiErrorBody = {
  error?: string | { message?: string };
};

type UsersManagerProps = {
  initialUsers: ManagedUser[];
  initialTenants: Tenant[];
  initialInvitations: Invitation[];
  currentUserId: string;
};

const booleanishSchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

const moduleAccessShape = {
  canAccessJornada: booleanishSchema,
  canAccessFotos: booleanishSchema,
};

const userFormSchema = z.object({
  tenantId: z.string().min(1),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(120),
  password: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(8).max(72).optional(),
  ),
  role: z.enum(["ADMIN", "OPERATOR"]),
  isActive: booleanishSchema,
  ...moduleAccessShape,
});

const invitationFormSchema = z.object({
  tenantId: z.string().min(1),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(120),
  role: z.enum(["ADMIN", "OPERATOR"]),
  ...moduleAccessShape,
});

const tenantFormSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
});

type UserFormInput = z.input<typeof userFormSchema>;
type UserFormValues = z.output<typeof userFormSchema>;
type InvitationFormInput = z.input<typeof invitationFormSchema>;
type InvitationFormValues = z.output<typeof invitationFormSchema>;
type TenantFormInput = z.input<typeof tenantFormSchema>;
type TenantFormValues = z.output<typeof tenantFormSchema>;

function userDefaults(tenantId = ""): UserFormInput {
  return {
    tenantId,
    email: "",
    name: "",
    password: "",
    role: "OPERATOR",
    isActive: true,
    canAccessJornada: true,
    canAccessFotos: true,
  };
}

function invitationDefaults(tenantId = ""): InvitationFormInput {
  return {
    tenantId,
    email: "",
    name: "",
    role: "OPERATOR",
    canAccessJornada: true,
    canAccessFotos: true,
  };
}

function sortUsers(users: ManagedUser[]) {
  return [...users].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function sortTenants(tenants: Tenant[]) {
  return [...tenants].sort((a, b) => a.name.localeCompare(b.name));
}

function makeSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function getErrorMessage(response: Response, fallback = "Falha na operação") {
  try {
    const data = (await response.json()) as ApiErrorBody;
    if (typeof data.error === "string") return data.error;
    return data.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function moduleLabel(user: Pick<ManagedUser, "role" | "canAccessJornada" | "canAccessFotos">) {
  if (user.role === "ADMIN") return "Todos";
  const enabled = [
    user.canAccessJornada ? "Jornada" : null,
    user.canAccessFotos ? "Fotos" : null,
  ].filter(Boolean);
  return enabled.length ? enabled.join(" / ") : "Nenhum";
}

export function UsersManager({
  initialUsers,
  initialTenants,
  initialInvitations,
  currentUserId,
}: UsersManagerProps) {
  const [users, setUsers] = useState(() => sortUsers(initialUsers));
  const [tenants, setTenants] = useState(() => sortTenants(initialTenants));
  const [invitations, setInvitations] = useState(initialInvitations);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inviteSentTo, setInviteSentTo] = useState<string | null>(null);

  const firstTenantId = tenants[0]?.id ?? "";
  const tenantOptions = useMemo(
    () => tenants.map((tenant) => ({ value: tenant.id, label: tenant.name })),
    [tenants],
  );

  const form = useForm<UserFormInput, unknown, UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: userDefaults(firstTenantId),
  });
  const invitationForm = useForm<InvitationFormInput, unknown, InvitationFormValues>({
    resolver: zodResolver(invitationFormSchema),
    defaultValues: invitationDefaults(firstTenantId),
  });
  const tenantForm = useForm<TenantFormInput, unknown, TenantFormValues>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: { name: "", slug: "" },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: UserFormValues) => {
      if (!editingId && !values.password) {
        form.setError("password", {
          type: "validate",
          message: "Senha obrigatoria",
        });
        throw new Error("Informe senha inicial com no minimo 8 caracteres");
      }

      const payload = {
        ...values,
        ...(values.password ? { password: values.password } : {}),
      };

      const response = await fetch(
        editingId ? `/api/admin/users/${editingId}` : "/api/admin/users",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Falha ao salvar usuário"));
      }

      return (await response.json()) as ManagedUser;
    },
    onSuccess(user) {
      setUsers((current) => {
        const exists = current.some((item) => item.id === user.id);
        const next = exists
          ? current.map((item) => (item.id === user.id ? user : item))
          : [user, ...current];

        return sortUsers(next);
      });
      setEditingId(null);
      form.reset(userDefaults(firstTenantId));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (user: ManagedUser) => {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Falha ao excluir usuário"));
      }

      return user;
    },
    onSuccess(user) {
      if (user.id === currentUserId) {
        window.location.href = "/login";
        return;
      }

      setUsers((current) => current.filter((item) => item.id !== user.id));
      if (editingId === user.id) {
        newUser();
      }
    },
  });

  const tenantMutation = useMutation({
    mutationFn: async (values: TenantFormValues) => {
      const response = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Falha ao criar empresa"));
      }

      return (await response.json()) as Tenant;
    },
    onSuccess(tenant) {
      const created = { ...tenant, _count: tenant._count ?? { users: 0 } };
      setTenants((current) => sortTenants([...current, created]));
      tenantForm.reset({ name: "", slug: "" });
      form.setValue("tenantId", tenant.id);
      invitationForm.setValue("tenantId", tenant.id);
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (values: InvitationFormValues) => {
      const response = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Falha ao enviar convite"));
      }

      return (await response.json()) as Invitation;
    },
    onSuccess(invitation) {
      setInviteSentTo(invitation.email);
      setInvitations((current) => [invitation, ...current].slice(0, 50));
      invitationForm.reset(invitationDefaults(invitation.tenantId));
    },
  });

  function editUser(user: ManagedUser) {
    setEditingId(user.id);
    form.reset({
      tenantId: user.tenantId ?? firstTenantId,
      email: user.email,
      name: user.name,
      password: "",
      role: user.role,
      isActive: user.isActive,
      canAccessJornada: user.canAccessJornada,
      canAccessFotos: user.canAccessFotos,
    });
  }

  function newUser() {
    setEditingId(null);
    form.reset(userDefaults(firstTenantId));
  }

  const submit = form.handleSubmit((values) => saveMutation.mutate(values));
  const submitInvitation = invitationForm.handleSubmit((values) => {
    setInviteSentTo(null);
    inviteMutation.mutate(values);
  });
  const submitTenant = tenantForm.handleSubmit((values) => tenantMutation.mutate(values));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-neutral-950">
                {editingId ? "Editar usuário" : "Novo usuário"}
              </h2>
              <p className="mt-1 text-sm text-neutral-600">
                Perfil, empresa e acesso por módulo.
              </p>
            </div>
            {editingId ? (
              <button
                type="button"
                onClick={newUser}
                className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
              >
                <Plus className="size-4" aria-hidden="true" />
                Novo
              </button>
            ) : null}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block text-sm font-medium text-neutral-800">
              Nome
              <input
                {...form.register("name")}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
              />
            </label>
            <label className="block text-sm font-medium text-neutral-800">
              E-mail
              <input
                type="email"
                {...form.register("email")}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
              />
            </label>
            <label className="block text-sm font-medium text-neutral-800">
              Senha
              <input
                type="password"
                autoComplete="new-password"
                {...form.register("password")}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
              />
            </label>
            <label className="block text-sm font-medium text-neutral-800">
              Empresa
              <select
                {...form.register("tenantId")}
                disabled={!tenantOptions.length}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950 disabled:bg-neutral-100"
              >
                {tenantOptions.map((tenant) => (
                  <option key={tenant.value} value={tenant.value}>
                    {tenant.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-neutral-800">
                Perfil
                <select
                  {...form.register("role")}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
                >
                  <option value="OPERATOR">Operador</option>
                  <option value="ADMIN">Administrador</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-neutral-800">
                Status
                <select
                  {...form.register("isActive")}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
                >
                  <option value="true">Ativo</option>
                  <option value="false">Inativo</option>
                </select>
              </label>
            </div>
            <div className="grid gap-2 rounded-md border border-neutral-200 p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                <input
                  type="checkbox"
                  {...form.register("canAccessJornada")}
                  className="size-4 rounded border-neutral-300"
                />
                Jornada
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                <input
                  type="checkbox"
                  {...form.register("canAccessFotos")}
                  className="size-4 rounded border-neutral-300"
                />
                Fotos 3x4
              </label>
            </div>

            {Object.values(form.formState.errors).length ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Revise nome, e-mail, senha, empresa e permissões.
              </p>
            ) : null}

            {saveMutation.isError ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {saveMutation.error.message}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={saveMutation.isPending || !tenantOptions.length}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
            >
              <Save className="size-4" aria-hidden="true" />
              {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </button>
          </form>
        </section>

        <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="px-4 py-3">Usuário</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Módulos</th>
                  <th className="px-4 py-3">Perfil</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-t border-neutral-100">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <UserRound className="size-4 text-neutral-500" aria-hidden="true" />
                        <div>
                          <div className="font-medium text-neutral-900">
                            {user.name}
                          </div>
                          <div className="text-xs text-neutral-500">{user.email}</div>
                        </div>
                      </div>
                    </td>
                  <td className="px-4 py-3">{user.tenant?.name ?? "Sem empresa"}</td>
                    <td className="px-4 py-3">{moduleLabel(user)}</td>
                    <td className="px-4 py-3">
                      {user.role === "ADMIN" ? "Administrador" : "Operador"}
                    </td>
                    <td className="px-4 py-3">
                      {user.isActive ? "Ativo" : "Inativo"}
                      {user.id === currentUserId ? " atual" : ""}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => editUser(user)}
                          className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                          Editar
                        </button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button
                              type="button"
                              disabled={deleteMutation.isPending}
                              className="inline-flex items-center gap-1 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                              Excluir
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Esta ação remove definitivamente {user.email} e seus
                                acessos ao sistema.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
                                Cancelar
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(user)}
                                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
                              >
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {deleteMutation.isError ? (
            <p className="border-t border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {deleteMutation.error.message}
            </p>
          ) : null}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-neutral-500" aria-hidden="true" />
            <h2 className="text-base font-semibold text-neutral-950">Empresas</h2>
          </div>
          <form onSubmit={submitTenant} className="mt-4 space-y-3">
            <label className="block text-sm font-medium text-neutral-800">
              Nome
              <input
                {...tenantForm.register("name", {
                  onBlur: (event) => {
                    if (!tenantForm.getValues("slug")) {
                      tenantForm.setValue("slug", makeSlug(event.target.value), {
                        shouldValidate: true,
                      });
                    }
                  },
                })}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
              />
            </label>
            <label className="block text-sm font-medium text-neutral-800">
              Apelido curto
              <input
                {...tenantForm.register("slug")}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
              />
            </label>
            {tenantMutation.isError ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {tenantMutation.error.message}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={tenantMutation.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
            >
              <Plus className="size-4" aria-hidden="true" />
              {tenantMutation.isPending ? "Criando..." : "Criar empresa"}
            </button>
          </form>
          <div className="mt-4 divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {tenants.map((tenant) => (
              <div key={tenant.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-medium text-neutral-900">{tenant.name}</span>
                <span className="text-neutral-500">{tenant.slug}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <MailPlus className="size-4 text-neutral-500" aria-hidden="true" />
            <h2 className="text-base font-semibold text-neutral-950">Convites</h2>
          </div>
          <form onSubmit={submitInvitation} className="mt-4 grid gap-3 lg:grid-cols-6">
            <label className="block text-sm font-medium text-neutral-800 lg:col-span-2">
              Nome
              <input
                {...invitationForm.register("name")}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
              />
            </label>
            <label className="block text-sm font-medium text-neutral-800 lg:col-span-2">
              E-mail
              <input
                type="email"
                {...invitationForm.register("email")}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
              />
            </label>
            <label className="block text-sm font-medium text-neutral-800">
              Empresa
              <select
                {...invitationForm.register("tenantId")}
                disabled={!tenantOptions.length}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950 disabled:bg-neutral-100"
              >
                {tenantOptions.map((tenant) => (
                  <option key={tenant.value} value={tenant.value}>
                    {tenant.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-neutral-800">
              Perfil
              <select
                {...invitationForm.register("role")}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
              >
                <option value="OPERATOR">Operador</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-4 lg:col-span-5">
              <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                <input
                  type="checkbox"
                  {...invitationForm.register("canAccessJornada")}
                  className="size-4 rounded border-neutral-300"
                />
                Jornada
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                <input
                  type="checkbox"
                  {...invitationForm.register("canAccessFotos")}
                  className="size-4 rounded border-neutral-300"
                />
                Fotos 3x4
              </label>
            </div>
            <button
              type="submit"
              disabled={inviteMutation.isPending || !tenantOptions.length}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
            >
              <MailPlus className="size-4" aria-hidden="true" />
              {inviteMutation.isPending ? "Enviando..." : "Convidar"}
            </button>
          </form>

          {inviteSentTo ? (
            <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              Convite enviado para {inviteSentTo}.
            </p>
          ) : null}
          {inviteMutation.isError ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {inviteMutation.error.message}
            </p>
          ) : null}

          <div className="mt-4 overflow-hidden rounded-md border border-neutral-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="px-3 py-2">E-mail</th>
                  <th className="px-3 py-2">Empresa</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2">
                      <div className="font-medium text-neutral-900">{invitation.name}</div>
                      <div className="text-xs text-neutral-500">{invitation.email}</div>
                    </td>
                    <td className="px-3 py-2">{invitation.tenant.name}</td>
                    <td className="px-3 py-2">
                      {invitation.acceptedAt ? "Aceito" : "Pendente"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
