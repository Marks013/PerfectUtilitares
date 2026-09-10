"use client";

import { Building2, Plus } from "lucide-react";
import { getFormErrorMessages, makeSlug } from "./users-manager-model";
import type { UsersManagerState } from "./use-users-manager";

export function ManagedTenantsForm({
  model,
}: {
  model: Pick<
    UsersManagerState,
    "submitTenant" | "tenantForm" | "tenantMutation" | "tenants"
  >;
}) {
  const { submitTenant, tenantForm, tenantMutation, tenants } = model;
  return (
    <section className="app-radius-lg border app-border app-bg-card p-5 app-shadow">
      <div className="flex items-center gap-2">
        <Building2 className="size-4 app-text-muted" aria-hidden="true" />
        <h2 className="text-base font-semibold app-text">Empresas</h2>
      </div>
      <form onSubmit={submitTenant} className="mt-4 space-y-3">
        <label className="block text-sm font-medium app-text">
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
            className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
          />
        </label>
        <label className="block text-sm font-medium app-text">
          Apelido curto
          <input
            {...tenantForm.register("slug")}
            className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
          />
        </label>
        {getFormErrorMessages(tenantForm.formState.errors).length ? (
          <div className="app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
            <p className="font-medium">Revise os dados da empresa:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {getFormErrorMessages(tenantForm.formState.errors).map(
                (message) => (
                  <li key={message}>{message}</li>
                ),
              )}
            </ul>
          </div>
        ) : null}
        {tenantMutation.isError ? (
          <p className="app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">
            {tenantMutation.error.message}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={tenantMutation.isPending}
          className="inline-flex w-full items-center justify-center gap-2 app-radius-md border app-border px-4 py-2 text-sm font-medium app-text app-hover-surface disabled:opacity-60"
        >
          <Plus className="size-4" aria-hidden="true" />
          {tenantMutation.isPending ? "Criando..." : "Criar empresa"}
        </button>
      </form>
      <div className="mt-4 divide-y divide-neutral-100 app-radius-md border app-border">
        {tenants.map((tenant) => (
          <div
            key={tenant.id}
            className="flex items-center justify-between px-3 py-2 text-sm"
          >
            <span className="font-medium app-text">{tenant.name}</span>
            <span className="app-text-muted">{tenant.slug}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
