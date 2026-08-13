import { describe, expect, it } from "vitest";
import { isPublicPerformancePath } from "./web-vitals-reporter";

describe("isPublicPerformancePath", () => {
  it.each([
    "/dashboard",
    "/jornada/validar",
    "/fotos",
    "/pdf/comprimir",
    "/privacidade",
  ])("accepts public path %s", (path) => {
    expect(isPublicPerformancePath(path)).toBe(true);
  });

  it.each(["/admin/seo", "/conta", "/convite/secret", "/presenca/event/guest"])(
    "rejects sensitive path %s",
    (path) => {
      expect(isPublicPerformancePath(path)).toBe(false);
    },
  );
});
