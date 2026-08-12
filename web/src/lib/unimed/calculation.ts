import { Prisma } from "@/generated/prisma/client";
import { documentKindForReason } from "@/lib/unimed/defaults";
import { unimedCalculationInputSchema } from "@/lib/unimed/schema";
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

function money(value: number | Prisma.Decimal) {
  return new Prisma.Decimal(value).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}

function serializeMoney(value: Prisma.Decimal) {
  return money(value).toFixed(2);
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
  includeHolder: boolean;
}) {
  const dependentsInvoice = input.dependents.reduce(
    (total, dependent) =>
      total
        .plus(money(dependent.invoicePlanAmount))
        .plus(money(dependent.addonAmount)),
    new Prisma.Decimal(0),
  );
  const holderInvoice = input.includeHolder
    ? money(input.holder.invoicePlanAmount).plus(money(input.holder.addonAmount))
    : new Prisma.Decimal(0);
  const holderPayroll = input.includeHolder
    ? money(input.holder.payrollPlanAmount).plus(money(input.holder.addonAmount))
    : new Prisma.Decimal(0);
  const invoiceTotal = money(holderInvoice.plus(dependentsInvoice));
  const payrollCharge = money(holderPayroll.plus(dependentsInvoice));
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

  const includeHolder = input.reasonCode !== 1;
  const currentTotals = monthlyTotals({ ...input, includeHolder });
  const nextTotals = monthlyTotals({
    ...(input.nextCompetency ?? input),
    includeHolder,
  });
  const zero = new Prisma.Decimal(0);
  const closedAfterCutoff =
    input.billingClosure === "AUTOMATIC_DAY_25" && usedDays >= 25;
  const refundDays = daysInMonth - usedDays;
  const usedProrata = money(
    currentTotals.invoiceTotal.dividedBy(daysInMonth).times(usedDays),
  );
  const invoiceProratedRefund = money(
    currentTotals.invoiceTotal.dividedBy(daysInMonth).times(refundDays),
  );
  const employeeProratedRefund = money(
    currentTotals.payrollCharge.dividedBy(daysInMonth).times(refundDays),
  );
  const nextCompetencyRefund = money(
    closedAfterCutoff ? nextTotals.invoiceTotal : zero,
  );
  const employeeNextRefund = money(
    closedAfterCutoff ? nextTotals.payrollCharge : zero,
  );
  const invoiceRefund = money(
    invoiceProratedRefund.plus(nextCompetencyRefund),
  );
  const employeeFullRefund = money(
    employeeProratedRefund.plus(employeeNextRefund),
  );
  const companyCurrentRefund = money(
    invoiceProratedRefund.minus(employeeProratedRefund),
  );
  const companyNextRefund = money(
    nextCompetencyRefund.minus(employeeNextRefund),
  );
  const companyFullRefund = money(invoiceRefund.minus(employeeFullRefund));
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
