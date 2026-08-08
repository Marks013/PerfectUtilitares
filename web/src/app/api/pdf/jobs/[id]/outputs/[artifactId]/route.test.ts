import { describe, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  type TestRouteHandler,
} from "@/test/api-route-contract";
import { DELETE, POST } from "./route";

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));

const routePath = "/api/pdf/jobs/test-id/outputs/test-artifactId";

describe("/api/pdf/jobs/test-id/outputs/test-artifactId route", () => {
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
