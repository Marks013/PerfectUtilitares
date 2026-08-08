import { expect } from "vitest";

export type TestRouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Response | Promise<Response>;

const context = {
  params: Promise.resolve({
    id: "test-id",
    artifactId: "test-artifact",
  }),
};

function request(method: string, pathname: string) {
  return new Request(`http://localhost${pathname}`, { method });
}

async function errorCode(response: Response) {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code;
}

export async function expectMethodNotAllowed(
  handler: TestRouteHandler,
  method: string,
  pathname: string,
  allow: string,
) {
  const response = await handler(request(method, pathname), context);
  expect(response.status).toBe(405);
  expect(response.headers.get("allow")).toBe(allow);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await errorCode(response)).toBe("METHOD_NOT_ALLOWED");
}

export async function expectUnauthenticated(
  handler: TestRouteHandler,
  method: string,
  pathname: string,
) {
  const response = await handler(request(method, pathname), context);
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await errorCode(response)).toBe("UNAUTHENTICATED");
}

export async function expectOriginRequired(
  handler: TestRouteHandler,
  method: string,
  pathname: string,
) {
  const response = await handler(request(method, pathname), context);
  expect(response.status).toBe(403);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await errorCode(response)).toBe("ORIGIN_REQUIRED");
}
