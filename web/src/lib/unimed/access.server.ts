import type { UnimedAccessLevel } from "@/generated/prisma/client";
import type { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/security";
import { canUseUnimed } from "@/lib/unimed/access";
import { getUnimedModuleSession } from "@/lib/unimed/module-session";
import type { UnimedAction } from "@/lib/unimed/types";

type UnimedAccessOk = {
  ok: true;
  moduleSessionId: string;
  operatorName: string;
  tenantId: string;
  accessLevel: UnimedAccessLevel;
};

type UnimedAccessFail = {
  ok: false;
  response: NextResponse;
};

export type UnimedAccessGuard = UnimedAccessOk | UnimedAccessFail;

export async function requireUnimedAccess(
  action: UnimedAction,
): Promise<UnimedAccessGuard> {
  const session = await getUnimedModuleSession();
  if (!session) {
    return {
      ok: false,
      response: jsonError(
        401,
        "UNIMED_ACCESS_REQUIRED",
        "Digite a senha do módulo Unimed para continuar.",
      ),
    };
  }

  if (!canUseUnimed({ role: "OPERATOR", accessLevel: session.level }, action)) {
    return {
      ok: false,
      response: jsonError(
        403,
        "UNIMED_FORBIDDEN",
        "A senha utilizada não permite realizar esta ação no módulo Unimed.",
      ),
    };
  }

  return {
    ok: true,
    moduleSessionId: session.id,
    operatorName: session.operatorName,
    tenantId: session.tenantId,
    accessLevel: session.level,
  };
}
