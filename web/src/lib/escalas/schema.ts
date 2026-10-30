import { z } from "zod";
import { addDays, dateRange, dayOfWeek, isDate, monthBounds } from "./dates";

const identifier = z.string().trim().min(1).max(100).regex(/^[\p{L}\p{N}_.:-]+$/u, "Identificador inválido");
const label = z.string().trim().min(1).max(160);
const date = z.string().refine(isDate, "Informe uma data real no formato AAAA-MM-DD, entre 1900 e 2099");
const planningDate = date.refine((value) => value >= "2000-01-01", "O período de planejamento deve estar entre 2000 e 2099");
const weeklyHours = z.union([z.literal(40), z.literal(42), z.literal(44)]);
const days = z.array(z.number().int().min(0).max(6)).max(7).refine((value) => new Set(value).size === value.length, "Dias duplicados");

const assignment = z.strictObject({
  employeeId: identifier, date, kind: z.enum(["WORK", "DUTY", "OFF", "ABSENCE"]),
  shiftId: identifier.optional(), locked: z.boolean().optional(),
}).superRefine((value, context) => {
  if ((value.kind === "WORK") !== (value.shiftId !== undefined)) {
    context.addIssue({ code: "custom", path: ["shiftId"], message: "Somente trabalho deve ter um turno, e todo trabalho exige turno" });
  }
});

const shift = z.strictObject({
  id: identifier, name: label,
  segments: z.array(z.strictObject({
    start: z.number().int().min(0).max(2879),
    end: z.number().int().min(1).max(2880),
    kind: z.enum(["WORK", "PAID_BREAK", "BREAK"]),
  })).min(1).max(12),
}).superRefine((value, context) => {
  let previousEnd = -1;
  let paid = 0;
  for (const [index, segment] of value.segments.entries()) {
    if (segment.end <= segment.start || segment.start < previousEnd) {
      context.addIssue({ code: "custom", path: ["segments", index], message: "Períodos devem ser positivos, ordenados e sem sobreposição" });
    }
    if (segment.kind !== "BREAK") paid += segment.end - segment.start;
    previousEnd = segment.end;
  }
  if (value.segments[0].start >= 1440 || paid <= 0 || paid > 600 || previousEnd - value.segments[0].start > 1080) {
    context.addIssue({ code: "custom", path: ["segments"], message: "Turno deve conter até 10 horas computáveis e amplitude de até 18 horas" });
  }
  if (value.segments[0].kind === "BREAK" || value.segments.at(-1)?.kind === "BREAK") {
    context.addIssue({ code: "custom", path: ["segments"], message: "Intervalos não remunerados devem ficar entre períodos de trabalho ou presença remunerada" });
  }
});

const employee = z.strictObject({
  id: identifier, registration: label, name: label,
  sector: z.string().trim().max(160), role: z.string().trim().max(160), weeklyHours,
  weeklyHoursMode: z.enum(["BRANCH", "INDIVIDUAL"]).optional(),
  simulationDailyMinutes: z.number().int().min(1).max(600).optional(),
  shiftIds: z.array(identifier).max(12), activeFrom: z.union([date, z.literal("")]), activeUntil: date.optional(),
  planningEnabled: z.boolean().optional(),
  scheduleMode: z.enum(["TIMED", "MISSING", "UNTIMED"]).optional(),
  planningExclusionReason: z.string().trim().max(240).optional(),
  sourceSchedule: z.strictObject({ report: z.literal("FPRE136"), code: z.string().trim().max(40),
    description: z.string().trim().max(180), weekday: z.string().trim().max(180), saturday: z.string().trim().max(180) }).optional(),
  offMode: z.enum(["VARIABLE", "MIXED", "FIXED"]), fixedOffDays: days,
  offPattern: z.enum(["ANY", "CONSECUTIVE", "PREFER_CONSECUTIVE"]),
  maxConsecutiveSundays: z.union([z.literal(1), z.literal(2)]), preferredOffDays: days,
  sundayRestRule: z.enum(["PROTECTIVE", "UNREVIEWED", "CLT_386", "COMMERCE"]).optional(),
  historyKnown: z.boolean(), history: z.array(assignment).max(56),
  planningHistory: z.array(assignment).max(56).optional(),
  planningFuture: z.array(assignment).max(21).optional(),
}).superRefine((value, context) => {
  const expected = { VARIABLE: 0, MIXED: 1, FIXED: 2 }[value.offMode];
  if (value.fixedOffDays.length !== expected) context.addIssue({ code: "custom", path: ["fixedOffDays"], message: `Este modo exige ${expected} dia(s) fixo(s)` });
  if (value.activeUntil && value.activeUntil < value.activeFrom) context.addIssue({ code: "custom", path: ["activeUntil"], message: "Desligamento anterior à admissão" });
  if (new Set(value.shiftIds).size !== value.shiftIds.length) context.addIssue({ code: "custom", path: ["shiftIds"], message: "Turnos duplicados" });
});

