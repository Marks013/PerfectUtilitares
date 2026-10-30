type SolverErrorCode = "SOLVER_BUSY" | "SOLVER_UNAVAILABLE" | "SOLVER_INVALID_RESPONSE" | "SOLVER_AUTH_FAILED" | "SOLVER_CANCELLED" | "SOLVER_TIMED_OUT";

const messages: Record<SolverErrorCode, string> = {
  SOLVER_BUSY: "Há um cálculo em andamento. Aguarde o cálculo atual terminar e tente novamente.",
  SOLVER_UNAVAILABLE: "Não foi possível acessar o cálculo. Sua escala salva foi mantida; tente novamente.",
  SOLVER_INVALID_RESPONSE: "O cálculo não passou pela conferência. Sua escala salva foi mantida; tente novamente.",
  SOLVER_AUTH_FAILED: "O serviço de cálculo precisa de uma correção de acesso interno. Avise o responsável pelo sistema; sua escala foi mantida.",
  SOLVER_CANCELLED: "O cálculo foi interrompido. Sua escala salva foi mantida.",
  SOLVER_TIMED_OUT: "O cálculo atingiu o prazo disponível. Sua escala salva foi mantida; tente novamente.",
};

export class EscalaSolverError extends Error {
  constructor(public readonly code: SolverErrorCode) {
    super(messages[code]);
    this.name = "EscalaSolverError";
  }
}
