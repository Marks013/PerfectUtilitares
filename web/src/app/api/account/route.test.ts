import { describe, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  expectUnauthenticated,
  type TestRouteHandler,
} from "@/test/api-route-contract";
import { DELETE, GET, PATCH } from "./route";

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));

const routePath = "/api/account";

describe("/api/account route", () => {
  it.each([
    { method: "PATCH", handler: PATCH },
    { method: "DELETE", handler: DELETE },
  ])("rejects unauthenticated $method requests", async ({ method, handler }) => {
    await expectUnauthenticated(
      handler as unknown as TestRouteHandler,
      method,
      routePath,
    );
  });

  it.each([
    { method: "GET", handler: GET, allow: "PATCH, DELETE" },
  ])("returns 405 for unsupported $method requests", async ({ method, handler, allow }) => {
    await expectMethodNotAllowed(
      handler as unknown as TestRouteHandler,
      method,
      routePath,
      allow,
    );
  });
});
