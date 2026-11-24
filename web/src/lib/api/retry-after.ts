export function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value || !/^\d{1,5}$/.test(value)) return undefined;
  const seconds = Number(value);
  return seconds >= 1 && seconds <= 86_400 ? seconds : undefined;
}

export function retryAfterInstruction(seconds?: number): string {
  if (seconds === undefined) return "Aguarde um pouco e tente novamente.";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const parts = [
    minutes ? `${minutes} ${minutes === 1 ? "minuto" : "minutos"}` : "",
    remainder ? `${remainder} ${remainder === 1 ? "segundo" : "segundos"}` : "",
  ].filter(Boolean);
  return `Tente novamente em ${parts.join(" e ")}.`;
}
