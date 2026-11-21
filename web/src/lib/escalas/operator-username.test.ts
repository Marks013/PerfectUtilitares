import { describe, expect, it } from "vitest";
import { ESCALA_OPERATOR_USERNAME_MAX_LENGTH, normalizeEscalaOperatorUsername } from "./operator-username";

describe("Escalas operator username lookup key", () => {
  it("uses the same key for case, outer spaces and repeated word separators", () => {
    for (const input of ["  Maria Silva  ", "MARIA SILVA", "Maria   Silva", "Maria\u00a0Silva"]) {
      expect(normalizeEscalaOperatorUsername(input)).toBe("maria silva");
    }
  });

  it("normalizes Unicode consistently without removing accents or punctuation", () => {
    expect(normalizeEscalaOperatorUsername("JOA\u0303O")).toBe("joão");
    expect(normalizeEscalaOperatorUsername("Ｊｏãｏ.０１")).toBe("joão.01");
    expect(normalizeEscalaOperatorUsername("João")).not.toBe(normalizeEscalaOperatorUsername("Joao"));
    expect(normalizeEscalaOperatorUsername("D'Ávila-01")).toBe("d'ávila-01");
  });

  it("is idempotent for the accepted key, including case expansion", () => {
    for (const input of [" İSTANBUL ", "Straße", "JOA\u0303O", "Ａna  Lima", "usuario_01"]) {
      const normalized = normalizeEscalaOperatorUsername(input);
      expect(normalized).not.toBeNull();
      expect(normalizeEscalaOperatorUsername(normalized)).toBe(normalized);
    }
  });

  it("does not treat names as privileges or branch identities", () => {
    for (const input of ["ADMIN", "PLANNER", "Filial 01"]) {
      expect(normalizeEscalaOperatorUsername(input)).toBe(input.toLowerCase());
    }
  });

  it("rejects missing, empty and non-string input without coercion", () => {
    for (const input of [undefined, null, "", "   ", "\u00a0", 1, true, [], {}, { toString: () => "admin" }]) {
      expect(normalizeEscalaOperatorUsername(input)).toBeNull();
    }
  });

  it("rejects controls, invisible formatting and malformed Unicode", () => {
    for (const input of ["ana\n", "\tana", "ana\0", "ana\u007f", "ana\u200b", "ana\u202e", "ana\u2028", "ana\u2029", "ana\ud800"]) {
      expect(normalizeEscalaOperatorUsername(input)).toBeNull();
    }
  });

  it("bounds both raw input and the normalized key without truncating", () => {
    expect(normalizeEscalaOperatorUsername("A".repeat(ESCALA_OPERATOR_USERNAME_MAX_LENGTH)))
      .toBe("a".repeat(ESCALA_OPERATOR_USERNAME_MAX_LENGTH));
    expect(normalizeEscalaOperatorUsername("a".repeat(ESCALA_OPERATOR_USERNAME_MAX_LENGTH + 1))).toBeNull();
    expect(normalizeEscalaOperatorUsername("ﬃ".repeat(22))).toBeNull();
    expect(normalizeEscalaOperatorUsername(`${" ".repeat(256)}a`)).toBeNull();
    expect(normalizeEscalaOperatorUsername("a")).toBe("a");
  });

  it("rejects visually ignorable marks and fillers outside the formatting category", () => {
    for (const invisible of ["\u034f", "\u3164", "\u1160", "\ufe0f", "\u115f"]) {
      expect(normalizeEscalaOperatorUsername(invisible)).toBeNull();
      expect(normalizeEscalaOperatorUsername(`an${invisible}a`)).toBeNull();
      expect(normalizeEscalaOperatorUsername(invisible.normalize("NFKC"))).toBeNull();
    }
    expect(normalizeEscalaOperatorUsername("Ana\u0301")).toBe("aná");
  });
});
