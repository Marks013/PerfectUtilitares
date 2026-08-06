const DEFAULT_APPLICATION_TIME_ZONE = "America/Sao_Paulo";

export function applicationTimeZone() {
  return process.env.APP_TIME_ZONE?.trim() || DEFAULT_APPLICATION_TIME_ZONE;
}

export function periodGreeting(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: applicationTimeZone(),
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );

  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}
