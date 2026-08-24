import { cookies } from "next/headers";
import {
  createUnimedModuleSession,
  revokeUnimedModuleSessionCookie,
  unimedSessionCookieOptions,
  verifyUnimedModuleSessionCookie,
} from "@/lib/unimed/module-session";

export const REAJUSTE_ACCESS_COOKIE =
  "perfectutilitares.reajuste-salarial-access";
export const REAJUSTE_STANDARD_OPERATOR = "Dp Planalto";

export function reajusteSessionCookieOptions(maxAgeSeconds: number) {
  return unimedSessionCookieOptions(maxAgeSeconds);
}

export async function createReajusteModuleSession() {
  return createUnimedModuleSession("STANDARD", REAJUSTE_STANDARD_OPERATOR, {
    accessChannel: "REAJUSTE_SALARIAL_MODULE_PASSWORD",
    auditEntity: "ReajusteSalarialModuleSession",
  });
}

export async function getReajusteModuleSession() {
  const cookieStore = await cookies();
  return verifyUnimedModuleSessionCookie(
    cookieStore.get(REAJUSTE_ACCESS_COOKIE)?.value,
  );
}

export async function revokeReajusteModuleSessionCookie(
  cookieValue: string | null | undefined,
) {
  return revokeUnimedModuleSessionCookie(cookieValue);
}
