import { describe, expect, it } from "vitest";
import { codigoJornadaSchema } from "@/lib/codigos/schema";

describe("codigo jornada schema", () => {
  it("normalizes manual code input", () => {
    const parsed = codigoJornadaSchema.parse({
      codigo: " 001 ",
      horariosOriginal: "08:00   12:00  13:00 17:00",
    });

    expect(parsed).toEqual({
      codigo: "001",
      horariosOriginal: "08:00   12:00  13:00 17:00",
      horariosNormalizado: "08:00 12:00 13:00 17:00",
    });
  });

  it("rejects invalid manual hours", () => {
    const parsed = codigoJornadaSchema.safeParse({
      codigo: "001",
      horariosOriginal: "08:90 12:00",
    });

    expect(parsed.success).toBe(false);
  });
});
