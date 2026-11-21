import { describe, expect, it, vi } from "vitest";
import { createEscalaExportCache } from "./export-cache";
import { createEscalaExportDescriptor, ESCALA_EXPORT_PROJECTION_CONTRACT_VERSION } from "./export-projection-contract";

// Only the real in-process cache is exercised. No database client or service is needed.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const metadata = () => ({
  tenantId: "tenant-a", workspaceId: "workspace-1", branchCode: "01", revision: 3,
  format: "pdf", mode: "both", projection: "BASIC_SCHEDULE", contentVersion: "synthetic-content-v1", separateSectors: false,
});
function descriptor(overrides: Record<string, unknown> = {}) {
  const result = createEscalaExportDescriptor({ ...metadata(), ...overrides });
  if (!result) throw new Error("Test fixture should produce a content descriptor");
  return result;
}

describe("Escalas candidate export projection and cache contract", () => {
  it("normalizes branch aliases without mutating canonical input", () => {
    const input = { ...metadata(), branchCode: " 0001 " };
    const before = structuredClone(input);
    const result = createEscalaExportDescriptor(input);
    expect(result).toMatchObject({ branchCode: "01", contractVersion: ESCALA_EXPORT_PROJECTION_CONTRACT_VERSION, mayIncludeAnalytics: false });
    expect(result?.cacheKey).toBe(descriptor().cacheKey);
    expect(input).toEqual(before);
  });

  it.each([
    ["rest", ["rest"]], ["hours", ["hours"]], ["both", ["rest", "hours"]],
  ])("selects only the requested %s schedule sections", (mode, sections) => {
    for (const format of ["pdf", "xlsx"]) expect(descriptor({ mode, format }).sections).toEqual(sections);
  });

  it.each(["pdf", "xlsx"])("keeps the basic %s projection free of analytical permissions", format => {
    for (const mode of ["rest", "hours", "both"]) {
      expect(descriptor({ format, mode }).mayIncludeAnalytics).toBe(false);
    }
  });

  it("allows supported administrative PDF analyses, never administrative XLSX analyses", () => {
    for (const mode of ["rest", "hours", "both"]) {
      expect(descriptor({ projection: "ADMIN_FULL", mode, format: "pdf" }).mayIncludeAnalytics).toBe(true);
      expect(descriptor({ projection: "ADMIN_FULL", mode, format: "xlsx" }).mayIncludeAnalytics).toBe(false);
    }
  });

  it("separates every content dimension and uses a new cache namespace", () => {
    const changes = [
      { tenantId: "tenant-b" }, { workspaceId: "workspace-2" }, { branchCode: "02" }, { revision: 4 },
      { mode: "hours" }, { mode: "rest" }, { format: "xlsx" }, { projection: "ADMIN_FULL" },
      { contentVersion: "synthetic-content-v2" },
    ];
    const keys = [descriptor().cacheKey, ...changes.map(change => descriptor(change).cacheKey)];
    expect(new Set(keys).size).toBe(keys.length);
    const oldKey = JSON.stringify([metadata().contentVersion, "tenant-a", "workspace-1", 3, "both", "pdf", false]);
    expect(keys).not.toContain(oldKey);
    expect(JSON.parse(keys[0]).slice(0, 2)).toEqual(["escala-export-scoped", ESCALA_EXPORT_PROJECTION_CONTRACT_VERSION]);
  });

  it("does not collide when identifiers contain delimiter characters", () => {
    expect(descriptor({ tenantId: "a:b", workspaceId: "c" }).cacheKey)
      .not.toBe(descriptor({ tenantId: "a", workspaceId: "b:c" }).cacheKey);
  });

  it("rejects missing metadata rather than inventing a tenant, revision or profile", () => {
    for (const field of Object.keys(metadata()) as (keyof ReturnType<typeof metadata>)[]) {
      const { [field]: _omitted, ...incomplete } = metadata();
      expect(createEscalaExportDescriptor(incomplete)).toBeNull();
    }
    for (const input of [null, undefined, [], true, "admin"]) expect(createEscalaExportDescriptor(input)).toBeNull();
  });

  it("rejects unknown format, mode, projection and options outside the versioned identity", () => {
    for (const value of ["unknown", "", null, true, {}, []]) {
      for (const field of ["format", "mode", "projection"]) expect(createEscalaExportDescriptor({ ...metadata(), [field]: value })).toBeNull();
    }
    for (const field of ["profile", "role", "contractVersion", "includeAnalytics", "employeeIds", "filters"]) {
      expect(createEscalaExportDescriptor({ ...metadata(), [field]: "unclassified-option" })).toBeNull();
    }
    expect(createEscalaExportDescriptor({ ...metadata(), format: "txt" })).toBeNull();
  });

  it("keeps sector sections disabled explicitly for every format and projection", () => {
    for (const format of ["pdf", "xlsx"]) for (const projection of ["BASIC_SCHEDULE", "ADMIN_FULL"]) {
      expect(descriptor({ format, projection }).separateSectors).toBe(false);
      for (const separateSectors of [true, "false", "true", 0, null]) {
        expect(createEscalaExportDescriptor({ ...metadata(), format, projection, separateSectors })).toBeNull();
      }
    }
  });

  it("accepts only supported saved revisions without coercion", () => {
    expect(descriptor({ revision: 2_000_000_000 }).revision).toBe(2_000_000_000);
    for (const revision of [0, -1, 1.1, 2_000_000_001, "3", true, null, Infinity, Number.NaN]) {
      expect(createEscalaExportDescriptor({ ...metadata(), revision })).toBeNull();
    }
  });

  it("bounds identifiers and rejects empty, invisible or invalid branch/version metadata", () => {
    for (const field of ["tenantId", "workspaceId"]) {
      for (const value of ["", " value ", "x".repeat(101), 1, "tenant\n", "tenant/other"]) {
        expect(createEscalaExportDescriptor({ ...metadata(), [field]: value })).toBeNull();
      }
    }
    for (const field of ["branchCode", "contentVersion"]) {
      for (const value of ["", " ", null, 1, "a\n", "a\u200b", "a\u034f", "a\ud800"]) {
        expect(createEscalaExportDescriptor({ ...metadata(), [field]: value })).toBeNull();
      }
    }
    for (const branchCode of ["x".repeat(161), " ".repeat(641)]) expect(createEscalaExportDescriptor({ ...metadata(), branchCode })).toBeNull();
    for (const contentVersion of ["x".repeat(129), " version "]) expect(createEscalaExportDescriptor({ ...metadata(), contentVersion })).toBeNull();
  });

  it("prevents changes to rendering policy after constructing its cache identity", () => {
    const result = descriptor();
    const originalKey = result.cacheKey;
    expect(Reflect.set(result, "projection", "ADMIN_FULL")).toBe(false);
    expect(Reflect.set(result, "mayIncludeAnalytics", true)).toBe(false);
    expect(Reflect.set(result.sections, 0, "analytics")).toBe(false);
    expect(result.projection).toBe("BASIC_SCHEDULE");
    expect(result.cacheKey).toBe(originalKey);
    expect(result.sections).toEqual(["rest", "hours"]);
  });
});

