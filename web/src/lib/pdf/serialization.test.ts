import { describe, expect, it } from "vitest";
import { serializePdfJob } from "@/lib/pdf/serialization";

describe("PDF job serialization", () => {
  it("returns only fields intended for the client", () => {
    const createdAt = new Date("2026-07-29T10:00:00.000Z");
    const expiresAt = new Date("2026-07-29T10:30:00.000Z");
    const job = {
      id: "job-1",
      tenantId: "tenant-secret",
      userId: "user-secret",
      ownerSessionHash: "session-secret",
      principalKey: `user:${"a".repeat(64)}`,
      operation: "COMPRESS",
      status: "SUCCEEDED",
      progress: 100,
      options: { quality: "SOURCE" },
      errorCode: null,
      errorMessage: null,
      inputBytes: BigInt(1_000),
      outputBytes: BigInt(800),
      startedAt: createdAt,
      completedAt: createdAt,
      expiresAt,
      createdAt,
      updatedAt: createdAt,
      artifacts: [
        {
          id: "artifact-1",
          jobId: "job-1",
          kind: "OUTPUT",
          storageKey: "job-1/private/output.pdf",
          originalName: "resultado.pdf",
          mimeType: "application/pdf",
          sizeBytes: BigInt(800),
          sha256: "internal-hash",
          pageCount: 2,
          createdAt,
        },
      ],
    } as Parameters<typeof serializePdfJob>[0];

    const serialized = serializePdfJob(job);

    expect(serialized).toEqual({
      id: "job-1",
      operation: "COMPRESS",
      status: "SUCCEEDED",
      progress: 100,
      options: { quality: "SOURCE" },
      errorCode: null,
      errorMessage: null,
      inputBytes: "1000",
      outputBytes: "800",
      startedAt: createdAt,
      completedAt: createdAt,
      expiresAt,
      createdAt,
      updatedAt: createdAt,
      artifacts: [
        {
          id: "artifact-1",
          kind: "OUTPUT",
          originalName: "resultado.pdf",
          mimeType: "application/pdf",
          sizeBytes: "800",
          pageCount: 2,
          createdAt,
        },
      ],
    });
    expect(serialized).not.toHaveProperty("tenantId");
    expect(serialized).not.toHaveProperty("userId");
    expect(serialized).not.toHaveProperty("ownerSessionHash");
    expect(serialized.artifacts?.[0]).not.toHaveProperty("jobId");
    expect(serialized.artifacts?.[0]).not.toHaveProperty("storageKey");
    expect(serialized.artifacts?.[0]).not.toHaveProperty("sha256");
  });
});
