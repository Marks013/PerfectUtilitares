import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PdfOutputMissingError,
  pollPdfJob,
} from "@/components/pdf/pdf-job-polling";

type Artifact = { id: string; kind: "INPUT" | "OUTPUT" };

function job(
  status: "QUEUED" | "RUNNING" | "SUCCEEDED",
  artifacts: Artifact[] = [],
) {
  return {
    job: { status, artifacts, errorMessage: null, progress: 100 },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("pollPdfJob", () => {
  it("never reports success when the job has no valid output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(job("SUCCEEDED")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const onUpdate = vi.fn();

    await expect(
      pollPdfJob<Artifact, Artifact>({
        jobId: "job-1",
        signal: new AbortController().signal,
        isOutput: (artifact): artifact is Artifact => artifact.kind === "OUTPUT",
        onConnectionIssue: vi.fn(),
        onUpdate,
      }),
    ).rejects.toBeInstanceOf(PdfOutputMissingError);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("reconnects after transient failures instead of declaring the job failed", async () => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback) => {
      queueMicrotask(() => (callback as () => void)());
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("offline"))
        .mockRejectedValueOnce(new TypeError("offline"))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify(job("SUCCEEDED", [{ id: "out", kind: "OUTPUT" }])),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
    );
    const connection = vi.fn();
    const updates = vi.fn();

    const outputs = await pollPdfJob<Artifact, Artifact>({
      jobId: "job-1",
      signal: new AbortController().signal,
      isOutput: (artifact): artifact is Artifact => artifact.kind === "OUTPUT",
      onConnectionIssue: connection,
      onUpdate: updates,
    });

    expect(outputs).toEqual([{ id: "out", kind: "OUTPUT" }]);
    expect(connection).toHaveBeenCalledWith(
      expect.stringContaining("Tentando reconectar"),
    );
    expect(connection).toHaveBeenLastCalledWith(null);
    expect(updates).toHaveBeenCalledTimes(1);
  });
});
