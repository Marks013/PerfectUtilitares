export type UsagePeriod = "day" | "month" | "year";

const DEFAULT_USAGE_TIME_ZONE =
  process.env.APP_TIME_ZONE?.trim() || "America/Sao_Paulo";

function civilDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

export function getUsageDate(
  now = new Date(),
  timeZone = DEFAULT_USAGE_TIME_ZONE,
) {
  const { year, month, day } = civilDate(now, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

export function getUsagePeriodRange(
  period: UsagePeriod,
  now = new Date(),
  timeZone = DEFAULT_USAGE_TIME_ZONE,
) {
  const date = getUsageDate(now, timeZone);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  if (period === "year") {
    return {
      start: new Date(Date.UTC(year, 0, 1)),
      end: new Date(Date.UTC(year + 1, 0, 1)),
    };
  }

  if (period === "month") {
    return {
      start: new Date(Date.UTC(year, month, 1)),
      end: new Date(Date.UTC(year, month + 1, 1)),
    };
  }

  return {
    start: new Date(Date.UTC(year, month, day)),
    end: new Date(Date.UTC(year, month, day + 1)),
  };
}
