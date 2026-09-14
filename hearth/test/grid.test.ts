import { describe, expect, it } from "vitest";
import {
	BOARD_COLUMNS,
	BOARD_ROWS,
	boardHeight,
	boardMetrics,
	cellFromPoint,
	drawnRows,
	gridSpan,
	moveCard,
	packCards,
	packedRows,
	placementRect,
	reorderIndex,
} from "../src/grid";
import {
	clampWidgetScale,
	type DashboardCard,
	WIDGET_SCALE_MAX,
	WIDGET_SCALE_MIN,
} from "../src/types";
import { GRID_CELL, GRID_GAP, SIZE_SPECS, sizeSpec, type WidgetSize } from "../src/widgetsize";

/**
 * The board has no stored geometry: a widget's size is one of four, its
 * position is its index in the array, and everything else is derived by the
 * packer on every render. These tests pin the derivation — that the reference's
 * tile sizes come back out of the grid, that packing fills gaps in reading
 * order, and that a drag reorders rather than displaces.
 */

/** The reference page's width in pixels: BOARD_COLUMNS cells and their gutters
 * at the reference cell size, i.e. the width at which the board draws 1:1. */
const REFERENCE_PAGE_WIDTH = BOARD_COLUMNS * GRID_CELL + (BOARD_COLUMNS - 1) * GRID_GAP;

let seq = 0;
function widget(size: WidgetSize, kind: DashboardCard["kind"] = "recent"): DashboardCard {
	return { id: `card-${seq++}`, kind, size };
}

