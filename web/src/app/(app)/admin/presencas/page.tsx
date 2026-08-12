import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PresenceAdmin } from "@/components/presence/presence-admin";

export const metadata = {
  robots: { index: false, follow: false },
  title: "Gestão de eventos",
};

export default async function PresenceAdminPage() {
  const session = await auth();
  if (session?.user.status !== "ACTIVE" || session.user.role !== "ADMIN") {
    redirect("/dashboard");
  }
  if (!session.user.tenantId) redirect("/dashboard");

  return <PresenceAdmin />;
}
