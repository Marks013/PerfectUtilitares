import { normalizarHorarios } from "@/lib/codigos/horario-normalizer";
import { calcularDuracaoMinutos, formatarDuracao, parseHorario } from "./time";

const FIM_PERIODO_NOTURNO_MINUTOS = 5 * 60;
const INICIO_PERIODO_NOTURNO_MINUTOS = 22 * 60;

function formatarTokenHorario(token: string): string {
  const trimmed = token.trim();
  const compacto = /^\d{3,4}$/.test(trimmed)
    ? trimmed.padStart(4, "0")
    : null;

  if (compacto) {
    return `${compacto.slice(0, 2)}:${compacto.slice(2, 4)}`;
  }

  const comDoisPontos = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (comDoisPontos) {
    const horas = Number(comDoisPontos[1]);
    const minutos = Number(comDoisPontos[2]);

    if (horas <= 23 && minutos <= 59) {
      return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
    }
  }

  return trimmed;
}

export function formatarHorariosEntrada(value: string): string {
  if (!value.trim()) return "";

  return value
    .replace(/[,\n\r;]+/g, " ")
    .trim()
    .split(/\s+/)
    .map(formatarTokenHorario)
    .join(" ");
}

function intervaloTemTrabalhoNoturno(inicio: number, fim: number): boolean {
  if (inicio === fim) return false;

  if (fim < inicio) {
    return true;
  }

  return (
    inicio < FIM_PERIODO_NOTURNO_MINUTOS ||
    fim > INICIO_PERIODO_NOTURNO_MINUTOS
  );
}

export function temTrabalhoNoturno(value: string): boolean {
  const horariosNormalizado = normalizarHorarios(formatarHorariosEntrada(value));
  if (!horariosNormalizado) return false;

  const pontos = horariosNormalizado.split(" ");
  if (pontos.length !== 2 && pontos.length !== 4) return false;

  const parsed = pontos.map(parseHorario);
  if (parsed.some((item) => item == null)) return false;

  const tempos = parsed as number[];
  return Array.from({ length: tempos.length / 2 }, (_, index) => {
    const inicio = tempos[index * 2];
    const fim = tempos[index * 2 + 1];
    return intervaloTemTrabalhoNoturno(inicio, fim);
  }).some(Boolean);
}

export function calcularDuracaoEntrada(value: string): {
  duracaoMinutos: number;
  duracaoFormatada: string;
  horariosNormalizado: string;
} | null {
  const horariosNormalizado = normalizarHorarios(formatarHorariosEntrada(value));
  if (!horariosNormalizado) return null;

  const pontos = horariosNormalizado.split(" ");
  if (pontos.length !== 2 && pontos.length !== 4) return null;

  const parsed = pontos.map(parseHorario);
  if (parsed.some((item) => item == null)) return null;

  const tempos = parsed as number[];
  let duracaoMinutos: number;

  if (tempos.length === 2) {
    if (tempos[0] >= tempos[1]) return null;
    duracaoMinutos = calcularDuracaoMinutos(tempos[0], tempos[1]);
  } else {
    const [inicio1, fim1, inicio2, fim2] = tempos;
    if (inicio1 >= fim1 || inicio2 >= fim2 || fim1 > inicio2) return null;
    duracaoMinutos =
      calcularDuracaoMinutos(inicio1, fim1) +
      calcularDuracaoMinutos(inicio2, fim2);
  }

  return {
    duracaoMinutos,
    duracaoFormatada: formatarDuracao(duracaoMinutos),
    horariosNormalizado,
  };
}

export function isJornadaOitoHoras(value: string): boolean {
  return calcularDuracaoEntrada(value)?.duracaoMinutos === 480;
}
