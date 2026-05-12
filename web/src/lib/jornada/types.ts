export type DiaValido = "util" | "sabado" | "domingo" | "feriado";

export type JornadaRuleInput = {
  id?: string;
  nome: string;
  duracaoMinutos: number;
  horasSemanais: number;
  horasMensais: number;
  intervaloMin: number;
  intervaloMax: number;
  diasValidos: string[];
  active?: boolean;
};

export type JornadaExceptionInput = {
  id: string;
  nome?: string | null;
  horariosNormalizado: string;
  sabadoNormalizado?: string | null;
  active?: boolean;
};

export type JornadaValidationInput = {
  horarios: string;
  tipoDia?: DiaValido;
  exigirSabadoComplementar?: boolean;
};

export type JornadaValidationMode = "simples" | "interjornada" | "sabado-combinado";

export type JornadaValidationResult = {
  valido: boolean;
  mensagem: string;
  duracaoCalculada?: string;
  tipoDia: DiaValido;
  codigo?: string;
  horasSemanais?: number;
  horasMensais?: number;
  intervalo?: string;
  horariosNormalizado: string;
  excecaoId?: string;
};

export type JornadaInterjornadaResult = {
  modo: Exclude<JornadaValidationMode, "simples">;
  valido: boolean;
  jornada1: JornadaValidationResult;
  jornada2: JornadaValidationResult;
  mensagemInterjornada: string;
  interjornadaMinutos?: number;
};
