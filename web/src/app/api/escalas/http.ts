import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/security";
import { EscalaError } from "@/lib/escalas/access";
import { EscalaSolverError } from "@/lib/escalas/solver-client";

export function escalaJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}

export function escalaFailure(error: unknown) {
  if (error instanceof EscalaError) return jsonError(error.status, error.code, error.message);
  if (error instanceof EscalaSolverError) return jsonError(error.code === "SOLVER_BUSY" ? 429 : 503, error.code,
    error.code === "SOLVER_BUSY" ? "O processamento de Escalas está ocupado. Aguarde e tente novamente; a proposta foi preservada." : "O processamento de Escalas está temporariamente indisponível. A proposta foi preservada.");
  if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
    return jsonError(409, "ESCALA_ALREADY_EXISTS", "Já existe uma escala para esta filial e período. Abra a proposta existente.");
  }
  throw error;
}
