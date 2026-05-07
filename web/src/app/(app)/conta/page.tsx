import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AccountDeletePanel } from "@/components/account-delete-panel";

export default async function ContaPage() {
  const session = await auth();

  if (!session || session.user.isActive === false) {
    redirect("/login");
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-950">Conta</h1>
        <p className="mt-1 text-sm text-neutral-600">{session.user.email}</p>
      </div>

      <AccountDeletePanel email={session.user.email ?? ""} />
    </div>
  );
}
