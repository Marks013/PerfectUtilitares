import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  overrides: new Map<string, unknown>(),
  recordUserUsage: vi.fn(),
}));

vi.mock("@/lib/api/security", () => ({
  enforceSharedRateLimit: async () => null,
  getOptionalSession: async () => ({
    user: {
      id: "test-admin-id",
      tenantId: "test-tenant-id",
      role: "ADMIN",
      status: "ACTIVE",
    },
  }),
  jsonError: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
  methodNotAllowed: (allowed: string[]) =>
    Response.json({}, { status: 405, headers: { Allow: allowed.join(", ") } }),
  readJsonBody: async (request: Request) => ({
    ok: true as const,
    data: await request.json(),
  }),
  requireContentType: () => null,
  requireMaxContentLength: () => null,
  requireSameOrigin: () => null,
}));

vi.mock("@/lib/api/resource-capacity", () => ({
  requireResourceCapacity: async () => null,
}));
vi.mock("@/lib/usage/record", () => ({
  recordUserUsage: mocks.recordUserUsage,
}));

vi.mock("@/lib/photos/request", () => ({
  isUploadedFile: (value: unknown) => value instanceof File,
  parseBatchCropAreas: () => ({}),
  parseCropArea: () => undefined,
  parsePhotoSettings: () => ({
    width: 300,
    height: 400,
    format: "jpeg",
    contrast: 0,
    brightness: 0,
    addBorder: false,
    replaceOriginal: false,
    convertToJpg: true,
  }),
  readPhotoInput: async (file: File) => Buffer.from(await file.arrayBuffer()),
  zodIssues: () => [],
}));
vi.mock("@/lib/photos/processor", () => {
  class PhotoProcessingError extends Error {
    code = "PHOTO_ERROR";
  }
  return {
    buildPhotoZip: vi.fn(async () => Buffer.from("zip-data")),
    MAX_BATCH_BYTES: 25 * 1024 * 1024,
    MAX_BATCH_FILES: 20,
    MAX_IMAGE_BYTES: 12 * 1024 * 1024,
    PhotoProcessingError,
    processPhoto: vi.fn(async () => ({
      buffer: Buffer.from("processed-image"),
      fileName: "foto-3x4.jpg",
      contentType: "image/jpeg",
      width: 300,
      height: 400,
    })),
  };
});

