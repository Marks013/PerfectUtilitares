import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertResourceCapacity: vi.fn(),
  jsonError: vi.fn(
    (status: number, code: string, message: string) =>
      Response.json({ error: { code, message } }, { status }),
  ),
}));

vi.mock("@/lib/system/resource-capacity", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/system/resource-capacity")>();
  return {
    ...original,
    assertResourceCapacity: mocks.assertResourceCapacity,
  };
});

vi.mock("@/lib/api/security", () => ({
  jsonError: mocks.jsonError,
}));

import {
  requireResourceCapacity,
  resourceCapacityErrorResponse,
} from "./resource-capacity";
import { ResourceCapacityError } from "@/lib/system/resource-capacity";

describe("API resource capacity boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows requests when system capacity is available", async () => {
    await expect(
      requireResourceCapacity({ inputBytes: 1024, multiplier: 2 }),
    ).resolves.toBeNull();
  });

  it("maps queue saturation to 503 and storage pressure to 507", async () => {
    const queueError = new ResourceCapacityError(
      "PDF_QUEUE_CAPACITY_REACHED",
      "Fila indisponivel",
    );
    const storageError = new ResourceCapacityError(
      "STORAGE_CAPACITY_LOW",
      "Armazenamento indisponivel",
    );

    expect(resourceCapacityErrorResponse(queueError)?.status).toBe(503);
    expect(resourceCapacityErrorResponse(storageError)?.status).toBe(507);
    expect(resourceCapacityErrorResponse(new Error("other"))).toBeNull();
  });

  it("returns a capacity response and rethrows unrelated errors", async () => {
    mocks.assertResourceCapacity.mockRejectedValueOnce(
      new ResourceCapacityError(
        "STORAGE_CAPACITY_LOW",
        "Armazenamento indisponivel",
      ),
    );
    await expect(
      requireResourceCapacity({ inputBytes: 2048 }),
    ).resolves.toMatchObject({ status: 507 });

    const unexpected = new Error("unexpected");
    mocks.assertResourceCapacity.mockRejectedValueOnce(unexpected);
    await expect(requireResourceCapacity({ inputBytes: 1 })).rejects.toBe(
      unexpected,
    );
  });
});
