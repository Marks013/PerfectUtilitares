import { describe, expect, it } from "vitest";
import { readShiftSegments } from "./shift-editor-validation";

describe("shift editor errors and overnight clocks", () => {
  it("identifies the exact incomplete field and overlapping period", () => {
    expect(readShiftSegments([{ kind: "WORK", start: "", end: "12:00" }])).toMatchObject({ error: { index: 0, field: "start" } });
    expect(readShiftSegments([{ kind: "WORK", start: "08:00", end: "12:00" }, { kind: "BREAK", start: "11:00", end: "13:00" }])).toMatchObject({ error: { index: 1, field: "start" } });
    expect(readShiftSegments([{ kind: "WORK", start: "22:00", end: "01:00" }])).toMatchObject({ error: { index: 0, field: "end" } });
  });
  it("keeps extended clocks and paid/unpaid pauses intact rather than inventing or rounding marks", () => {
    expect(readShiftSegments([{ kind: "WORK", start: "22:00", end: "25:00" }, { kind: "BREAK", start: "25:00", end: "25:30" }, { kind: "PAID_BREAK", start: "25:30", end: "25:45" }])).toEqual({ segments: [{ kind: "WORK", start: 1320, end: 1500 }, { kind: "BREAK", start: 1500, end: 1530 }, { kind: "PAID_BREAK", start: 1530, end: 1545 }] });
    expect(readShiftSegments([{ kind: "BREAK", start: "12:00", end: "13:00" }])).toHaveProperty("error");
  });
});
