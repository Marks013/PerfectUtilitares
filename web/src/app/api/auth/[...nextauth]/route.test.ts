import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const authHandlers = vi.hoisted(() => ({
  GET: vi.fn(() => new Response(null, { status: 204 })),
  POST: vi.fn(() => new Response(null, { status: 201 })),
}));

vi.mock("@/auth", () => ({ handlers: authHandlers }));

import { GET, POST } from "./route";

describe("NextAuth route", () => {
  it("forwards GET to the configured authentication handler", async () => {
    const response = await GET(new NextRequest("http://localhost/api/auth/session"));
    expect(response.status).toBe(204);
    expect(authHandlers.GET).toHaveBeenCalledOnce();
  });

  it("forwards POST to the configured authentication handler", async () => {
    const response = await POST(new NextRequest("http://localhost/api/auth/callback", { method: "POST" }));
    expect(response.status).toBe(201);
    expect(authHandlers.POST).toHaveBeenCalledOnce();
  });
});
