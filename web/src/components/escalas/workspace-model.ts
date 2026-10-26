import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift, WeeklyHours } from "@/lib/escalas/types";

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
  const daily = (hours * 60) / 5;
  return {
    schemaVersion: 1,
    branchCode: branchCode.trim(),
    branchName: branchName.trim(),
    ...period,
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
      minInterShiftMinutes: 660,
      minWeeklyRestMinutes: 2100,
      minMealMinutes: 60,
      maxConsecutiveWorkDays: 6,
      closedDates: [],
      holidayDates: [],
      authorizedHolidayDates: [],
      holidayRestAllowed: false,
      nightWorkReviewed: false,
    },
    shifts: [
      {
        id: "turno-inicial",
        name: `Diurno ${clock(daily)}`,
        segments: [
          { start: 480, end: 720, kind: "WORK" },
          { start: 720, end: 780, kind: "BREAK" },
          { start: 780, end: 780 + daily - 240, kind: "WORK" },
        ],
      },
    ],
    employees: [],
    demands: [],
    assignments: [],
  };
}

export function newEmployee(hours: WeeklyHours, shiftId?: string): EscalaEmployee {
  return {
    id: crypto.randomUUID(),
    registration: "",
    name: "",
    sector: "",
    role: "",
    weeklyHours: hours,
    shiftIds: shiftId ? [shiftId] : [],
    activeFrom: "",
    offMode: "VARIABLE",
    fixedOffDays: [],
    offPattern: "ANY",
    maxConsecutiveSundays: 1,
    preferredOffDays: [],
    historyKnown: false,
    history: [],
  };
}

export function replaceAssignment(assignments: EscalaAssignment[], next: EscalaAssignment) {
  return [...assignments.filter((item) => item.employeeId !== next.employeeId || item.date !== next.date), next];
}

export function mergeImport(input: EscalaInput, employees: EscalaEmployee[], shifts: EscalaShift[]): EscalaInput {
  const registrations = new Set(input.employees.map((item) => item.registration));
  if (
    employees.some((item) => registrations.has(item.registration)) ||
    new Set(employees.map((item) => item.registration)).size !== employees.length
  ) {
    throw new Error(
      "A prévia contém matrícula já cadastrada. Revise os registros antes de importar; nenhum dado foi substituído.",
    );
  }
  if (input.employees.length + employees.length > 150)
    throw new Error("A filial comporta até 150 colaboradores por proposta. Reduza os registros da importação.");
  const byId = new Map(input.shifts.map((shift) => [shift.id, shift]));
  for (const shift of shifts) {
    if (byId.has(shift.id) && JSON.stringify(byId.get(shift.id)) !== JSON.stringify(shift)) {
      throw new Error("Um identificador de horário já existe com configuração diferente. Revise a importação.");
    }
    byId.set(shift.id, shift);
  }
  return {
    ...input,
    employees: [...input.employees, ...employees],
    shifts: [...byId.values()],
  };
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
