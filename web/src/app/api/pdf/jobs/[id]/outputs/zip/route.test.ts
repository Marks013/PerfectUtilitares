import { unzipSync } from "fflate";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  type TestRouteHandler,
} from "@/test/api-route-contract";
import { DELETE, GET, POST } from "./route";

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { pdfJob: { findFirst } },
}));
vi.mock("@/lib/api/security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/security")>()),
  enforceSharedRateLimit: vi.fn(async () => null),
}));
vi.mock("@/lib/pdf/access", () => ({
  getPdfOwnerContext: vi.fn(async () => ({ session: true })),
  pdfJobAccessWhere: vi.fn(() => ({ tenantId: "test-tenant" })),
}));
vi.mock("@/lib/pdf/storage", () => ({
  resolvePdfStorageKey: (key: string) => key,
}));

const routePath = "/api/pdf/jobs/test-id/outputs/zip";

describe("/api/pdf/jobs/test-id/outputs/zip route", () => {
  it("streams a ZIP with unique filenames and the original PDF bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pdf-zip-route-"));
    try {
      const pdf = await PDFDocument.create();
      pdf.addPage();
      const bytes = Buffer.from(await pdf.save());
      const artifacts = await Promise.all(
        ["first.pdf", "second.pdf"].map(async (name) => {
          const storageKey = join(directory, name);
          await writeFile(storageKey, bytes);
          return { originalName: "resultado.pdf", storageKey };
        }),
      );
      findFirst.mockResolvedValueOnce({
        id: "test-id",
        status: "SUCCEEDED",
        artifacts,
      });

      const response = await GET(new Request(`http://localhost${routePath}`), {
        params: Promise.resolve({ id: "test-id" }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Output-Count")).toBe("2");
      const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
      expect(Object.keys(entries).sort()).toEqual([
        "resultado-2.pdf",
        "resultado.pdf",
      ]);
      for (const entry of Object.values(entries)) {
        expect(Buffer.from(entry)).toEqual(bytes);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { method: "POST", handler: POST, allow: "GET" },
    { method: "DELETE", handler: DELETE, allow: "GET" },
  ])("returns 405 for unsupported $method requests", async ({ method, handler, allow }) => {
    await expectMethodNotAllowed(
      handler as unknown as TestRouteHandler,
      method,
      routePath,
      allow,
    );
  });
});
