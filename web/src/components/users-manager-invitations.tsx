"use client";

import { MailPlus, CheckCircle2, Copy } from "lucide-react";
import { getFormErrorMessages, formatDate } from "./users-manager-model";
import type { UsersManagerState } from "./use-users-manager";

export function UserInvitationForm({
  model,
}: {
  model: Pick<
    UsersManagerState,
    | "submitInvitation"
    | "invitationForm"
    | "tenantOptions"
    | "inviteMutation"
    | "inviteSent"
    | "copyInviteLink"
    | "copiedInvite"
    | "copyInviteError"
  >;
}) {
  const {
    submitInvitation,
    invitationForm,
    tenantOptions,
    inviteMutation,
    inviteSent,
    copyInviteLink,
    copiedInvite,
    copyInviteError,
  } = model;
  return (
    <section className="app-radius-lg border app-border app-bg-card p-5 app-shadow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold app-text">Convidar usuário</h2>
          <p className="mt-1 max-w-2xl text-sm app-text-muted">
            O administrador define perfil e módulos. A senha é criada pelo
            próprio usuário no link de convite. Para uma conta já cadastrada,
            use a recuperação de senha na tela de login.
          </p>
        </div>
        <MailPlus className="size-5 app-text-muted" aria-hidden="true" />
      </div>

      <form
        onSubmit={submitInvitation}
        className="mt-5 grid gap-3 lg:grid-cols-6"
      >
        <label className="block text-sm font-medium app-text lg:col-span-2">
          Nome
          <input
            {...invitationForm.register("name")}
            className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
          />
        </label>
        <label className="block text-sm font-medium app-text lg:col-span-2">
          E-mail
          <input
            type="email"
            {...invitationForm.register("email")}
            className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
          />
        </label>
        <label className="block text-sm font-medium app-text">
          Empresa
          <select
            {...invitationForm.register("tenantId")}
            disabled={!tenantOptions.length}
            className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border app-disabled-surface"
          >
            {tenantOptions.map((tenant) => (
              <option key={tenant.value} value={tenant.value}>
                {tenant.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium app-text">
          Perfil
          <select
            {...invitationForm.register("role")}
            className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
          >
            <option value="OPERATOR">Operador</option>
            <option value="ADMIN">Administrador</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={inviteMutation.isPending || !tenantOptions.length}
          className="inline-flex items-center justify-center gap-2 app-radius-md app-action-fill px-4 py-2 text-sm font-medium text-white app-hover-action disabled:opacity-60"
        >
          <MailPlus className="size-4" aria-hidden="true" />
          {inviteMutation.isPending ? "Gerando..." : "Gerar convite"}
        </button>
      </form>
      {getFormErrorMessages(invitationForm.formState.errors).length ? (
        <div className="mt-3 app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
          <p className="font-medium">Revise os dados do convite:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {getFormErrorMessages(invitationForm.formState.errors).map(
              (message) => (
                <li key={message}>{message}</li>
              ),
            )}
          </ul>
        </div>
      ) : null}

      {inviteSent ? (
        <div className="mt-4 app-radius-md border app-border-success app-bg-success-soft p-3 text-sm text-emerald-800">
          <div className="flex items-start gap-2">
            <CheckCircle2
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-emerald-950">
                Convite criado para {inviteSent.email}.
              </p>
              {inviteSent.inviteUrl ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <code className="min-w-0 select-all truncate app-radius-md border app-border-success app-bg-card px-3 py-2 text-xs app-text app-shadow">
                    {inviteSent.inviteUrl}
                  </code>
                  <button
                    type="button"
                    onClick={copyInviteLink}
                    className="inline-flex items-center justify-center gap-1 app-radius-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                  >
                    <Copy className="size-3.5" aria-hidden="true" />
                    {copiedInvite ? "Copiado" : "Copiar link"}
                  </button>
                  {copyInviteError ? (
                    <p className="app-radius-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:col-span-2">
                      {copyInviteError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {inviteMutation.isError ? (
        <p className="mt-3 app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
          {inviteMutation.error.message}
        </p>
      ) : null}
    </section>
  );
}

export function UserInvitationHistory({
  model,
}: {
  model: Pick<UsersManagerState, "invitations">;
}) {
  const { invitations } = model;
  return (
    <section className="app-radius-lg border app-border app-bg-card p-5 app-shadow">
      <div className="flex items-center gap-2">
        <MailPlus className="size-4 app-text-muted" aria-hidden="true" />
        <h2 className="text-base font-semibold app-text">Convites recentes</h2>
      </div>
      <div className="mt-4 overflow-hidden app-radius-md border app-border">
        <table className="w-full text-left text-sm">
          <thead className="app-bg-surface app-text-muted">
            <tr>
              <th className="px-3 py-2">E-mail</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">Criado</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((invitation) => (
              <tr key={invitation.id} className="border-t app-border">
                <td className="px-3 py-2">
                  <div className="font-medium app-text">{invitation.name}</div>
                  <div className="text-xs app-text-muted">
                    {invitation.email}
                  </div>
                </td>
                <td className="px-3 py-2">{invitation.tenant.name}</td>
                <td className="px-3 py-2">
                  {formatDate(invitation.createdAt)}
                </td>
                <td className="px-3 py-2">
                  {invitation.acceptedAt ? "Aceito" : "Pendente"}
                </td>
              </tr>
            ))}
            {invitations.length === 0 ? (
              <tr>
                <td className="px-3 py-6 app-text-muted" colSpan={4}>
                  Nenhum convite enviado ainda.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
