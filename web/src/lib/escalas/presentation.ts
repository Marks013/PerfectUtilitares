import { visibleDates } from "./dates";
import { compareProposedSchedules, sortEmployees, sortHoursEmployees } from "./order";
import { isRestPlanningExcludedRole } from "./eligibility";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift, EscalaWorkspace } from "./types";

const ESCALA_LEGEND = "F = Folga | T01/T02 = Turno | ENC = Sem horário fixo | NP = Não processado | AF = Afastado | FV = Fora do vínculo | X = Não incluído ou não considerado";
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
  const sourceClocks = employee.sourceSchedule?.weekday.match(/\d{2}:\d{2}/g) ?? [];
  const allZeroSource = employee.scheduleMode === "MISSING" && sourceClocks.length > 0 && sourceClocks.every(clock => clock === "00:00");
  if (employee.scheduleMode === "UNTIMED" || allZeroSource) return { code: "ENC", description: "Sem horário fixo: participa das folgas; não entra na contagem de pessoas por horário" };
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
    const proposedVariants = [...variants.values()].sort((left, right) => compareProposedSchedules(left.schedule, right.schedule));
    const proposedSchedule = proposedVariants.length === 1 ? proposedVariants[0].schedule
      : proposedVariants.length > 1 ? "Varia no mês: " + proposedVariants.map((entry) => entry.code + " " + entry.schedule).join(" | ")
      : cells.some((cell) => cell.code === "ENC") ? "ENC — Sem horário fixo"
      : cells.some((cell) => cell.code === "NP") ? "NP — horário ainda não processado" : "Sem trabalho com horário neste período";
    return { employee, cells, proposedSchedule, proposedVariants };
  });
  const excluded = sortEmployees(input.employees.filter((employee) => employee.planningEnabled === false))
    .map((employee) => ({ employee, ...exclusionPresentation(employee) }));
  const byEmployee = new Map(people.map(person => [person.employee.id, person]));
  const hoursPeople = sortHoursEmployees(input).flatMap(employee => {
    const person = byEmployee.get(employee.id); return person ? [person] : [];
  });
  const restPeople = people.filter(person => !isRestPlanningExcludedRole(person.employee.role));
  return { dates, codes, people, hoursPeople, restPeople, excluded, legend: ESCALA_LEGEND };
}

/** One immutable interpretation for screen cells, PDF and Excel. Technical boundary days remain in input. */
export function buildEscalaPresentation(workspace: EscalaWorkspace) {
  const { input } = workspace, base = buildEscalaSchedule(input);
  const { dates } = base;
  return { ...base,
    branch: `Filial ${input.branchCode} - ${input.branchName}`, period: `${dates[0] ?? input.startDate} a ${dates.at(-1) ?? input.endDate}`,
    state: workspace.status === "PUBLISHED" ? "PUBLICADA" : "RASCUNHO" };
}
