import {
  getErrorMessage,
  type ManagedUser,
  type UserEditValues,
  type TenantFormValues,
  type Tenant,
  type InvitationFormValues,
  type Invitation,
} from "./users-manager-model";

export async function saveManagedUser(
  editingUser: ManagedUser | null,
  values: UserEditValues,
) {
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
}

export async function deleteManagedUser(user: ManagedUser) {
  const response = await fetch(`/api/admin/users/${user.id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, "Falha ao excluir usuário"),
    );
  }

  return user;
}

export async function createManagedTenant(values: TenantFormValues) {
  const response = await fetch("/api/admin/tenants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Falha ao criar empresa"));
  }

  return (await response.json()) as Tenant;
}

export async function createUserInvitation(values: InvitationFormValues) {
  const response = await fetch("/api/admin/invitations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Falha ao enviar convite"));
  }

  return (await response.json()) as Invitation;
}

export async function copyInvitationUrl(inviteUrl: string) {
  if (window.navigator.clipboard && window.isSecureContext) {
    await window.navigator.clipboard.writeText(inviteUrl);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = inviteUrl;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();

    if (!copied) {
      throw new Error("copy_failed");
    }
  }
}
