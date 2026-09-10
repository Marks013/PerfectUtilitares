import { afterAll, beforeAll, expect, test, vi } from "vitest";

const access = vi.hoisted(() => ({ tenantId: "" }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/unimed/access.server", () => ({
  requireUnimedAccess: async () => ({ ok: true, tenantId: access.tenantId }),
}));

import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/unimed/calculation/route";
import {
  updateUserWithAdminInvariant,
  deleteAccountWithAdminInvariant,
} from "@/lib/users/account-mutations";

let holderId: string;
let dependentIds: string[];
let foreignHolderId: string;
let originalPost: typeof POST | undefined;
const date = (value: string) => new Date(value + "T00:00:00.000Z");

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.pathname !== "/perfect_audit")
    throw new Error("Disposable database required");
  if (process.env.VERIFY_UNIMED_BASELINE === "1") {
    const baseline = "./unimed-before.ts";
    originalPost = (await import(baseline)).POST;
  }
  const tenant = await prisma.tenant.create({
    data: { name: "Architecture", slug: "architecture-unimed" },
  });
  access.tenantId = tenant.id;
  const tenantId = tenant.id;
  const competency = await prisma.unimedCompetency.create({
    data: { tenantId, year: 2026, month: 9, status: "ACTIVE" },
  });
  await prisma.unimedExclusionReason.createMany({
    data: [1, 8].map((code) => ({
      tenantId,
      code,
      label: "Synthetic",
      documentKind: "INACTIVE_TERM" as const,
    })),
  });
  const bracket = await prisma.unimedAgeBracket.create({
    data: { tenantId, code: "ALL", label: "All", minAge: 0, sortOrder: 1 },
  });
  await prisma.unimedPlanPriceVersion.createMany({
    data: [
      {
        tenantId,
        ageBracketId: bracket.id,
        planCode: "A",
        companyAmount: "200.00",
        employeeAmount: "150.00",
        validFrom: date("2026-09-01"),
        validTo: date("2026-09-30"),
      },
      {
        tenantId,
        ageBracketId: bracket.id,
        planCode: "A",
        companyAmount: "300.00",
        employeeAmount: "220.00",
        validFrom: date("2026-10-01"),
      },
    ],
  });
  await prisma.unimedBillingSetting.create({
    data: {
      tenantId,
      closure: "AUTOMATIC_DAY_25",
      closingDay: 25,
      validFrom: date("2026-09-01"),
    },
  });
  const holder = await prisma.unimedBeneficiary.create({
    data: {
      tenantId,
      competencyId: competency.id,
      sourceKey: "holder",
      fullName: "Synthetic Holder",
      cpf: "000.000.000-00",
      birthDate: date("1990-01-01"),
      inclusionDate: date("2020-01-01"),
      category: "HOLDER",
      planCode: "A",
    },
  });
  holderId = holder.id;
  dependentIds = [];
  for (const [index, sourceKey] of ["z-dependent", "a-dependent"].entries()) {
    const dependent = await prisma.unimedBeneficiary.create({
      data: {
        tenantId,
        competencyId: competency.id,
        holderId,
        sourceKey,
        fullName: "Synthetic Dependent",
        birthDate: date("2010-01-01"),
        inclusionDate: date(index ? "2026-09-10" : "2020-01-01"),
        category: "DEPENDENT",
        planCode: "A",
      },
    });
    dependentIds.push(dependent.id);
  }
  const foreignTenant = await prisma.tenant.create({
    data: { name: "Other", slug: "architecture-other" },
  });
  const foreignCompetency = await prisma.unimedCompetency.create({
    data: {
      tenantId: foreignTenant.id,
      year: 2026,
      month: 9,
      status: "ACTIVE",
    },
  });
  foreignHolderId = (
    await prisma.unimedBeneficiary.create({
      data: {
        tenantId: foreignTenant.id,
        competencyId: foreignCompetency.id,
        sourceKey: "foreign",
        fullName: "Foreign Holder",
        category: "HOLDER",
      },
    })
  ).id;
  await prisma.unimedPayrollLoan.createMany({
    data: [
      {
        tenantId,
        competencyId: competency.id,
        sourceKey: "loan-a",
        sourceRow: 1,
        competence: "2026-09",
        cpfNormalized: "00000000000",
        employeeName: "Synthetic",
        contractNumber: "A",
        installmentAmount: "12.34",
        startCompetence: "2026-01",
        endCompetence: "2026-12",
        bankCode: "001",
        bankName: "Synthetic",
      },
      {
        tenantId,
        competencyId: competency.id,
        sourceKey: "loan-b",
        sourceRow: 2,
        competence: "2026-09",
        cpfNormalized: "00000000000",
        employeeName: "Synthetic",
        contractNumber: "B",
        installmentAmount: "0.01",
        startCompetence: "2026-01",
        endCompetence: "2026-12",
        bankCode: "001",
        bankName: "Synthetic",
      },
      {
        tenantId,
        competencyId: competency.id,
        sourceKey: "loan-ended",
        sourceRow: 3,
        competence: "2026-09",
        cpfNormalized: "00000000000",
        employeeName: "Synthetic",
        contractNumber: "ENDED",
        installmentAmount: "999.99",
        startCompetence: "2026-01",
        endCompetence: "2026-08",
        bankCode: "001",
        bankName: "Synthetic",
      },
    ],
  });
});
afterAll(async () => {
  await prisma.$disconnect();
});

