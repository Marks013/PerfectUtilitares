import { visibleDates } from "./dates";
import { sortEmployees } from "./order";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift, EscalaWorkspace } from "./types";

const ESCALA_LEGEND = "F = Folga | T01/T02 = Turno | ENC = Não subordinado a horário | NP = Não processado | AF = Afastado | FV = Fora do vínculo | X = Não incluído ou não considerado";
export type EscalaExportMode = "rest" | "hours" | "both";
const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function escalaDateLabel(date: string): string {
  return `${date.slice(8)}/${date.slice(5, 7)} ${weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()]}`;
}

/** Codes follow the persisted shift list, not a filtered view or the assignments selected for export. */
export function escalaShiftCodes(input: Pick<EscalaInput, "shifts">): Map<string, string> {
  return new Map(input.shifts.map((shift, index) => [shift.id, `T${String(index + 1).padStart(2, "0")}`]));
}

/** An exclusion is explicit; missing clocks alone never imply a manual exclusion or an exemption. */
export function exclusionPresentation(employee: EscalaEmployee) {
  const recorded = employee.planningExclusionReason?.trim();
  const reason = recorded || "Não inclusão registrada, sem motivo informado.";
  const guidance = /horário|turno|jornada/i.test(reason)
    ? "Confira o horário e os turnos permitidos deste colaborador; depois escolha incluí-lo e gere novamente."
    : "Confira a decisão no cadastro do colaborador; informe o motivo ou escolha incluí-lo e gere novamente.";
  return { code: "X" as const, reason, guidance };
}

