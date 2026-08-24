import { describe, expect, it } from "vitest";
import { hasDeclaredReajusteContentLength } from "./request-security";

describe("salary adjustment request security", () => {
  it("requires a declared multipart size", async () => {
    expect(hasDeclaredReajusteContentLength(
      new Request("https://example.test/api", { method: "POST" }),
    )).toBe(false);
    expect(
      hasDeclaredReajusteContentLength(
        new Request("https://example.test/api", {
          method: "POST",
          headers: { "content-length": "1024" },
        }),
      ),
    ).toBe(true);
  });
});
