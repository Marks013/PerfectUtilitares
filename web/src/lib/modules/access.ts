import { redirect } from "next/navigation";
import { auth, type AppSession } from "@/auth";
import type { AppModule } from "@/lib/api/security";

export function canAccessModule(session: AppSession, module: AppModule) {
  if (session.user.role === "ADMIN") {
    return true;
  }

  return module === "jornada"
    ? session.user.canAccessJornada
    : session.user.canAccessFotos;
}

export async function requirePageModuleAccess(module: AppModule) {
  const session = (await auth()) as AppSession | null;

  if (!session) {
    redirect("/login");
  }

  if (!canAccessModule(session, module)) {
    redirect("/dashboard");
  }

  return session;
}
