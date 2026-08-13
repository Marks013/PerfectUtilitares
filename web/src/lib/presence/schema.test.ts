import { describe, expect, it } from "vitest";
import {
  presenceAccessSchema,
  presenceConfirmationSchema,
  presenceEventCreateSchema,
  presencePublicRouteSchema,
} from "@/lib/presence/schema";

describe("presence schemas", () => {
  it("accepts a readable route with a cryptographic invitation token", () => {
    expect(
      presenceAccessSchema.safeParse({
        eventSlug: "casamento-ana-e-joao",
        guestSlug: "maico-rafael",
        token: `c_${"a".repeat(43)}`,
      }).success,
    ).toBe(true);
  });

  it("rejects unsafe or ambiguous slugs", () => {
    expect(
      presencePublicRouteSchema.safeParse({
        eventSlug: "Casamento Ana",
        guestSlug: "../admin",
      }).success,
    ).toBe(false);
  });

  it("requires at least one adult and keeps children optional", () => {
    expect(
      presenceConfirmationSchema.safeParse({
        status: "CONFIRMED",
        adultCount: 0,
        childCount: 0,
      }).success,
    ).toBe(false);
    expect(
      presenceConfirmationSchema.safeParse({
        status: "CONFIRMED",
        adultCount: 2,
        childCount: 1,
      }).success,
    ).toBe(true);
    expect(
      presenceConfirmationSchema.safeParse({
        status: "CONFIRMED",
        adultCount: 1,
      }).success,
    ).toBe(true);
    expect(
      presenceConfirmationSchema.safeParse({
        status: "CONFIRMED",
        adultCount: 0,
        childCount: 2,
      }).success,
    ).toBe(false);
  });

  it("clears attendance when presence is declined", () => {
    expect(
      presenceConfirmationSchema.safeParse({
        status: "DECLINED",
        adultCount: 1,
        childCount: 0,
      }).success,
    ).toBe(false);
  });

  it("accepts controlled customization and valid automation dates", () => {
    const parsed = presenceEventCreateSchema.safeParse({
      eventSlug: "formatura-2026",
      title: "Formatura 2026",
      startsAt: "2026-12-20T19:00:00-03:00",
      confirmationDeadline: "2026-12-10T23:59:00-03:00",
      reminderAt: "2026-12-08T09:00:00-03:00",
      retentionUntil: "2027-06-20T19:00:00-03:00",
      theme: {
        preset: "ELEGANT",
        cover: "NONE",
        accent: "GOLD",
        welcomeTitle: "Celebre conosco",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a reminder scheduled after confirmation closes", () => {
    const parsed = presenceEventCreateSchema.safeParse({
      eventSlug: "formatura-2026",
      title: "Formatura 2026",
      startsAt: "2026-12-20T19:00:00-03:00",
      confirmationDeadline: "2026-12-10T23:59:00-03:00",
      reminderAt: "2026-12-11T09:00:00-03:00",
    });
    expect(parsed.success).toBe(false);
  });
});
