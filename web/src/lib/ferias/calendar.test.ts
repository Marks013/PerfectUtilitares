import { describe, expect, it } from "vitest";
import {
	FERIAS_CALENDAR_VERSION,
	FeriasCalendarError,
	vacationHighlight,
} from "./calendar";

describe("vacationHighlight", () => {
	it.each([
		["2026-08-03", "2026-09-01", false],
		["2026-08-04", "2026-09-02", true],
		["2026-09-01", "2026-09-30", false],
		["2026-09-02", "2026-10-01", true],
		["2026-05-04", "2026-06-02", false],
		["2026-05-05", "2026-06-03", true],
		["2026-11-03", "2026-12-02", false],
		["2026-11-04", "2026-12-03", true],
		["2026-01-02", "2026-01-31", false],
		["2026-01-05", "2026-02-03", true],
		["2026-12-01", "2026-12-30", false],
		["2026-12-03", "2027-01-01", true],
	])(
		"30 calendar days %s through %s: highlight %s",
		(start, end, highlight) => {
			expect(vacationHighlight(start, end)).toEqual({
				days: 30,
				highlight,
				nonBusinessStart: false,
			});
		},
	);

	it.each([
		"2026-01-01",
		"2026-04-03",
		"2026-04-21",
		"2026-05-01",
		"2026-06-04",
		"2026-06-26",
		"2026-08-15",
		"2026-09-07",
		"2026-10-04",
		"2026-10-12",
		"2026-11-02",
		"2026-11-15",
		"2026-11-20",
		"2026-12-25",
		"2026-08-01",
		"2026-08-02",
	])("excludes holiday or weekend %s", (date) => {
		expect(vacationHighlight(date, date)).toEqual({
			days: 1,
			highlight: true,
			nonBusinessStart: true,
		});
	});

	it.each([
		"2026-02-16",
		"2026-02-17",
		"2026-04-02",
		"2026-04-20",
		"2026-06-05",
		"2026-08-17",
		"2026-10-05",
		"2026-11-16",
	])("does not treat optional days or substitutes as holidays: %s", (date) => {
		expect(vacationHighlight(date, date).nonBusinessStart).toBe(false);
	});

	it("flags a nonbusiness start without moving dates or adding a false highlight", () => {
		expect(vacationHighlight("2026-08-01", "2026-08-30")).toEqual({
			days: 30,
			highlight: false,
			nonBusinessStart: true,
		});
	});

	it("uses inclusive calendar days for short vacations", () => {
		expect(vacationHighlight("2026-09-01", "2026-09-20")).toEqual({
			days: 20,
			highlight: true,
			nonBusinessStart: false,
		});
	});

	it("explains likely typing errors without correcting the dates", () => {
		expect(() => vacationHighlight("2026-08-01", "2026-08-31")).toThrow(
			/ultrapassa 30 dias.*erro de digitação/,
		);
		expect(() => vacationHighlight("2026-08-10", "2026-08-09")).toThrow(
			/data final.*data inicial/,
		);
	});

	it.each([
		["2026-02-29", "2026-03-10"],
		["2026-02-31", "2026-03-10"],
		["2026-13-01", "2026-13-10"],
		["2026-00-01", "2026-01-10"],
		["2026-08-00", "2026-08-10"],
		["2026-08-10", "2026-08-09"],
		["2026-08-01", "2026-08-31"],
		["2026-8-01", "2026-08-10"],
		["2026-08-01T00:00:00Z", "2026-08-10"],
		["01/08/2026", "10/08/2026"],
		["", "2026-08-10"],
	])("rejects invalid period %s to %s", (start, end) => {
		expect(() => vacationHighlight(start, end)).toThrow(FeriasCalendarError);
	});

	it("requires a reviewed calendar before another start year", () => {
		expect(() => vacationHighlight("2027-01-04", "2027-02-02")).toThrow(
			/calendário/,
		);
		expect(() => vacationHighlight("2025-12-01", "2025-12-30")).toThrow(
			/calendário/,
		);
	});

	it("exposes calendar revision for source consistency", () => {
		expect(FERIAS_CALENDAR_VERSION).toBe("umuarama-2026-v1");
	});
});
