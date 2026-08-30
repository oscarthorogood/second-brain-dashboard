import { describe, expect, it } from "vitest";
import {
	boardHeight,
	boardMetrics,
	cellFromPoint,
	MIN_COLUMNS,
	moveCard,
	packCards,
	packedRows,
	placementRect,
	reorderIndex,
} from "../src/grid";
import type { DashboardCard } from "../src/types";
import { GRID_CELL, GRID_GAP, SIZE_SPECS, sizeSpec, type WidgetSize } from "../src/widgetsize";

/**
 * The board has no stored geometry: a widget's size is one of four, its
 * position is its index in the array, and everything else is derived by the
 * packer on every render. These tests pin the derivation — that the reference's
 * tile sizes come back out of the grid, that packing fills gaps in reading
 * order, and that a drag reorders rather than displaces.
 */

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

	it("gains columns as the board widens, keeping the cell constant", () => {
		const narrow = boardMetrics(700);
		const wide = boardMetrics(1400);
		expect(wide.cell).toBe(narrow.cell);
		expect(wide.columns).toBeGreaterThan(narrow.columns);
	});

	it("never lays out below the width of a medium widget", () => {
		expect(boardMetrics(10).columns).toBe(MIN_COLUMNS);
		expect(boardMetrics(0).columns).toBe(MIN_COLUMNS);
	});

	it("scales the whole grid together", () => {
		const one = boardMetrics(1200, 1);
		const big = boardMetrics(1200, 2);
		expect(big.cell).toBe(one.cell * 2);
		expect(big.gap).toBe(one.gap * 2);
		// Same board, larger widgets, so fewer of them fit across.
		expect(big.columns).toBeLessThan(one.columns);
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

	it("clamps a widget wider than the board rather than overflowing it", () => {
		// An extra-large widget is eight columns; a four-column board has to
		// give it the full width instead of letting it run off the edge.
		const [placement] = packCards([widget("xlarge")], MIN_COLUMNS);
		expect(placement.cols).toBe(MIN_COLUMNS);
	});
});

describe("board geometry", () => {
	it("measures a tile at its reference pixel size", () => {
		const metrics = boardMetrics(1200);
		const [placement] = packCards([widget("medium")], metrics.columns);
		const rect = placementRect(placement, metrics);
		expect(rect.width).toBe(338);
		expect(rect.height).toBe(158);
	});

	it("is as tall as its packed rows", () => {
		const metrics = boardMetrics(1200);
		const placements = packCards([widget("large")], metrics.columns);
		expect(packedRows(placements)).toBe(4);
		expect(boardHeight(placements, metrics)).toBe(354 - 16);
	});

	it("has no height when it has no widgets", () => {
		expect(boardHeight([], boardMetrics(1200))).toBe(0);
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