describe("the invisible grid", () => {
	it("reproduces the reference's tile widths exactly", () => {
		// Widget Set captions its tiles S 158x158, M 338x158, L 338x354 and
		// XL 702x354. The grid is what has to produce the first two numbers of
		// each: 2 cells is 158 and 4 cells is 338.
		const span = (cells: number) => cells * GRID_CELL + (cells - 1) * GRID_GAP;
		expect(span(2)).toBe(158);
		expect(span(4)).toBe(338);
	});

	it("is sixteen cells across and eight down, whatever the pane measures", () => {
		// The page is a fixed 16x8, so the column count is not a function of the
		// width any more.
		expect(BOARD_COLUMNS).toBe(16);
		expect(BOARD_ROWS).toBe(8);
		for (const width of [0, 10, 320, 700, 1400, 4000]) {
			expect(boardMetrics(width).columns).toBe(BOARD_COLUMNS);
		}
	});

	it("holds eight large widgets, four across and two down", () => {
		// The page this board is drawn for: a large is 4x4, so 16/4 by 8/4 is
		// four across and two down.
		expect(BOARD_COLUMNS / SIZE_SPECS.large.cols).toBe(4);
		expect(BOARD_ROWS / SIZE_SPECS.large.rows).toBe(2);
		const larges = Array.from({ length: 8 }, () => widget("large"));
		const placements = packCards(larges, BOARD_COLUMNS);
		expect(packedRows(placements)).toBe(BOARD_ROWS);
		// The eighth one lands in the bottom-right corner, so the page is full
		// and nothing has spilled past it.
		expect(placements[7]).toMatchObject({ col: 12, row: 4, cols: 4, rows: 4 });
	});

	it("takes any other combination of sizes on the same page", () => {
		// The other three footprints divide into 16x8 just as evenly.
		const fills = (size: WidgetSize, count: number) => {
			const spec = SIZE_SPECS[size];
			expect((BOARD_COLUMNS / spec.cols) * (BOARD_ROWS / spec.rows)).toBe(count);
			const cards = Array.from({ length: count }, () => widget(size));
			expect(packedRows(packCards(cards, BOARD_COLUMNS))).toBe(BOARD_ROWS);
		};
		fills("small", 32);
		fills("medium", 16);
		fills("xlarge", 4);
	});

	it("scales the cell with the pane instead of repacking the board", () => {
		// This is the whole point: a wider pane draws the SAME eight columns
		// bigger, so no widget changes slot when the window is resized.
		const narrow = boardMetrics(700);
		const wide = boardMetrics(1400);
		expect(wide.columns).toBe(narrow.columns);
		expect(wide.cell).toBeGreaterThan(narrow.cell);
		expect(wide.gap).toBeGreaterThan(narrow.gap);
	});

	it("draws the reference page at the reference cell", () => {
		// 16 cells and 15 gutters is 16*68 + 15*22 = 1418.
		const metrics = boardMetrics(REFERENCE_PAGE_WIDTH);
		expect(REFERENCE_PAGE_WIDTH).toBe(1418);
		expect(metrics.cell).toBe(GRID_CELL);
		expect(metrics.gap).toBe(GRID_GAP);
	});

	it("fills the width it is given", () => {
		const width = 1240;
		const metrics = boardMetrics(width);
		// Slack is only the cell's and gutter's own rounding, at most half a
		// pixel on each of the 16 cells and 15 gutters.
		expect(Math.abs(gridSpan(BOARD_COLUMNS, metrics) - width)).toBeLessThanOrEqual(16);
	});

	it("falls back to the reference cell when there is nothing to measure", () => {
		expect(boardMetrics(0).cell).toBe(GRID_CELL);
	});

	it("fits the height too, so all eight rows stay on screen", () => {
		const wide = 4000;
		// A pane far wider than it is tall: the height is what binds, and all
		// eight rows have to land inside it.
		const metrics = boardMetrics(wide, 1, 400);
		expect(gridSpan(BOARD_ROWS, metrics)).toBeLessThanOrEqual(400);
		// Width alone would have drawn the page far larger.
		expect(metrics.cell).toBeLessThan(boardMetrics(wide).cell);
	});

	it("never draws a page larger than the box it was fitted to", () => {
		// The regression this pins: cell and gutter were ROUNDED, and a page is
		// a whole multiple of both, so the error scaled by the track count and
		// the fitted page came out bigger than the space it had to fit — the
		// bottom row under the fold, or a horizontal overflow.
		for (const width of [320, 400, 699, 1024, 1418, 1600, 2560, 3840]) {
			for (const height of [0, 200, 400, 698, 900, 1600]) {
				const m = boardMetrics(width, 1, height);
				expect(gridSpan(BOARD_COLUMNS, m)).toBeLessThanOrEqual(width);
				if (height > 0) expect(gridSpan(BOARD_ROWS, m)).toBeLessThanOrEqual(height);
			}
		}
	});

	it("ignores the height when none is offered", () => {
		expect(boardMetrics(1200, 1, 0)).toEqual(boardMetrics(1200));
	});

	it("scales the whole page together", () => {
		const full = boardMetrics(1200, 1);
		const small = boardMetrics(1200, WIDGET_SCALE_MIN);
		expect(small.cell).toBeLessThan(full.cell);
		expect(small.gap).toBeLessThan(full.gap);
		// Same eight columns, drawn smaller — the knob sizes the page, it does
		// not change how many widgets fit across it.
		expect(small.columns).toBe(full.columns);
		// The page then stops filling the pane, which is what leaves the room
		// the board is centred in.
		expect(gridSpan(BOARD_COLUMNS, small)).toBeLessThan(1200);
	});

	it("caps the scale at the size that fills the pane", () => {
		// The cell is fitted to the pane, so there is nothing above 1 to ask
		// for; a board saved at the old ceiling of 2 lands on it.
		expect(WIDGET_SCALE_MAX).toBe(1);
		expect(clampWidgetScale(2)).toBe(1);
		expect(clampWidgetScale(0.1)).toBe(WIDGET_SCALE_MIN);
	});
});

