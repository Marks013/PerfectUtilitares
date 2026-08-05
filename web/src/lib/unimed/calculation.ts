import { Prisma } from "@prisma/client";
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

export function calculateUnimed(
  rawInput: UnimedCalculationInput,
): UnimedCalculationResult {
  const input = unimedCalculationInputSchema.parse(rawInput);
  const exclusionDate = parseDateOnly(input.exclusionDate);
  const enrollmentDate = parseDateOnly(input.planEnrollmentDate);
  const daysInMonth = new Date(
    Date.UTC(
      exclusionDate.getUTCFullYear(),
      exclusionDate.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  const usedDays = exclusionDate.getUTCDate();

  const dependentsInvoice = input.dependents.reduce(
    (total, dependent) =>
      total
        .plus(money(dependent.invoicePlanAmount))
        .plus(money(dependent.addonAmount)),
    new Prisma.Decimal(0),
  );
  const invoiceTotal = money(
    money(input.holder.invoicePlanAmount)
      .plus(money(input.holder.addonAmount))
      .plus(dependentsInvoice),
  );
  const payrollCharge = money(
    money(input.holder.payrollPlanAmount)
      .plus(money(input.holder.addonAmount))
      .plus(dependentsInvoice),
  );

  const closedAfterCutoff =
    input.billingClosure === "AUTOMATIC_DAY_25" && usedDays >= 25;
  const refundDays = daysInMonth - usedDays;
  const usedProrata = money(
    invoiceTotal.dividedBy(daysInMonth).times(usedDays),
  );
  const invoiceProratedRefund = money(
    invoiceTotal.dividedBy(daysInMonth).times(refundDays),
  );
  const employeeProratedRefund = money(
    payrollCharge.dividedBy(daysInMonth).times(refundDays),
  );
  const invoiceRefund = money(
    invoiceProratedRefund.plus(
      closedAfterCutoff ? invoiceTotal : new Prisma.Decimal(0),
    ),
  );
  const employeeFullRefund = money(
    employeeProratedRefund.plus(
      closedAfterCutoff ? payrollCharge : new Prisma.Decimal(0),
    ),
  );
  const companyFullRefund = money(invoiceRefund.minus(employeeFullRefund));
  const enrollmentMonths = completeMonthsBetween(enrollmentDate, exclusionDate);

  return {
    invoiceTotal: serializeMoney(invoiceTotal),
    usedProrata: serializeMoney(usedProrata),
    invoiceRefund: serializeMoney(invoiceRefund),
    refundDays,
    payrollCharge: serializeMoney(payrollCharge),
    employeeFullRefund: serializeMoney(employeeFullRefund),
    companyFullRefund: serializeMoney(companyFullRefund),
    enrollmentMonths,
    contributionMonths: Math.max(1, enrollmentMonths),
    documentKind: documentKindForReason(input.reasonCode),
    emailHasAttachment: false,
    display: {
      invoiceTotal: serializeMoney(invoiceTotal),
      usedProrata: serializeMoney(usedProrata),
      invoiceRefund: serializeMoney(invoiceRefund),
      payrollCharge: serializeMoney(payrollCharge),
      employeeFullRefund: serializeMoney(employeeFullRefund),
      companyFullRefund: serializeMoney(companyFullRefund),
    },
  };
}