const policy = z.strictObject({
  source: z.string().trim().max(1000), validFrom: date, validUntil: date,
  reviewed: z.boolean(), reviewedBy: z.string().trim().max(160), weeklyLimit: weeklyHours,
  dailyLimitMinutes: z.number().int().min(1).max(600), compensationAuthorized: z.boolean(),
  normativeProfile: z.enum(["CUSTOM", "SINDECOMU_SUPERMARKETS_2026_2027"]).optional(),
  transitionWeekAccepted: z.boolean().optional(),
  coverageReview: z.enum(["SUGGESTED", "CONFIRMED"]).optional(),
  collectiveAgreement: z.strictObject({
    source: z.string().trim().max(1000), validFrom: z.union([date, z.literal("")]), validUntil: z.union([date, z.literal("")]),
    reviewedBy: z.string().trim().max(160), reviewed: z.boolean(),
  }).refine((value) => !value.validFrom || !value.validUntil || value.validUntil >= value.validFrom, "Vigência do acordo inválida").optional(),
  mealIntervalAgreement: z.strictObject({
    source: z.string().trim().max(1000), validFrom: z.union([date, z.literal("")]), validUntil: z.union([date, z.literal("")]),
    reviewedBy: z.string().trim().max(160), reviewed: z.boolean(),
    maximumMinutes: z.number().int().min(121).max(360),
  }).refine((value) => !value.validFrom || !value.validUntil || value.validUntil >= value.validFrom, "Vigência do acordo de intervalo inválida").optional(),
  operationalCertificate: z.strictObject({
    identifier: z.string().trim().max(160), validFrom: z.union([date, z.literal("")]), validUntil: z.union([date, z.literal("")]),
    reviewedBy: z.string().trim().max(160), reviewed: z.boolean(),
    sundays: z.boolean(), holidays: z.boolean(), after20: z.boolean(),
  }).refine((value) => !value.validFrom || !value.validUntil || value.validUntil >= value.validFrom, "Vigência da certidão inválida").optional(),
  minInterShiftMinutes: z.number().int().min(660).max(1440),
  minWeeklyRestMinutes: z.number().int().min(2100).max(4320),
  minMealMinutes: z.number().int().min(30).max(180),
  // Six remains readable for legacy records; generation and validation always cap the model at five.
  maxConsecutiveWorkDays: z.number().int().min(1).max(6),
  allowShortMealSimulation: z.boolean().optional(),
  closedDates: z.array(date).max(100), holidayDates: z.array(date).max(100),
  authorizedHolidayDates: z.array(date).max(100), holidayRestAllowed: z.boolean(), nightWorkReviewed: z.boolean(),
}).superRefine((value, context) => {
  if (value.validUntil < value.validFrom) context.addIssue({ code: "custom", path: ["validUntil"], message: "Fim de vigência anterior ao início" });
  if (value.authorizedHolidayDates.some((day) => !value.holidayDates.includes(day))) context.addIssue({ code: "custom", path: ["authorizedHolidayDates"], message: "Autorizações devem corresponder a feriados cadastrados" });
});