describe("the four sizes", () => {
	it("are Apple's four footprints", () => {
		expect(SIZE_SPECS.small).toMatchObject({ cols: 2, rows: 2 });
		expect(SIZE_SPECS.medium).toMatchObject({ cols: 4, rows: 2 });
		expect(SIZE_SPECS.large).toMatchObject({ cols: 4, rows: 4 });
		expect(SIZE_SPECS.xlarge).toMatchObject({ cols: 8, rows: 4 });
	});

	it("give the two-row tiles a 30px corner and the four-row tiles 40px", () => {
		expect(SIZE_SPECS.small.radius).toBe(30);
		expect(SIZE_SPECS.medium.radius).toBe(30);
		expect(SIZE_SPECS.large.radius).toBe(40);
		expect(SIZE_SPECS.xlarge.radius).toBe(40);
	});

	it("make the search widget's wide option two rows, not four", () => {
		// The reference's one documented exception: SEARCH is captioned
		// 4x2 / 702x158, so its extra-large tile is 8x2 with a 30px corner.
		expect(sizeSpec("searchbar", "xlarge")).toEqual({ cols: 8, rows: 2, radius: 30 });
		// Every other kind keeps the table.
		expect(sizeSpec("recent", "xlarge")).toEqual(SIZE_SPECS.xlarge);
	});
});

describe("packCards", () => {
	it("places widgets in reading order", () => {
		const a = widget("small");
		const b = widget("small");
		const placements = packCards([a, b], 8);
		expect(placements[0]).toMatchObject({ card: a, col: 0, row: 0 });
		expect(placements[1]).toMatchObject({ card: b, col: 2, row: 0 });
	});

	it("wraps to the next row when a widget doesn't fit", () => {
		// Two mediums (4 wide each) fill an 8-column row; the third wraps.
		const cards = [widget("medium"), widget("medium"), widget("medium")];
		const placements = packCards(cards, 8);
		expect(placements[2]).toMatchObject({ col: 0, row: 2 });
	});

	it("backfills a gap an earlier row left open", () => {
		// A large widget (4x4) beside a small one (2x2) leaves a 2x2 hole at
		// columns 6-7 of the first two rows. The next small widget belongs in
		// that hole, not on a new row — this is what closes gaps when a widget
		// is moved or removed.
		const large = widget("large");
		const first = widget("small");
		const filler = widget("small");
		const placements = packCards([large, first, filler], 8);
		expect(placements[1]).toMatchObject({ card: first, col: 4, row: 0 });
		expect(placements[2]).toMatchObject({ card: filler, col: 6, row: 0 });
	});

	it("never overlaps two widgets", () => {
		const cards = [
			widget("xlarge"),
			widget("small"),
			widget("large"),
			widget("medium"),
			widget("small"),
			widget("large"),
		];
		const placements = packCards(cards, 8);
		const taken = new Set<string>();
		for (const p of placements) {
			for (let r = p.row; r < p.row + p.rows; r++) {
				for (let c = p.col; c < p.col + p.cols; c++) {
					const key = `${r}:${c}`;
					expect(taken.has(key)).toBe(false);
					taken.add(key);
				}
			}
		}
	});

	it("fits two extra-large widgets side by side across the board", () => {
		// An extra-large is 8 wide, so the 16-column page takes two of them in a
		// row with nothing clamped away.
		const placements = packCards([widget("xlarge"), widget("xlarge")], BOARD_COLUMNS);
		expect(placements[0]).toMatchObject({ col: 0, row: 0, cols: 8, rows: 4 });
		expect(placements[1]).toMatchObject({ col: 8, row: 0, cols: 8, rows: 4 });
	});

	it("clamps a widget wider than the grid it is packed onto", () => {
		// Only reachable from a caller packing onto a narrower grid of its own,
		// but a widget must never run off the edge of one.
		const [placement] = packCards([widget("xlarge")], 4);
		expect(placement.cols).toBe(4);
	});
});

