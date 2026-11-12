type Classification = {
  mode: "TIMED" | "MISSING" | "UNTIMED";
  weekday: string;
  saturday: string;
  paidPeriods: string[];
  warnings: string[];
};
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const zero = "00:00";

function reference(raw: unknown[]) {
  const values = raw.map(value => String(value ?? "").trim());
  if (values.length !== 4 || values.some(value => !clock.test(value))) throw new Error("Horário FPRE136 inválido.");
  return { values, text: `${values[0]}-${values[1]} / ${values[2]}-${values[3]}` };
}

/** Only the confirmed FPRE136 source gives four zero fields the operational meaning UNTIMED. */
export function classifyFpre136Schedule(source: { report: "FPRE136"; weekday: unknown[]; saturday: unknown[] }): Classification {
  const weekday = reference(source.weekday), saturday = reference(source.saturday);
  const warnings: string[] = [];
  if (weekday.values.every(value => value === zero)) {
    if (saturday.values.some(value => value !== zero)) warnings.push("Dias úteis sem horário controlado, mas o sábado contém horários. A referência de sábado foi preservada para conferência; nenhum turno foi criado.");
    return { mode: "UNTIMED", weekday: weekday.text, saturday: saturday.text, paidPeriods: [], warnings };
  }
  const periods = [[weekday.values[0], weekday.values[1]], [weekday.values[2], weekday.values[3]]]
    .filter(([start, end]) => start !== zero || end !== zero);
  let previousEnd = "";
  for (const [start, end] of periods) {
    if (end <= start || start < previousEnd) {
      warnings.push("Referência de horário incompleta ou fora de ordem. A pessoa foi mantida para planejar os dias e folgas; confira as entradas e saídas antes de apurar suas horas.");
      return { mode: "MISSING", weekday: weekday.text, saturday: saturday.text, paidPeriods: [], warnings };
    }
    previousEnd = end;
  }
  return { mode: "TIMED", weekday: weekday.text, saturday: saturday.text,
    paidPeriods: periods.map(([start, end]) => `${start}-${end}`), warnings };
}

/** Principal weekday duration only; a shorter Saturday never defines a reduced weekday. */
export function fpre136WeekdayMinutes(weekday: string): number | null {
  const parts = weekday.split(/\s*\/\s*/);
  if (!parts.length || parts.length > 2) return null;
  const values: string[] = [];
  for (const part of parts) {
    const match = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(part.trim());
    if (!match) return null;
    values.push(match[1], match[2]);
  }
  while (values.length < 4) values.push(zero);
  try {
    const classified = classifyFpre136Schedule({ report: "FPRE136", weekday: values, saturday: [zero, zero, zero, zero] });
    if (classified.mode !== "TIMED") return null;
    const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    return classified.paidPeriods.reduce((total, period) => {
      const [start, end] = period.split("-"); return total + minute(end) - minute(start);
    }, 0);
  } catch { return null; }
}
