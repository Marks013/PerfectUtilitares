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

function createInterjornadaMessage(intervaloMinutos: number, prefix = "Interjornada") {
  const minimoHoras = JORNADA_CONFIG.interjornadaMinimaMinutos / 60;

  if (intervaloMinutos >= JORNADA_CONFIG.interjornadaMinimaMinutos) {
    return `${prefix}: ${formatarDuracaoLegivel(intervaloMinutos)}`;
  }

  return `${prefix} insuficiente: ${formatarDuracaoLegivel(intervaloMinutos)} (minimo ${minimoHoras}h)`;
}

function createPeriodosMessage(periodo1: number, periodo2: number): string {
  return `Primeiro periodo: ${formatarDuracaoLegivel(periodo1)}\nSegundo periodo: ${formatarDuracaoLegivel(periodo2)}`;
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
        ? `Primeiro periodo: ${formatarDuracaoLegivel(
            calcularDuracaoMinutos(inicio1, fim1),
          )}`
        : "Primeiro periodo: nao calculado",
    );
  }

  if (pontos.length >= 4) {
    const inicio2 = parseHorario(pontos[2]);
    const fim2 = parseHorario(pontos[3]);
    detalhes.push(
      inicio2 != null && fim2 != null && inicio2 < fim2
        ? `Segundo periodo: ${formatarDuracaoLegivel(
            calcularDuracaoMinutos(inicio2, fim2),
          )}`
        : "Segundo periodo: nao calculado",
    );
  }

  const motivo = invalido
    ? `Horario incompleto ou invalido: ${invalido}. Use HH:MM entre 00:00 e 23:59.`
    : pontos.length !== 2 && pontos.length !== 4
      ? `Quantidade incompleta: informe 2 horarios (entrada e saida) ou 4 horarios (entrada, saida, retorno e saida final). Horarios recebidos: ${pontos.length}.`
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
      "Formato inválido. Use HH:MM",
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
        "Horário inicial deve ser antes do final",
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
        "Esta jornada requer intervalo. Digite 4 horários",
        tipoDia,
        horariosNormalizado,
      );
    }
  } else {
    const [inicio1, fim1, inicio2, fim2] = times;

    if (inicio1 >= fim1) {
      return createError(
        "Primeiro período deve iniciar antes do final",
        tipoDia,
        horariosNormalizado,
      );
    }

    if (inicio2 >= fim2) {
      return createError(
        "Segundo período deve iniciar antes do final",
        tipoDia,
        horariosNormalizado,
      );
    }

    if (fim1 > inicio2) {
      return createError(
        "Intervalo entre periodos invalido. Segundo periodo deve iniciar depois do primeiro",
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
        `Primeiro periodo (${formatarDuracaoLegivel(periodo1Minutos)}) excede ${formatarDuracaoLegivel(
          JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos,
        )}`,
      );
    }

    if (periodo2Minutos > JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos) {
      erros.push(
        `Segundo periodo (${formatarDuracaoLegivel(periodo2Minutos)}) excede ${formatarDuracaoLegivel(
          JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos,
        )}`,
      );
    }

    if (
      !hasLunchException(duracaoMinutos) &&
      intervaloMinutos < JORNADA_CONFIG.intervaloAlmocoMinimoMinutos
    ) {
      erros.push(
        `Intervalo insuficiente (${formatarDuracaoLegivel(intervaloMinutos)}). Minimo: ${formatarDuracaoLegivel(
          JORNADA_CONFIG.intervaloAlmocoMinimoMinutos,
        )}`,
      );
    }

    if (intervaloMinutos > JORNADA_CONFIG.intervaloAlmocoMaximoMinutos) {
      erros.push(
        `Intervalo excessivo (${formatarDuracaoLegivel(intervaloMinutos)}). Maximo: ${formatarDuracaoLegivel(
          JORNADA_CONFIG.intervaloAlmocoMaximoMinutos,
        )}`,
      );
    }

    const periodoTotalMinutos = duracaoMinutos + intervaloMinutos;
    if (!validarLimiteDiario(periodoTotalMinutos, JORNADA_CONFIG.periodoMaximoHoras)) {
      erros.push(
        `Periodo total (${formatarDuracaoLegivel(periodoTotalMinutos)}) excede limite de ${JORNADA_CONFIG.periodoMaximoHoras}h`,
      );
    }
  }

  const authorizedException = findAuthorizedException(
    exceptions,
    tipoDia,
    horariosNormalizado,
  );
  if (authorizedException) {
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
      `Periodo total (${formatarDuracaoLegivel(duracaoMinutos)}) excede limite de ${JORNADA_CONFIG.periodoMaximoHoras}h`,
    );
  }

  if (
    duracaoMinutos === JORNADA_CONFIG.complementoSabadoMinutos &&
    times.length !== 2
  ) {
    erros.push(
      "Jornada de 04:00 não tem intervalo. Digite apenas entrada e saída",
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
      )}. Jornadas aceitas: 04:00, 05:50, 07:20 ou 08:00`,
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
      )} para completar 44h semanais. Duração informada: ${formatarDuracao(
        duracaoMinutos,
      )}`,
    );
  }

  const rule = getRule(rules, duracaoMinutos, tipoDia);
  if (!rule && !duracaoInvalidaParaDia) {
    erros.push(
      `Não existe regra ativa para jornada de ${formatarDuracao(duracaoMinutos)}`,
    );
  }

  if (rule && rule.intervaloMin > 0) {
    if (intervaloMinutos == null) {
      return createError(
        "Esta jornada requer intervalo. Digite 4 horários",
        tipoDia,
        horariosNormalizado,
      );
    }

    if (intervaloMinutos < rule.intervaloMin) {
      erros.push(
        `Intervalo insuficiente (${formatarDuracaoLegivel(intervaloMinutos)}). Minimo: ${formatarDuracaoLegivel(
          rule.intervaloMin,
        )}`,
      );
    }

    if (intervaloMinutos > rule.intervaloMax) {
      erros.push(
        `Intervalo excessivo (${formatarDuracaoLegivel(intervaloMinutos)}). Maximo: ${formatarDuracaoLegivel(
          rule.intervaloMax,
        )}`,
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
          mensagem: "Jornada principal deve ser 8h válida para abrir sábado",
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
            ? "Sabado deve ter exatamente 4 horas"
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
          ? "Interjornada nao calculada"
          : createInterjornadaMessage(interjornadaMinutos),
      interjornadaMinutos,
    };
  }

  const interjornadaValida =
    !validarInterjornada ||
    interjornadaMinutos >= JORNADA_CONFIG.interjornadaMinimaMinutos;
  const mensagemInterjornada = validarInterjornada
    ? createInterjornadaMessage(interjornadaMinutos)
    : `Interjornada nao avaliada: ${formatarDuracaoLegivel(interjornadaMinutos)}`;

  if (input.modo === "sabado-combinado") {
    const horasSemanais = 44;
    const horasMensais = 220;
    const jornada2Combinada: JornadaValidationResult = {
      ...jornada2,
      valido: interjornadaValida,
      mensagem: interjornadaValida
        ? "Jornada Sabado - 4h (Complemento 44h semanais)"
        : "Jornada Sabado - Interjornada insuficiente",
      horasSemanais,
      horasMensais,
    };

    return {
      modo: input.modo,
      valido: interjornadaValida,
      jornada1,
      jornada2: jornada2Combinada,
      mensagemInterjornada: interjornadaValida
        ? `Jornada Completa: 40h (Seg-Sex) + 4h (Sab) = ${horasSemanais}h semanais / ${horasMensais}h mensais\n${
            validarInterjornada
              ? createInterjornadaMessage(
                  interjornadaMinutos,
                  "Interjornada Sexta a Sabado",
                )
              : "Interjornada nao avaliada"
          }`
        : `Jornada: 40h (Seg-Sex) + 4h (Sab) = ${horasSemanais}h semanais / ${horasMensais}h mensais\n${createInterjornadaMessage(
            interjornadaMinutos,
            "Interjornada Sexta a Sabado",
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