vi.mock("@/lib/pdf/access", () => ({
  getPdfOwnerContext: vi.fn(async () => ({
    session: {
      user: {
        id: "test-admin-id",
        tenantId: "test-tenant-id",
        role: "ADMIN",
        status: "ACTIVE",
      },
    },
    ownerSessionHash: null,
  })),
  getPdfPrincipal: () => ({
    key: "authenticated:test-admin-id",
    tier: "authenticated",
  }),
  pdfJobAccessWhere: () => ({}),
}));
vi.mock("@/lib/pdf/capacity", () => {
  class PdfPublicCapacityError extends Error {
    code = "PDF_PUBLIC_CAPACITY";
  }
  return {
    acquirePdfJobLock: vi.fn(async () => undefined),
    createPdfDraftWithCapacity: vi.fn(async (input: Record<string, unknown>) => ({
      id: "pdf-job-id",
      ...input,
      status: "DRAFT",
      inputBytes: 0n,
      outputBytes: 0n,
      artifacts: [],
      createdAt: new Date("2026-08-08T12:00:00.000Z"),
      updatedAt: new Date("2026-08-08T12:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    })),
    PdfPublicCapacityError,
  };
});
vi.mock("@/lib/pdf/serialization", () => ({
  serializePdfJob: (job: Record<string, unknown>) =>
    JSON.parse(
      JSON.stringify(job, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ),
}));
vi.mock("@/lib/pdf/storage", async () => {
  const { Readable } = await import("node:stream");
  class PdfStorageError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    createPdfStorageReadStream: () => Readable.from(Buffer.from("artifact")),
    OFFICE_FORMATS: {
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        { extension: ".docx" },
    },
    PdfStorageError,
    removePdfStorageKey: vi.fn(async () => undefined),
    resolvePdfStorageKey: () => "/tmp/perfectutilitares-route-test",
    sanitizeImageFileName: () => "image.jpg",
    sanitizeOfficeFileName: () => "document.docx",
    writeImageUpload: vi.fn(async () => ({
      artifactId: "image-artifact-id",
      sha256: "image-sha",
      sizeBytes: 5n,
      storageKey: "jobs/pdf-job-id/input/image.jpg",
    })),
    writeOfficeUpload: vi.fn(async () => ({
      artifactId: "office-artifact-id",
      sha256: "office-sha",
      sizeBytes: 5n,
      storageKey: "jobs/pdf-job-id/input/document.docx",
    })),
  };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, access: vi.fn(async () => undefined) };
});
vi.mock("sharp", () => ({
  default: () => ({
    metadata: async () => ({ format: "jpeg", width: 1, height: 1 }),
  }),
}));
vi.mock("archiver", async () => {
  const { EventEmitter } = await import("node:events");
  class ZipArchive extends EventEmitter {
    destination?: { end: (value: Buffer) => void };
    append() {}
    pipe(destination: { end: (value: Buffer) => void }) {
      this.destination = destination;
      return destination;
    }
    async finalize() {
      this.destination?.end(Buffer.from("zip-data"));
    }
  }
  return { default: () => new ZipArchive(), ZipArchive };
});

vi.mock("@/lib/prisma", () => {
  const now = new Date("2026-08-08T12:00:00.000Z");
  const base = {
    id: "pdf-job-id",
    tenantId: "test-tenant-id",
    userId: "test-admin-id",
    ownerSessionHash: null,
    operation: "WORD_TO_PDF",
    options: null,
    status: "DRAFT",
    inputBytes: 0n,
    outputBytes: 0n,
    errorCode: null,
    errorMessage: null,
    attempts: 0,
    artifacts: [],
    _count: { artifacts: 0 },
    kind: "INPUT",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    originalName: "document.docx",
    sizeBytes: 5n,
    storageKey: "jobs/pdf-job-id/input/document.docx",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  };
  let prisma: Record<string, unknown>;
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, method) => async (...args: unknown[]) => {
          const key = `${name}.${String(method)}`;
          mocks.calls.push(key);
          if (mocks.overrides.has(key)) {
            const value = mocks.overrides.get(key);
            return typeof value === "function"
              ? (value as (...input: unknown[]) => unknown)(...args)
              : value;
          }
          if (method === "findMany" || method === "groupBy") return [];
          if (method === "count") return 0;
          return { ...base };
        },
      },
    );
  prisma = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === "$transaction") {
          return async (work: unknown) =>
            typeof work === "function"
              ? (work as (client: unknown) => unknown)(prisma)
              : Promise.all(work as Promise<unknown>[]);
        }
        return model(String(property));
      },
    },
  );
  return { prisma };
});

import { POST as processPhotoBatch } from "@/app/api/fotos/lote/route";
import { POST as processPhoto } from "@/app/api/fotos/processar/route";
import { POST as uploadDocument } from "@/app/api/pdf/jobs/[id]/documents/route";
import { POST as uploadImage } from "@/app/api/pdf/jobs/[id]/images/route";
import { GET as getInput } from "@/app/api/pdf/jobs/[id]/inputs/[artifactId]/route";
import { GET as getOutput } from "@/app/api/pdf/jobs/[id]/outputs/[artifactId]/route";
import { GET as getOutputZip } from "@/app/api/pdf/jobs/[id]/outputs/zip/route";
import { POST as createPdfJob } from "@/app/api/pdf/jobs/route";

const origin = "http://localhost:3000";
const routeContext = { params: Promise.resolve({ id: "pdf-job-id" }) };
const artifactContext = {
  params: Promise.resolve({ id: "pdf-job-id", artifactId: "pdf-artifact-id" }),
};
function photoForm(field: "file" | "files") {
  const form = new FormData();
  form.append(
    field,
    new File([Buffer.from("image")], "photo.jpg", { type: "image/jpeg" }),
  );
  return form;
}
type FunctionalRouteCase = {
  route: string;
  expectedStatus: 200 | 201;
  run: () => Promise<Response> | Response;
  persistence?: string;
};