describe("existing export cache with candidate projection identities", () => {
  it.each(["ADMIN_FULL", "BASIC_SCHEDULE"])("keeps saved %s bytes separate from the other projection", async firstProjection => {
    const secondProjection = firstProjection === "ADMIN_FULL" ? "BASIC_SCHEDULE" : "ADMIN_FULL";
    const cache = createEscalaExportCache();
    const first = descriptor({ projection: firstProjection });
    const second = descriptor({ projection: secondProjection });
    const buildFirst = vi.fn(() => new Uint8Array([1]));
    const buildSecond = vi.fn(() => new Uint8Array([2]));
    expect(await cache.get(first.cacheKey, buildFirst)).toEqual(new Uint8Array([1]));
    expect(await cache.get(second.cacheKey, buildSecond)).toEqual(new Uint8Array([2]));
    expect(await cache.get(first.cacheKey, buildFirst)).toEqual(new Uint8Array([1]));
    expect(await cache.get(second.cacheKey, buildSecond)).toEqual(new Uint8Array([2]));
    expect(buildFirst).toHaveBeenCalledTimes(1);
    expect(buildSecond).toHaveBeenCalledTimes(1);
  });

  it("coalesces the same projection while keeping simultaneous admin/basic generation separate", async () => {
    const cache = createEscalaExportCache({ concurrency: 2 });
    let finishAdmin!: (value: Uint8Array) => void;
    const adminBuild = vi.fn(() => new Promise<Uint8Array>(resolve => { finishAdmin = resolve; }));
    const basicBuild = vi.fn(() => new Uint8Array([8]));
    const adminKey = descriptor({ projection: "ADMIN_FULL" }).cacheKey;
    const basicKey = descriptor().cacheKey;
    const admin1 = cache.get(adminKey, adminBuild);
    const admin2 = cache.get(adminKey, adminBuild);
    const basic = cache.get(basicKey, basicBuild);
    expect(await basic).toEqual(new Uint8Array([8]));
    finishAdmin(new Uint8Array([9]));
    expect(await admin1).toEqual(new Uint8Array([9]));
    expect(await admin2).toEqual(new Uint8Array([9]));
    expect(adminBuild).toHaveBeenCalledTimes(1);
    expect(basicBuild).toHaveBeenCalledTimes(1);
  });
});
