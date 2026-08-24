import type { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/security";
import { getReajusteModuleSession } from "./access-session";

type ReajusteAccessOk = {
  ok: true;
  moduleSessionId: string;
  operatorName: string;
  tenantId: string;
};

type ReajusteAccessFail = {
  ok: false;
  response: NextResponse;
};

export type ReajusteAccessGuard = ReajusteAccessOk | ReajusteAccessFail;

export async function requireReajusteAccess(): Promise<ReajusteAccessGuard> {
  const session = await getReajusteModuleSession();
  if (!session) {
    return {
      ok: false,
      response: jsonError(
        401,
        "REAJUSTE_ACCESS_REQUIRED",
        "Digite a senha padrão do módulo para continuar.",
      ),
    };
  }

  return {
    ok: true,
    moduleSessionId: session.id,
    operatorName: session.operatorName,
    tenantId: session.tenantId,
  };
}
