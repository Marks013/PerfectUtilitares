import { describe, expect, it } from "vitest";
import {
  presenceConfirmationContractSchema,
  presenceStateContractSchema,
} from "@/lib/presence/public-contract";

describe("presence public contracts", () => {
  it("accepts a serialized invitation state", () => {
    expect(
      presenceStateContractSchema.safeParse({
        revision: 3,
        event: {
          eventSlug: "casamento-ana-e-joao",
          title: "Ana e João",
          description: null,
          startsAt: "2026-12-20T18:00:00.000Z",
          venueName: null,
          venueAddress: null,
          confirmationDeadline: "2026-12-10T23:59:00.000Z",
          timeZone: "America/Sao_Paulo",
          status: "PUBLISHED",
          theme: {
            preset: "CELEBRATION",
            cover: "WEDDING",
            accent: "CORAL",
            welcomeTitle: null,
          },
          confirmationOpen: true,
        },
        guest: {
          guestSlug: "maico-rafael",
          name: "Maico",
          rsvpStatus: "CONFIRMED",
          adultCount: 2,
          childCount: 0,
          respondedAt: "2026-09-01T12:00:00.000Z",
        },
        gifts: [],
      }).success,
    ).toBe(true);
  });

  it("rejects incomplete state responses", () => {
    expect(
      presenceStateContractSchema.safeParse({ revision: 1, gifts: [] }).success,
    ).toBe(false);
  });

  it("accepts a valid confirmation response", () => {
    expect(
      presenceConfirmationContractSchema.safeParse({
        revision: 4,
        rsvpStatus: "CONFIRMED",
        adultCount: 2,
        childCount: 1,
      }).success,
    ).toBe(true);
  });
});
