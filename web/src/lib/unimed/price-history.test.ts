import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PriceRow = {
  validFrom: string;
  validTo: string;
  employeeAmount: number;
  bracketCode: string;
  companyAmount: number;
};

const sql = readFileSync(
  new URL(
    "../../../scripts/unimed/seed-price-history-2024-2027.sql",
    import.meta.url,
  ),
  "utf8",
);

const rows = Array.from(
  sql.matchAll(
    /\(DATE '(\d{4}-\d{2}-\d{2})', DATE '(\d{4}-\d{2}-\d{2})', ([\d.]+), '([^']+)', ([\d.]+)\)/g,
  ),
  (match): PriceRow => ({
    validFrom: match[1],
    validTo: match[2],
    employeeAmount: Number(match[3]),
    bracketCode: match[4],
    companyAmount: Number(match[5]),
  }),
);

describe("Unimed price history seed", () => {
  it("maps both imported Unimed plan codes", () => {
    expect(sql).toContain("('1013')");
    expect(sql).toContain("('10041')");
    expect(sql).not.toContain("('PERSONAL PLUS ENFERMARIA PARTICIPATIVO CE')");
  });

  it("contains the exact 2024-2025 reference table", () => {
    const period = rows.filter((row) => row.validFrom === "2024-07-01");

    expect(period).toHaveLength(10);
    expect(period.map((row) => row.companyAmount)).toEqual([
      102.67, 125.03, 156.59, 180.24, 213.39, 238.81, 274.89, 339.46, 431.18,
      612.96,
    ]);
    expect(new Set(period.map((row) => row.employeeAmount))).toEqual(
      new Set([54.21]),
    );
    expect(period.every((row) => row.validTo === "2025-07-31")).toBe(true);
    expect(sql).toContain(
      ":'tenant_id', 'FUNERAL', 'Aditivo funeral', 5.42, DATE '2024-07-01', DATE '2025-07-31'",
    );
  });

  it("contains the exact 2026-2027 reference table and 13 percent rule", () => {
    const period = rows.filter((row) => row.validFrom === "2026-08-01");

    expect(period).toHaveLength(10);
    expect(period.map((row) => row.companyAmount)).toEqual([
      116.02, 141.29, 176.95, 203.71, 241.17, 269.89, 310.67, 383.65, 487.31,
      692.76,
    ]);
    expect(new Set(period.map((row) => row.employeeAmount))).toEqual(
      new Set([61.26]),
    );
    expect(period.every((row) => row.validTo === "2027-07-31")).toBe(true);
    expect(sql).toContain(
      ":'tenant_id', 'FUNERAL', 'Aditivo funeral', 6.12, DATE '2026-08-01', DATE '2027-07-31'",
    );
    expect(sql).toContain(
      ":'tenant_id', 0.1300, 0.0000, DATE '2026-08-01', DATE '2027-07-31'",
    );
  });

  it("defines automatic day-25 billing closure for both price periods", () => {
    expect(sql).toContain(
      ":'tenant_id', 'AUTOMATIC_DAY_25', 25, DATE '2024-07-01', DATE '2025-07-31'",
    );
    expect(sql).toContain(
      ":'tenant_id', 'AUTOMATIC_DAY_25', 25, DATE '2026-08-01', DATE '2027-07-31'",
    );
    expect(sql).toContain(
      'ON CONFLICT ("tenantId", "validFrom") DO UPDATE SET',
    );
  });

  it("has one non-overlapping row per age bracket in each period", () => {
    const expectedCodes = [
      "00-18",
      "19-23",
      "24-28",
      "29-33",
      "34-38",
      "39-43",
      "44-48",
      "49-53",
      "54-58",
      "59+",
    ];

    for (const validFrom of ["2024-07-01", "2026-08-01"]) {
      expect(
        rows
          .filter((row) => row.validFrom === validFrom)
          .map((row) => row.bracketCode),
      ).toEqual(expectedCodes);
    }
  });
});
