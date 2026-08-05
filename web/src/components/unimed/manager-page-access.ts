import { redirect } from "next/navigation";
import { canUseUnimed } from "@/lib/unimed/access";
import { getUnimedModuleSession } from "@/lib/unimed/module-session";
import type { UnimedAction } from "@/lib/unimed/types";

export async function requireUnimedManagerPage(action: UnimedAction) {
  const session = await getUnimedModuleSession();
  const nextPath =
    action === "MANAGE_CONFIG"
      ? "/unimed/configuracoes"
      : "/unimed/importar";
  if (!session) {
    redirect(`/unimed/acesso?next=${encodeURIComponent(nextPath)}`);
  }

  if (
    !canUseUnimed(
      { role: "OPERATOR", accessLevel: session.level },
      action,
    )
  ) {
    redirect("/unimed");
  }

  return session;
}
