"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  Copy,
  MailPlus,
  Pencil,
  Plus,
  Save,
  Trash2,
  UserRound,
  X,
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
  inviteUrl?: string;
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

const userEditSchema = z.object({
  tenantId: z.string().min(1),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(120),
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

type UserEditInput = z.input<typeof userEditSchema>;
type UserEditValues = z.output<typeof userEditSchema>;
type InvitationFormInput = z.input<typeof invitationFormSchema>;
type InvitationFormValues = z.output<typeof invitationFormSchema>;
type TenantFormInput = z.input<typeof tenantFormSchema>;
type TenantFormValues = z.output<typeof tenantFormSchema>;

function userEditDefaults(user: ManagedUser, tenantId = ""): UserEditInput {
  return {
    tenantId: user.tenantId ?? tenantId,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    canAccessJornada: user.canAccessJornada,
    canAccessFotos: user.canAccessFotos,
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

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
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
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [inviteSent, setInviteSent] = useState<Invitation | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const firstTenantId = tenants[0]?.id ?? "";
  const tenantOptions = useMemo(
    () => tenants.map((tenant) => ({ value: tenant.id, label: tenant.name })),
    [tenants],
  );

  const editForm = useForm<UserEditInput, unknown, UserEditValues>({
    resolver: zodResolver(userEditSchema),
    values: editingUser ? userEditDefaults(editingUser, firstTenantId) : undefined,
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
    mutationFn: async (values: UserEditValues) => {
      if (!editingUser) {
        throw new Error("Selecione um usuário para editar");
      }

      const response = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Falha ao salvar usuário"));
      }

      return (await response.json()) as ManagedUser;
    },
    onSuccess(user) {
      setUsers((current) =>
        sortUsers(current.map((item) => (item.id === user.id ? user : item))),
      );
      setEditingUser(user);
      editForm.reset(userEditDefaults(user, firstTenantId));
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
      if (editingUser?.id === user.id) {
        setEditingUser(null);
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
      setInviteSent(invitation);
      setCopiedInvite(false);
      setInvitations((current) => [invitation, ...current].slice(0, 50));
      invitationForm.reset(invitationDefaults(invitation.tenantId));
    },
  });

  function editUser(user: ManagedUser) {
    setEditingUser(user);
    editForm.reset(userEditDefaults(user, firstTenantId));
  }

  async function copyInviteLink() {
    if (!inviteSent?.inviteUrl) return;
    await window.navigator.clipboard.writeText(inviteSent.inviteUrl);
    setCopiedInvite(true);
  }

  const submitEdit = editForm.handleSubmit((values) => saveMutation.mutate(values));
  const submitInvitation = invitationForm.handleSubmit((values) => {
    setInviteSent(null);
    inviteMutation.mutate(values);
  });
  const submitTenant = tenantForm.handleSubmit((values) => tenantMutation.mutate(values));

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-950">
              Convidar usuário
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-neutral-600">
              O administrador define perfil e módulos. A senha é criada pelo
              próprio usuário no link de convite. Para recuperar acesso de uma
              conta já cadastrada, envie um novo convite para o mesmo e-mail.
            </p>
          </div>
          <MailPlus className="size-5 text-neutral-500" aria-hidden="true" />
        </div>

        <form onSubmit={submitInvitation} className="mt-5 grid gap-3 lg:grid-cols-6">
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
            {inviteMutation.isPending ? "Gerando..." : "Gerar convite"}
          </button>
        </form>

        {inviteSent ? (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p>Convite criado para {inviteSent.email}.</p>
                {inviteSent.inviteUrl ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md border border-emerald-200 bg-white/60 px-2 py-1 text-xs text-neutral-800">
                      {inviteSent.inviteUrl}
                    </code>
                    <button
                      type="button"
                      onClick={copyInviteLink}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-white/60"
                    >
                      <Copy className="size-3.5" aria-hidden="true" />
                      {copiedInvite ? "Copiado" : "Copiar link"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        {inviteMutation.isError ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {inviteMutation.error.message}
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-neutral-950">Usuários</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Edite cadastro, status e permissões. Senha fica com o usuário.
              </p>
            </div>
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700">
              {users.length} cadastro(s)
            </span>
          </div>
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

        <aside className="space-y-4">
          <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-neutral-950">
                  Editar usuário
                </h2>
                <p className="mt-1 text-sm text-neutral-600">
                  {editingUser
                    ? "Ajuste dados e permissões."
                    : "Selecione um usuário na tabela."}
                </p>
              </div>
              {editingUser ? (
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="grid size-9 place-items-center rounded-md border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
                  title="Fechar edição"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>

            {editingUser ? (
              <form onSubmit={submitEdit} className="mt-5 space-y-4">
                <label className="block text-sm font-medium text-neutral-800">
                  Nome
                  <input
                    {...editForm.register("name")}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
                  />
                </label>
                <label className="block text-sm font-medium text-neutral-800">
                  E-mail
                  <input
                    type="email"
                    {...editForm.register("email")}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
                  />
                </label>
                <label className="block text-sm font-medium text-neutral-800">
                  Empresa
                  <select
                    {...editForm.register("tenantId")}
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
                      {...editForm.register("role")}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
                    >
                      <option value="OPERATOR">Operador</option>
                      <option value="ADMIN">Administrador</option>
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-neutral-800">
                    Status
                    <select
                      {...editForm.register("isActive")}
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
                      {...editForm.register("canAccessJornada")}
                      className="size-4 rounded border-neutral-300"
                    />
                    Jornada
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                    <input
                      type="checkbox"
                      {...editForm.register("canAccessFotos")}
                      className="size-4 rounded border-neutral-300"
                    />
                    Fotos 3x4
                  </label>
                </div>
                <p className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
                  Para senha ou primeiro acesso, gere um convite para o e-mail do usuário.
                </p>
                {saveMutation.isError ? (
                  <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {saveMutation.error.message}
                  </p>
                ) : null}
                {saveMutation.isSuccess ? (
                  <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                    Usuário atualizado.
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
                >
                  <Save className="size-4" aria-hidden="true" />
                  {saveMutation.isPending ? "Salvando..." : "Salvar alterações"}
                </button>
              </form>
            ) : null}
          </section>

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
        </aside>
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <MailPlus className="size-4 text-neutral-500" aria-hidden="true" />
          <h2 className="text-base font-semibold text-neutral-950">Convites recentes</h2>
        </div>
        <div className="mt-4 overflow-hidden rounded-md border border-neutral-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-neutral-600">
              <tr>
                <th className="px-3 py-2">E-mail</th>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">Criado</th>
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
                  <td className="px-3 py-2">{formatDate(invitation.createdAt)}</td>
                  <td className="px-3 py-2">
                    {invitation.acceptedAt ? "Aceito" : "Pendente"}
                  </td>
                </tr>
              ))}
              {invitations.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-neutral-500" colSpan={4}>
                    Nenhum convite enviado ainda.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
