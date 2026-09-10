"use client";

import { X, Save } from "lucide-react";
import { getFormErrorMessages } from "./users-manager-model";
import type { UsersManagerState } from "./use-users-manager";

export function ManagedUserEditForm({
  model,
}: {
  model: Pick<
    UsersManagerState,
    | "editingUser"
    | "setEditingUser"
    | "submitEdit"
    | "editForm"
    | "tenantOptions"
    | "saveMutation"
  >;
}) {
  const {
    editingUser,
    setEditingUser,
    submitEdit,
    editForm,
    tenantOptions,
    saveMutation,
  } = model;
  return (
    <section className="app-radius-lg border app-border app-bg-card p-5 app-shadow">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold app-text">Editar usuário</h2>
          <p className="mt-1 text-sm app-text-muted">
            {editingUser
              ? "Ajuste os dados e o status da conta."
              : "Selecione um usuário na tabela."}
          </p>
        </div>
        {editingUser ? (
          <button
            type="button"
            onClick={() => setEditingUser(null)}
            className="grid size-9 place-items-center app-radius-md border app-border app-text-muted app-hover-surface"
            title="Fechar edição"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {editingUser ? (
        <form onSubmit={submitEdit} className="mt-5 space-y-4">
          <label className="block text-sm font-medium app-text">
            Nome
            <input
              {...editForm.register("name")}
              className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
            />
          </label>
          <label className="block text-sm font-medium app-text">
            E-mail
            <input
              type="email"
              {...editForm.register("email")}
              className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
            />
          </label>
          <label className="block text-sm font-medium app-text">
            Empresa
            <select
              {...editForm.register("tenantId")}
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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium app-text">
              Perfil
              <select
                {...editForm.register("role")}
                className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
              >
                <option value="OPERATOR">Operador</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </label>
            <label className="block text-sm font-medium app-text">
              Status
              <select
                {...editForm.register("status")}
                className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
              >
                <option value="ACTIVE">Ativo</option>
                <option value="BLOCKED">Bloqueado temporariamente</option>
                <option value="BANNED">Banido</option>
              </select>
            </label>
          </div>
          <p className="app-radius-md border app-border app-bg-surface p-3 text-xs app-text-muted">
            Para recuperar a senha, use a recuperação de acesso na tela de
            login.
          </p>
          <p className="text-xs app-text-muted">
            Bloquear suspende o acesso temporariamente. Banir impede novos
            acessos até que um administrador altere o status.
          </p>
          {getFormErrorMessages(editForm.formState.errors).length ? (
            <div className="app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
              <p className="font-medium">Revise o cadastro do usuário:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {getFormErrorMessages(editForm.formState.errors).map(
                  (message) => (
                    <li key={message}>{message}</li>
                  ),
                )}
              </ul>
            </div>
          ) : null}
          {saveMutation.isError ? (
            <p className="app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
              {saveMutation.error.message}
            </p>
          ) : null}
          {saveMutation.isSuccess ? (
            <p className="app-radius-md border app-border-success app-bg-success-soft p-3 text-sm app-text-success">
              Usuário atualizado.
            </p>
          ) : null}
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="inline-flex w-full items-center justify-center gap-2 app-radius-md app-action-fill px-4 py-2 text-sm font-medium text-white app-hover-action disabled:opacity-60"
          >
            <Save className="size-4" aria-hidden="true" />
            {saveMutation.isPending ? "Salvando..." : "Salvar alterações"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
