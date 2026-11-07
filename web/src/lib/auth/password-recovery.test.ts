import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueuePasswordRecovery, getRecoveryConfiguration, PASSWORD_RECOVERY_TTL_MS } from "./password-recovery";
const mocks = vi.hoisted(() => ({ send: vi.fn(), getQueue: vi.fn(), createQueue: vi.fn(), getWorkQueue: vi.fn() }));
vi.mock("@/lib/jobs/queue", () => ({ getWorkQueue: mocks.getWorkQueue }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue("queue-id"); mocks.getQueue.mockResolvedValue(null); mocks.createQueue.mockResolvedValue(undefined);
  mocks.getWorkQueue.mockResolvedValue({ send: mocks.send, getQueue: mocks.getQueue, createQueue: mocks.createQueue });
  vi.stubEnv("RESEND_API_KEY", "test-key"); vi.stubEnv("RESEND_FROM_EMAIL", "Perfect <sender@example.test>"); vi.stubEnv("APP_URL", "https://app.example.test");
});
afterEach(() => vi.unstubAllEnvs());
const configuration = { baseUrl: "https://app.example.test", from: "Perfect <sender@example.test>" };
describe("recovery durable queue", () => {
  it("publishes bounded TTL and identity without personal delivery details or raw tokens", async () => {
    await enqueuePasswordRecovery({ ...configuration, userId: "user-1", tenantId: "tenant-1", securityVersion: 1, resetStamp: "a".repeat(64) });
    const [name, data, options] = mocks.send.mock.calls[0] ?? [];
    expect(name).toBe("perfect-password-recovery");
    expect(data.expiresAt - data.issuedAt).toBe(PASSWORD_RECOVERY_TTL_MS);
    expect(options.id).toBe(data.requestId);
    expect(data).not.toHaveProperty("email"); expect(data).not.toHaveProperty("token");
    expect(data).not.toHaveProperty("passwordHash");
    expect(mocks.createQueue).toHaveBeenCalledWith(name, expect.objectContaining({ retryLimit: 3, expireInSeconds: 120 }));
  });
  it("enqueues unknown accounts too and rejects missing queue acknowledgements", async () => {
    mocks.send.mockResolvedValueOnce(null);
    await expect(enqueuePasswordRecovery({ ...configuration, userId: null, tenantId: null, securityVersion: null, resetStamp: null })).rejects.toThrow("QUEUE_UNAVAILABLE");
    expect(mocks.send.mock.calls[0]?.[1].userId).toBeNull();
  });
  it.each(["", "not-a-url", "ftp://app.example.test", "https://user:pass@app.example.test"])("disables malformed configured origins", (url) => {
    vi.stubEnv("APP_URL", url); vi.stubEnv("AUTH_URL", ""); expect(getRecoveryConfiguration()).toBeNull();
  });
  it("requires HTTPS for all production origins including loopback", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect(getRecoveryConfiguration()).toBeNull();
    vi.stubEnv("APP_URL", "https://app.example.test");
    expect(getRecoveryConfiguration()).toEqual(configuration);
  });
});
