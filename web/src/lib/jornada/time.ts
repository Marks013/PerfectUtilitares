const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function parseHorario(value: string): number | null {
  if (!TIME_PATTERN.test(value)) {
    return null;
  }

  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function calcularDuracaoMinutos(inicio: number, fim: number): number {
  if (fim < inicio) {
    return fim + 24 * 60 - inicio;
  }

  return fim - inicio;
}

export function formatarDuracao(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const mins = minutos % 60;
  return `${String(horas).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function formatarIntervalo(minutos: number): string {
  return formatarDuracao(minutos);
}

export function formatarDuracaoLegivel(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const mins = minutos % 60;

  if (mins === 0) {
    return `${horas}h`;
  }

  return `${horas}h${String(mins).padStart(2, "0")}`;
}

export function validarLimiteDiario(
  minutos: number,
  periodoMaximoHoras = 10,
): boolean {
  return minutos <= periodoMaximoHoras * 60;
}
