import { describe, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  expectOriginRequired,
  type TestRouteHandler,
} from "@/test/api-route-contract";
import { DELETE, GET, PATCH, POST, PUT } from "./route";

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));

const routePath = "/api/pdf/jobs";

describe("/api/pdf/jobs route", () => {
  it("rejects POST requests without a trusted origin", async () => {
    await expectOriginRequired(
      POST as unknown as TestRouteHandler,
      "POST",
      routePath,
    );
  });

  it.each([
    { method: "GET", handler: GET, allow: "POST" },
    { method: "PUT", handler: PUT, allow: "POST" },
    { method: "PATCH", handler: PATCH, allow: "POST" },
    { method: "DELETE", handler: DELETE, allow: "POST" },
  ])("returns 405 for unsupported $method requests", async ({ method, handler, allow }) => {
    await expectMethodNotAllowed(
      handler as unknown as TestRouteHandler,
      method,
      routePath,
      allow,
    );
  });
});
