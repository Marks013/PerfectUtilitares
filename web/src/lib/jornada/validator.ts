import {
  normalizarHorarios,
  validarHorariosNormalizados,
} from "@/lib/codigos/horario-normalizer";
import {
  addPeriodosDetalhe,
  buildExceptionResult,
  createError,
  createFormatoDetalhadoMessage,
  createInterjornadaMessage,
  createMissingSaturdayComplementMessage,
  createPeriodosMessage,
  extractFirstAndLast,
  findAuthorizedException,
  getRule,
} from "./validator-helpers";
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
  JornadaExceptionInput,
  JornadaInterjornadaResult,
  JornadaRuleInput,
  JornadaValidationInput,
  JornadaValidationMode,
  JornadaValidationResult,
} from "./types";

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
  let rule: JornadaRuleInput | undefined;
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
    rule = getRule(rules, duracaoMinutos, tipoDia);
    const limitePeriodoMinutos =
      rule?.limitePeriodoMinutos ?? JORNADA_CONFIG.limitePeriodoPadraoMinutos;
    if (duracaoMinutos > limitePeriodoMinutos) {
      erros.push(
        `Período único (${formatarDuracaoLegivel(duracaoMinutos)}) excede o limite de ${formatarDuracao(
          limitePeriodoMinutos,
        )} configurado na regra.`,
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
    rule = getRule(rules, duracaoMinutos, tipoDia);
    const limitePeriodoMinutos =
      rule?.limitePeriodoMinutos ?? JORNADA_CONFIG.limitePeriodoPadraoMinutos;

    if (periodo1Minutos > limitePeriodoMinutos) {
      erros.push(
        `Primeiro período (${formatarDuracaoLegivel(periodo1Minutos)}) excede ${formatarDuracaoLegivel(
          limitePeriodoMinutos,
        )}. Cada período de trabalho deve respeitar o limite de ${formatarDuracao(
          limitePeriodoMinutos,
        )} configurado na regra.`,
      );
    }

    if (periodo2Minutos > limitePeriodoMinutos) {
      erros.push(
        `Segundo período (${formatarDuracaoLegivel(periodo2Minutos)}) excede ${formatarDuracaoLegivel(
          limitePeriodoMinutos,
        )}. Cada período de trabalho deve respeitar o limite de ${formatarDuracao(
          limitePeriodoMinutos,
        )} configurado na regra.`,
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

  if (!rule && !duracaoInvalidaParaDia) {
    const duracoesAtivas = [
      ...new Set(
        rules
          .filter(
            (candidate) =>
              candidate.active !== false && candidate.diasValidos.includes(tipoDia),
          )
          .map((candidate) => candidate.duracaoMinutos),
      ),
    ]
      .sort((a, b) => a - b)
      .map(formatarDuracao)
      .join(", ");
    erros.push(
      `Total informado: ${formatarDuracao(duracaoMinutos)}. Não existe regra ativa para esta duração neste tipo de dia.${
        duracoesAtivas ? ` Jornadas ativas: ${duracoesAtivas}.` : ""
      }`,
    );
  }

  if (rule) {
    if (intervaloMinutos == null && rule.intervaloMin > 0) {
      return createError(
        `A regra "${rule.nome}" requer intervalo. Informe 4 horários: entrada, saída para intervalo, retorno e saída final.`,
        tipoDia,
        horariosNormalizado,
      );
    }

    if (intervaloMinutos != null && rule.intervaloMax === 0) {
      erros.push(
        `Jornada de ${formatarDuracao(duracaoMinutos)} não deve ter intervalo segundo a regra "${rule.nome}". Informe apenas 2 horários: entrada e saída.`,
      );
    } else if (
      intervaloMinutos != null &&
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
      intervaloMinutos != null &&
      rule.intervaloMax > 0 &&
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
