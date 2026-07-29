import type { PdfArtifact, PdfJob } from "@prisma/client";

type JobWithArtifacts = PdfJob & { artifacts?: PdfArtifact[] };

export function serializePdfJob(job: JobWithArtifacts) {
  return {
    ...job,
    inputBytes: job.inputBytes.toString(),
    outputBytes: job.outputBytes.toString(),
    artifacts: job.artifacts?.map((artifact) => ({
      ...artifact,
      sizeBytes: artifact.sizeBytes.toString(),
    })),
  };
}
