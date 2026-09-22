import { describe, expect, it } from "vitest";
import {
	DEFAULT_SETTINGS,
	migrateSettings,
	settingsAreReadable,
	type DashboardCard,
	type HomeSettings,
} from "../src/types";

/**
 * What a plugin update must never cost the user.
 *
 * An update replaces the plugin's files under a running app — BRAT does it on
 * every beta — and leaves `data.json` alone. So the board and the settings
 * survive by themselves, and the only way to lose them is for this code to
 * throw them away: by reading a board it half-recognises and emptying it, or by
 * reading nothing at all and writing a fresh install over the real file.
 *
 * These pin both: the board's own survival through `migrateSettings`, and the
 * read decision (`settingsAreReadable`) that stands between an unreadable file
 * and a starter board written over it.
 */

function settings(cards: DashboardCard[]): HomeSettings {
	return { ...structuredClone(DEFAULT_SETTINGS), cards };
}

/** Run the migration the way `loadSettings` does: `raw` is the persisted
 * `data.json` and `s` is it merged over the defaults. A `raw` with no `cards`
 * key is a fresh install, which seeds the starter board instead. */
function migrate(s: HomeSettings): void {
	migrateSettings(s, { cards: s.cards });
}

function card(id: string, size: unknown = "medium"): DashboardCard {
	return { id, kind: "text", size } as DashboardCard;
}

describe("migrateSettings: a board survives one bad widget", () => {
	it("keeps every widget that carries a valid size", () => {
		const s = settings([card("a"), card("b", "large"), card("c", "small")]);
		migrate(s);
		expect(s.cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
	});

	it("drops only the unreadable widget, not the board around it", () => {
		// The regression this exists for: one half-written card — a save
		// interrupted, a beta that wrote a size this build doesn't know, one
		// hand-edited entry — used to empty `cards` outright, taking every other
		// widget with it, on load and silently.
		// The size key present but empty — a default parameter would swallow an
		// explicit `undefined`, so this card is built by hand.
		const broken = { id: "broken", kind: "text" } as unknown as DashboardCard;
		const s = settings([card("a"), broken, card("c")]);
		migrate(s);
		expect(s.cards.map((c) => c.id)).toEqual(["a", "c"]);
	});

	it("drops a size no build of this plugin has ever written", () => {
		const s = settings([card("a"), card("future", "enormous")]);
		migrate(s);
		expect(s.cards.map((c) => c.id)).toEqual(["a"]);
	});

	it("still empties a board saved before the fixed grid", () => {
		// Every widget on a free-form board carries coordinates and no size, so
		// per-card dropping reaches the same answer the whole-board rule did —
		// which is the one case that rule was written for.
		const s = settings([
			{ id: "a", kind: "text", x: 0, y: 0, w: 4, h: 3 } as unknown as DashboardCard,
			{ id: "b", kind: "clock", x: 4, y: 0, w: 4, h: 3 } as unknown as DashboardCard,
		]);
		migrate(s);
		expect(s.cards).toEqual([]);
	});

	it("leaves a good board's array alone rather than rebuilding it", () => {
		// Nothing to drop means nothing to write back, which is what keeps an
		// ordinary load from re-saving the board it just read.
		const cards = [card("a"), card("b")];
		const s = settings(cards);
		migrate(s);
		expect(s.cards).toBe(cards);
	});
});


describe("settingsAreReadable", () => {
	it("reads a settings object", () => {
		expect(settingsAreReadable({ cards: [] }, false, true)).toBe(true);
		// An empty object is a real answer too — a data.json holding `{}`.
		expect(settingsAreReadable({}, false, true)).toBe(true);
	});

	it("treats a vault with no settings file as a fresh install", () => {
		// The one case that should get the starter board.
		expect(settingsAreReadable(null, false, false)).toBe(true);
	});

	it("refuses a file that is there but gave nothing back", () => {
		// The update case: the file exists, the read came back empty. Carrying on
		// would seed a starter board and then save it over their real one.
		expect(settingsAreReadable(null, false, true)).toBe(false);
		expect(settingsAreReadable(undefined, false, true)).toBe(false);
	});

	it("refuses a parse that threw, file or no file", () => {
		// A truncated data.json — half-written by a sync client, or by the crash
		// that preceded this launch. There is nothing safe to do but stop.
		expect(settingsAreReadable(null, true, true)).toBe(false);
		expect(settingsAreReadable(null, true, false)).toBe(false);
	});

	it("refuses anything that parsed but is not settings", () => {
		// Valid JSON of the wrong shape is as unusable as invalid JSON, and just
		// as much a sign that the file should not be written over.
		expect(settingsAreReadable([], false, true)).toBe(false);
		expect(settingsAreReadable("{}", false, true)).toBe(false);
		expect(settingsAreReadable(42, false, true)).toBe(false);
	});
});
