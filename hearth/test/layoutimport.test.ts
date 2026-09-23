import { describe, expect, it } from "vitest";
import { exportSettings, importSettings } from "../src/layout";
import { DEFAULT_SETTINGS, type DashboardCard, type HomeSettings } from "../src/types";

/**
 * A settings export is also the automatic pre-update backup, so anything the
 * round-trip loses is something "undo this update" silently throws away.
 */

function settings(over: Partial<HomeSettings> = {}): HomeSettings {
	return { ...structuredClone(DEFAULT_SETTINGS), ...over };
}

function roundTrip(from: HomeSettings): HomeSettings {
	const into = settings();
	const err = importSettings(into, exportSettings(from));
	expect(err).toBeNull();
	return into;
}

describe("settings export → import round-trip", () => {
	it("keeps the config of widget kinds that have no dedicated sanitizer", () => {
		const cards = [
			{ id: "w", kind: "weather", size: "medium", weather: { place: "London|51.5|-0.1", units: "metric" } },
			{ id: "s", kind: "calsync", size: "medium", calsync: { classes: { url: "https://x/a.ics" }, refreshMin: 30 } },
			{ id: "d", kind: "detail", size: "medium", detail: { target: "Lectures/L01.md" } },
		] as unknown as DashboardCard[];
		const back = roundTrip(settings({ cards }));
		expect(back.cards.find((c) => c.id === "w")?.weather).toEqual(cards[0].weather);
		expect(back.cards.find((c) => c.id === "s")?.calsync).toEqual(cards[1].calsync);
		expect(back.cards.find((c) => c.id === "d")?.detail).toEqual(cards[2].detail);
	});

	it("drops prototype-reaching keys from imported plain config", () => {
		const json = JSON.stringify({
			sbdSettings: 1,
			sbdLayout: 4,
			cards: [{ id: "p", kind: "pet", size: "small", pet: JSON.parse('{"name":"Rex","__proto__":{"polluted":true}}') as unknown }],
		});
		const into = settings();
		expect(importSettings(into, json)).toBeNull();
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect((into.cards[0] as unknown as { pet: Record<string, unknown> }).pet.name).toBe("Rex");
	});

	it("keeps the calendar's agenda length", () => {
		const cards = [{ id: "c", kind: "calendar", size: "large", calendar: { agendaDays: 14 } }] as unknown as DashboardCard[];
		expect(roundTrip(settings({ cards })).cards[0].calendar?.agendaDays).toBe(14);
	});

	it("restores a board with no widgets at all", () => {
		// A search-launcher-only vault: rejecting `cards: []` aborted the whole import.
		const back = roundTrip(settings({ cards: [], title: "Launcher" }));
		expect(back.cards).toEqual([]);
		expect(back.title).toBe("Launcher");
	});

	it("carries the settings that used to be left out", () => {
		const back = roundTrip(
			settings({
				themeColorTarget: "both",
				liveRefresh: true,
				focusSearchOnOpen: true,
				arrangeButtonVisibility: "hover",
				customFileIcons: false,
				backgroundSkyAnimate: false,
			}),
		);
		expect(back.themeColorTarget).toBe("both");
		expect(back.liveRefresh).toBe(true);
		expect(back.focusSearchOnOpen).toBe(true);
		expect(back.arrangeButtonVisibility).toBe("hover");
		expect(back.customFileIcons).toBe(false);
		expect(back.backgroundSkyAnimate).toBe(false);
	});

	it("accepts a weather-sky background", () => {
		const back = roundTrip(settings({ backgroundKind: "weather", backgroundValue: "London|51.5|-0.1" }));
		expect(back.backgroundKind).toBe("weather");
	});
});
