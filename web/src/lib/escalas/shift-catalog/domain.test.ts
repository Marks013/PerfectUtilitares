import { describe, expect, it } from "vitest";
import {
  allocateInitialCatalog,
  appendCatalogEntries,
  markingsFromShift,
  renderTurnoTxt,
  type TurnoTxtRow,
} from "./domain";

describe("turn catalog domain", () => {
  it("extracts one or two ordinary work periods without changing the four-mark key", () => {
    expect(markingsFromShift({ segments: [
      { start: 480, end: 720, kind: "WORK" },
    ] })).toEqual({ ok: true, markings: ["08:00", "12:00", "00:00", "00:00"] });

    expect(markingsFromShift({ segments: [
      { start: 480, end: 720, kind: "WORK" },
      { start: 720, end: 780, kind: "BREAK" },
      { start: 780, end: 1104, kind: "WORK" },
    ] })).toEqual({ ok: true, markings: ["08:00", "12:00", "13:00", "18:24"] });
  });

  it("rejects all-zero, paid-break, overnight, partial and more than two work periods", () => {
    expect(markingsFromShift({ segments: [
      { start: 0, end: 0, kind: "WORK" },
    ] })).toMatchObject({ ok: false, reason: "ZERO_MARKINGS" });
    expect(markingsFromShift({ segments: [
      { start: 480, end: 720, kind: "WORK" },
      { start: 720, end: 780, kind: "PAID_BREAK" },
      { start: 780, end: 1080, kind: "WORK" },
    ] })).toMatchObject({ ok: false, reason: "PAID_BREAK" });
    expect(markingsFromShift({ segments: [
      { start: 1320, end: 1500, kind: "WORK" },
    ] })).toMatchObject({ ok: false, reason: "OVERNIGHT" });
    expect(markingsFromShift({ segments: [
      { start: 480, end: 720, kind: "WORK" },
      { start: 720, end: 780, kind: "BREAK" },
    ] })).toMatchObject({ ok: false, reason: "PARTIAL" });
    expect(markingsFromShift({ segments: [
      { start: 480, end: 600, kind: "WORK" },
      { start: 600, end: 630, kind: "BREAK" },
      { start: 630, end: 750, kind: "WORK" },
      { start: 750, end: 780, kind: "BREAK" },
      { start: 780, end: 900, kind: "WORK" },
    ] })).toMatchObject({ ok: false, reason: "TOO_MANY_PERIODS" });
  });

  it("assigns initial codes by numeric clock tuple and never renumbers later entries", () => {
    const initial = allocateInitialCatalog([
      ["09:00", "13:00", "14:00", "18:00"],
      ["08:00", "12:00", "13:00", "18:24"],
      ["08:00", "12:00", "13:00", "18:24"],
      ["08:00", "12:00", "00:00", "00:00"],
    ]);
    expect(initial.map(entry => [entry.code, entry.markings])).toEqual([
      [1500, ["08:00", "12:00", "00:00", "00:00"]],
      [1501, ["08:00", "12:00", "13:00", "18:24"]],
      [1502, ["09:00", "13:00", "14:00", "18:00"]],
    ]);
    const extended = appendCatalogEntries(initial, [
      ["07:00", "11:00", "12:00", "16:00"],
      ["08:00", "12:00", "13:00", "18:24"],
    ]);
    expect(extended.map(entry => entry.code)).toEqual([1500, 1501, 1502, 1503]);
    expect(extended[0]).toEqual(initial[0]);
    expect(extended[3].markings).toEqual(["07:00", "11:00", "12:00", "16:00"]);
  });

  it("prints one TXT2 registration per global catalog code", () => {
    const rows: TurnoTxtRow[] = [
      { registration: "0007", code: 1500, markings: ["08:00", "12:00", "14:00", "18:00"] },
      { registration: "0008", code: 1500, markings: ["08:00", "12:00", "14:00", "18:00"] },
      { registration: "0009", code: 1501, markings: ["09:00", "13:00", "14:00", "18:00"] },
    ];
    expect(new TextDecoder().decode(renderTurnoTxt("TXT2", rows))).toBe(
      "1500,08:00 12:00 14:00 18:00,08:00,12:00,14:00,18:00\r\n1501,09:00 13:00 14:00 18:00,09:00,13:00,14:00,18:00\r\n",
    );
  });

  it("keeps the second-pair-zero schedule distinct from four zeroes", () => {
    const [valid] = allocateInitialCatalog([["00:00", "08:00", "00:00", "00:00"]]);
    expect(valid.markings).toEqual(["00:00", "08:00", "00:00", "00:00"]);
    expect(allocateInitialCatalog([["00:00", "00:00", "00:00", "00:00"]])).toEqual([]);
  });

  it("renders both TXT layouts as UTF-8 without BOM and with CRLF", () => {
    const row: TurnoTxtRow = {
      registration: "0007",
      code: 1500,
      markings: ["08:00", "12:00", "14:00", "18:24"],
    };
    const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    expect(decode(renderTurnoTxt("TXT1", [row]))).toBe("0007,08:00,12:00,14:00,18:24\r\n");
    expect(decode(renderTurnoTxt("TXT2", [row]))).toBe("1500,08:00 12:00 14:00 18:24,08:00,12:00,14:00,18:24\r\n");
    expect(renderTurnoTxt("TXT1", [row]).slice(0, 3)).not.toEqual([0xef, 0xbb, 0xbf]);
  });
});
