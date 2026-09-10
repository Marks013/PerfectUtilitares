"use client";

import { UserRound, Pencil, Trash2 } from "lucide-react";
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
import { userStatusClass, userStatusLabel } from "./users-manager-model";
import type { UsersManagerState } from "./use-users-manager";

export function ManagedUsersList({
  model,
}: {
  model: Pick<
    UsersManagerState,
    "users" | "currentUserId" | "editUser" | "deleteMutation"
  >;
}) {
  const { users, currentUserId, editUser, deleteMutation } = model;
  return (
    <section className="overflow-hidden app-radius-lg border app-border app-bg-card app-shadow">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b app-border px-4 py-3">
        <div>
          <h2 className="text-base font-semibold app-text">Usuários</h2>
          <p className="mt-1 text-sm app-text-muted">
            Edite cadastro, empresa e status. Senha fica com o usuário.
          </p>
        </div>
        <span className="rounded-full app-bg-surface px-3 py-1 text-xs font-medium app-text-muted">
          {users.length} cadastro(s)
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="app-bg-surface app-text-muted">
            <tr>
              <th className="px-4 py-3">Usuário</th>
              <th className="px-4 py-3">Empresa</th>
              <th className="px-4 py-3">Perfil</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t app-border">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <UserRound
                      className="size-4 app-text-muted"
                      aria-hidden="true"
                    />
                    <div>
                      <div className="font-medium app-text">{user.name}</div>
                      <div className="text-xs app-text-muted">{user.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {user.tenant?.name ?? "Sem empresa"}
                </td>
                <td className="px-4 py-3">
                  {user.role === "ADMIN" ? "Administrador" : "Operador"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${userStatusClass(user.status)}`}
                  >
                    {userStatusLabel(user.status)}
                    {user.id === currentUserId ? " · atual" : ""}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => editUser(user)}
                      className="inline-flex items-center gap-1 app-radius-md border app-border px-3 py-2 text-sm font-medium app-text app-hover-surface"
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                      Editar
                    </button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          type="button"
                          disabled={deleteMutation.isPending}
                          className="inline-flex items-center gap-1 app-radius-md border app-border-danger px-3 py-2 text-sm font-medium app-text-danger hover:bg-red-50 disabled:opacity-60"
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
                          <AlertDialogCancel className="app-radius-md border app-border px-4 py-2 text-sm font-medium app-text app-hover-surface">
                            Cancelar
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteMutation.mutate(user)}
                            className="app-radius-md app-bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
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
        <p className="border-t border-red-100 app-bg-danger-soft px-4 py-3 text-sm app-text-danger">
          {deleteMutation.error.message}
        </p>
      ) : null}
    </section>
  );
}
