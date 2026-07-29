import { describe, expect, it } from "vitest";
import {
  getPdfJobExpiry,
  PDF_JOB_RETENTION_MINUTES,
} from "@/lib/pdf/constants";

describe("PDF operational retention", () => {
  it("keeps outputs only for the short download window", () => {
    expect(PDF_JOB_RETENTION_MINUTES).toBe(30);
  });

  it("calculates expiration from the supplied instant", () => {
    const now = new Date("2026-07-29T12:00:00.000Z");

    expect(getPdfJobExpiry(now).toISOString()).toBe(
      "2026-07-29T12:30:00.000Z",
    );
  });
});
