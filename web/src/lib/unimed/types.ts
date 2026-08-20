import type {
  UnimedAccessLevel,
  UnimedBillingClosure,
  UnimedDocumentKind,
  UserRole,
} from "@/generated/prisma/client";

export type UnimedAction =
  | "VIEW"
  | "CALCULATE"
  | "GENERATE_DOCUMENT"
  | "SEND_EMAIL"
  | "IMPORT"
  | "PUBLISH"
  | "MANAGE_CONFIG"
  | "MANAGE_ACCESS";

export type UnimedActor = {
  role: UserRole;
  accessLevel: UnimedAccessLevel | null;
};

type UnimedMoneyComponents = {
  invoicePlanAmount: number;
  payrollPlanAmount: number;
  addonAmount: number;
};

type UnimedDependentMoneyComponents = Omit<
  UnimedMoneyComponents,
  "payrollPlanAmount"
> & {
  clientId?: string;
  planEnrollmentDate?: string;
};

export type UnimedCalculationInput = {
  reasonCode: number;
  exclusionDate: string;
  planEnrollmentDate: string;
  billingClosure: UnimedBillingClosure;
  holder: UnimedMoneyComponents;
  dependents: UnimedDependentMoneyComponents[];
  nextCompetency?: {
    holder: UnimedMoneyComponents;
    dependents: UnimedDependentMoneyComponents[];
  };
};

export type UnimedCalculationResult = {
  invoiceTotal: string;
  daysInMonth: number;
  usedDays: number;
  usedProrata: string;
  cutoffApplied: boolean;
  currentCompetency: string;
  nextCompetency: string | null;
  nextCompetencyDays: number;
  totalRefundDays: number;
  currentCompetencyRefund: string;
  nextCompetencyRefund: string;
  nextCompetencyInvoiceTotal: string;
  nextCompetencyPayrollCharge: string;
  invoiceRefund: string;
  refundDays: number;
  payrollCharge: string;
  employeeCurrentRefund: string;
  employeeNextRefund: string;
  employeeFullRefund: string;
  companyCurrentRefund: string;
  companyNextRefund: string;
  companyFullRefund: string;
  enrollmentMonths: number;
  contributionMonths: number;
  dependentUsage?: Array<{
    clientId: string;
    planEnrollmentDate: string;
    usedDays: number;
    refundDays: number;
    usedProrata: string;
    currentRefund: string;
  }>;
  documentKind: UnimedDocumentKind;
  emailHasAttachment: false;
  display: {
    invoiceTotal: string;
    nextCompetencyInvoiceTotal: string;
    usedProrata: string;
    invoiceRefund: string;
    payrollCharge: string;
    employeeFullRefund: string;
    companyFullRefund: string;
  };
};