function input(overrides: Record<string, unknown> = {}) {
  return {
    beneficiaryId: holderId,
    dependentIds,
    reasonCode: 8,
    exclusionDate: "2026-09-24",
    billingClosure: "AUTOMATIC_DAY_25",
    ...overrides,
  };
}
function request(body: unknown) {
  return new Request("https://audit.invalid/api/unimed/calculation", {
    method: "POST",
    headers: {
      origin: "https://audit.invalid",
      "content-type": "application/json",
      "x-real-ip": "192.0.2.80",
    },
    body: JSON.stringify(body),
  });
}
async function calculate(body: unknown) {
  const response = await POST(request(body));
  const data = await response.json();
  if (originalPost) {
    const original = await originalPost(request(body));
    expect(response.status).toBe(original.status);
    expect(response.headers.get("Cache-Control")).toBe(
      original.headers.get("Cache-Control"),
    );
    expect(data).toEqual(await original.json());
  }
  return { response, data };
}

test("real route preserves official prices, dependent order, prorata and exact loan sum before cutoff", async () => {
  const { response, data } = await calculate(input());
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(data.officialInput.holder).toEqual({
    invoicePlanAmount: 200,
    payrollPlanAmount: 150,
    addonAmount: 0,
  });
  expect(
    data.officialInput.dependents.map((d: { clientId: string }) => d.clientId),
  ).toEqual(dependentIds);
  expect(data.calculation).toMatchObject({
    invoiceTotal: "600.00",
    usedProrata: "420.00",
    cutoffApplied: false,
  });
  expect(data.pricingCompetencies).toEqual({ current: "2026-09", next: null });
  expect(data.payrollLoans.totalAmount).toBe("12.35");
  expect(
    data.payrollLoans.contracts.map(
      (c: { contractNumber: string }) => c.contractNumber,
    ),
  ).toEqual(["A", "B"]);
});

test("day 25 uses the following month's price versions", async () => {
  const { response, data } = await calculate(
    input({ exclusionDate: "2026-09-25" }),
  );
  expect(response.status).toBe(200);
  expect(data.calculation.cutoffApplied).toBe(true);
  expect(data.officialInput.nextCompetency.holder.invoicePlanAmount).toBe(300);
  expect(
    data.officialInput.nextCompetency.dependents.map(
      (d: { invoicePlanAmount: number }) => d.invoicePlanAmount,
    ),
  ).toEqual([300, 300]);
  expect(data.pricingCompetencies).toEqual({
    current: "2026-09",
    next: "2026-10",
  });
});

test("open billing on day 25 does not add the following competence", async () => {
  const { response, data } = await calculate(
    input({ exclusionDate: "2026-09-25", billingClosure: "OPEN" }),
  );
  expect(response.status).toBe(200);
  expect(data.officialInput.nextCompetency).toBeUndefined();
});

test("manual dependent inherits plan and preserves its own inclusion date", async () => {
  const { response, data } = await calculate(
    input({
      dependentIds: [],
      reasonCode: 1,
      manualDependents: [
        {
          clientId: "manual-0001",
          fullName: "Synthetic Manual",
          birthDate: "2015-01-01",
          inclusionDate: "2026-09-20",
        },
      ],
    }),
  );
  expect(response.status).toBe(200);
  expect(data.officialInput.dependents).toEqual([
    {
      clientId: "manual-0001",
      invoicePlanAmount: 200,
      addonAmount: 0,
      planEnrollmentDate: "2026-09-20",
    },
  ]);
  expect(data.calculation).toMatchObject({
    invoiceTotal: "200.00",
    usedProrata: "33.33",
  });
});

test("tenant boundary rejects a real holder from another tenant", async () => {
  const { response, data } = await calculate(
    input({ beneficiaryId: foreignHolderId, dependentIds: [] }),
  );
  expect(response.status).toBe(422);
  expect(data.error.code).toBe("UNIMED_BENEFICIARY_NOT_CURRENT");
});

test("unlinked dependents and missing reasons retain domain errors", async () => {
  for (const [body, code] of [
    [input({ dependentIds: [foreignHolderId] }), "UNIMED_DEPENDENT_NOT_LINKED"],
    [input({ reasonCode: 9999 }), "UNIMED_REASON_NOT_FOUND"],
  ] as const) {
    const { response, data } = await calculate(body);
    expect(response.status).toBe(422);
    expect(data.error.code).toBe(code);
  }
});

test("duplicate IDs and future manual inclusion remain invalid input", async () => {
  for (const body of [
    input({ dependentIds: [dependentIds[0], dependentIds[0]] }),
    input({
      manualDependents: [
        {
          clientId: "manual-0001",
          fullName: "Synthetic Manual",
          birthDate: "2015-01-01",
          inclusionDate: "2026-10-01",
        },
      ],
    }),
  ]) {
    const { response, data } = await calculate(body);
    expect(response.status).toBe(400);
    expect(data.error.code).toBe("UNIMED_CALCULATION_INVALID");
  }
});

test("real concurrent admin mutations preserve the last active admin", async () => {
  const admins = await Promise.all(
    ["first", "second"].map((name) =>
      prisma.user.create({
        data: {
          tenantId: access.tenantId,
          name,
          email: name + "@architecture.invalid",
          passwordHash: "unusable-synthetic-hash",
          role: "ADMIN",
          status: "ACTIVE",
        },
      }),
    ),
  );
  const results = await Promise.all(
    admins.map((admin) =>
      updateUserWithAdminInvariant({
        targetUserId: admin.id,
        actorUserId: admins[0].id,
        data: { status: "BLOCKED" },
      }),
    ),
  );
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toEqual([
    { ok: false, reason: "LAST_ACTIVE_ADMIN" },
  ]);
  const remaining = await prisma.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
  });
  expect(remaining).toHaveLength(1);
  expect(
    await deleteAccountWithAdminInvariant({
      targetUserId: remaining[0].id,
      actorUserId: remaining[0].id,
      action: "SELF_DELETE",
    }),
  ).toEqual({ ok: false, reason: "LAST_ACTIVE_ADMIN" });
});
