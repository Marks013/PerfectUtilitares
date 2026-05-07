import { normalizarHorarios } from "@/lib/codigos/horario-normalizer";
import { calcularDuracaoMinutos, formatarDuracao, parseHorario } from "./time";

function formatarTokenHorario(token: string): string {
  const trimmed = token.trim();
  const compacto = /^\d{3,4}$/.test(trimmed)
    ? trimmed.padStart(4, "0")
    : null;

  if (compacto) {
    const horas = Number(compacto.slice(0, 2));
    const minutos = Number(compacto.slice(2, 4));

    if (horas <= 23 && minutos <= 59) {
      return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
    }
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
