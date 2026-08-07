import { normalizarHorarios } from "@/lib/codigos/horario-normalizer";
import {
  lerLinhasParaValidacao,
  parseJornadaBatchXlsx,
} from "./batch-input";
import type {
  JornadaBatchConfig,
  JornadaBatchLine,
  JornadaBatchReport,
  JornadaBatchValidationResult,
} from "./batch-types";
import { JORNADA_CONFIG } from "./default-rules";
import {
  calcularDuracaoMinutos,
  formatarDuracao,
  parseHorario,
  validarLimiteDiario,
} from "./time";
import type { JornadaRuleInput } from "./types";

export { normalizarHorarioLote } from "./batch-input";
export type {
  JornadaBatchConfig,
  JornadaBatchReport,
} from "./batch-types";

export const DEFAULT_JORNADA_BATCH_CONFIG: JornadaBatchConfig = {
  validarPeriodos: true,
  validarJornada: true,
  validarIntervalos: true,
  usarHorariosAgrupados: false,
  linhaInicio: 3,
  colunaHorariosAgrupados: 2,
};

export const NON_SUBORDINATE_SCHEDULE_LABEL = "NÃO SUBORNIDADO Á HORÁRIO";

function createError(message: string): JornadaBatchValidationResult {
  return {
    valido: false,
    mensagem: message,
    duracaoCalculada: "00:00",
    tipoDia: "",
    horasSemanais: 0,
    horasMensais: 0,
  };
}

function createNonSubordinateSchedule(): JornadaBatchValidationResult {
  return {
    valido: true,
    mensagem: NON_SUBORDINATE_SCHEDULE_LABEL,
    duracaoCalculada: "00:00",
    tipoDia: NON_SUBORDINATE_SCHEDULE_LABEL,
    horasSemanais: 0,
    horasMensais: 0,
  };
}

function determineDayType(durationMinutes: number) {
  switch (durationMinutes) {
    case 240:
    case 350:
    case 440:
      return "Segunda a Sábado";
    case 480:
      return "Segunda a Sexta";
    default:
      return "Não especificado";
  }
}

function createSuccess(
  rule: JornadaRuleInput | undefined,
  durationMinutes: number,
  intervalMinutes: number | null,
  input: string,
  codigoByHorario: Map<string, string>,
): JornadaBatchValidationResult {
  const normalized = normalizarHorarios(input);
  const code = codigoByHorario.get(normalized);
  const message = rule
    ? `${rule.nome}${code ? ` (Código: ${code})` : ""}`
    : `Duração: ${formatarDuracao(durationMinutes)}${code ? ` (Código: ${code})` : ""}`;

  return {
    valido: true,
    mensagem: message,
    duracaoCalculada: formatarDuracao(durationMinutes),
    tipoDia: determineDayType(durationMinutes),
    codigo: code,
    horasSemanais: rule?.horasSemanais ?? 0,
    horasMensais: rule?.horasMensais ?? 0,
    intervalo:
      intervalMinutes == null ? undefined : formatarDuracao(intervalMinutes),
  };
}

function getRule(rules: JornadaRuleInput[], durationMinutes: number) {
  return rules.find(
    (rule) => rule.active !== false && rule.duracaoMinutos === durationMinutes,
  );
}

function getExpectedSaturdayDuration(referenceMinutes?: number | null) {
  if (referenceMinutes == null) return null;
  return referenceMinutes === 480
    ? JORNADA_CONFIG.complementoSabadoMinutos
    : referenceMinutes;
}

function validateSaturdayDuration(
  durationMinutes: number,
  referenceMinutes?: number | null,
) {
  const expected = getExpectedSaturdayDuration(referenceMinutes);
  if (expected == null || durationMinutes === expected) return null;

  return `Sábado deve ter jornada de ${formatarDuracao(
    expected,
  )} quando a jornada principal é ${formatarDuracao(
    referenceMinutes ?? 0,
  )}. Encontrado: ${formatarDuracao(durationMinutes)}`;
}

