import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FeriasWorkspace } from "@/components/ferias/ferias-workspace";

export const metadata = {
  robots: { index: false, follow: false },
  title: "Férias",
};

export default async function FeriasPage() {
  const session = await auth();
  if (
    session?.user.status !== "ACTIVE" ||
    session.user.role !== "ADMIN" ||
    !session.user.tenantId
  ) {
    redirect("/dashboard");
  }
  return <FeriasWorkspace />;
}
