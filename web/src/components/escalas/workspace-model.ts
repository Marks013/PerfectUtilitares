import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift, EscalaValidation, WeeklyHours } from "@/lib/escalas/types";
import { CCT_FROM, CCT_UNTIL, effectiveWeeklyMinutes, isMixed42LongShift, legalWeeklyHours, SUPERMARKET_CCT, usesMixed42Week } from "@/lib/escalas/labor-rules";
import { planningWeeklyHours } from "@/lib/escalas/preparation";
import { canonicalBranchCode } from "@/lib/escalas/branch-code";
import { storeClosingMinutes } from "@/lib/escalas/store-hours";
import { reconcileImport, type ImportChoices } from "./import-reconciliation";

export const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
export const HOURS: WeeklyHours[] = [40, 42, 44];

export function addDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  for (let date = start; date <= end && dates.length < 42; date = addDate(date, 1)) dates.push(date);
  return dates;
}

export function monthPeriod(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Informe o mês da escala.");
  const [year, number] = month.split("-").map(Number);
  if (number < 1 || number > 12 || year < 2000 || year > 2099) throw new Error("Mês inválido.");
  const first = `${month}-01`;
  const last = new Date(Date.UTC(year, number, 0, 12)).toISOString().slice(0, 10);
  const mondayOffset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const sundayOffset = 6 - ((new Date(`${last}T12:00:00Z`).getUTCDay() + 6) % 7);
  const result = {
    startDate: addDate(first, -mondayOffset),
    endDate: addDate(last, sundayOffset),
  };
  if (result.startDate < "2000-01-01" || result.endDate > "2099-12-31")
    throw new Error("Selecione um mês cujas semanas completas estejam entre 2000 e 2099.");
  return result;
}

export function displayDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function clock(minutes: number) {
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
}

export function parseClock(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) throw new Error("Use o formato HH:MM.");
  const [hours, minutes] = value.split(":").map(Number);
  if (minutes > 59 || hours > 48 || (hours === 48 && minutes !== 0)) throw new Error("Horário inválido.");
  return hours * 60 + minutes;
}

export function newInput(branchCode: string, branchName: string, month: string, hours: WeeklyHours): EscalaInput {
  const period = monthPeriod(month);
  const weeklyTargets = [
    ...new Set(
      datesBetween(period.startDate, period.endDate)
        .filter((_, index) => index % 7 === 0)
        .map((start) => Math.min(hours, legalWeeklyHours(addDate(start, 6)))),
    ),
  ];
  return {
    schemaVersion: 1,
    branchCode: canonicalBranchCode(branchCode),
    branchName: branchName.trim(),
    ...period,
    visibleMonth: month,
    defaultWeeklyHours: hours,
    timeZone: "America/Sao_Paulo",
    policy: {
      source: "",
      validFrom: period.startDate,
      validUntil: period.endDate,
      reviewed: false,
      reviewedBy: "",
      weeklyLimit: 44,
      dailyLimitMinutes: 528,
      compensationAuthorized: false,
      normativeProfile: "CUSTOM",
      transitionWeekAccepted: false,
      minInterShiftMinutes: 660,
      minWeeklyRestMinutes: 2100,
      minMealMinutes: 60,
      allowShortMealSimulation: false,
      maxConsecutiveWorkDays: 5,
      calendarMode: "LOCAL",
      closedDates: [],
      holidayDates: [],
      authorizedHolidayDates: [],
      holidayRestAllowed: false,
      nightWorkReviewed: false,
    },
    shifts: weeklyTargets.map((target, index) => {
      const daily = (target * 60) / 5;
      return {
        id: index === 0 ? "turno-inicial" : `turno-inicial-${target}h`,
        name: `Diurno ${clock(daily)}`,
        segments: [
          { start: 480, end: 720, kind: "WORK" },
          { start: 720, end: 780, kind: "BREAK" },
          { start: 780, end: 780 + daily - 240, kind: "WORK" },
        ],
      };
    }),
    employees: [],
    demands: [],
    assignments: [],
  };
}

export function newEmployee(hours: WeeklyHours, shiftId?: string | string[]): EscalaEmployee {
  return {
    id: crypto.randomUUID(),
    registration: "",
    name: "",
    sector: "",
    role: "",
    weeklyHours: hours,
    weeklyHoursMode: "INDIVIDUAL",
    shiftIds: Array.isArray(shiftId) ? [...new Set(shiftId)] : shiftId ? [shiftId] : [],
    activeFrom: "",
    offMode: "VARIABLE",
    fixedOffDays: [],
    offPattern: "ANY",
    maxConsecutiveSundays: 1,
    sundayRestRule: "PROTECTIVE",
    preferredOffDays: [],
    historyKnown: false,
    history: [],
  };
}

