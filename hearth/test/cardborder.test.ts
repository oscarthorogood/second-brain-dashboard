import { describe, expect, it } from "vitest";
import {
	DEFAULT_SETTINGS,
	effectiveCardBorderWidth,
	FIXED_CARD_BORDER_WIDTH,
	resolveCardBorderWidth,
	type DashboardCard,
	type HomeSettings,
} from "../src/types";

/**
 * Card border width used to be settable at three levels — global, per
 * dashboard and per card — with a fallback chain between them. The per-
 * dashboard level went with multi-page support; the border is now a fixed
 * part of the dashboard's glass identity, so the remaining levels are ignored
 * and {@link FIXED_CARD_BORDER_WIDTH} always wins, however a saved layout
 * (old or hand-edited) sets these fields.
 */

function settings(): HomeSettings {
	return structuredClone(DEFAULT_SETTINGS);
}

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
	return { id: "c1", kind: "text", title: "", x: 0, y: 0, w: 2, h: 2, ...overrides };
}

describe("resolveCardBorderWidth", () => {
	it("is fixed regardless of the global setting", () => {
		const s = settings();
		s.cardBorderWidth = 3;
		expect(effectiveCardBorderWidth(s)).toBe(FIXED_CARD_BORDER_WIDTH);
		expect(resolveCardBorderWidth(s, card())).toBe(FIXED_CARD_BORDER_WIDTH);
	});

	it("is fixed regardless of a per-card override, in or out of range", () => {
		const s = settings();
		s.cardBorderWidth = 3;
		expect(resolveCardBorderWidth(s, card({ cardBorderWidth: 0 }))).toBe(FIXED_CARD_BORDER_WIDTH);
		expect(resolveCardBorderWidth(s, card({ cardBorderWidth: 400 }))).toBe(
			FIXED_CARD_BORDER_WIDTH,
		);
		expect(resolveCardBorderWidth(s, card({ cardBorderWidth: -4 }))).toBe(FIXED_CARD_BORDER_WIDTH);
		expect(resolveCardBorderWidth(s, card({ cardBorderWidth: Number.NaN }))).toBe(
			FIXED_CARD_BORDER_WIDTH,
		);
	});
});
