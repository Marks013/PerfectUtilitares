import type { EscalaShift } from "../types";
import type { TurnoClockMarks, TurnoCatalogEntryDto } from "./contracts";

export type TurnoUnrepresentableReason =
  | "ZERO_MARKINGS"
  | "PARTIAL"
  | "OVERNIGHT"
  | "PAID_BREAK"
  | "TOO_MANY_PERIODS";

export type ShiftMarkingResult =
  | { ok: true; markings: TurnoClockMarks }
  | { ok: false; reason: TurnoUnrepresentableReason };

export type TurnoTxtRow = {
  registration: string;
  code: number;
  markings: TurnoClockMarks;
};

export function clockMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

export function minutesClock(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value >= 1440) return null;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function markingKey(markings: TurnoClockMarks): string {
  return markings.join("|");
}

function isZeroMarking(markings: TurnoClockMarks): boolean {
  return markings.every(mark => mark === "00:00");
}

export function markingsFromShift(shift: Pick<EscalaShift, "segments">): ShiftMarkingResult {
  const segments = shift.segments;
  if (segments.some(segment => segment.kind === "PAID_BREAK")) return { ok: false, reason: "PAID_BREAK" };
  const work = segments.filter(segment => segment.kind === "WORK").sort((a, b) => a.start - b.start);
  if (work.some(segment => segment.start >= 1440 || segment.end >= 1440)) return { ok: false, reason: "OVERNIGHT" };
  if (work.length > 2) return { ok: false, reason: "TOO_MANY_PERIODS" };
  if (work.length === 1 && work[0].start === 0 && work[0].end === 0) return { ok: false, reason: "ZERO_MARKINGS" };
  if (work.length === 0 || segments.some(segment => !Number.isInteger(segment.start) || !Number.isInteger(segment.end)
    || segment.start < 0 || segment.end <= segment.start)) return { ok: false, reason: "PARTIAL" };
  const breaks = segments.filter(segment => segment.kind === "BREAK");
  if ((work.length === 1 && breaks.length > 0)
    || breaks.some(segment => segment.start < work[0].end || segment.end > (work[1]?.start ?? work[0].end))) {
    return { ok: false, reason: "PARTIAL" };
  }

  const values = work.flatMap(segment => [minutesClock(segment.start), minutesClock(segment.end)]);
  if (values.some(value => value === null)) return { ok: false, reason: "OVERNIGHT" };
  if (work.length === 2 && work[0].end > work[1].start) return { ok: false, reason: "PARTIAL" };

  const markings: TurnoClockMarks = work.length === 1
    ? [(values[0] as string), (values[1] as string), "00:00", "00:00"]
    : [(values[0] as string), (values[1] as string), (values[2] as string), (values[3] as string)];
  if (isZeroMarking(markings)) return { ok: false, reason: "ZERO_MARKINGS" };
  return { ok: true, markings };
}

function compareMarkings(left: TurnoClockMarks, right: TurnoClockMarks): number {
  for (let index = 0; index < 4; index += 1) {
    const diff = (clockMinutes(left[index]) as number) - (clockMinutes(right[index]) as number);
    if (diff) return diff;
  }
  return 0;
}

function uniqueSorted(markingsList: readonly TurnoClockMarks[]): TurnoClockMarks[] {
  const unique = new Map<string, TurnoClockMarks>();
  for (const markings of markingsList) {
    if (markings.every(mark => clockMinutes(mark) !== null) && !isZeroMarking(markings)) unique.set(markingKey(markings), markings);
  }
  return [...unique.values()].sort(compareMarkings);
}

export function allocateInitialCatalog(markingsList: readonly TurnoClockMarks[]): TurnoCatalogEntryDto[] {
  return uniqueSorted(markingsList).map((markings, index) => ({
    code: 1500 + index,
    markings,
    name: markings.join(" "),
  }));
}

export function appendCatalogEntries(
  existing: readonly TurnoCatalogEntryDto[],
  markingsList: readonly TurnoClockMarks[],
  requestedNextCode = Math.max(1499, ...existing.map(entry => entry.code)) + 1,
): TurnoCatalogEntryDto[] {
  const known = new Set(existing.map(entry => markingKey(entry.markings)));
  const missing = uniqueSorted(markingsList).filter(markings => !known.has(markingKey(markings)));
  const nextCode = Math.max(requestedNextCode, Math.max(1499, ...existing.map(entry => entry.code)) + 1);
  return [
    ...existing,
    ...missing.map((markings, index) => ({ code: nextCode + index, markings, name: markings.join(" ") })),
  ];
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function renderTurnoTxt(format: "TXT1" | "TXT2", rows: readonly TurnoTxtRow[]): Uint8Array {
  const outputRows = format === "TXT2"
    ? [...new Map(rows.map(row => [row.code, row])).values()].sort((left, right) => left.code - right.code)
    : rows;
  const lines = outputRows.map(row => format === "TXT1"
    ? [row.registration, ...row.markings].map(csvField).join(",")
    : [String(row.code), row.markings.join(" "), ...row.markings].map(csvField).join(","));
  return new TextEncoder().encode(lines.length ? `${lines.join("\r\n")}\r\n` : "");
}
