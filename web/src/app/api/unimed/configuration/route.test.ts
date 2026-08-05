import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/unimed-route-rate-limit.mock";

const mocks = vi.hoisted(() => ({
  getUnimedConfiguration: vi.fn(),
  requireUnimedAccess: vi.fn(),
  saveUnimedConfiguration: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/unimed/access.server", () => ({
  requireUnimedAccess: mocks.requireUnimedAccess,
}));

vi.mock("@/lib/unimed/configuration", () => ({
  getUnimedConfiguration: mocks.getUnimedConfiguration,
  saveUnimedConfiguration: mocks.saveUnimedConfiguration,
}));

import { GET, POST, PUT } from "@/app/api/unimed/configuration/route";

const validConfiguration = {
  validFrom: "2026-08-01",
  billingClosure: "AUTOMATIC_DAY_25",
  annualAdjustmentPercent: 13,
  differencePercent: 1,
  ageBrackets: [
    {
      code: "00-18",
      label: "0 a 18",
      minAge: 0,
      maxAge: 18,
      sortOrder: 1,
    },
  ],
  planPrices: [
    {
      planCode: "1013",
      ageBracketCode: "00-18",
      companyAmount: 116.02,
      employeeAmount: 40,
    },
  ],
  addonPrices: [
    {
      code: "AEROMEDICO",
      label: "Aeromédico",
      amount: 12.5,
    },
  ],
  email: {
    enabled: true,
    recipients: ["unimed@example.com"],
    subjectTemplate: "Solicitação de Coparticipação",
  },
};

let requestSequence = 1;

function putRequest(
  body: unknown,
  options: {
    contentLength?: string;
    contentType?: string;
    origin?: string;
  } = {},
) {
  const payload = JSON.stringify(body);
  const headers = new Headers({
    "content-type": options.contentType ?? "application/json",
    origin: options.origin ?? "http://localhost",
    "x-forwarded-for": `127.1.0.${requestSequence++}`,
  });
  if (options.contentLength) {
    headers.set("content-length", options.contentLength);
  }

  return new Request("http://localhost/api/unimed/configuration", {
    method: "PUT",
    headers,
    body: payload,
  });
}

function accessOk() {
  return {
    ok: true,
    moduleSessionId: "module-session-1",
    tenantId: "tenant-12345678",
    accessLevel: "MANAGER",
  };
}

