import { describe, expect, it } from "vitest";
import {
	DEFAULT_FILING_AHEAD_DAYS,
	DEFAULT_FILING_PAST_DAYS,
	DEFAULT_SETTINGS,
	effectiveFilingFolders,
	effectiveFilingWindow,
	migrateSettings,
	type DashboardCard,
	type HomeSettings,
} from "../src/types";
import { INBOX_FOLDER, UNSORTED_FOLDER } from "../src/vaultfiling";

/**
 * Where the two trays are, and how much calendar the inbox takes, are
 * properties of one filing *system* rather than of the widgets that fill it:
 * every sync widget writes into the same inbox and shares one record of what it
 * has already written, and whoever drains a tray reads one folder. So they live
 * in plugin settings, and these tests pin the two things that makes possible —
 * reading them back consistently however the file was edited, and lifting the
 * per-widget values a pre-move board still carries.
 */

function settings(over: Partial<HomeSettings> = {}): HomeSettings {
	return { ...structuredClone(DEFAULT_SETTINGS), ...over };
}

function syncCard(calsync: DashboardCard["calsync"]): DashboardCard {
	return { id: "c", kind: "calsync", size: "medium", calsync };
}

/**
 * Run the migration the way `loadSettings` does: `raw` is the persisted
 * `data.json`, and `s` is it merged over the defaults. Passing the cards in
 * both matters — a `raw` with no `cards` key is a fresh install, and the
 * migration replaces the board with the starter cards before it ever reaches
 * the widget config this is about.
 */
function migrate(s: HomeSettings, raw: Record<string, unknown> = {}): void {
	migrateSettings(s, { cards: s.cards, ...raw });
}

describe("effectiveFilingFolders", () => {
	it("defaults to Claude's own two trays", () => {
		expect(effectiveFilingFolders(settings())).toEqual({
			inbox: INBOX_FOLDER,
			unsorted: UNSORTED_FOLDER,
		});
	});

	it("uses the folders the vault named", () => {
		const s = settings({ filingInboxFolder: "Agent/in", filingUnsortedFolder: "Agent/loose" });
		expect(effectiveFilingFolders(s)).toEqual({ inbox: "Agent/in", unsorted: "Agent/loose" });
	});

	it("normalises on read, so a written note and a counted one are the same folder", () => {
		// The field holds what the user typed; a trailing slash here and none
		// there would otherwise write to one path and count at another, leaving a
		// tray that looks permanently empty.
		const s = settings({ filingInboxFolder: "/Agent/in/", filingUnsortedFolder: " Agent / loose " });
		expect(effectiveFilingFolders(s)).toEqual({ inbox: "Agent/in", unsorted: "Agent/loose" });
	});

	it("falls back when a field is cleared or was hand-edited to nonsense", () => {
		const s = settings({ filingInboxFolder: "", filingUnsortedFolder: "  " });
		expect(effectiveFilingFolders(s)).toEqual({ inbox: INBOX_FOLDER, unsorted: UNSORTED_FOLDER });
	});
});

describe("effectiveFilingWindow", () => {
	it("defaults to a window short enough to keep the inbox readable", () => {
		expect(effectiveFilingWindow(settings())).toEqual({
			pastDays: DEFAULT_FILING_PAST_DAYS,
			aheadDays: DEFAULT_FILING_AHEAD_DAYS,
		});
	});

	it("uses the days the vault set", () => {
		expect(effectiveFilingWindow(settings({ filingPastDays: 0, filingAheadDays: 90 }))).toEqual({
			pastDays: 0,
			aheadDays: 90,
		});
	});

	it("falls back rather than syncing a negative or unparseable window", () => {
		const s = settings({ filingAheadDays: -5 });
		(s as unknown as Record<string, unknown>).filingPastDays = "seven";
		expect(effectiveFilingWindow(s)).toEqual({
			pastDays: DEFAULT_FILING_PAST_DAYS,
			aheadDays: DEFAULT_FILING_AHEAD_DAYS,
		});
	});
});

describe("migrateSettings: the sync window moves off the widgets", () => {
	it("lifts a card's window into settings and drops it from the card", () => {
		const card = syncCard({ aheadDays: 45, pastDays: 2, refreshMin: 30 });
		const s = settings({ cards: [card] });
		migrate(s);
		expect(s.filingAheadDays).toBe(45);
		expect(s.filingPastDays).toBe(2);
		// Gone from the card, so the migration converges and stops re-saving.
		expect(card.calsync?.aheadDays).toBeUndefined();
		expect(card.calsync?.pastDays).toBeUndefined();
		// The refresh interval is this widget's own timer and stays put.
		expect(card.calsync?.refreshMin).toBe(30);
	});

	it("the first card wins, and every later card's value is dropped", () => {
		// Two sync widgets on one board could hold two answers to a question the
		// single shared inbox only has one of. Averaging or maxing them would be
		// a number nobody chose.
		const first = syncCard({ aheadDays: 45 });
		const second = syncCard({ aheadDays: 7 });
		const s = settings({ cards: [first, second] });
		migrate(s);
		expect(s.filingAheadDays).toBe(45);
		expect(second.calsync?.aheadDays).toBeUndefined();
	});

	it("never overwrites a value already chosen in the settings pane", () => {
		const card = syncCard({ aheadDays: 45 });
		const s = settings({ cards: [card], filingAheadDays: 14 });
		migrate(s, { filingAheadDays: 14 });
		expect(s.filingAheadDays).toBe(14);
		expect(card.calsync?.aheadDays).toBeUndefined();
	});

	it("leaves a board with nothing to migrate alone", () => {
		const card = syncCard({ refreshMin: 30 });
		const s = settings({ cards: [card] });
		migrate(s);
		expect(s.filingAheadDays).toBe(DEFAULT_FILING_AHEAD_DAYS);
		expect(s.filingPastDays).toBe(DEFAULT_FILING_PAST_DAYS);
	});
});