/** Resolve legacy branch references before changing the selected branch target. */
export function changeBranchWeeklyHours(input: EscalaInput, hours: WeeklyHours): EscalaInput {
  if (input.defaultWeeklyHours === hours) return input;
  return { ...input, defaultWeeklyHours: hours, mixed42Sectors: undefined,
    employees: input.employees.map((person) => ({ ...person, ...planningWeeklyHours(person, input.defaultWeeklyHours, hours) })),
    demands: input.demands.filter((demand) => !demand.estimated),
  };
}

/** Changing the calculation scope preserves every day and reference until regeneration. */
export function changeGenerationMode(input: EscalaInput, generationMode: NonNullable<EscalaInput["generationMode"]>): EscalaInput {
  if ((input.generationMode ?? "DAYS_AND_HOURS") === generationMode) return input;
  return { ...input, generationMode,
    needsRegeneration: input.needsRegeneration || input.assignments.length > 0,
    demands: input.demands.filter(demand => demand.estimated !== true),
  };
}

/** Keep the visible roster for comparison; only a real closing-time change invalidates it. */
export function changeStoreClosingMinutes(input: EscalaInput, closingMinutes: number | undefined): EscalaInput {
  if (closingMinutes !== undefined && (!Number.isInteger(closingMinutes) || closingMinutes < 1 || closingMinutes > 1440)) {
    throw new Error("Informe um horário de fechamento válido.");
  }
  if (input.storeClosingMinutes === closingMinutes) return input;
  const updated = { ...input, storeClosingMinutes: closingMinutes };
  if (storeClosingMinutes(input) === storeClosingMinutes(updated)) return updated;
  return {
    ...updated,
    needsRegeneration: input.needsRegeneration || input.assignments.length > 0,
    demands: input.demands.filter(demand => demand.estimated !== true),
  };
}

/** Only changes the proposal preference; imported clocks and locked assignments remain untouched. */
export function changeContinuousWorkLimit(input: EscalaInput, enabled: boolean): EscalaInput {
  if ((input.policy.limitContinuousWorkBlocks === true) === enabled) return input;
  return { ...input, policy: { ...input.policy, limitContinuousWorkBlocks: enabled } };
}

