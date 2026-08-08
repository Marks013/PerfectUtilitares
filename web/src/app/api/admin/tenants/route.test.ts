import { describe, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  expectUnauthenticated,
  type TestRouteHandler,
} from "@/test/api-route-contract";
import { DELETE, GET, PATCH, POST } from "./route";

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));

const routePath = "/api/admin/tenants";

describe("/api/admin/tenants route", () => {
  it.each([
    { method: "GET", handler: GET },
    { method: "POST", handler: POST },
  ])("rejects unauthenticated $method requests", async ({ method, handler }) => {
    await expectUnauthenticated(
      handler as unknown as TestRouteHandler,
      method,
      routePath,
    );
  });

  it.each([
    { method: "PATCH", handler: PATCH, allow: "GET, POST" },
    { method: "DELETE", handler: DELETE, allow: "GET, POST" },
  ])("returns 405 for unsupported $method requests", async ({ method, handler, allow }) => {
    await expectMethodNotAllowed(
      handler as unknown as TestRouteHandler,
      method,
      routePath,
      allow,
    );
  });
});