function decimal(value: number) {
  return {
    toFixed: (digits: number) => value.toFixed(digits),
    toNumber: () => value,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUnimedAccess.mockResolvedValue(accessOk());
  mocks.saveUnimedConfiguration.mockResolvedValue({
    validFrom: "2026-08-01",
    ageBrackets: 1,
    planPrices: 1,
    addonPrices: 1,
  });
  mocks.getUnimedConfiguration.mockResolvedValue({
    ageBrackets: [
      {
        id: "bracket-1",
        tenantId: "tenant-12345678",
        code: "00-18",
        label: "0 a 18",
        minAge: 0,
        maxAge: 18,
        sortOrder: 1,
        active: true,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
    planPrices: [
      {
        id: "price-1",
        tenantId: "tenant-12345678",
        planCode: "1013",
        companyAmount: decimal(116.02),
        employeeAmount: decimal(40),
        validFrom: new Date("2026-08-01T00:00:00.000Z"),
        validTo: null,
        ageBracket: { code: "00-18" },
        internalSecret: "do-not-return",
      },
    ],
    addonPrices: [
      {
        id: "addon-1",
        tenantId: "tenant-12345678",
        code: "AEROMEDICO",
        label: "Aeromédico",
        amount: decimal(12.5),
        validFrom: new Date("2026-08-01T00:00:00.000Z"),
        validTo: null,
      },
    ],
    billing: {
      tenantId: "tenant-12345678",
      closure: "AUTOMATIC_DAY_25",
      closingDay: 25,
      validFrom: new Date("2026-08-01T00:00:00.000Z"),
      validTo: null,
    },
    rules: {
      tenantId: "tenant-12345678",
      annualAdjustment: decimal(0.13),
      difference: decimal(0.01),
      validFrom: new Date("2026-08-01T00:00:00.000Z"),
      validTo: null,
    },
    email: {
      id: "email-1",
      tenantId: "tenant-12345678",
      enabled: true,
      recipients: ["unimed@example.com"],
      subjectTemplate: "Solicitação de Coparticipação",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    },
    reasons: [
      {
        id: "reason-1",
        tenantId: "tenant-12345678",
        code: 1,
        label: "Exclusão de dependente",
        documentKind: "RN561",
        active: true,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
  });
});

describe("Unimed configuration API", () => {
  it("rejects unsupported POST requests", () => {
    const response = POST();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, PUT");
  });

  it("requires VIEW permission before reading configuration", async () => {
    mocks.requireUnimedAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: { code: "UNIMED_ACCESS_DENIED" } },
        { status: 403 },
      ),
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.requireUnimedAccess).toHaveBeenCalledWith("VIEW");
    expect(mocks.getUnimedConfiguration).not.toHaveBeenCalled();
  });

  it("serializes configuration without tenant or persistence metadata", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getUnimedConfiguration).toHaveBeenCalledWith(
      "tenant-12345678",
    );
    expect(body).toMatchObject({
      ageBrackets: [
        {
          code: "00-18",
          label: "0 a 18",
          minAge: 0,
          maxAge: 18,
          sortOrder: 1,
        },
      ],
      planPrices: [
        {
          companyAmount: "116.02",
          employeeAmount: "40.00",
          validFrom: "2026-08-01",
        },
      ],
      rules: {
        annualAdjustmentPercent: 13,
        differencePercent: 1,
      },
      email: {
        enabled: true,
        recipients: ["unimed@example.com"],
        subjectTemplate: "Solicitação de Coparticipação",
      },
      reasons: [
        {
          code: 1,
          label: "Exclusão de dependente",
          documentKind: "RN561",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("tenant-12345678");
    expect(JSON.stringify(body)).not.toContain("internalSecret");
    expect(body.ageBrackets[0]).not.toHaveProperty("createdAt");
    expect(body.email).not.toHaveProperty("updatedAt");
  });

  it("checks same-origin before MANAGE_CONFIG permission", async () => {
    const response = await PUT(
      putRequest(validConfiguration, {
        origin: "https://attacker.test",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireUnimedAccess).not.toHaveBeenCalled();
    expect(mocks.saveUnimedConfiguration).not.toHaveBeenCalled();
  });

  it("requires MANAGE_CONFIG permission for updates", async () => {
    mocks.requireUnimedAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: { code: "UNIMED_FORBIDDEN" } },
        { status: 403 },
      ),
    });

    const response = await PUT(putRequest(validConfiguration));

    expect(response.status).toBe(403);
    expect(mocks.requireUnimedAccess).toHaveBeenCalledWith("MANAGE_CONFIG");
    expect(mocks.saveUnimedConfiguration).not.toHaveBeenCalled();
  });

  it("enforces JSON content type and the 128KB body limit", async () => {
    const wrongType = await PUT(
      putRequest(validConfiguration, { contentType: "text/plain" }),
    );
    const oversized = await PUT(
      putRequest(validConfiguration, {
        contentLength: String(128 * 1024 + 1),
      }),
    );

    expect(wrongType.status).toBe(415);
    expect(oversized.status).toBe(413);
    expect(mocks.saveUnimedConfiguration).not.toHaveBeenCalled();
  });

  it("rejects invalid ranges before saving", async () => {
    const response = await PUT(
      putRequest({
        ...validConfiguration,
        ageBrackets: [
          {
            ...validConfiguration.ageBrackets[0],
            minAge: 19,
            maxAge: 18,
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "UNIMED_CONFIGURATION_INVALID",
        details: [
          {
            path: "ageBrackets.0.maxAge",
          },
        ],
      },
    });
    expect(mocks.saveUnimedConfiguration).not.toHaveBeenCalled();
  });

  it("saves normalized configuration inside the session tenant", async () => {
    const response = await PUT(
      putRequest({
        ...validConfiguration,
        planPrices: [
          {
            ...validConfiguration.planPrices[0],
            companyAmount: 116.017,
          },
        ],
        email: {
          ...validConfiguration.email,
          recipients: [" Unimed@Example.COM "],
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.saveUnimedConfiguration).toHaveBeenCalledWith(
      "tenant-12345678",
      { moduleSessionId: "module-session-1" },
      expect.objectContaining({
        planPrices: [expect.objectContaining({ companyAmount: 116.02 })],
        email: expect.objectContaining({
          recipients: ["unimed@example.com"],
        }),
      }),
    );
  });

  it("returns a generic error when persistence fails", async () => {
    mocks.saveUnimedConfiguration.mockRejectedValue(
      new Error("tenant-12345678 database password secret"),
    );

    const response = await PUT(putRequest(validConfiguration));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).toContain("UNIMED_CONFIGURATION_FAILED");
    expect(text).not.toContain("tenant-12345678");
    expect(text).not.toContain("password");
  });
});
