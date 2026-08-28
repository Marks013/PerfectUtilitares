import { describe, expect, it } from "vitest";
import { isValidUnimedBeneficiaryQuery } from "./beneficiary-search-query";

describe("isValidUnimedBeneficiaryQuery", () => {
  it.each(["0", "5", "9", " 5 ", "15", "05", "Al", "  Al  ", "529.982.247-25"])(
    "accepts registration, CPF or a name with at least two characters: %s",
    (query) => {
      expect(isValidUnimedBeneficiaryQuery(query)).toBe(true);
    },
  );

  it.each(["", " ", "\t\n", "a", " a ", ".", "-"])(
    "rejects empty or single-character non-numeric searches: %s",
    (query) => {
      expect(isValidUnimedBeneficiaryQuery(query)).toBe(false);
    },
  );
});