describe("board geometry", () => {
	it("measures a tile at its reference pixel size", () => {
		// On a board drawn at the reference page width, the cell is the
		// reference cell and the tiles come out at their captioned sizes.
		const metrics = boardMetrics(REFERENCE_PAGE_WIDTH);
		const [placement] = packCards([widget("medium")], metrics.columns);
		const rect = placementRect(placement, metrics);
		expect(rect.width).toBe(338);
		expect(rect.height).toBe(158);
	});

	it("is as tall as its packed rows", () => {
		const metrics = boardMetrics(REFERENCE_PAGE_WIDTH);
		const placements = packCards([widget("large")], metrics.columns);
		expect(packedRows(placements)).toBe(4);
		expect(boardHeight(placements, metrics)).toBe(354 - 16);
	});

	it("has no height when it has no widgets", () => {
		expect(boardHeight([], boardMetrics(1200))).toBe(0);
	});

	it("is drawn eight rows tall even when the widgets don't fill it", () => {
		// The page reserves its own height, so adding or removing a widget
		// doesn't resize the board (and so every widget on it).
		expect(drawnRows([])).toBe(BOARD_ROWS);
		expect(drawnRows(packCards([widget("small")], BOARD_COLUMNS))).toBe(BOARD_ROWS);
	});

	it("keeps the extra rows of a board packed taller than the page", () => {
		// Five extra-large widgets pack two to a band, so three bands: twelve
		// rows. The page is a drawn height, not a cap.
		const cards = Array.from({ length: 5 }, () => widget("xlarge"));
		expect(drawnRows(packCards(cards, BOARD_COLUMNS))).toBe(12);
	});
});

describe("reordering", () => {
	it("puts a widget after everything that starts earlier in reading order", () => {
		const a = widget("small");
		const b = widget("small");
		const c = widget("small");
		const cards = [a, b, c];
		// Measured on the board as it is once the dragged widget is lifted out:
		// with `a` gone, b sits at column 0 and c at column 2, so a drop at
		// column 4 is past both of them.
		expect(reorderIndex(cards, a, 4, 0, 8)).toBe(2);
		// Dropped at the very start: nothing precedes it.
		expect(reorderIndex(cards, c, 0, 0, 8)).toBe(0);
	});

	it("moves a widget within the array", () => {
		const a = widget("small");
		const b = widget("small");
		const c = widget("small");
		const cards = [a, b, c];
		expect(moveCard(cards, a, 2)).toBe(true);
		expect(cards).toEqual([b, c, a]);
	});

	it("aims a drop at the slot under it, not one short of it", () => {
		// The bug this pins: measuring against a layout that still contained the
		// dragged widget put every rightward drag one slot behind the pointer.
		const a = widget("small");
		const b = widget("small");
		const c = widget("small");
		const cards = [a, b, c];
		const index = reorderIndex(cards, a, 4, 0, 8);
		moveCard(cards, a, index);
		expect(cards).toEqual([b, c, a]);
	});

	it("reports no change when a widget is already where it belongs", () => {
		const a = widget("small");
		const cards = [a, widget("small")];
		expect(moveCard(cards, a, 0)).toBe(false);
	});

	it("reorders rather than displaces: every widget survives a move", () => {
		const cards = [widget("small"), widget("large"), widget("medium"), widget("small")];
		const moved = cards[3];
		moveCard(cards, moved, 0);
		expect(cards).toHaveLength(4);
		expect(new Set(cards).size).toBe(4);
		expect(cards[0]).toBe(moved);
	});
});

describe("cellFromPoint", () => {
	it("maps a point to the cell under it", () => {
		const metrics = boardMetrics(1200);
		const step = metrics.cell + metrics.gap;
		expect(cellFromPoint(0, 0, metrics)).toEqual({ col: 0, row: 0 });
		expect(cellFromPoint(step * 2 + 4, step * 3 + 4, metrics)).toEqual({ col: 2, row: 3 });
	});

	it("clamps to the board rather than returning a cell off it", () => {
		const metrics = boardMetrics(1200);
		const far = cellFromPoint(999_999, -50, metrics);
		expect(far.col).toBe(metrics.columns - 1);
		expect(far.row).toBe(0);
	});
});
