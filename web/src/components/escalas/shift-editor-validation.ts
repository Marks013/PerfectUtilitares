import type { EscalaShift } from "@/lib/escalas/types";
import { parseClock } from "./workspace-model";

type DraftSegment = { start: string; end: string; kind: EscalaShift["segments"][number]["kind"] };
export type ShiftFieldError = { message: string; index: number; field: "start" | "end" };
export function readShiftSegments(segments: DraftSegment[]): { segments: EscalaShift["segments"] } | { error: ShiftFieldError } {
  const parsed: EscalaShift["segments"] = [];
  for (const [index, segment] of segments.entries()) {
    let start: number, end: number;
    try { start = parseClock(segment.start); } catch { return { error: { index, field: "start", message: `Período ${index + 1}: informe o início em HH:MM. Após meia-noite, use 25:00 para 01:00 do dia seguinte.` } }; }
    try { end = parseClock(segment.end); } catch { return { error: { index, field: "end", message: `Período ${index + 1}: informe o fim em HH:MM.` } }; }
    if (end <= start) return { error: { index, field: "end", message: `Período ${index + 1}: o fim precisa ser posterior ao início. Para o dia seguinte, continue a contagem após 24:00.` } };
    if (index > 0 && start < parsed[index - 1].end) return { error: { index, field: "start", message: `Período ${index + 1}: o início se sobrepõe ao período anterior.` } };
    parsed.push({ start, end, kind: segment.kind });
  }
  if (!parsed.some(segment => segment.kind === "WORK")) return { error: { index: 0, field: "start", message: "Informe ao menos um período de trabalho; intervalos e pausas não o substituem." } };
  return { segments: parsed };
}
