import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/unimed-route-rate-limit.mock";
import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  requireUnimedAccess: vi.fn(),
  findReason: vi.fn(),
  findCompetency: vi.fn(),
  findBeneficiary: vi.fn(),
  findPayrollCompetence: vi.fn(),
  findPayrollLoans: vi.fn(),
  getUnimedConfiguration: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unimedExclusionReason: { findFirst: mocks.findReason },
    unimedCompetency: { findFirst: mocks.findCompetency },
    unimedBeneficiary: { findFirst: mocks.findBeneficiary },
    unimedPayrollLoan: {
      findFirst: mocks.findPayrollCompetence,
      findMany: mocks.findPayrollLoans,
    },
  },
}));

vi.mock("@/lib/unimed/access.server", () => ({
  requireUnimedAccess: mocks.requireUnimedAccess,
}));

vi.mock("@/lib/unimed/configuration", () => ({
  getUnimedConfiguration: mocks.getUnimedConfiguration,
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { GET, POST } from "@/app/api/unimed/calculation/route";

const validInput = {
  beneficiaryId: "beneficiary-12345678",
  dependentIds: ["dependent-12345678"],
  reasonCode: 8,
  exclusionDate: "2026-07-22",
};

function calculationRequest(
  body: unknown,
  options: {
    origin?: string;
    contentType?: string;
    contentLength?: string;
  } = {},
) {
  const payload = JSON.stringify(body);
  const headers = new Headers({
    "content-type": options.contentType ?? "application/json",
    origin: options.origin ?? "http://localhost",
    "x-forwarded-for": `127.0.0.${Math.floor(Math.random() * 200) + 1}`,
  });
  if (options.contentLength) {
    headers.set("content-length", options.contentLength);
  }

  return new Request("http://localhost/api/unimed/calculation", {
    method: "POST",
    headers,
    body: payload,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findReason.mockResolvedValue({ documentKind: "INACTIVE_TERM" });
  mocks.findCompetency.mockResolvedValue({ id: "competency-2026-07" });
  mocks.findBeneficiary.mockResolvedValue({
    cpf: "52998224725",
    birthDate: new Date("1990-01-01T00:00:00.000Z"),
    inclusionDate: new Date("2022-01-22T00:00:00.000Z"),
    planCode: "HOLDER",
    hasAddon: true,
    dependents: [
      {
        id: "dependent-12345678",
        birthDate: new Date("2015-01-01T00:00:00.000Z"),
        planCode: "DEPENDENT",
        hasAddon: false,
      },
    ],
  });
  mocks.getUnimedConfiguration.mockResolvedValue({
    ageBrackets: [{ code: "ALL", minAge: 0, maxAge: null }],
    planPrices: [
      {
        planCode: "HOLDER",
        ageBracket: { code: "ALL" },
        companyAmount: new Prisma.Decimal("200.00"),
        employeeAmount: new Prisma.Decimal("170.00"),
      },
      {
        planCode: "DEPENDENT",
        ageBracket: { code: "ALL" },
        companyAmount: new Prisma.Decimal("82.97"),
        employeeAmount: new Prisma.Decimal("82.97"),
      },
    ],
    addonPrices: [{ amount: new Prisma.Decimal("10.00") }],
    billing: { closure: "AUTOMATIC_DAY_25" },
    rules: null,
    email: null,
    reasons: [],
  });
  mocks.findPayrollCompetence.mockResolvedValue(null);
  mocks.findPayrollLoans.mockResolvedValue([]);
  mocks.requireUnimedAccess.mockResolvedValue({
    ok: true,
    session: {
      expires: new Date(Date.now() + 60_000).toISOString(),
      user: {
        id: "user-12345678",
        tenantId: "tenant-12345678",
        role: "OPERATOR",
        status: "ACTIVE",
      },
    },
    tenantId: "tenant-12345678",
    accessLevel: "OPERATOR",
  });
});

describe("Unimed calculation API", () => {
  it("accepts only POST", async () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("rejects requests from another origin before checking access", async () => {
    const response = await POST(
      calculationRequest(validInput, { origin: "https://attacker.test" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ORIGIN_NOT_ALLOWED" },
    });
    expect(mocks.requireUnimedAccess).not.toHaveBeenCalled();
  });

  it("requires explicit Unimed calculation access", async () => {
    mocks.requireUnimedAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: { code: "UNIMED_ACCESS_DENIED" } },
        { status: 403 },
      ),
    });

    const response = await POST(calculationRequest(validInput));

    expect(response.status).toBe(403);
    expect(mocks.requireUnimedAccess).toHaveBeenCalledWith("CALCULATE");
  });

  it("rejects non-JSON and oversized requests", async () => {
    const wrongType = await POST(
      calculationRequest(validInput, { contentType: "text/plain" }),
    );
    const oversized = await POST(
      calculationRequest(validInput, {
        contentLength: String(16 * 1024 + 1),
      }),
    );

    expect(wrongType.status).toBe(415);
    expect(oversized.status).toBe(413);
  });

  it("returns structured Zod validation errors", async () => {
    const response = await POST(
      calculationRequest({
        ...validInput,
        exclusionDate: "2026-02-30",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "UNIMED_CALCULATION_INVALID",
        details: [
          {
            path: "exclusionDate",
          },
        ],
      },
    });
  });

  it("calculates monetary values with two decimal places and no cache", async () => {
    const response = await POST(calculationRequest(validInput));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      calculation: {
        invoiceTotal: "292.97",
        payrollCharge: "262.97",
        documentKind: "INACTIVE_TERM",
        emailHasAttachment: false,
        display: {
          invoiceTotal: "292.97",
          payrollCharge: "262.97",
        },
      },
      payrollLoans: null,
    });
  });

  it("uses the August table for 6 proportional days and the September table for the next 30 days", async () => {
    mocks.findBeneficiary.mockResolvedValue({
      cpf: "52998224725",
      birthDate: new Date("1990-01-01T00:00:00.000Z"),
      inclusionDate: new Date("2022-01-22T00:00:00.000Z"),
      planCode: "HOLDER",
      hasAddon: false,
      dependents: [
        {
          id: "dependent-12345678",
          birthDate: new Date("2015-01-01T00:00:00.000Z"),
          planCode: "DEPENDENT",
          hasAddon: false,
        },
      ],
    });
    mocks.getUnimedConfiguration.mockImplementation(
      async (_tenantId: string, referenceDate: Date) => {
        const isSeptember = referenceDate.getUTCMonth() === 8;
        return {
          ageBrackets: [{ code: "ALL", minAge: 0, maxAge: null }],
          planPrices: [
            {
              planCode: "HOLDER",
              ageBracket: { code: "ALL" },
              companyAmount: new Prisma.Decimal(isSeptember ? "120.00" : "100.00"),
              employeeAmount: new Prisma.Decimal(isSeptember ? "70.00" : "60.00"),
            },
            {
              planCode: "DEPENDENT",
              ageBracket: { code: "ALL" },
              companyAmount: new Prisma.Decimal(isSeptember ? "60.00" : "50.00"),
              employeeAmount: new Prisma.Decimal(isSeptember ? "60.00" : "50.00"),
            },
          ],
          addonPrices: [],
          billing: { closure: "AUTOMATIC_DAY_25" },
          rules: null,
          email: null,
          reasons: [],
        };
      },
    );

    const response = await POST(
      calculationRequest({
        ...validInput,
        exclusionDate: "2026-08-25",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getUnimedConfiguration).toHaveBeenNthCalledWith(
      1,
      "tenant-12345678",
      new Date("2026-08-25T00:00:00.000Z"),
    );
    expect(mocks.getUnimedConfiguration).toHaveBeenNthCalledWith(
      2,
      "tenant-12345678",
      new Date("2026-09-01T00:00:00.000Z"),
    );
    await expect(response.json()).resolves.toMatchObject({
      pricingCompetencies: { current: "2026-08", next: "2026-09" },
      officialInput: {
        holder: { invoicePlanAmount: 100, payrollPlanAmount: 60 },
        dependents: [{ invoicePlanAmount: 50 }],
        nextCompetency: {
          holder: { invoicePlanAmount: 120, payrollPlanAmount: 70 },
          dependents: [{ invoicePlanAmount: 60 }],
        },
      },
      calculation: {
        currentCompetency: "2026-08",
        nextCompetency: "2026-09",
        refundDays: 6,
        nextCompetencyDays: 30,
        totalRefundDays: 36,
        currentCompetencyRefund: "29.03",
        nextCompetencyRefund: "180.00",
        invoiceRefund: "209.03",
        employeeFullRefund: "151.29",
        companyFullRefund: "57.74",
      },
    });
  });

  it("resolves payroll loans by tenant, beneficiary CPF and exclusion competence", async () => {
    mocks.findPayrollCompetence.mockResolvedValue({ competence: "2026-08" });
    mocks.findPayrollLoans.mockResolvedValue([
      {
        contractNumber: "CONTRATO-1",
        installmentAmount: new Prisma.Decimal("100.10"),
        startCompetence: "2026-08",
        endCompetence: "2027-07",
        bankCode: "001",
        bankName: "Banco Um",
      },
      {
        contractNumber: "CONTRATO-2",
        installmentAmount: new Prisma.Decimal("20.05"),
        startCompetence: "2026-08",
        endCompetence: "2026-12",
        bankCode: "341",
        bankName: "Banco Dois",
      },
    ]);

    const response = await POST(
      calculationRequest({
        ...validInput,
        beneficiaryId: "beneficiary-12345678",
        exclusionDate: "2026-08-31",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.findBeneficiary).toHaveBeenCalledWith({
      where: {
        id: "beneficiary-12345678",
        tenantId: "tenant-12345678",
        competency: {
          status: { in: ["ACTIVE", "PREVIOUS"] },
          OR: [
            { year: { lt: 2026 } },
            { year: 2026, month: { lte: 8 } },
          ],
        },
        category: "HOLDER",
      },
      select: {
        cpf: true,
        birthDate: true,
        inclusionDate: true,
        planCode: true,
        hasAddon: true,
        dependents: {
          where: { id: { in: ["dependent-12345678"] } },
          select: {
            id: true,
            birthDate: true,
            planCode: true,
            hasAddon: true,
          },
        },
      },
    });
    expect(mocks.findPayrollCompetence).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-12345678",
        cpfNormalized: "52998224725",
        competence: { lte: "2026-08" },
      },
      orderBy: { competence: "desc" },
      select: { competence: true },
    });
    expect(mocks.findPayrollLoans).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-12345678",
          cpfNormalized: "52998224725",
          competence: "2026-08",
          startCompetence: { lte: "2026-08" },
          endCompetence: { gte: "2026-08" },
        },
        orderBy: [{ bankCode: "asc" }, { contractNumber: "asc" }],
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      payrollLoans: {
        competence: "2026-08",
        totalAmount: "120.15",
        contracts: [
          {
            contractNumber: "CONTRATO-1",
            installmentAmount: "100.10",
            startCompetence: "2026-08",
            endCompetence: "2027-07",
            bankCode: "001",
            bankName: "Banco Um",
          },
          {
            contractNumber: "CONTRATO-2",
            installmentAmount: "20.05",
          },
        ],
      },
    });
  });

  it("does not borrow another employee's newer payroll competence", async () => {
    mocks.findPayrollCompetence.mockResolvedValue({ competence: "2026-07" });
    mocks.findPayrollLoans.mockResolvedValue([]);

    const response = await POST(
      calculationRequest({
        ...validInput,
        exclusionDate: "2026-08-31",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.findPayrollCompetence).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-12345678",
        cpfNormalized: "52998224725",
        competence: { lte: "2026-08" },
      },
      orderBy: { competence: "desc" },
      select: { competence: true },
    });
    expect(mocks.findPayrollLoans).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cpfNormalized: "52998224725",
          competence: "2026-07",
        }),
      }),
    );
  });

  it("does not query loans when the selected beneficiary has no CPF", async () => {
    mocks.findBeneficiary.mockResolvedValue({
      cpf: null,
      birthDate: new Date("1990-01-01T00:00:00.000Z"),
      inclusionDate: new Date("2022-01-22T00:00:00.000Z"),
      planCode: "HOLDER",
      hasAddon: true,
      dependents: [
        {
          id: "dependent-12345678",
          birthDate: new Date("2015-01-01T00:00:00.000Z"),
          planCode: "DEPENDENT",
          hasAddon: false,
        },
      ],
    });

    const response = await POST(
      calculationRequest({
        ...validInput,
        beneficiaryId: "beneficiary-without-cpf",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.findPayrollLoans).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      payrollLoans: null,
    });
  });

  it("rejects a selected beneficiary that is not a current holder", async () => {
    mocks.findBeneficiary.mockResolvedValue(null);

    const response = await POST(
      calculationRequest({
        ...validInput,
        beneficiaryId: "dependent-beneficiary",
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNIMED_BENEFICIARY_NOT_CURRENT" },
    });
    expect(mocks.findPayrollLoans).not.toHaveBeenCalled();
  });
});
