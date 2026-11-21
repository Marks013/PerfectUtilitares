import { expect, test } from "./fixtures";

const assets = [
  "/mediapipe/tasks-vision/vision_bundle.mjs",
  "/mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm",
  "/mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm",
  "/mediapipe/models/blaze_face_short_range.tflite",
];

/** Browser-only, synthetic asset audit. Never loads a real photograph or employee record. */
test("MediaPipe assets are same-origin, cacheable and have measurable browser resource timings", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/mediapipe/face-detection-frame.html");
  await expect(page).toHaveURL(/\/mediapipe\/face-detection-frame\.html$/);

  const measurements = await page.evaluate(async (paths) => {
    performance.setResourceTimingBufferSize(200);
    performance.clearResourceTimings();
    return Promise.all(paths.map(async (path) => {
      const started = performance.now();
      const response = await fetch(path, { cache: "reload", credentials: "same-origin" });
      const bytes = await response.arrayBuffer();
      const resource = performance.getEntriesByName(new URL(path, location.href).href, "resource").at(-1) as PerformanceResourceTiming | undefined;
      return {
        path, status: response.status, contentType: response.headers.get("content-type"),
        cacheControl: response.headers.get("cache-control"),
        bytes: bytes.byteLength, requestDurationMs: performance.now() - started,
        resourceDurationMs: resource?.duration ?? null,
        transferSize: resource?.transferSize ?? null,
        validWasm: path.endsWith(".wasm") ? WebAssembly.validate(bytes) : null,
      };
    }));
  }, assets);

  for (const resource of measurements) {
    expect(resource.status, resource.path).toBe(200);
    expect(resource.cacheControl, resource.path).toMatch(/public, max-age=86400/);
    expect(resource.bytes, resource.path).toBeGreaterThan(100_000);
    expect(Number.isFinite(resource.requestDurationMs), resource.path).toBe(true);
    expect(resource.requestDurationMs, resource.path).toBeGreaterThanOrEqual(0);
    expect(resource.resourceDurationMs, resource.path).not.toBeNull();
  }
  for (const resource of measurements.filter(item => item.path.endsWith(".wasm"))) {
    expect(resource.contentType).toContain("application/wasm");
    expect(resource.bytes).toBeGreaterThan(9_000_000);
    expect(resource.validWasm, resource.path).toBe(true);
  }

  // This is measurement evidence, not a performance threshold or proof that
  // both fallback variants are downloaded during ordinary face detection.
  console.log("[mediapipe-browser-assets] " + JSON.stringify(measurements));
});

test("the sandboxed face detector frame retains its restrictive embedding policy", async ({ page }) => {
  const response = await page.request.get("/mediapipe/face-detection-frame.html");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(response.headers()["content-security-policy"]).toContain("connect-src 'self'");
});