export function assignmentPresentation(employee: EscalaEmployee, date: string, assignment: EscalaAssignment | undefined, codes: ReadonlyMap<string, string>) {
  if (employee.planningEnabled === false) return { code: "X", description: exclusionPresentation(employee).reason };
  if (date < employee.activeFrom || (employee.activeUntil && date > employee.activeUntil)) return { code: "FV", description: "Fora do período de vínculo" };
  if (!assignment) return { code: "NP", description: "Dia não processado: gere a proposta ou selecione um turno, uma folga ou um afastamento" };
  if (assignment.kind === "OFF") return { code: "F", description: "Folga" };
  if (assignment.kind === "ABSENCE") return { code: "AF", description: "Afastado; não conta como folga nem como presença na cobertura" };
  if (employee.scheduleMode === "UNTIMED") return { code: "ENC", description: "Não subordinado a horário, conforme condição expressamente informada; horas e cobertura horária não apuradas" };
  if (assignment.kind === "DUTY" || employee.scheduleMode === "MISSING") return { code: "NP", description: "Horário não processado: presença diária planejada sem horário informado; defina um horário para apurar horas e cobertura" };
  const code = codes.get(assignment.shiftId ?? "");
  return code ? { code, description: `Turno planejado ${code}` } : { code: "NP", description: "Horário não processado: turno não encontrado; selecione um turno válido" };
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

/** Exact schedule interpretation shared by screen, PDF and Excel; no clock rounding or role inference. */
export function buildEscalaSchedule(input: EscalaInput) {
  const dates = visibleDates(input), codes = escalaShiftCodes(input);
  const assignments = new Map(input.assignments.map((assignment) => [`${assignment.employeeId}\0${assignment.date}`, assignment]));
  const byShift = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const people = sortEmployees(input.employees.filter((employee) => employee.planningEnabled !== false)).map((employee) => {
    const cells = dates.map((date) => {
      const assignment = assignments.get(`${employee.id}\0${date}`);
      const label = assignmentPresentation(employee, date, assignment, codes);
      const shift = /^T\d+$/.test(label.code) ? byShift.get(assignment?.shiftId ?? "") : undefined;
      const dailyMinutes = shift?.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
      return { date, ...label, shiftId: shift?.id, schedule: shift ? scheduleText(shift, false) : label.description,
        interval: shift ? scheduleText(shift, true) || "Sem intervalo informado" : "Não se aplica",
        daily: dailyMinutes === undefined ? "Não apurada" : escalaDuration(dailyMinutes) };
    });
    const variants = new Map<string, { shiftId: string; code: string; schedule: string; interval: string; daily: string; dates: string[] }>();
    for (const cell of cells) if (cell.shiftId) {
      const entry = variants.get(cell.shiftId) ?? { shiftId: cell.shiftId, code: cell.code, schedule: cell.schedule, interval: cell.interval, daily: cell.daily, dates: [] };
      entry.dates.push(cell.date); variants.set(cell.shiftId, entry);
    }
    const proposedVariants = [...variants.values()];
    const proposedSchedule = proposedVariants.length === 1 ? proposedVariants[0].schedule
      : proposedVariants.length > 1 ? "Varia no mês: " + proposedVariants.map((entry) => entry.code + " " + entry.schedule).join(" | ")
      : employee.scheduleMode === "UNTIMED" ? "ENC — condição expressamente informada"
      : cells.some((cell) => cell.code === "NP") ? "NP — horário ainda não processado" : "Sem trabalho com horário neste período";
    return { employee, cells, proposedSchedule, proposedVariants };
  });
  const excluded = sortEmployees(input.employees.filter((employee) => employee.planningEnabled === false))
    .map((employee) => ({ employee, ...exclusionPresentation(employee) }));
  return { dates, codes, people, excluded, legend: ESCALA_LEGEND };
}

/** One immutable interpretation for screen cells, PDF and Excel. Technical boundary days remain in input. */
export function buildEscalaPresentation(workspace: EscalaWorkspace) {
  const { input } = workspace, base = buildEscalaSchedule(input);
  const { dates, codes, people } = base;
  const visible = new Set(dates), included = new Map(people.map(({ employee }) => [employee.id, employee]));
  const used = input.assignments.filter((assignment) => {
    const employee = included.get(assignment.employeeId);
    return assignment.kind === "WORK" && visible.has(assignment.date) && employee && employee.scheduleMode !== "UNTIMED" && employee.scheduleMode !== "MISSING"
      && assignment.date >= employee.activeFrom && (!employee.activeUntil || assignment.date <= employee.activeUntil);
  });
  const usedIds = new Set(used.map((assignment) => assignment.shiftId));
  const shifts = input.shifts.filter((shift) => usedIds.has(shift.id)).map((shift) => {
    const userIds = new Set(used.filter((assignment) => assignment.shiftId === shift.id).map((assignment) => assignment.employeeId));
    const users = input.employees.filter((employee) => userIds.has(employee.id));
    const sources = new Map(users.filter((employee) => employee.sourceSchedule)
      .map((employee) => { const source = employee.sourceSchedule as NonNullable<EscalaEmployee["sourceSchedule"]>; return [JSON.stringify(source), source]; }));
    const work = shift.segments.filter((segment) => segment.kind === "WORK");
    return { id: shift.id, code: codes.get(shift.id) as string, name: shift.name, schedule: scheduleText(shift, false), interval: scheduleText(shift, true) || "Sem intervalo informado",
      entry: work.length ? escalaDuration(work[0].start) : "Não informada", exit: work.length ? escalaDuration(work.at(-1)?.end ?? 0) : "Não informada",
      daily: escalaDuration(shift.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0)),
      employeeCount: userIds.size, sectors: [...new Set(users.map((employee) => employee.sector))].sort((a, b) => a.localeCompare(b, "pt-BR")),
      sources: [...sources.values()].map((source) => ({ ...source, changes: changeDescription(source, shift) })) };
  });
  return { ...base, shifts, issues: presentationIssues(workspace),
    branch: `Filial ${input.branchCode} - ${input.branchName}`, period: `${dates[0] ?? input.startDate} a ${dates.at(-1) ?? input.endDate}`,
    state: workspace.status === "PUBLISHED" ? "PUBLICADA" : "RASCUNHO" };
}
