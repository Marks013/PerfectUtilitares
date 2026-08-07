import { JORNADA_CONFIG } from "./default-rules";
import {
  calcularDuracaoMinutos,
  formatarDuracao,
  formatarDuracaoLegivel,
  formatarIntervalo,
  parseHorario,
} from "./time";
import type {
  DiaValido,
  JornadaExceptionInput,
  JornadaRuleInput,
  JornadaValidationResult,
} from "./types";

function sameDuration(ruleDuration: number, duration: number): boolean {
  return ruleDuration === duration;
}

export function getRule(
  rules: JornadaRuleInput[],
  duracaoMinutos: number,
  tipoDia: DiaValido,
) {
  return rules.find(
    (rule) =>
      rule.active !== false &&
      sameDuration(rule.duracaoMinutos, duracaoMinutos) &&
      rule.diasValidos.includes(tipoDia),
  );
}

export function createError(
  mensagem: string,
  tipoDia: DiaValido,
  horariosNormalizado: string,
): JornadaValidationResult {
  return {
    valido: false,
    mensagem,
    tipoDia,
    horariosNormalizado,
  };
}

export function extractFirstAndLast(horariosNormalizado: string) {
  const parsed = horariosNormalizado.split(" ").map(parseHorario);

  if (parsed.length < 2 || parsed.some((value) => value == null)) {
    return null;
  }

  return {
    first: parsed[0] as number,
    last: parsed[parsed.length - 1] as number,
  };
}

export function formatarJornadasAceitas() {
  return JORNADA_CONFIG.jornadasUtilAceitasMinutos.map(formatarDuracao).join(", ");
}

export function createInterjornadaMessage(intervaloMinutos: number, prefix = "Interjornada") {
  const minimoHoras = JORNADA_CONFIG.interjornadaMinimaMinutos / 60;

  if (intervaloMinutos >= JORNADA_CONFIG.interjornadaMinimaMinutos) {
    return `${prefix} válida: ${formatarDuracaoLegivel(intervaloMinutos)} entre a saída da primeira jornada e a entrada da próxima.`;
  }

  return `${prefix} insuficiente: ${formatarDuracaoLegivel(intervaloMinutos)} entre uma jornada e outra. O mínimo exigido é ${minimoHoras}h.`;
}

export function createPeriodosMessage(periodo1: number, periodo2: number): string {
  return `Primeiro período trabalhado: ${formatarDuracaoLegivel(periodo1)}\nSegundo período trabalhado: ${formatarDuracaoLegivel(periodo2)}`;
}

export function createFormatoDetalhadoMessage(horariosNormalizado: string, mensagem: string) {
  const pontos = horariosNormalizado.split(" ");
  const invalido = pontos.find((ponto) => parseHorario(ponto) == null);
  const detalhes: string[] = [];

  if (pontos.length >= 2) {
    const inicio1 = parseHorario(pontos[0]);
    const fim1 = parseHorario(pontos[1]);
    detalhes.push(
      inicio1 != null && fim1 != null && inicio1 < fim1
        ? `Primeiro período trabalhado: ${formatarDuracaoLegivel(
            calcularDuracaoMinutos(inicio1, fim1),
          )}`
        : "Primeiro período: não calculado",
    );
  }

  if (pontos.length >= 4) {
    const inicio2 = parseHorario(pontos[2]);
    const fim2 = parseHorario(pontos[3]);
    detalhes.push(
      inicio2 != null && fim2 != null && inicio2 < fim2
        ? `Segundo período trabalhado: ${formatarDuracaoLegivel(
            calcularDuracaoMinutos(inicio2, fim2),
          )}`
        : "Segundo período: não calculado",
    );
  }

  const motivo = invalido
    ? `Horário incompleto ou inválido: ${invalido}. Use o formato HH:MM, entre 00:00 e 23:59.`
    : pontos.length !== 2 && pontos.length !== 4
      ? `Quantidade de horários inválida: informe 2 horários (entrada e saída) ou 4 horários (entrada, saída para intervalo, retorno e saída final). Horários recebidos: ${pontos.length}.`
      : mensagem;

  return [motivo, ...detalhes].join("\n");
}

export function addPeriodosDetalhe(erros: string[], periodosDetalhe: string): string {
  if (!periodosDetalhe) return erros.join("\n");

  return [...erros, periodosDetalhe].join("\n");
}

export function hasLunchException(duracaoMinutos: number) {
  return JORNADA_CONFIG.jornadasComExcecaoAlmocoMinutos.includes(duracaoMinutos);
}

export function findAuthorizedException(
  exceptions: JornadaExceptionInput[],
  tipoDia: DiaValido,
  horariosNormalizado: string,
) {
  return exceptions.find((exception) => {
    if (exception.active === false) return false;

    return tipoDia === "sabado"
      ? exception.sabadoNormalizado === horariosNormalizado
      : exception.horariosNormalizado === horariosNormalizado;
  });
}

export function buildExceptionResult({
  exception,
  tipoDia,
  horariosNormalizado,
  duracaoMinutos,
  intervaloMinutos,
  buscarCodigo,
}: {
  exception: JornadaExceptionInput;
  tipoDia: DiaValido;
  horariosNormalizado: string;
  duracaoMinutos: number;
  intervaloMinutos: number | null;
  buscarCodigo?: (horariosNormalizado: string) => string | null | undefined;
}): JornadaValidationResult {
  const duracaoCalculada = formatarDuracao(duracaoMinutos);
  const nome = exception.nome?.trim() || "exceção autorizada";
  const horasSemanais =
    tipoDia === "util" && duracaoMinutos === 480 && exception.sabadoNormalizado
      ? 44
      : undefined;

  return {
    valido: true,
    mensagem: `Jornada válida por exceção autorizada: ${nome}`,
    duracaoCalculada,
    tipoDia,
    codigo: buscarCodigo?.(horariosNormalizado) ?? undefined,
    horasSemanais,
    horasMensais: horasSemanais ? horasSemanais * 5 : undefined,
    intervalo:
      intervaloMinutos == null ? undefined : formatarIntervalo(intervaloMinutos),
    horariosNormalizado,
    excecaoId: exception.id,
  };
}

export function createMissingSaturdayComplementMessage(exceptionName: string) {
  return `Esta exceção autorizada exige complemento de sábado. Informe também a jornada de sábado cadastrada para fechar 44h semanais. Exceção: ${exceptionName}.`;
}

