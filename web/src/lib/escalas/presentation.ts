import { visibleDates } from "./dates";
import { sortEmployees } from "./order";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift, EscalaWorkspace } from "./types";

const ESCALA_LEGEND = "F = Folga | T01/T02 = Turno | SF = Trabalho sem horário definido | P = Pendente | A = Ausência | FV = Fora do vínculo | EX = Não incluído";
const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function escalaDateLabel(date: string): string {
  return `${date.slice(8)}/${date.slice(5, 7)} ${weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()]}`;
}

/** Codes follow the persisted shift list, not a filtered view or the assignments selected for export. */
export function escalaShiftCodes(input: Pick<EscalaInput, "shifts">): Map<string, string> {
  return new Map(input.shifts.map((shift, index) => [shift.id, `T${String(index + 1).padStart(2, "0")}`]));
}

export function assignmentPresentation(employee: EscalaEmployee, date: string, assignment: EscalaAssignment | undefined, codes: ReadonlyMap<string, string>) {
  if (employee.planningEnabled === false) return { code: "EX", description: `Não incluído: ${employee.planningExclusionReason || "conferência necessária"}` };
  if (date < employee.activeFrom || (employee.activeUntil && date > employee.activeUntil)) return { code: "FV", description: "Fora do período de vínculo" };
  if (!assignment) return { code: "P", description: "Pendente: selecione um turno, uma folga ou uma ausência" };
  if (assignment.kind === "OFF") return { code: "F", description: "Folga" };
  if (assignment.kind === "ABSENCE") return { code: "A", description: "Ausência" };
  if (assignment.kind === "DUTY") return { code: "SF", description: employee.scheduleMode === "UNTIMED" ? "Trabalho sem controle de horário confirmado; horas e cobertura horária não apuradas" : "Presença planejada sem horário informado; horas e cobertura horária não apuradas" };
  const code = codes.get(assignment.shiftId ?? "");
  return code ? { code, description: `Turno planejado ${code}` } : { code: "P", description: "Turno não encontrado: selecione um horário válido" };
}

export function escalaDuration(minutes: number): string {
  return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
}

function scheduleText(shift: EscalaShift, breaks: boolean) {
  return shift.segments.filter((segment) => breaks ? segment.kind !== "WORK" : segment.kind === "WORK")
    .map((segment) => `${escalaDuration(segment.start)}-${escalaDuration(segment.end)}${segment.kind === "PAID_BREAK" ? " (pausa remunerada)" : ""}`).join(" / ");
}

function changeDescription(source: NonNullable<EscalaEmployee["sourceSchedule"]>, shift: EscalaShift): string {
  const times = [...source.weekday.matchAll(/\b(\d{2}):(\d{2})\b/g)].map((match) => Number(match[1]) * 60 + Number(match[2]));
  const work = shift.segments.filter((segment) => segment.kind === "WORK");
  if (times.length !== 4 || !work.length || times[1] <= times[0] || times[3] <= times[2]) return "Referência original preservada; compare com a proposta. Não foi presumida uma jornada original.";
  const before = times[1] - times[0] + times[3] - times[2];
  const after = shift.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
  const first = work[0].start, last = work.at(-1)?.end ?? first;
  const interval = scheduleText(shift, true), originalInterval = `${escalaDuration(times[1])}-${escalaDuration(times[2])}`;
  return [first === times[0] ? `Entrada mantida (${escalaDuration(first)})` : `Entrada de ${escalaDuration(times[0])} para ${escalaDuration(first)}`,
    interval === originalInterval ? `intervalo mantido (${interval})` : `intervalo de ${originalInterval} para ${interval || "não informado"}`,
    last === times[3] ? `saída mantida (${escalaDuration(last)})` : `saída de ${escalaDuration(times[3])} para ${escalaDuration(last)}`,
    `jornada de ${escalaDuration(before)} para ${escalaDuration(after)}`].join("; ");
}

