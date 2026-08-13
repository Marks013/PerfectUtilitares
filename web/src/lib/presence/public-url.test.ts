import { describe, expect, it } from "vitest";
import { presenceShortUrlForOrigin } from "./public-url";

describe("presenceShortUrlForOrigin", () => {
  const code = `p_${"a".repeat(16)}`;

  it("replaces an internal server origin with the browser public origin", () => {
    expect(
      presenceShortUrlForOrigin(
        `http://127.0.0.1:3002/p/${code}`,
        "https://perfectutilitares.duckdns.org",
      ),
    ).toBe(`https://perfectutilitares.duckdns.org/p/${code}`);
  });

  it("rejects paths that are not presence short links", () => {
    expect(() =>
      presenceShortUrlForOrigin(
        "http://127.0.0.1:3002/dashboard",
        "https://perfectutilitares.duckdns.org",
      ),
    ).toThrow("Link curto de convite inválido.");
  });
});
