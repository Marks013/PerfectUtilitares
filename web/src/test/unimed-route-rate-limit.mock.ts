import { vi } from "vitest";

vi.mock("@/lib/api/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/api/rate-limit")
  >();
  return {
    ...actual,
    checkSharedRateLimit: vi.fn().mockResolvedValue({
      limited: false,
      remaining: 999,
      resetAt: Date.now() + 60_000,
    }),
  };
});
