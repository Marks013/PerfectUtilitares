import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  constructor: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };

    constructor(apiKey: string, options?: { baseUrl?: string }) {
      mocks.constructor(apiKey, options);
    }
  },
}));

const originalEnv = { ...process.env };

async function loadModule() {
  return import("@/lib/email/resend");
}

describe("Resend email adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.send.mockReset().mockResolvedValue({ data: { id: "email-id" } });
    mocks.constructor.mockReset();
    process.env = { ...originalEnv };
    delete process.env.APP_URL;
    delete process.env.AUTH_URL;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses configured public origin without keeping path data", async () => {
    process.env.APP_URL = "https://app.example.test/private/path";
    process.env.AUTH_URL = "https://fallback.example.test";
    const { getAppUrl } = await loadModule();

    expect(getAppUrl(new Request("https://request.example.test/login"))).toBe(
      "https://app.example.test",
    );
  });

  it("falls back from AUTH_URL to the request origin", async () => {
    process.env.AUTH_URL = "https://auth.example.test/callback";
    const { getAppUrl } = await loadModule();

    expect(getAppUrl(new Request("https://request.example.test/login"))).toBe(
      "https://auth.example.test",
    );

    delete process.env.AUTH_URL;
    expect(getAppUrl(new Request("https://request.example.test/login"))).toBe(
      "https://request.example.test",
    );
  });

  it.each(["invitation", "password reset"] as const)(
    "rejects %s delivery when credentials are incomplete",
    async (kind) => {
      const email = await loadModule();
      const delivery =
        kind === "invitation"
          ? email.sendInvitationEmail({
              to: "user@example.test",
              name: "User",
              tenantName: "Tenant",
              inviteUrl: "https://example.test/invite",
            })
          : email.sendPasswordResetEmail({
              to: "user@example.test",
              name: "User",
              resetUrl: "https://example.test/reset",
            });

      await expect(delivery).rejects.toThrow("RESEND_NOT_CONFIGURED");
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );

  it("sends escaped invitation and reset HTML through one reused client", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "Perfect <no-reply@example.test>";
    const email = await loadModule();

    await email.sendInvitationEmail({
      to: "invitee@example.test",
      name: "<Admin & Co>",
      tenantName: "\"Tenant\" <script>",
      inviteUrl: "https://example.test/invite?a=1&b=\"x\"",
    });
    await email.sendPasswordResetEmail({
      to: "invitee@example.test",
      name: "O'Reilly",
      resetUrl: "https://example.test/reset?a=1&b=2",
    });

    expect(mocks.constructor).toHaveBeenCalledTimes(1);
    expect(mocks.constructor).toHaveBeenCalledWith("re_test_key", undefined);
    expect(mocks.send).toHaveBeenCalledTimes(2);

    const invitation = mocks.send.mock.calls[0]?.[0];
    expect(invitation).toMatchObject({
      from: "Perfect <no-reply@example.test>",
      to: "invitee@example.test",
      subject: "Convite para o Sistema Web",
    });
    expect(invitation.html).toContain("&lt;Admin &amp; Co&gt;");
    expect(invitation.html).toContain("&quot;Tenant&quot; &lt;script&gt;");
    expect(invitation.html).toContain("a=1&amp;b=&quot;x&quot;");
    expect(invitation.html).not.toContain("<script>");

    const reset = mocks.send.mock.calls[1]?.[0];
    expect(reset.subject).toMatch(/^Redefini.+ de senha$/);
    expect(reset.html).toContain("O&#039;Reilly");
    expect(reset.html).toContain("a=1&amp;b=2");
  });

  it("sends a presence invitation with provider idempotency", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "Perfect <no-reply@example.test>";
    const { sendPresenceInvitationEmail } = await loadModule();

    await expect(
      sendPresenceInvitationEmail({
        to: "guest@example.test",
        name: "Ana <Souza>",
        eventTitle: "Formatura & Festa",
        eventDate: "20 de dezembro de 2026 às 19:00",
        venueName: "Salão <Principal>",
        inviteUrl: "https://example.test/presenca#c_token&a=1",
        idempotencyKey: "presence/delivery-1",
      }),
    ).resolves.toBe("email-id");

    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "guest@example.test",
        subject: "Confirme sua presença em Formatura & Festa",
      }),
      { idempotencyKey: "presence/delivery-1" },
    );
    expect(mocks.send.mock.calls[0]?.[0].html).toContain(
      "Ana &lt;Souza&gt;",
    );
    expect(mocks.send.mock.calls[0]?.[0].html).not.toContain("<Principal>");
  });
});
