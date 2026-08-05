import type {
  UnimedAccessLevel,
  UnimedBillingClosure,
  UnimedDocumentKind,
  UserRole,
} from "@prisma/client";

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
>;

export type UnimedCalculationInput = {
  reasonCode: number;
  exclusionDate: string;
  planEnrollmentDate: string;
  billingClosure: UnimedBillingClosure;
  holder: UnimedMoneyComponents;
  dependents: UnimedDependentMoneyComponents[];
};

export type UnimedCalculationResult = {
  invoiceTotal: string;
  usedProrata: string;
  invoiceRefund: string;
  refundDays: number;
  payrollCharge: string;
  employeeFullRefund: string;
  companyFullRefund: string;
  enrollmentMonths: number;
  contributionMonths: number;
  documentKind: UnimedDocumentKind;
  emailHasAttachment: false;
  display: {
    invoiceTotal: string;
    usedProrata: string;
    invoiceRefund: string;
    payrollCharge: string;
    employeeFullRefund: string;
    companyFullRefund: string;
  };
};
