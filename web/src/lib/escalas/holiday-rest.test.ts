import { describe, expect, it } from "vitest";
import { assertNoNewManualHolidayRest } from "./holiday-rest";
import { scopedMonthDraft } from "./scoped-month-draft";

describe("manual holiday rest", () => {
  it("does not turn an official holiday into a new manual rest", () => {
    const existing = scopedMonthDraft("07", "2027-01");
    const day = { employeeId: "person", date: "2027-01-01", kind: "OFF" as const };
    expect(() => assertNoNewManualHolidayRest(existing, { ...existing, assignments: [day] }))
      .toThrow("Não é possível criar ou mover uma folga manualmente para um feriado.");
    const previouslyScheduled = { ...existing, assignments: [day] };
    expect(() => assertNoNewManualHolidayRest(previouslyScheduled, previouslyScheduled)).not.toThrow();
  });
});
