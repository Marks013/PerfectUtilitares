import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), redirect: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/ferias/ferias-workspace", () => ({ FeriasWorkspace: () => <h1>Férias</h1> }));

import FeriasPage, { metadata } from "@/app/(app)/admin/ferias/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
});

describe("Ferias admin page", () => {
  it.each([
    null,
    { user: { role: "USER", status: "ACTIVE", tenantId: "tenant" } },
    { user: { role: "ADMIN", status: "BLOCKED", tenantId: "tenant" } },
    { user: { role: "ADMIN", status: "ACTIVE", tenantId: null } },
  ])("rejects an unauthorized session: %j", async (session) => {
    mocks.auth.mockResolvedValue(session);
    await expect(FeriasPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders only for an active administrator with a tenant and prevents indexing", async () => {
    mocks.auth.mockResolvedValue({ user: { role: "ADMIN", status: "ACTIVE", tenantId: "tenant" } });
    expect(renderToStaticMarkup(await FeriasPage())).toContain("Férias");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
