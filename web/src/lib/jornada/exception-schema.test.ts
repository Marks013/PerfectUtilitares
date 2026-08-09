import { describe, expect, it } from "vitest";
import {
  jornadaExceptionPatchSchema,
  jornadaExceptionSchema,
  zodIssueDetails,
} from "@/lib/jornada/exception-schema";

const baseInput = {
  userId: "user-test-id",
  nome: "  Operador Teste  ",
  horarios: "08:00, 12:00, 13:00, 17:00",
};

describe("jornada exception schema", () => {
  it("normalizes a complete weekday and optional Saturday schedule", () => {
    const parsed = jornadaExceptionSchema.parse({
      ...baseInput,
      sabadoHorarios: "08:00 12:00",
      active: false,
    });

    expect(parsed).toMatchObject({
      userId: "user-test-id",
      nome: "Operador Teste",
      horariosNormalizado: "08:00 12:00 13:00 17:00",
      sabadoNormalizado: "08:00 12:00",
      active: false,
    });
  });

  it("converts blank optional fields to their canonical values", () => {
    const parsed = jornadaExceptionSchema.parse({
      userId: "user-test-id",
      horarios: "08:00 17:00",
    });

    expect(parsed.nome).toBeNull();
    expect(parsed.sabadoNormalizado).toBeNull();
    expect(parsed.active).toBe(true);
  });

  it.each([
    {
      input: { ...baseInput, horarios: "08:00 12:00 13:00" },
      path: "horarios",
    },
    {
      input: { ...baseInput, sabadoHorarios: "08:00 12:00 13:00 17:00" },
      path: "sabadoHorarios",
    },
  ])("rejects invalid schedule shape at $path", ({ input, path }) => {
    const parsed = jornadaExceptionSchema.safeParse(input);
    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(zodIssueDetails(parsed.error)).toEqual(
        expect.arrayContaining([expect.objectContaining({ path })]),
      );
    }
  });

  it("requires an explicit boolean for patch updates", () => {
    expect(jornadaExceptionPatchSchema.parse({ active: false })).toEqual({
      active: false,
    });
    expect(jornadaExceptionPatchSchema.safeParse({ active: "false" }).success).toBe(
      false,
    );
  });
});
