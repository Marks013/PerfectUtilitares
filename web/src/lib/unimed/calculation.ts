import { documentKindForReason } from "@/lib/unimed/defaults";
import { unimedCalculationInputSchema } from "@/lib/unimed/calculation-schema";
import type {
  UnimedCalculationInput,
  UnimedCalculationResult,
} from "@/lib/unimed/types";

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function completeMonthsBetween(start: Date, end: Date) {
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth();
  return Math.max(0, months - (end.getUTCDate() < start.getUTCDate() ? 1 : 0));
}

function roundHalfUp(value: number) {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(value) + 0.5 + Number.EPSILON);
}

function cents(value: number) {
  const sign = value < 0 ? -1 : 1;
  const [whole, fraction = ""] = Math.abs(value).toFixed(10).split(".");
  const padded = fraction.padEnd(3, "0");
  const base = Number(whole) * 100 + Number(padded.slice(0, 2));
  return sign * (base + (Number(padded[2]) >= 5 ? 1 : 0));
}

function prorate(valueCents: number, numerator: number, denominator: number) {
  return roundHalfUp((valueCents * numerator) / denominator);
}

function serializeMoney(valueCents: number) {
  return (valueCents / 100).toFixed(2);
}

function competency(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nextMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
}

function monthlyTotals(input: {
  holder: UnimedCalculationInput["holder"];
  dependents: UnimedCalculationInput["dependents"];
}) {
  const dependentsInvoice = input.dependents.reduce(
    (total, dependent) =>
      total + cents(dependent.invoicePlanAmount) + cents(dependent.addonAmount),
    0,
  );
  const invoiceTotal =
    cents(input.holder.invoicePlanAmount) +
    cents(input.holder.addonAmount) +
    dependentsInvoice;
  const payrollCharge =
    cents(input.holder.payrollPlanAmount) +
    cents(input.holder.addonAmount) +
    dependentsInvoice;
  return { invoiceTotal, payrollCharge };
}

export function calculateUnimed(
  rawInput: UnimedCalculationInput,
): UnimedCalculationResult {
  const input = unimedCalculationInputSchema.parse(rawInput);
  const exclusionDate = parseDateOnly(input.exclusionDate);
  const enrollmentDate = parseDateOnly(input.planEnrollmentDate);
  const followingMonth = nextMonth(exclusionDate);
  const daysInMonth = new Date(
    Date.UTC(
      exclusionDate.getUTCFullYear(),
      exclusionDate.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  const nextCompetencyDays = new Date(
    Date.UTC(
      followingMonth.getUTCFullYear(),
      followingMonth.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  const usedDays = exclusionDate.getUTCDate();

  const currentTotals = monthlyTotals(input);
  const nextTotals = monthlyTotals(input.nextCompetency ?? input);
  const closedAfterCutoff =
    input.billingClosure === "AUTOMATIC_DAY_25" && usedDays >= 25;
  const refundDays = daysInMonth - usedDays;
  const usedProrata = prorate(
    currentTotals.invoiceTotal,
    usedDays,
    daysInMonth,
  );
  const invoiceProratedRefund = prorate(
    currentTotals.invoiceTotal,
    refundDays,
    daysInMonth,
  );
  const employeeProratedRefund = prorate(
    currentTotals.payrollCharge,
    refundDays,
    daysInMonth,
  );
  const nextCompetencyRefund = closedAfterCutoff
    ? nextTotals.invoiceTotal
    : 0;
  const employeeNextRefund = closedAfterCutoff
    ? nextTotals.payrollCharge
    : 0;
  const invoiceRefund = invoiceProratedRefund + nextCompetencyRefund;
  const employeeFullRefund = employeeProratedRefund + employeeNextRefund;
  const companyCurrentRefund =
    invoiceProratedRefund - employeeProratedRefund;
  const companyNextRefund = nextCompetencyRefund - employeeNextRefund;
  const companyFullRefund = invoiceRefund - employeeFullRefund;
  const enrollmentMonths = completeMonthsBetween(enrollmentDate, exclusionDate);

  return {
    invoiceTotal: serializeMoney(currentTotals.invoiceTotal),
    daysInMonth,
    usedDays,
    usedProrata: serializeMoney(usedProrata),
    cutoffApplied: closedAfterCutoff,
    currentCompetency: competency(exclusionDate),
    nextCompetency: closedAfterCutoff ? competency(followingMonth) : null,
    nextCompetencyDays,
    totalRefundDays: refundDays + (closedAfterCutoff ? nextCompetencyDays : 0),
    currentCompetencyRefund: serializeMoney(invoiceProratedRefund),
    nextCompetencyRefund: serializeMoney(nextCompetencyRefund),
    nextCompetencyInvoiceTotal: serializeMoney(nextTotals.invoiceTotal),
    nextCompetencyPayrollCharge: serializeMoney(nextTotals.payrollCharge),
    invoiceRefund: serializeMoney(invoiceRefund),
    refundDays,
    payrollCharge: serializeMoney(currentTotals.payrollCharge),
    employeeCurrentRefund: serializeMoney(employeeProratedRefund),
    employeeNextRefund: serializeMoney(employeeNextRefund),
    employeeFullRefund: serializeMoney(employeeFullRefund),
    companyCurrentRefund: serializeMoney(companyCurrentRefund),
    companyNextRefund: serializeMoney(companyNextRefund),
    companyFullRefund: serializeMoney(companyFullRefund),
    enrollmentMonths,
    contributionMonths: Math.max(1, enrollmentMonths),
    documentKind: documentKindForReason(input.reasonCode),
    emailHasAttachment: false,
    display: {
      invoiceTotal: serializeMoney(currentTotals.invoiceTotal),
      nextCompetencyInvoiceTotal: serializeMoney(nextTotals.invoiceTotal),
      usedProrata: serializeMoney(usedProrata),
      invoiceRefund: serializeMoney(invoiceRefund),
      payrollCharge: serializeMoney(currentTotals.payrollCharge),
      employeeFullRefund: serializeMoney(employeeFullRefund),
      companyFullRefund: serializeMoney(companyFullRefund),
    },
  };
}
