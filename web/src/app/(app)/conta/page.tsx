import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AccountDeletePanel } from "@/components/account-delete-panel";
import { AccountProfilePanel } from "@/components/account-profile-panel";

export default async function ContaPage() {
  const session = await auth();

  if (!session || session.user.isActive === false) {
    redirect("/login");
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-950">Conta</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Gerencie seu perfil, senha e acesso à plataforma.
        </p>
      </div>

      <AccountProfilePanel
        name={session.user.name ?? ""}
        email={session.user.email ?? ""}
        role={session.user.role}
      />
      <AccountDeletePanel email={session.user.email ?? ""} />
    </div>
  );
}
