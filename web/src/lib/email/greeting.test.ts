import { afterEach, describe, expect, it } from "vitest";
import { periodGreeting } from "@/lib/email/greeting";

const originalTimeZone = process.env.APP_TIME_ZONE;

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.APP_TIME_ZONE;
  else process.env.APP_TIME_ZONE = originalTimeZone;
});

describe("periodGreeting", () => {
  it.each([
    ["2026-08-06T08:00:00-03:00", "Bom dia"],
    ["2026-08-06T11:59:00-03:00", "Bom dia"],
    ["2026-08-06T12:00:00-03:00", "Boa tarde"],
    ["2026-08-06T17:59:00-03:00", "Boa tarde"],
    ["2026-08-06T18:00:00-03:00", "Boa noite"],
    ["2026-08-06T23:00:00-03:00", "Boa noite"],
  ])("returns the expected period for %s", (date, expected) => {
    process.env.APP_TIME_ZONE = "America/Sao_Paulo";
    expect(periodGreeting(new Date(date))).toBe(expected);
  });
});