function validarHorariosLote(
  horariosArray: string[],
  config: JornadaBatchConfig,
  rules: JornadaRuleInput[],
  codigoByHorario = new Map<string, string>(),
  context: { linhaSabado?: boolean; jornadaReferenciaMinutos?: number | null } = {},
): JornadaBatchValidationResult {
  if (
    horariosArray.length > 0 &&
    horariosArray.every((item) => item.trim() === "00:00")
  ) {
    return createNonSubordinateSchedule();
  }

  const horarios = horariosArray.filter((item) => item.trim() && item !== "00:00");
  if (horarios.length === 0) return createError("Nenhum horário válido");
  if (horarios.length !== 2 && horarios.length !== 4) {
    return createError(`Quantidade inválida de horários: ${horarios.length}`);
  }

  const parsed = horarios.map(parseHorario);
  if (parsed.some((value) => value == null)) return createError("Formato inválido");
  const times = parsed as number[];

  if (times.length === 2) {
    if (times[0] >= times[1]) return createError("Horário inicial ≥ final");

    const duration = calcularDuracaoMinutos(times[0], times[1]);
    if (context.linhaSabado) {
      const saturdayError = validateSaturdayDuration(
        duration,
        context.jornadaReferenciaMinutos,
      );
      if (saturdayError) return createError(saturdayError);
    }

    if (config.validarJornada) {
      if (!validarLimiteDiario(duration, JORNADA_CONFIG.periodoMaximoHoras)) {
        return createError(`Duração excede 10h: ${formatarDuracao(duration)}`);
      }

      const rule = getRule(rules, duration);
      if (!rule) return createError(`Duração não válida: ${formatarDuracao(duration)}`);
      if (rule.intervaloMin > 0) return createError("Jornada requer intervalo (4 horários)");
      return createSuccess(rule, duration, null, horarios.join(" "), codigoByHorario);
    }

    return createSuccess(
      getRule(rules, duration),
      duration,
      null,
      horarios.join(" "),
      codigoByHorario,
    );
  }

  const [start1, end1, start2, end2] = times;
  if (start1 >= end1 || end1 > start2 || start2 >= end2) {
    return createError("Horários fora de ordem");
  }

  const duration1 = calcularDuracaoMinutos(start1, end1);
  const interval = calcularDuracaoMinutos(end1, start2);
  const duration2 = calcularDuracaoMinutos(start2, end2);
  const totalDuration = duration1 + duration2;
  const errors: string[] = [];
  if (context.linhaSabado) {
    const saturdayError = validateSaturdayDuration(
      totalDuration,
      context.jornadaReferenciaMinutos,
    );
    if (saturdayError) errors.push(saturdayError);
  }

  if (config.validarPeriodos) {
    if (duration1 > JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos) {
      errors.push(
        `1º período > ${formatarDuracao(
          JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos,
        )}: ${formatarDuracao(duration1)}`,
      );
    }

    if (duration2 > JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos) {
      errors.push(
        `2º período > ${formatarDuracao(
          JORNADA_CONFIG.periodoMaximoSemIntervaloMinutos,
        )}: ${formatarDuracao(duration2)}`,
      );
    }

    const totalPeriodHours = (totalDuration + interval) / 60;
    if (totalPeriodHours > JORNADA_CONFIG.periodoMaximoHoras) {
      errors.push(
        `Período total > ${JORNADA_CONFIG.periodoMaximoHoras.toFixed(
          1,
        )}h: ${totalPeriodHours.toFixed(1)}h`,
      );
    }
  }

  const rule = getRule(rules, totalDuration);
  if (config.validarJornada && !rule) {
    errors.push(`Duração não válida: ${formatarDuracao(totalDuration)}`);
  }

  if (config.validarIntervalos && rule) {
    if (interval < rule.intervaloMin) {
      errors.push(
        `Intervalo < mínimo: ${formatarDuracao(interval)} (mín: ${formatarDuracao(
          rule.intervaloMin,
        )})`,
      );
    }

    if (rule.intervaloMax > 0 && interval > rule.intervaloMax) {
      errors.push(
        `Intervalo > máximo: ${formatarDuracao(interval)} (máx: ${formatarDuracao(
          rule.intervaloMax,
        )})`,
      );
    }
  }

  if (errors.length > 0) return createError(errors.join(" | "));
  return createSuccess(rule, totalDuration, interval, horarios.join(" "), codigoByHorario);
}

function errorDedupeKey(line: JornadaBatchLine) {
  return [
    line.matricula.trim().toUpperCase(),
    line.nome.trim().toUpperCase(),
    line.jornadaCompleta.trim(),
    line.resultado?.mensagem.trim() ?? "",
  ].join("|");
}

function dedupeErrorLines(lines: JornadaBatchLine[]) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = errorDedupeKey(line);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function validarJornadaBatchXlsx({
  buffer,
  fileName,
  config = DEFAULT_JORNADA_BATCH_CONFIG,
  rules,
  codigoByHorario = new Map<string, string>(),
}: {
  buffer: Buffer;
  fileName: string;
  config?: JornadaBatchConfig;
  rules: JornadaRuleInput[];
  codigoByHorario?: Map<string, string>;
}): Promise<JornadaBatchReport> {
  const sheet = await parseJornadaBatchXlsx(buffer);
  const linhas = lerLinhasParaValidacao(sheet.rows, config).map((line) => {
    const resultado = validarHorariosLote(
      line.horarios,
      config,
      rules,
      codigoByHorario,
      {
        linhaSabado: line.linhaSabado,
        jornadaReferenciaMinutos: line.jornadaReferenciaMinutos,
      },
    );
    const isNonSubordinate =
      line.horarios.length > 0 &&
      line.horarios.every((horario) => horario === "00:00");

    return {
      ...line,
      resultado,
      horariosOriginais: isNonSubordinate
        ? NON_SUBORDINATE_SCHEDULE_LABEL
        : line.horariosOriginais,
      jornadaCompleta: isNonSubordinate
        ? NON_SUBORDINATE_SCHEDULE_LABEL
        : line.jornadaCompleta,
    };
  });
  const jornadasRepetidas: Record<string, number> = {};

  linhas.forEach((line) => {
    if (line.horarios.length >= 2) {
      jornadasRepetidas[line.jornadaCompleta] =
        (jornadasRepetidas[line.jornadaCompleta] ?? 0) + 1;
    }
  });

  const validos = linhas.filter((line) => line.resultado?.valido).length;
  const linhasComErro = dedupeErrorLines(
    linhas.filter((line) => line.resultado?.valido === false),
  );

  return {
    arquivoOrigem: fileName,
    nomePlanilha: sheet.name,
    totalLinhas: linhas.length,
    validos,
    erros: linhasComErro.length,
    avisos: 0,
    linhas,
    linhasComErro,
    jornadasRepetidas,
  };
}
