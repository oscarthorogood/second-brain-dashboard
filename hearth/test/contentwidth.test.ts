import { describe, expect, it } from "vitest";
import {
	CONTENT_WIDTH_MAX,
	CONTENT_WIDTH_MIN,
	contentWidthIsFull,
	DEFAULT_SETTINGS,
	effectiveMaxWidth,
	type HomeSettings,
} from "../src/types";
import { boardMetrics } from "../src/grid";
import { BOARD_COLUMNS } from "../src/grid";

/**
 * The content column's cap, and what it costs.
 *
 * The board is a fixed 16-column page, so its width is exactly `16 × cell` and
 * the side margin is whatever the pane has left over. The cap therefore does
 * two things at once: it decides the margin *and* it decides how large the
 * widgets are drawn. It used to stop at 1600px — which was also the default, so
 * on any wider display the leftover was side margin and no setting could close
 * it. The top of the range now means "fill the pane" instead.
 */

function settings(maxWidth: number): HomeSettings {
	return { ...structuredClone(DEFAULT_SETTINGS), maxWidth };
}

describe("contentWidthIsFull", () => {
	it("is off at the default, so no existing board moves on upgrade", () => {
		// The point of raising the ceiling rather than the default: 1600 was the
		// end stop and is now a mid-range value, and it still means 1600px.
		expect(DEFAULT_SETTINGS.maxWidth).toBe(1600);
		expect(contentWidthIsFull(DEFAULT_SETTINGS)).toBe(false);
		expect(effectiveMaxWidth(DEFAULT_SETTINGS)).toBe(1600);
	});

	it("is off anywhere below the top of the range", () => {
		for (const px of [CONTENT_WIDTH_MIN, 1000, 1600, CONTENT_WIDTH_MAX - 20]) {
			expect(contentWidthIsFull(settings(px))).toBe(false);
		}
	});

	it("is on at the top of the range", () => {
		expect(contentWidthIsFull(settings(CONTENT_WIDTH_MAX))).toBe(true);
	});

	it("stays on above the top, for a hand-edited or newer settings file", () => {
		// `>=`, so a file asking for more than this build's ceiling gets a wider
		// board rather than silently falling back to a narrower one.
		expect(contentWidthIsFull(settings(CONTENT_WIDTH_MAX + 500))).toBe(true);
	});

	it("leaves room above the old ceiling for a modern display", () => {
		expect(CONTENT_WIDTH_MAX).toBeGreaterThan(1600);
	});
});

describe("what filling the pane costs", () => {
	/** The board's drawn width at a given column width, as the grid lays it out. */
	function boardWidth(paneWidth: number): number {
		const m = boardMetrics(paneWidth);
		return BOARD_COLUMNS * m.cell + (BOARD_COLUMNS - 1) * m.gap;
	}

	it("closes the side margin, because the board takes the width it is given", () => {
		// The trade this setting makes: on a 1872px column the capped board draws
		// its 16 columns at the 1600px cell and leaves the rest as margin.
		const pane = 1872;
		const capped = boardWidth(1600);
		const full = boardWidth(pane);
		expect(pane - full).toBeLessThan(pane - capped);
		// And the margin genuinely nearly closes, rather than merely shrinking.
		expect(pane - full).toBeLessThan(30);
	});

	it("draws the widgets larger, which is the same knob", () => {
		// Stated as a test because it is the thing a reader of this setting most
		// needs to know: there is no width-without-scale option on a fixed-column
		// board.
		expect(boardMetrics(1872).cell).toBeGreaterThan(boardMetrics(1600).cell);
	});
});