export function mixed42EligibleSectors(input: EscalaInput): string[] {
  if (input.defaultWeeklyHours !== 42) return [];
  const weeks = datesBetween(input.startDate, input.endDate).filter((_, index) => index % 7 === 0);
  const scope = { ...input, simulation: true, mixed42Sectors: [...new Set(input.employees.map((person) => person.sector).filter(Boolean))] };
  const eligible = input.employees.filter((person) => {
    const reference = { ...person, ...planningWeeklyHours(person, 42, 42) };
    return weeks.some((day) => (!person.activeUntil || person.activeUntil >= day)
      && (!person.activeFrom || person.activeFrom <= addDate(day, 6)) && usesMixed42Week(scope, reference, day));
  });
  return [...new Set(eligible.map((person) => person.sector))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function mixed42Key(input: EscalaInput) {
  return JSON.stringify([...new Set(input.mixed42Sectors ?? [])].sort());
}

export function changeMixed42Sectors(input: EscalaInput, selected: string[]): EscalaInput {
  const mixed42Sectors = mixed42EligibleSectors(input).filter((sector) => selected.includes(sector));
  if (mixed42Key(input) === mixed42Key({ ...input, mixed42Sectors })) return input;
  return { ...input, mixed42Sectors: mixed42Sectors.length ? mixed42Sectors : undefined,
    ...(mixed42Sectors.length ? { simulation: true } : {}),
    needsRegeneration: input.needsRegeneration || input.assignments.length > 0,
    demands: input.demands.filter((demand) => !demand.estimated),
  };
}

export function pruneMixed42Sectors(input: EscalaInput): EscalaInput {
  return input.mixed42Sectors?.length ? changeMixed42Sectors(input, input.mixed42Sectors) : input;
}

/** Changes that make a previously generated scenario obsolete. Manual day edits remain intentional. */
function absenceDays(input: EscalaInput): string {
  return JSON.stringify(input.assignments.filter((item) => item.kind === "ABSENCE").map((item) => JSON.stringify([item.employeeId, item.date])).sort());
}

export function scenarioDefinitionChanged(previous: EscalaInput, next: EscalaInput): boolean {
  if (mixed42Key(previous) !== mixed42Key(next) || absenceDays(previous) !== absenceDays(next)) return true;
  if (storeClosingMinutes(previous) !== storeClosingMinutes(next)) return true;
  if (previous.defaultWeeklyHours !== next.defaultWeeklyHours || previous.startDate !== next.startDate || previous.endDate !== next.endDate) return true;
  if ((previous.generationMode ?? "DAYS_AND_HOURS") !== (next.generationMode ?? "DAYS_AND_HOURS")) return true;
  return (['employees', 'shifts', 'demands', 'policy', 'movementPriorities'] as const).some((key) => previous[key] !== next[key] && JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
}

export function hasOutdatedResults(input: EscalaInput, validation: EscalaValidation | null): boolean {
  if (input.needsRegeneration || input.policy.maxConsecutiveWorkDays > 5) return true;
  if (!validation?.issues.some((issue) => ['WEEKLY_MINUTES', 'WEEKLY_LIMIT'].includes(issue.code))) return false;
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  return input.employees.some((person) => person.scheduleMode !== "MISSING" && person.scheduleMode !== "UNTIMED"
    && input.assignments.some((assignment) => {
      if (assignment.employeeId !== person.id || assignment.kind !== "WORK") return false;
      const shift = shifts.get(assignment.shiftId ?? "");
      if (!shift) return false;
      const minutes = shift.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
      if (usesMixed42Week(input, person, assignment.date)) return minutes !== 480 && !isMixed42LongShift(shift);
      return minutes !== effectiveWeeklyMinutes(person, assignment.date) / 5;
    }));
}

export function coverageDefinitionChanged(previous: EscalaInput, next: EscalaInput): boolean {
  if (mixed42Key(previous) !== mixed42Key(next) || absenceDays(previous) !== absenceDays(next)) return true;
  if (storeClosingMinutes(previous) !== storeClosingMinutes(next)) return true;
  if ((previous.policy.limitContinuousWorkBlocks === true) !== (next.policy.limitContinuousWorkBlocks === true)) return true;
  if ((previous.generationMode ?? "DAYS_AND_HOURS") !== (next.generationMode ?? "DAYS_AND_HOURS")) return true;
  if (previous.defaultWeeklyHours !== next.defaultWeeklyHours || previous.startDate !== next.startDate || previous.endDate !== next.endDate) return true;
  if (previous.employees !== next.employees || previous.shifts !== next.shifts) return true;
  if (previous.demands === next.demands) return false;
  return previous.demands.length !== next.demands.length || previous.demands.some((before, index) => {
    const after = next.demands[index];
    return before.id !== after.id || before.date !== after.date || before.sector !== after.sector
      || before.role !== after.role || before.start !== after.start || before.end !== after.end
      || before.minimum !== after.minimum;
  });
}

export function selectNormativeProfile(
  input: EscalaInput,
  normativeProfile: NonNullable<EscalaInput["policy"]["normativeProfile"]>,
): EscalaInput {
  const previous = input.policy;
  return {
    ...input,
    policy: {
      ...previous,
      normativeProfile,
      reviewed: false,
      ...(previous.collectiveAgreement
        ? { collectiveAgreement: { ...previous.collectiveAgreement, reviewed: false } }
        : {}),
      ...(previous.operationalCertificate
        ? { operationalCertificate: { ...previous.operationalCertificate, reviewed: false } }
        : {}),
      ...(normativeProfile === SUPERMARKET_CCT
        ? {
            source: "PR003084/2026 — CCT Supermercados Umuarama, cl. 28/29/30/35/46",
            validFrom: CCT_FROM,
            validUntil: CCT_UNTIL,
            holidayRestAllowed: false,
            maxConsecutiveWorkDays: 5,
          }
        : {}),
    },
  };
}

export function replaceAssignment(assignments: EscalaAssignment[], next: EscalaAssignment) {
  return [...assignments.filter((item) => item.employeeId !== next.employeeId || item.date !== next.date), next];
}

export function mergeImport(input: EscalaInput, employees: EscalaEmployee[], shifts: EscalaShift[], choices?: ImportChoices): EscalaInput {
  return reconcileImport(input, employees, shifts, choices);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir. Tente novamente.";
}

export function isCurrentResponse(signal: AbortSignal, responseVersion: number, currentVersion: number) {
  return !signal.aborted && responseVersion === currentVersion;
}

export function responseMessage(body: unknown) {
  if (body && typeof body === "object") {
    const value = body as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof value.error === "string") return value.error;
    return value.error?.message ?? value.message ?? "Não foi possível concluir a operação.";
  }
  return "Resposta inválida do servidor.";
}
