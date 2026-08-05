import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/unimed-route-rate-limit.mock";

const mocks = vi.hoisted(() => ({
  findCompetency: vi.fn(),
  findMany: vi.fn(),
  getUnimedConfiguration: vi.fn(),
  requireUnimedAccess: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unimedCompetency: {
      findFirst: mocks.findCompetency,
    },
    unimedBeneficiary: {
      findMany: mocks.findMany,
    },
  },
}));

vi.mock("@/lib/unimed/access.server", () => ({
  requireUnimedAccess: mocks.requireUnimedAccess,
}));

vi.mock("@/lib/unimed/configuration", () => ({
  getUnimedConfiguration: mocks.getUnimedConfiguration,
}));

import { GET, POST } from "@/app/api/unimed/beneficiaries/route";

let requestSequence = 1;

function searchRequest(query: string, referenceDate?: string) {
  const dateQuery = referenceDate
    ? `&referenceDate=${encodeURIComponent(referenceDate)}`
    : "";
  return new Request(
    `http://localhost/api/unimed/beneficiaries?q=${encodeURIComponent(query)}${dateQuery}`,
    {
      headers: {
        "x-forwarded-for": `127.3.0.${requestSequence++}`,
      },
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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
  mocks.findCompetency.mockResolvedValue({
    id: "competency-2026-07",
    year: 2026,
    month: 7,
  });
  mocks.findMany.mockResolvedValue([]);
  mocks.getUnimedConfiguration.mockResolvedValue({
    ageBrackets: [],
    planPrices: [],
    addonPrices: [],
    billing: null,
    rules: null,
    email: null,
    reasons: [],
  });
});

describe("Unimed beneficiary search API", () => {
  it("accepts only GET", () => {
    const response = POST();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });

  it("requires VIEW permission before querying personal data", async () => {
    mocks.requireUnimedAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: { code: "UNIMED_ACCESS_DENIED" } },
        { status: 403 },
      ),
    });

    const response = await GET(searchRequest("Maria"));

    expect(response.status).toBe(403);
    expect(mocks.requireUnimedAccess).toHaveBeenCalledWith("VIEW");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("rejects search terms outside the 2 to 100 character limit", async () => {
    const tooShort = await GET(searchRequest("a"));
    const tooLong = await GET(searchRequest("a".repeat(101)));

    expect(tooShort.status).toBe(400);
    expect(tooLong.status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid pricing reference date", async () => {
    const response = await GET(searchRequest("Maria", "2026-02-30"));

    expect(response.status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.getUnimedConfiguration).not.toHaveBeenCalled();
  });

  it("uses the latest valid competency at or before the reference date", async () => {
    const response = await GET(searchRequest("  Maria Silva  ", "2026-08-04"));

    expect(response.status).toBe(200);
    expect(mocks.findCompetency).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-12345678",
        status: { in: ["ACTIVE", "PREVIOUS"] },
        beneficiaries: { some: {} },
        OR: [{ year: { lt: 2026 } }, { year: 2026, month: { lte: 8 } }],
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { id: true, year: true, month: true },
    });
    expect(mocks.findMany).toHaveBeenCalledOnce();
    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      tenantId: "tenant-12345678",
      competencyId: "competency-2026-07",
      category: "HOLDER",
      OR: [
        {
          fullName: {
            contains: "Maria Silva",
            mode: "insensitive",
          },
        },
        {
          dependents: {
            some: {
              fullName: {
                contains: "Maria Silva",
                mode: "insensitive",
              },
            },
          },
        },
      ],
    });
    expect(query.orderBy).toEqual({ fullName: "asc" });
    expect(query.take).toBe(20);
  });

  it("uses exact registration for short numeric terms", async () => {
    const response = await GET(searchRequest("4689"));

    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      tenantId: "tenant-12345678",
      competencyId: "competency-2026-07",
      category: "HOLDER",
      registration: "4689",
      address: { isNot: null },
    });
    expect(query.where).not.toHaveProperty("cpf");
    expect(query.where).not.toHaveProperty("fullName");
    expect((await response.json()).searchMode).toBe("REGISTRATION");
  });

  it("uses exact normalized CPF only when 11 digits are informed", async () => {
    const response = await GET(searchRequest("529.982.247-25"));

    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      tenantId: "tenant-12345678",
      competencyId: "competency-2026-07",
      category: "HOLDER",
      OR: [
        { cpf: "52998224725" },
        { dependents: { some: { cpf: "52998224725" } } },
      ],
    });
    expect(query.where).not.toHaveProperty("registration");
    expect(query.where).not.toHaveProperty("fullName");
    expect((await response.json()).searchMode).toBe("CPF");
  });

  it("does not use a numeric term as partial CPF", async () => {
    await GET(searchRequest("101"));

    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where).toEqual({
      tenantId: "tenant-12345678",
      competencyId: "competency-2026-07",
      category: "HOLDER",
      registration: "101",
      address: { isNot: null },
    });
  });

  it("returns selected data with monetary values serialized to cents", async () => {
    mocks.getUnimedConfiguration.mockResolvedValue({
      ageBrackets: [{ code: "24+", minAge: 24, maxAge: null }],
      planPrices: [
        {
          planCode: "1013",
          ageBracket: { code: "24+" },
          companyAmount: { toFixed: () => "350.00" },
          employeeAmount: { toFixed: () => "122.50" },
        },
      ],
      addonPrices: [
        {
          code: "STANDARD",
          label: "Funeral",
          amount: { toFixed: () => "4.25" },
        },
      ],
      billing: { closure: "AUTOMATIC_DAY_25" },
      rules: null,
      email: null,
      reasons: [],
    });
    mocks.findMany.mockResolvedValue([
      {
        id: "beneficiary-1",
        sourceKey: "source-1",
        registration: "100",
        fullName: "Maria Silva",
        cpf: "12345678900",
        birthDate: new Date("1990-01-01T00:00:00.000Z"),
        inclusionDate: new Date("2020-01-01T00:00:00.000Z"),
        category: "HOLDER",
        relationship: null,
        planCode: "1013",
        planName: "Plano",
        accommodation: "ENFERMARIA",
        hasAddon: false,
        branch: { code: "MATRIZ", name: "Matriz" },
        holder: null,
        dependents: [],
        address: null,
        tenantId: "must-not-be-selected",
        competencyId: "must-not-be-selected",
      },
    ]);

    const response = await GET(searchRequest("Maria", "2026-07-01"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.beneficiaries[0]).not.toHaveProperty("invoiceItems");
    expect(body.beneficiaries[0].pricing).toMatchObject({
      status: "RESOLVED",
      companyAmount: "350.00",
      employeeAmount: "122.50",
    });
    expect(body.pricingContext).toEqual({
      referenceDate: "2026-07-01",
      dataCompetency: { year: 2026, month: 7 },
      billingClosure: "AUTOMATIC_DAY_25",
      addonPrices: [{ code: "STANDARD", label: "Funeral", amount: "4.25" }],
    });
    expect(mocks.findMany.mock.calls[0][0].select).not.toHaveProperty(
      "tenantId",
    );
    expect(mocks.findMany.mock.calls[0][0].select).not.toHaveProperty(
      "competencyId",
    );
  });
});
