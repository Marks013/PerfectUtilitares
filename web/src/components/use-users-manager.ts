"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import type {
  InvitationFormValues,
  TenantFormValues,
} from "./users-manager-model";
import {
  type Invitation,
  invitationDefaults,
  type InvitationFormInput,
  invitationFormSchema,
  type ManagedUser,
  sortTenants,
  sortUsers,
  type TenantFormInput,
  tenantFormSchema,
  type UserEditInput,
  userEditDefaults,
  userEditSchema,
  type UserEditValues,
  type UsersManagerProps,
} from "./users-manager-model";
import {
  saveManagedUser,
  deleteManagedUser,
  createManagedTenant,
  createUserInvitation,
  copyInvitationUrl,
} from "./users-manager-api";

export function useUsersManager({
  initialUsers,
  initialTenants,
  initialInvitations,
  currentUserId,
}: UsersManagerProps) {
  const queryClient = useQueryClient();
  const [users, setUsers] = useState(() => sortUsers(initialUsers));
  const [tenants, setTenants] = useState(() => sortTenants(initialTenants));
  const [invitations, setInvitations] = useState(initialInvitations);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [inviteSent, setInviteSent] = useState<Invitation | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [copyInviteError, setCopyInviteError] = useState<string | null>(null);

  const firstTenantId = tenants[0]?.id ?? "";
  const tenantOptions = useMemo(
    () => tenants.map((tenant) => ({ value: tenant.id, label: tenant.name })),
    [tenants],
  );

  const editForm = useForm<UserEditInput, unknown, UserEditValues>({
    resolver: zodResolver(userEditSchema),
    values: editingUser
      ? userEditDefaults(editingUser, firstTenantId)
      : undefined,
  });
  const invitationForm = useForm<
    InvitationFormInput,
    unknown,
    InvitationFormValues
  >({
    resolver: zodResolver(invitationFormSchema),
    defaultValues: invitationDefaults(firstTenantId),
  });
  const tenantForm = useForm<TenantFormInput, unknown, TenantFormValues>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: { name: "", slug: "" },
  });

  const saveMutation = useMutation({
    mutationFn: (values: UserEditValues) =>
      saveManagedUser(editingUser, values),
    onSuccess(user) {
      setUsers((current) =>
        sortUsers(current.map((item) => (item.id === user.id ? user : item))),
      );
      setEditingUser(user);
      editForm.reset(userEditDefaults(user, firstTenantId));
      void queryClient.invalidateQueries({ queryKey: ["admin", "usage"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteManagedUser,
    onSuccess(user) {
      if (user.id === currentUserId) {
        window.location.href = "/login";
        return;
      }

      setUsers((current) => current.filter((item) => item.id !== user.id));
      void queryClient.invalidateQueries({ queryKey: ["admin", "usage"] });
      if (editingUser?.id === user.id) {
        setEditingUser(null);
      }
    },
  });

  const tenantMutation = useMutation({
    mutationFn: createManagedTenant,
    onSuccess(tenant) {
      const created = { ...tenant, _count: tenant._count ?? { users: 0 } };
      setTenants((current) => sortTenants([...current, created]));
      tenantForm.reset({ name: "", slug: "" });
      invitationForm.setValue("tenantId", tenant.id);
    },
  });

  const inviteMutation = useMutation({
    mutationFn: createUserInvitation,
    onSuccess(invitation) {
      setInviteSent(invitation);
      setCopiedInvite(false);
      setCopyInviteError(null);
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
    setCopyInviteError(null);

    try {
      await copyInvitationUrl(inviteSent.inviteUrl);

      setCopiedInvite(true);
    } catch {
      setCopiedInvite(false);
      setCopyInviteError(
        "Não foi possível copiar automaticamente. Selecione o link e copie manualmente.",
      );
    }
  }

  const submitEdit = editForm.handleSubmit((values) =>
    saveMutation.mutate(values),
  );
  const submitInvitation = invitationForm.handleSubmit((values) => {
    setInviteSent(null);
    inviteMutation.mutate(values);
  });
  const submitTenant = tenantForm.handleSubmit((values) =>
    tenantMutation.mutate(values),
  );

  return {
    users,
    tenants,
    invitations,
    editingUser,
    inviteSent,
    copiedInvite,
    copyInviteError,
    tenantOptions,
    editForm,
    invitationForm,
    tenantForm,
    saveMutation,
    deleteMutation,
    tenantMutation,
    inviteMutation,
    editUser,
    copyInviteLink,
    submitEdit,
    submitInvitation,
    submitTenant,
    setEditingUser,
    currentUserId,
  };
}
export type UsersManagerState = ReturnType<typeof useUsersManager>;
