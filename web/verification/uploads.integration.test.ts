import { afterAll, expect, test, vi } from "vitest";
import sharp from "sharp";
import { unzipSync } from "fflate";
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/api/resource-capacity", () => ({ requireResourceCapacity: async () => null }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
import { prisma } from "@/lib/prisma";
import { readMultipartBody } from "@/lib/api/multipart";
import { POST as single } from "@/app/api/fotos/processar/route";
import { POST as batch } from "@/app/api/fotos/lote/route";

afterAll(async () => { await prisma.$disconnect(); });

test("multipart limit applies to streamed bytes despite an absent or false length", async () => {
  for (const length of [undefined, "1"]) {
    let delivered = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (delivered >= 16) { controller.close(); return; }
        delivered++;
        controller.enqueue(new Uint8Array(512));
      },
      cancel() { cancelled = true; },
    });
    const request = new Request("https://audit.invalid/upload", {
      method: "POST", body, duplex: "half", headers: { "content-type": "multipart/form-data; boundary=audit-boundary" },
    } as RequestInit & { duplex: "half" });
    if (length) request.headers.set("content-length", length);
    const result = await readMultipartBody(request, 2048);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toBe(true);
    expect(delivered).toBeLessThan(16);
  }
});

test("photo routes process a real PNG individually and in a ZIP batch", async () => {
  const input = await sharp({ create: { width: 300, height: 400, channels: 3, background: "#336699" } }).png().toBuffer();
  for (const [handler, field] of [[single, "file"], [batch, "files"]] as const) {
    const form = new FormData();
    form.append(field, new Blob([new Uint8Array(input)], { type: "image/png" }), "audit.png");
    const response = await handler(new Request("https://audit.invalid/api/fotos/test", { method: "POST", headers: { origin: "https://audit.invalid", "x-real-ip": "192.0.2.99" }, body: form }));
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const image = field === "file" ? bytes : Object.values(unzipSync(bytes))[0];
    const metadata = await sharp(image).metadata();
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(metadata.width!);
  }
});
