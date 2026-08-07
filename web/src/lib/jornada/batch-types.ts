export type JornadaBatchConfig = {
  validarPeriodos: boolean;
  validarJornada: boolean;
  validarIntervalos: boolean;
  usarHorariosAgrupados: boolean;
  linhaInicio: number;
  colunaHorariosAgrupados: number;
};

export type JornadaBatchLine = {
  numeroLinha: number;
  matricula: string;
  nome: string;
  cargo: string;
  horarios: string[];
  horariosOriginais: string;
  jornadaCompleta: string;
  linhaSabado?: boolean;
  jornadaReferenciaMinutos?: number | null;
  resultado?: JornadaBatchValidationResult;
};

export type JornadaBatchValidationResult = {
  valido: boolean;
  mensagem: string;
  duracaoCalculada: string;
  tipoDia: string;
  codigo?: string;
  horasSemanais: number;
  horasMensais: number;
  intervalo?: string;
};

export type JornadaBatchReport = {
  arquivoOrigem: string;
  nomePlanilha: string;
  totalLinhas: number;
  validos: number;
  erros: number;
  avisos: number;
  linhas: JornadaBatchLine[];
  linhasComErro: JornadaBatchLine[];
  jornadasRepetidas: Record<string, number>;
};
