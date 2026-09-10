"use client";

import type { UsersManagerProps } from "./users-manager-model";
import { useUsersManager } from "./use-users-manager";
import {
  UserInvitationForm,
  UserInvitationHistory,
} from "./users-manager-invitations";
import { ManagedUsersList } from "./users-manager-list";
import { ManagedUserEditForm } from "./users-manager-edit-form";
import { ManagedTenantsForm } from "./users-manager-tenants";

export function UsersManager(props: UsersManagerProps) {
  const model = useUsersManager(props);
  return (
    <div className="space-y-4">
      <UserInvitationForm model={model} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <ManagedUsersList model={model} />
        <aside className="space-y-4">
          <ManagedUserEditForm model={model} />
          <ManagedTenantsForm model={model} />
        </aside>
      </div>
      <UserInvitationHistory model={model} />
    </div>
  );
}