const cases: FunctionalRouteCase[] = [
  {
    route: "src/app/api/fotos/lote/route.ts",
    expectedStatus: 200,
    run: () =>
      processPhotoBatch(
        new Request(`${origin}/api/fotos/lote`, {
          method: "POST",
          headers: { origin },
          body: photoForm("files"),
        }),
      ),
  },
  {
    route: "src/app/api/fotos/processar/route.ts",
    expectedStatus: 200,
    run: () =>
      processPhoto(
        new Request(`${origin}/api/fotos/processar`, {
          method: "POST",
          headers: { origin },
          body: photoForm("file"),
        }),
      ),
  },
  {
    route: "src/app/api/pdf/jobs/route.ts",
    expectedStatus: 201,
    run: () =>
      createPdfJob(
        new Request(`${origin}/api/pdf/jobs`, {
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify({ operation: "MERGE" }),
        }),
      ),
  },
  {
    route: "src/app/api/pdf/jobs/[id]/documents/route.ts",
    expectedStatus: 201,
    persistence: "pdfJob.update",
    run: () => {
      mocks.overrides.set("pdfJob.findFirst", {
        id: "pdf-job-id",
        operation: "WORD_TO_PDF",
        status: "DRAFT",
        inputBytes: 0n,
        _count: { artifacts: 0 },
      });
      return uploadDocument(
        new Request(`${origin}/api/pdf/jobs/pdf-job-id/documents`, {
          method: "POST",
          headers: {
            "content-type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "x-file-name": "document.docx",
            origin,
          },
          body: Buffer.from("office"),
        }),
        routeContext,
      );
    },
  },
  {
    route: "src/app/api/pdf/jobs/[id]/images/route.ts",
    expectedStatus: 201,
    persistence: "pdfJob.update",
    run: () => {
      mocks.overrides.set("pdfJob.findFirst", {
        id: "pdf-job-id",
        operation: "JPG_TO_PDF",
        status: "DRAFT",
        inputBytes: 0n,
        _count: { artifacts: 0 },
      });
      return uploadImage(
        new Request(`${origin}/api/pdf/jobs/pdf-job-id/images`, {
          method: "POST",
          headers: {
            "content-type": "image/jpeg",
            "x-file-name": "image.jpg",
            origin,
          },
          body: Buffer.from("image"),
        }),
        routeContext,
      );
    },
  },
  {
    route: "src/app/api/pdf/jobs/[id]/inputs/[artifactId]/route.ts",
    expectedStatus: 200,
    run: () => {
      mocks.overrides.set("pdfArtifact.findFirst", {
        id: "pdf-artifact-id",
        kind: "INPUT",
        mimeType: "application/pdf",
        originalName: "input.pdf",
        storageKey: "jobs/pdf-job-id/input/input.pdf",
        sizeBytes: 8n,
      });
      return getInput(
        new Request(
          `${origin}/api/pdf/jobs/pdf-job-id/inputs/pdf-artifact-id`,
        ),
        artifactContext,
      );
    },
  },
  {
    route: "src/app/api/pdf/jobs/[id]/outputs/[artifactId]/route.ts",
    expectedStatus: 200,
    run: () => {
      mocks.overrides.set("pdfArtifact.findFirst", {
        id: "pdf-artifact-id",
        kind: "OUTPUT",
        mimeType: "application/pdf",
        originalName: "output.pdf",
        storageKey: "jobs/pdf-job-id/output/output.pdf",
        sizeBytes: 8n,
      });
      return getOutput(
        new Request(
          `${origin}/api/pdf/jobs/pdf-job-id/outputs/pdf-artifact-id`,
        ),
        artifactContext,
      );
    },
  },
  {
    route: "src/app/api/pdf/jobs/[id]/outputs/zip/route.ts",
    expectedStatus: 200,
    run: () => {
      mocks.overrides.set("pdfJob.findFirst", {
        id: "pdf-job-id",
        status: "SUCCEEDED",
        artifacts: [
          {
            id: "output-artifact-id",
            kind: "OUTPUT",
            originalName: "output.pdf",
            storageKey: "jobs/pdf-job-id/output/output.pdf",
          },
        ],
      });
      return getOutputZip(
        new Request(`${origin}/api/pdf/jobs/pdf-job-id/outputs/zip`),
        routeContext,
      );
    },
  },
];

describe("functional success paths for photo and PDF routes", () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.overrides.clear();
    mocks.recordUserUsage.mockClear();
  });
  for (const routeCase of cases) {
    it(`route-success: ${routeCase.route}`, async () => {
      const response = await routeCase.run();
      expect(response.status).toBe(routeCase.expectedStatus);
      if (routeCase.persistence) {
        const persistence = routeCase.persistence;
        expect(
          mocks.calls.some((call) => call.startsWith(persistence)),
        ).toBe(true);
      }
    });
  }
});
