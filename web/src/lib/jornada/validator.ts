import {
  normalizarHorarios,
  validarHorariosNormalizados,
} from "@/lib/codigos/horario-normalizer";
import { DEFAULT_JORNADA_RULES, JORNADA_CONFIG } from "./default-rules";
import {
  calcularDuracaoMinutos,
  formatarDuracao,
  formatarDuracaoLegivel,
  formatarIntervalo,
  parseHorario,
  validarLimiteDiario,
} from "./time";
import type {
  DiaValido,
  JornadaExceptionInput,
  JornadaInterjornadaResult,
  JornadaRuleInput,
  JornadaValidationInput,
  JornadaValidationMode,
  JornadaValidationResult,
} from "./types";

function sameDuration(ruleDuration: number, duration: number): boolean {
  return ruleDuration === duration;
}

function getRule(
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

function createError(
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

function extractFirstAndLast(horariosNormalizado: string) {
  const parsed = horariosNormalizado.split(" ").map(parseHorario);

  if (parsed.length < 2 || parsed.some((value) => value == null)) {
    return null;
  }

  return {
    first: parsed[0] as number,
    last: parsed[parsed.length - 1] as number,
  };
}

function formatarJornadasAceitas() {
  return JORNADA_CONFIG.jornadasUtilAceitasMinutos.map(formatarDuracao).join(", ");
}

function createInterjornadaMessage(intervaloMinutos: number, prefix = "Interjornada") {
  const minimoHoras = JORNADA_CONFIG.interjornadaMinimaMinutos / 60;

  if (intervaloMinutos >= JORNADA_CONFIG.interjornadaMinimaMinutos) {
    return `${prefix} válida: ${formatarDuracaoLegivel(intervaloMinutos)} entre a saída da primeira jornada e a entrada da próxima.`;
  }

  return `${prefix} insuficiente: ${formatarDuracaoLegivel(intervaloMinutos)} entre uma jornada e outra. O mínimo exigido é ${minimoHoras}h.`;
}

function createPeriodosMessage(periodo1: number, periodo2: number): string {
  return `Primeiro período trabalhado: ${formatarDuracaoLegivel(periodo1)}\nSegundo período trabalhado: ${formatarDuracaoLegivel(periodo2)}`;
}

function createFormatoDetalhadoMessage(horariosNormalizado: string, mensagem: string) {
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

function addPeriodosDetalhe(erros: string[], periodosDetalhe: string): string {
  if (!periodosDetalhe) return erros.join("\n");

  return [...erros, periodosDetalhe].join("\n");
}

function hasLunchException(duracaoMinutos: number) {
  return JORNADA_CONFIG.jornadasComExcecaoAlmocoMinutos.includes(duracaoMinutos);
}

function findAuthorizedException(
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

function buildExceptionResult({
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

function createMissingSaturdayComplementMessage(exceptionName: string) {
  return `Esta exceção autorizada exige complemento de sábado. Informe também a jornada de sábado cadastrada para fechar 44h semanais. Exceção: ${exceptionName}.`;
}

export function validarJornadaManual(
  input: JornadaValidationInput,
  rules: JornadaRuleInput[] = DEFAULT_JORNADA_RULES,
  buscarCodigo?: (horariosNormalizado: string) => string | null | undefined,
  exceptions: JornadaExceptionInput[] = [],
): JornadaValidationResult {
  const tipoDia = input.tipoDia ?? "util";
  const horariosNormalizado = normalizarHorarios(input.horarios);

  const validacaoFormato = validarHorariosNormalizados(horariosNormalizado);
  if (!validacaoFormato.valido) {
    return createError(
      horariosNormalizado
        ? createFormatoDetalhadoMessage(
            horariosNormalizado,
            validacaoFormato.mensagem,
          )
        : validacaoFormato.mensagem,
      tipoDia,
      horariosNormalizado,
    );
  }

  const horarios = horariosNormalizado.split(" ");
  const parsed = horarios.map(parseHorario);

  if (parsed.some((value) => value == null)) {
    return createError(
      "Formato de horário inválido. Use HH:MM, por exemplo 08:00 ou 17:30.",
      tipoDia,
      horariosNormalizado,
    );
  }

  const times = parsed as number[];
  let duracaoMinutos = 0;
  let intervaloMinutos: number | null = null;
  let periodosDetalhe = "";
  let duracaoInvalidaParaDia = false;
  const erros: string[] = [];

  if (times.length === 2) {
    if (times[0] >= times[1]) {
      return createError(
        `Horário inicial inválido: a entrada (${horarios[0]}) deve ser antes da saída (${horarios[1]}).`,
        tipoDia,
        horariosNormalizado,
      );
    }

    duracaoMinutos = calcularDuracaoMinutos(times[0], times[1]);

    if (
      duracaoMinutos > JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos &&
      tipoDia !== "sabado"
    ) {
      return createError(
        `Esta jornada soma ${formatarDuracao(duracaoMinutos)} e requer intervalo. Informe 4 horários: entrada, saída para intervalo, retorno e saída final.`,
        tipoDia,
        horariosNormalizado,
      );
    }
  } else {
    const [inicio1, fim1, inicio2, fim2] = times;

    if (inicio1 >= fim1) {
      return createError(
        `Primeiro período inválido: a entrada (${horarios[0]}) deve ser antes da saída para intervalo (${horarios[1]}).`,
        tipoDia,
        horariosNormalizado,
      );
    }

    if (inicio2 >= fim2) {
      return createError(
        `Segundo período inválido: o retorno (${horarios[2]}) deve ser antes da saída final (${horarios[3]}).`,
        tipoDia,
        horariosNormalizado,
      );
    }

    if (fim1 > inicio2) {
      return createError(
        `Intervalo entre períodos inválido: o retorno (${horarios[2]}) deve ser depois da saída para intervalo (${horarios[1]}).`,
        tipoDia,
        horariosNormalizado,
      );
    }

    const periodo1Minutos = calcularDuracaoMinutos(inicio1, fim1);
    const periodo2Minutos = calcularDuracaoMinutos(inicio2, fim2);
    intervaloMinutos = calcularDuracaoMinutos(fim1, inicio2);
    duracaoMinutos = periodo1Minutos + periodo2Minutos;
    periodosDetalhe = createPeriodosMessage(periodo1Minutos, periodo2Minutos);

    if (periodo1Minutos > JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos) {
      erros.push(
        `Primeiro período (${formatarDuracaoLegivel(periodo1Minutos)}) excede ${formatarDuracaoLegivel(
          JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos,
        )}. Cada período de trabalho deve ter no máximo 04:00 antes de iniciar ou retornar do intervalo.`,
      );
    }

    if (periodo2Minutos > JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos) {
      erros.push(
        `Segundo período (${formatarDuracaoLegivel(periodo2Minutos)}) excede ${formatarDuracaoLegivel(
          JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos,
        )}. Cada período de trabalho deve ter no máximo 04:00 antes de iniciar ou retornar do intervalo.`,
      );
    }

    if (
      !hasLunchException(duracaoMinutos) &&
      intervaloMinutos < JORNADA_CONFIG.intervaloAlmocoMinimoMinutos
    ) {
      erros.push(
        `Intervalo insuficiente (${formatarDuracaoLegivel(intervaloMinutos)}). Mínimo: ${formatarDuracaoLegivel(
          JORNADA_CONFIG.intervaloAlmocoMinimoMinutos,
        )} para jornadas de 07:20 ou 08:00.`,
      );
    }

    if (
      !hasLunchException(duracaoMinutos) &&
      intervaloMinutos > JORNADA_CONFIG.intervaloAlmocoMaximoMinutos
    ) {
      erros.push(
        `Intervalo excessivo (${formatarDuracaoLegivel(intervaloMinutos)}). Máximo: ${formatarDuracaoLegivel(
          JORNADA_CONFIG.intervaloAlmocoMaximoMinutos,
        )}.`,
      );
    }

  }

  const authorizedException = findAuthorizedException(
    exceptions,
    tipoDia,
    horariosNormalizado,
  );
  if (authorizedException) {
    if (
      input.exigirSabadoComplementar &&
      tipoDia === "util" &&
      duracaoMinutos === 480 &&
      authorizedException.sabadoNormalizado
    ) {
      return createError(
        createMissingSaturdayComplementMessage(
          authorizedException.nome?.trim() || "exceção autorizada",
        ),
        tipoDia,
        horariosNormalizado,
      );
    }

    return buildExceptionResult({
      exception: authorizedException,
      tipoDia,
      horariosNormalizado,
      duracaoMinutos,
      intervaloMinutos,
      buscarCodigo,
    });
  }

  if (
    times.length === 2 &&
    !validarLimiteDiario(duracaoMinutos, JORNADA_CONFIG.periodoMaximoHoras)
  ) {
    erros.push(
      `Período total (${formatarDuracaoLegivel(duracaoMinutos)}) excede o limite diário de ${JORNADA_CONFIG.periodoMaximoHoras}h.`,
    );
  }

  if (
    duracaoMinutos === JORNADA_CONFIG.complementoSabadoMinutos &&
    times.length !== 2
  ) {
    erros.push(
      "Jornada de 04:00 não deve ter intervalo. Informe apenas 2 horários: entrada e saída.",
    );
  }

  if (
    tipoDia === "util" &&
    !JORNADA_CONFIG.jornadasUtilAceitasMinutos.includes(duracaoMinutos)
  ) {
    duracaoInvalidaParaDia = true;
    erros.push(
      `Total informado: ${formatarDuracao(
        duracaoMinutos,
      )}. Para dia útil, as jornadas aceitas são: ${formatarJornadasAceitas()}.`,
    );
  }

  if (
    tipoDia === "sabado" &&
    duracaoMinutos !== JORNADA_CONFIG.complementoSabadoMinutos
  ) {
    duracaoInvalidaParaDia = true;
    erros.push(
      `Sábado deve ter exatamente ${formatarDuracao(
        JORNADA_CONFIG.complementoSabadoMinutos,
      )}, sem intervalo, para completar 44h semanais. Duração informada: ${formatarDuracao(
        duracaoMinutos,
      )}.`,
    );
  }

  const rule = getRule(rules, duracaoMinutos, tipoDia);
  if (!rule && !duracaoInvalidaParaDia) {
    erros.push(
      `Não existe regra ativa para jornada de ${formatarDuracao(duracaoMinutos)} neste tipo de dia. Verifique as regras cadastradas ou autorize uma exceção.`,
    );
  }

  if (rule && rule.intervaloMin > 0) {
    if (intervaloMinutos == null) {
      return createError(
        `A regra "${rule.nome}" requer intervalo. Informe 4 horários: entrada, saída para intervalo, retorno e saída final.`,
        tipoDia,
        horariosNormalizado,
      );
    }

    if (
      intervaloMinutos < rule.intervaloMin &&
      !erros.some((erro) => erro.startsWith("Intervalo insuficiente"))
    ) {
      erros.push(
        `Intervalo insuficiente (${formatarDuracaoLegivel(intervaloMinutos)}) para ${rule.nome}. Mínimo exigido: ${formatarDuracaoLegivel(
          rule.intervaloMin,
        )}.`,
      );
    }

    if (
      intervaloMinutos > rule.intervaloMax &&
      !erros.some((erro) => erro.startsWith("Intervalo excessivo"))
    ) {
      erros.push(
        `Intervalo excessivo (${formatarDuracaoLegivel(intervaloMinutos)}) para ${rule.nome}. Máximo permitido: ${formatarDuracaoLegivel(
          rule.intervaloMax,
        )}.`,
      );
    }
  }

  if (erros.length > 0 || !rule) {
    return createError(
      addPeriodosDetalhe([...new Set(erros)], periodosDetalhe),
      tipoDia,
      horariosNormalizado,
    );
  }

  const codigo = buscarCodigo?.(horariosNormalizado) ?? undefined;
  const duracaoCalculada = formatarDuracao(duracaoMinutos);

  return {
    valido: true,
    mensagem: `Jornada válida: ${rule.nome}`,
    duracaoCalculada,
    tipoDia,
    codigo,
    horasSemanais: rule.horasSemanais,
    horasMensais: rule.horasMensais,
    intervalo:
      intervaloMinutos == null ? undefined : formatarIntervalo(intervaloMinutos),
    horariosNormalizado,
  };
}

export function validarJornadaComInterjornada(
  input: {
    horarios1: string;
    horarios2: string;
    modo: Exclude<JornadaValidationMode, "simples">;
    validarInterjornada?: boolean;
  },
  rules: JornadaRuleInput[] = DEFAULT_JORNADA_RULES,
  buscarCodigo?: (horariosNormalizado: string) => string | null | undefined,
  exceptions: JornadaExceptionInput[] = [],
): JornadaInterjornadaResult {
  const validarInterjornada = input.validarInterjornada ?? true;
  const jornada1 = validarJornadaManual(
    { horarios: input.horarios1, tipoDia: "util" },
    rules,
    buscarCodigo,
    exceptions,
  );
  const jornada2 = validarJornadaManual(
    {
      horarios: input.horarios2,
      tipoDia: input.modo === "sabado-combinado" ? "sabado" : "util",
    },
    rules,
    buscarCodigo,
    exceptions,
  );
  const endpoints1 = extractFirstAndLast(jornada1.horariosNormalizado);
  const endpoints2 = extractFirstAndLast(jornada2.horariosNormalizado);
  const interjornadaMinutos =
    endpoints1 && endpoints2
      ? calcularDuracaoMinutos(endpoints1.last, endpoints2.first)
      : undefined;

  if (input.modo === "sabado-combinado") {
    if (!jornada1.valido || jornada1.duracaoCalculada !== "08:00") {
      return {
        modo: input.modo,
        valido: false,
        jornada1,
        jornada2: {
          ...jornada2,
          valido: false,
          mensagem:
            "Jornada principal deve ser uma jornada válida de 08:00 para liberar o complemento de sábado.",
        },
        mensagemInterjornada: "",
        interjornadaMinutos,
      };
    }

    if (!jornada2.valido || jornada2.duracaoCalculada !== "04:00") {
      return {
        modo: input.modo,
        valido: false,
        jornada1,
        jornada2: {
          ...jornada2,
          valido: false,
          mensagem: jornada2.valido
            ? "Sábado deve ter exatamente 04:00, sem intervalo, para completar a jornada semanal."
            : jornada2.mensagem,
        },
        mensagemInterjornada: "",
        interjornadaMinutos,
      };
    }
  }

  if (!jornada1.valido || !jornada2.valido || interjornadaMinutos == null) {
    return {
      modo: input.modo,
      valido: false,
      jornada1,
      jornada2,
      mensagemInterjornada:
        interjornadaMinutos == null
          ? "Interjornada não calculada. Verifique se as duas jornadas possuem horários válidos."
          : createInterjornadaMessage(interjornadaMinutos),
      interjornadaMinutos,
    };
  }

  const interjornadaValida =
    !validarInterjornada ||
    interjornadaMinutos >= JORNADA_CONFIG.interjornadaMinimaMinutos;
  const mensagemInterjornada = validarInterjornada
    ? createInterjornadaMessage(interjornadaMinutos)
    : `Interjornada não avaliada por configuração: ${formatarDuracaoLegivel(interjornadaMinutos)}.`;

  if (input.modo === "sabado-combinado") {
    const horasSemanais = 44;
    const horasMensais = 220;
    const jornada2Combinada: JornadaValidationResult = {
      ...jornada2,
      valido: interjornadaValida,
      mensagem: interjornadaValida
        ? "Jornada Sábado - 04:00 (complemento para 44h semanais)"
        : "Jornada Sábado - Interjornada insuficiente",
      horasSemanais,
      horasMensais,
    };

    return {
      modo: input.modo,
      valido: interjornadaValida,
      jornada1,
      jornada2: jornada2Combinada,
      mensagemInterjornada: interjornadaValida
        ? `Jornada completa: 40h (Seg-Sex) + 4h (Sáb) = ${horasSemanais}h semanais / ${horasMensais}h mensais\n${
            validarInterjornada
              ? createInterjornadaMessage(
                  interjornadaMinutos,
                  "Interjornada Sexta a Sábado",
                )
              : "Interjornada não avaliada por configuração"
          }`
        : `Jornada: 40h (Seg-Sex) + 4h (Sáb) = ${horasSemanais}h semanais / ${horasMensais}h mensais\n${createInterjornadaMessage(
            interjornadaMinutos,
            "Interjornada Sexta a Sábado",
          )}`,
      interjornadaMinutos,
    };
  }

  return {
    modo: input.modo,
    valido: jornada1.valido && jornada2.valido && interjornadaValida,
    jornada1,
    jornada2,
    mensagemInterjornada,
    interjornadaMinutos,
  };
}