export const escalaInputSchema = z.strictObject({
  simulation: z.boolean().optional(),
  needsRegeneration: z.boolean().optional(),
  schemaVersion: z.literal(1), branchCode: label, branchName: label, startDate: planningDate, endDate: planningDate,
  visibleMonth: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).optional(),
  defaultWeeklyHours: weeklyHours, timeZone: z.literal("America/Sao_Paulo"), policy,
  employees: z.array(employee).max(250), shifts: z.array(shift).max(120),
  demands: z.array(z.strictObject({
    id: identifier, date, sector: label, role: label.optional(),
    start: z.number().int().min(0).max(1439), end: z.number().int().min(1).max(1440),
    minimum: z.number().int().min(0).max(250),
    estimated: z.boolean().optional(),
  })).max(12000), assignments: z.array(assignment).max(10500),
}).superRefine((value, context) => {
  if (!isDate(value.startDate) || !isDate(value.endDate)) return;
  const dates = value.endDate >= value.startDate && value.endDate <= addDays(value.startDate, 41) ? dateRange(value.startDate, value.endDate) : [];
  if (!dates.length || dates.length % 7 !== 0 || dayOfWeek(value.startDate) !== 0 || dayOfWeek(value.endDate) !== 6) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "Selecione de 1 a 6 semanas completas, de segunda a domingo" });
  }
  if (value.visibleMonth && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value.visibleMonth)) {
    const month = monthBounds(value.visibleMonth);
    if (month.startDate < value.startDate || month.endDate > value.endDate)
      context.addIssue({ code: "custom", path: ["visibleMonth"], message: "O horizonte técnico deve conter todo o mês selecionado" });
  }
  for (const field of ["employees", "shifts", "demands"] as const) {
    const seen = new Set<string>();
    value[field].forEach((item, index) => {
      if (seen.has(item.id)) context.addIssue({ code: "custom", path: [field, index, "id"], message: "Identificador duplicado" });
      seen.add(item.id);
    });
  }
  const employeeIds = new Set(value.employees.map((person) => person.id));
  const shiftIds = new Set(value.shifts.map((item) => item.id));
  const checkAssignments = (entries: z.infer<typeof assignment>[], path: (string | number)[], personId?: string, future = false) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      const key = `${entry.employeeId}\0${entry.date}`;
      if (seen.has(key)) context.addIssue({ code: "custom", path: [...path, index], message: "Mais de uma atribuição para a pessoa na data" });
      seen.add(key);
      if (!employeeIds.has(entry.employeeId) || (personId && personId !== entry.employeeId)) context.addIssue({ code: "custom", path: [...path, index, "employeeId"], message: "Colaborador inválido" });
      if (entry.shiftId && !shiftIds.has(entry.shiftId)) context.addIssue({ code: "custom", path: [...path, index, "shiftId"], message: "Turno inexistente" });
      if (!personId && (entry.date < value.startDate || entry.date > value.endDate)) context.addIssue({ code: "custom", path: [...path, index, "date"], message: "Data fora da escala" });
      if (personId && (future ? entry.date <= value.endDate || entry.date > addDays(value.endDate, 21) : entry.date >= value.startDate || entry.date < addDays(value.startDate, -56))) context.addIssue({ code: "custom", path: [...path, index, "date"], message: future ? "Continuidade posterior deve estar nos 21 dias após a escala" : "Histórico deve estar nos 56 dias anteriores à escala" });
    });
  };
  checkAssignments(value.assignments, ["assignments"]);
  value.employees.forEach((person, index) => {
    if (person.shiftIds.some((id) => !shiftIds.has(id))) context.addIssue({ code: "custom", path: ["employees", index, "shiftIds"], message: "Turno permitido inexistente" });
    checkAssignments(person.history, ["employees", index, "history"], person.id);
    checkAssignments(person.planningHistory ?? [], ["employees", index, "planningHistory"], person.id);
    checkAssignments(person.planningFuture ?? [], ["employees", index, "planningFuture"], person.id, true);
    const duplicate = value.employees.slice(0, index).some((previous) => previous.registration === person.registration
      && previous.activeFrom <= (person.activeUntil ?? "2099-12-31")
      && person.activeFrom <= (previous.activeUntil ?? "2099-12-31"));
    if (duplicate) context.addIssue({ code: "custom", path: ["employees", index, "registration"], message: "Matrícula duplicada com períodos de vínculo sobrepostos na filial" });
  });
  value.demands.forEach((demand, index) => {
    if (demand.end <= demand.start || demand.date < value.startDate || demand.date > value.endDate) context.addIssue({ code: "custom", path: ["demands", index], message: "Faixa de cobertura inválida ou fora do período" });
  });
});