function presentationIssues(workspace: EscalaWorkspace) {
  const people = new Map(workspace.input.employees.map((employee) => [employee.id, employee]));
  const visible = new Set(visibleDates(workspace.input));
  const groups = new Map<string, { severity: "ERROR" | "PENDING" | "WARNING"; label: string; context: string; count: number; dates: string[]; messages: string[] }>();
  for (const issue of workspace.validation.issues) {
    const person = issue.employeeId ? people.get(issue.employeeId) : undefined;
    const local = person?.sector ?? (/COVERAGE/.test(issue.code) ? issue.message.split(":")[0] : "Proposta");
    const context = issue.date && !visible.has(issue.date) ? `${local} — verificação técnica entre períodos` : local;
    const key = `${issue.severity}\0${issue.code}\0${context}`;
    const group = groups.get(key) ?? { severity: issue.severity, label: issue.severity === "ERROR" ? "Impedimento" : issue.severity === "PENDING" ? "Atenção" : "Informação", context, count: 0, dates: [], messages: [] };
    group.count++;
    if (issue.date && !group.dates.includes(issue.date)) group.dates.push(issue.date);
    if (!group.messages.includes(issue.message)) group.messages.push(issue.message);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => ["ERROR", "PENDING", "WARNING"].indexOf(left.severity) - ["ERROR", "PENDING", "WARNING"].indexOf(right.severity));
}

/** One immutable interpretation for screen cells, PDF and Excel. Technical boundary days remain in input. */
export function buildEscalaPresentation(workspace: EscalaWorkspace) {
  const { input } = workspace, dates = visibleDates(input), codes = escalaShiftCodes(input);
  const assignments = new Map(input.assignments.map((assignment) => [`${assignment.employeeId}\0${assignment.date}`, assignment]));
  const people = sortEmployees(input.employees).map((employee) => ({ employee, cells: dates.map((date) => ({ date, ...assignmentPresentation(employee, date, assignments.get(`${employee.id}\0${date}`), codes) })) }));
  const visible = new Set(dates), included = new Map(people.filter(({ employee }) => employee.planningEnabled !== false).map(({ employee }) => [employee.id, employee]));
  const used = input.assignments.filter((assignment) => {
    const employee = included.get(assignment.employeeId);
    return assignment.kind === "WORK" && visible.has(assignment.date) && employee && assignment.date >= employee.activeFrom && (!employee.activeUntil || assignment.date <= employee.activeUntil);
  });
  const usedIds = new Set(used.map((assignment) => assignment.shiftId));
  const shifts = input.shifts.filter((shift) => usedIds.has(shift.id)).map((shift) => {
    const userIds = new Set(used.filter((assignment) => assignment.shiftId === shift.id).map((assignment) => assignment.employeeId));
    const sources = new Map(input.employees.filter((employee) => userIds.has(employee.id) && employee.sourceSchedule)
      .map((employee) => { const source = employee.sourceSchedule as NonNullable<EscalaEmployee["sourceSchedule"]>; return [JSON.stringify(source), source]; }));
    const work = shift.segments.filter((segment) => segment.kind === "WORK");
    return { id: shift.id, code: codes.get(shift.id) as string, name: shift.name, schedule: scheduleText(shift, false), interval: scheduleText(shift, true) || "Sem intervalo informado",
      entry: work.length ? escalaDuration(work[0].start) : "Não informada", exit: work.length ? escalaDuration(work.at(-1)?.end ?? 0) : "Não informada",
      daily: escalaDuration(shift.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0)),
      sources: [...sources.values()].map((source) => ({ ...source, changes: changeDescription(source, shift) })) };
  });
  return { dates, people, shifts, codes, issues: presentationIssues(workspace), legend: ESCALA_LEGEND,
    branch: `Filial ${input.branchCode} - ${input.branchName}`, period: `${dates[0] ?? input.startDate} a ${dates.at(-1) ?? input.endDate}`,
    state: workspace.status === "PUBLISHED" ? "PUBLICADA" : "RASCUNHO" };
}
