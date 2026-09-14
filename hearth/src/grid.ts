import { Component } from "obsidian";
import type { HomeView } from "./view";
import type { DashboardCard } from "./types";
import { GRID_CELL, GRID_GAP as REFERENCE_GAP, sizeSpec } from "./widgetsize";

/**
 * The board's invisible grid.
 *
 * Widgets are neither freely moved nor resized. Each one is one of four fixed
 * footprints (see `widgetsize.ts`) and the board packs them, in the order they
 * appear in `HomeSettings.cards`, into the first slot each fits — so a widget
 * has no stored coordinates at all and the layout is derived on every render.
 * Dragging a widget therefore *reorders the array*; the pack that follows is
 * what makes its neighbours flow out of the way and gaps close behind it, the
 * way a phone home screen behaves.
 *
 * This replaced a continuous free-form engine (per-card `fx/fy/fw/fh`
 * fractions, magnetic edge snapping, eight resize grips and a fit-to-page
 * squeeze). None of it survives: with four fixed sizes on a fixed grid there
 * is no geometry left for a user to get wrong, which is the point.
 */

/** The board's fixed column count.
 *
 * Sixteen cells is four large widgets across (a large is 4x4), which with
 * {@link BOARD_ROWS} is what makes the page hold eight of them. Every other
 * footprint divides into it too: two extra-larges, four mediums, eight smalls.
 * The count does not change with the pane — see {@link boardMetrics} for why. */
export const BOARD_COLUMNS = 16;

/** The board's own height, in grid rows.
 *
 * Eight cells is two large widgets down, so a 16x8 page is a 4x2 arrangement of
 * large tiles: eight of them, which is the page this board is drawn for. Other
 * sizes fill it in the same grid — 32 smalls, 16 mediums, 4 extra-larges, or
 * any mix the packer fits. Content is never truncated to the page: a board
 * packed taller than eight rows simply grows and scrolls. */
export const BOARD_ROWS = 8;

/** The reference board's pixel size: the span of a full 16x8 page at the
 * reference cell and gutter (1418x698). The live cell is this shape scaled to
 * whatever box the board is given. */
const REFERENCE_BOARD_WIDTH =
	BOARD_COLUMNS * GRID_CELL + (BOARD_COLUMNS - 1) * REFERENCE_GAP;
const REFERENCE_BOARD_HEIGHT =
	BOARD_ROWS * GRID_CELL + (BOARD_ROWS - 1) * REFERENCE_GAP;

/** The live geometry of the board's grid, derived from the pane size. */
export interface BoardMetrics {
	/** Side of one square grid cell, in pixels. */
	cell: number;
	/** Gutter between two neighbouring cells, in pixels. */
	gap: number;
	/** How many cells fit across the board. Always {@link BOARD_COLUMNS}. */
	columns: number;
}

/**
 * Measure the grid for a board of `boardWidth` x `availableHeight` pixels.
 *
 * The board is ALWAYS a 16x8 page, and the *cell* is what the pane decides:
 * the reference page is scaled down (or up) until it fits the space given, so
 * resizing the window resizes the widgets and nothing ever changes slot.
 *
 * This replaced a constant cell with a derived column count, where the board
 * gained a column whenever the pane crossed a multiple of 90px. That is the
 * phone-home-screen model, and on a resizable pane it means a widget's
 * neighbours — and its row — are a function of the window width: dragging the
 * split a few pixels repacks the whole board and every widget lands somewhere
 * else. A fixed page can't do that. Whatever the pane measures, a widget keeps
 * the slot it was put in and only its size changes.
 *
 * Both axes are fitted so the whole page stays on screen: the binding
 * constraint is whichever of width and height runs out first, which is what
 * keeps all eight rows visible on a short pane instead of pushing the bottom
 * row under the fold. `availableHeight` is optional — passing 0 (or omitting it)
 * fits width alone, for callers that have no height to offer.
 *
 * `scale` (the user's one remaining board knob) multiplies the fitted cell, so
 * the page can be drawn smaller than the pane on purpose.
 */
export function boardMetrics(boardWidth: number, scale = 1, availableHeight = 0): BoardMetrics {
	let fit = Math.max(0, boardWidth) / REFERENCE_BOARD_WIDTH;
	if (availableHeight > 0) fit = Math.min(fit, availableHeight / REFERENCE_BOARD_HEIGHT);
	// A board with nothing to measure yet (first paint, a pane with no width)
	// draws at the reference cell rather than collapsing to a 1px grid.
	const factor = (fit > 0 ? fit : 1) * scale;
	// Floored, not rounded: the page's span is a whole multiple of the cell and
	// the gutter, so rounding either UP scales that error by the track count and
	// the page comes out wider or taller than the box it was just fitted into —
	// which is the one thing the fit exists to prevent (a 16x8 page fitted to
	// 400px of height rounds to 403px and pushes its bottom row under the fold).
	// Flooring can only ever leave the page a pixel per track short, which is
	// slack the centring absorbs.
	const cell = Math.max(1, Math.floor(GRID_CELL * factor));
	const gap = Math.max(0, Math.floor(REFERENCE_GAP * factor));
	return { cell, gap, columns: BOARD_COLUMNS };
}

/** Where one widget landed on the grid, in cells. */
export interface Placement {
	card: DashboardCard;
	/** Zero-based column of the widget's left edge. */
	col: number;
	/** Zero-based row of the widget's top edge. */
	row: number;
	/** Width in cells, after any clamp to the board's column count. */
	cols: number;
	/** Height in cells. */
	rows: number;
}

/**
 * Pack every widget onto a grid `columns` wide, in array order.
 *
 * First fit, scanning each row left to right before moving down: a widget goes
 * in the earliest slot it fits, so a small widget will drop into a hole an
 * earlier row left open rather than starting a new row. That backfilling is
 * what closes gaps automatically when a widget is moved or removed.
 *
 * The board is {@link BOARD_COLUMNS} wide, which every footprint divides into,
 * so nothing ever needs clamping there; the clamp is kept for callers that pack
 * onto a narrower grid of their own.
 */
export function packCards(cards: readonly DashboardCard[], columns: number): Placement[] {
	const width = Math.max(1, Math.floor(columns));
	/** Row-major occupancy, grown as widgets are placed. */
	const rows: boolean[][] = [];
	const rowAt = (r: number): boolean[] => {
		while (rows.length <= r) rows.push(new Array<boolean>(width).fill(false));
		return rows[r];
	};
	const free = (row: number, col: number, w: number, h: number): boolean => {
		for (let r = row; r < row + h; r++) {
			const cells = rowAt(r);
			for (let c = col; c < col + w; c++) if (cells[c]) return false;
		}
		return true;
	};

	const placements: Placement[] = [];
	for (const card of cards) {
		const spec = sizeSpec(card.kind, card.size);
		const w = Math.min(spec.cols, width);
		const h = Math.max(1, spec.rows);
		let placed = false;
		for (let row = 0; !placed; row++) {
			for (let col = 0; col + w <= width; col++) {
				if (!free(row, col, w, h)) continue;
				for (let r = row; r < row + h; r++) {
					const cells = rowAt(r);
					for (let c = col; c < col + w; c++) cells[c] = true;
				}
				placements.push({ card, col, row, cols: w, rows: h });
				placed = true;
				break;
			}
		}
	}
	return placements;
}

/** How many grid rows the packed board occupies. */
export function packedRows(placements: readonly Placement[]): number {
	return placements.reduce((max, p) => Math.max(max, p.row + p.rows), 0);
}

/** The pixel span of `cells` grid tracks. The cell is square, so this measures
 *  a run of columns and a run of rows alike. */
export function gridSpan(cells: number, metrics: BoardMetrics): number {
	return cells <= 0 ? 0 : cells * metrics.cell + (cells - 1) * metrics.gap;
}

/** The board's pixel height for a packed layout (0 for an empty board). */
export function boardHeight(placements: readonly Placement[], metrics: BoardMetrics): number {
	return gridSpan(packedRows(placements), metrics);
}

/**
 * How many rows the board is DRAWN at.
 *
 * The page is {@link BOARD_ROWS} tall whether or not the widgets fill it, so a
 * half-empty board still reserves its full height — the empty cells are where
 * a widget dragged down there lands, and reserving them is what stops the
 * board's height (and so every widget's size, once the cell is fitted to it)
 * from jumping about as widgets are added. A board packed taller than the page
 * keeps its extra rows and scrolls.
 */
export function drawnRows(placements: readonly Placement[]): number {
	return Math.max(BOARD_ROWS, packedRows(placements));
}

/** The pixel rectangle a placement occupies, relative to the grid element. */
export function placementRect(
	p: Placement,
	metrics: BoardMetrics,
): { left: number; top: number; width: number; height: number } {
	const step = metrics.cell + metrics.gap;
	return {
		left: p.col * step,
		top: p.row * step,
		width: p.cols * metrics.cell + (p.cols - 1) * metrics.gap,
		height: p.rows * metrics.cell + (p.rows - 1) * metrics.gap,
	};
}

/** Position a widget's element at its placement. */
export function applyPlacement(el: HTMLElement, p: Placement, metrics: BoardMetrics): void {
	const rect = placementRect(p, metrics);
	el.style.left = `${rect.left}px`;
	el.style.top = `${rect.top}px`;
	el.style.width = `${rect.width}px`;
	el.style.height = `${rect.height}px`;
}

/** The grid cell a board-relative point falls in, clamped to the board. */
export function cellFromPoint(
	x: number,
	y: number,
	metrics: BoardMetrics,
): { col: number; row: number } {
	const step = metrics.cell + metrics.gap;
	const col = Math.min(metrics.columns - 1, Math.max(0, Math.floor(x / step)));
	const row = Math.max(0, Math.floor(y / step));
	return { col, row };
}

/** Reading-order rank of a cell, used to compare two positions on the board. */
function readingOrder(col: number, row: number, columns: number): number {
	return row * columns + col;
}

/**
 * Where a widget dragged to (`col`, `row`) belongs in the card array.
 *
 * The board reads left to right, top to bottom, so the widget goes after every
 * other widget that starts earlier in that order. Comparing *starts* (rather
 * than hit-testing the widget under the pointer) keeps the answer stable while
 * a big widget straddles several of its neighbours.
 *
 * The comparison is made against the board REPACKED WITHOUT the dragged
 * widget, which is the board the user is actually dropping onto: lifting a
 * widget out pulls every widget after it back into the space it left, so
 * measuring against positions that still include it reads every drop one slot
 * short of where it was aimed. The index this returns is likewise an index
 * into the array without the dragged widget, which is exactly what
 * {@link moveCard} splices at.
 */
export function reorderIndex(
	cards: readonly DashboardCard[],
	dragged: DashboardCard,
	col: number,
	row: number,
	columns: number,
): number {
	const target = readingOrder(col, row, columns);
	const rest = packCards(cards.filter((c) => c !== dragged), columns);
	let index = 0;
	for (const p of rest) {
		if (readingOrder(p.col, p.row, columns) < target) index++;
	}
	return index;
}

/** Move `card` to `index` within `cards`, in place. */
export function moveCard(cards: DashboardCard[], card: DashboardCard, index: number): boolean {
	const from = cards.indexOf(card);
	if (from < 0) return false;
	const to = Math.max(0, Math.min(cards.length - 1, index));
	if (from === to) return false;
	cards.splice(from, 1);
	cards.splice(to, 0, card);
	return true;
}

/** Shared layout state passed to the drag engine. */
export interface GridLayout {
	cards: DashboardCard[];
	elements: Map<DashboardCard, HTMLElement>;
	metrics: BoardMetrics;
}

/** Lay every widget out from the current array order and return the packing. */
export function relayout(gridEl: HTMLElement, layout: GridLayout, skip?: DashboardCard): Placement[] {
	const placements = packCards(layout.cards, layout.metrics.columns);
	for (const p of placements) {
		if (p.card === skip) continue;
		const el = layout.elements.get(p.card);
		if (el) applyPlacement(el, p, layout.metrics);
	}
	// The page is exactly as wide as its sixteen columns and is centred in the
	// pane by CSS (margin-inline: auto), so a board drawn below full scale sits
	// in the middle instead of hugging the left edge.
	gridEl.style.width = `${gridSpan(layout.metrics.columns, layout.metrics)}px`;
	// The page keeps its full eight rows even when the widgets don't fill them
	// (see drawnRows), so the board doesn't resize itself as cards come and go.
	const height = gridSpan(drawnRows(placements), layout.metrics);
	gridEl.style.minHeight = height > 0 ? `${height}px` : "";
	return placements;
}

/** How far a pointer must travel before a press becomes a drag, in pixels.
 * Below this a press is a click (opening the widget's settings), so tapping a
 * widget in arrange mode doesn't nudge it. */
const DRAG_THRESHOLD = 4;

/**
 * Make a widget draggable while the dashboard is in arrange mode.
 *
 * There is no resizing: a widget's size is fixed when it is added. Dragging
 * moves the element under the pointer and, whenever it crosses into a new
 * cell, re-orders the card array and re-packs — so the other widgets shuffle
 * aside live and the dragged one drops into a real slot on release.
 */
export function enableReorderDrag(
	view: HomeView,
	cardEl: HTMLElement,
	gridEl: HTMLElement,
	card: DashboardCard,
	layout: GridLayout,
	component: Component,
	commit: () => void,
): void {
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let grabX = 0;
	let grabY = 0;
	let dragging = false;

	const boardPoint = (ev: PointerEvent): { x: number; y: number } => {
		const board = gridEl.getBoundingClientRect();
		return { x: ev.clientX - board.left, y: ev.clientY - board.top };
	};

	const begin = () => {
		dragging = true;
		cardEl.addClass("is-dragging");
		gridEl.addClass("is-dragging-card");
	};

	const onMove = (ev: PointerEvent) => {
		if (pointerId !== ev.pointerId) return;
		if (!dragging) {
			if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
			begin();
		}
		ev.preventDefault();
		const { x, y } = boardPoint(ev);
		// Follow the pointer, keeping the grab offset so the widget doesn't jump
		// under the cursor when the drag starts.
		const left = x - grabX;
		const top = y - grabY;
		cardEl.style.left = `${left}px`;
		cardEl.style.top = `${top}px`;

		// Re-order from the widget's centre rather than the pointer: with a
		// four-column widget the pointer can sit over a neighbour while most of
		// the widget is still elsewhere, and the centre is what the eye reads as
		// "where it is".
		const centreX = left + cardEl.offsetWidth / 2;
		const centreY = top + cardEl.offsetHeight / 2;
		const { col, row } = cellFromPoint(centreX, centreY, layout.metrics);
		const index = reorderIndex(layout.cards, card, col, row, layout.metrics.columns);
		if (moveCard(layout.cards, card, index)) {
			relayout(gridEl, layout, card);
			applyEdgeMerging(gridEl);
		}
	};

	const finish = (ev: PointerEvent) => {
		if (pointerId !== ev.pointerId) return;
		cardEl.releasePointerCapture?.(ev.pointerId);
		pointerId = null;
		if (!dragging) return;
		dragging = false;
		cardEl.removeClass("is-dragging");
		gridEl.removeClass("is-dragging-card");
		// Snap into the slot the reorder already chose, then persist the order.
		relayout(gridEl, layout);
		applyEdgeMerging(gridEl);
		commit();
	};

	component.registerDomEvent(cardEl, "pointerdown", (ev: PointerEvent) => {
		if (!view.arrangeMode) return;
		// Left button / touch / pen only, and never from a control inside the
		// widget's header (the settings and delete buttons).
		if (ev.button !== 0) return;
		if ((ev.target as HTMLElement).closest(".sbd-card-action")) return;
		pointerId = ev.pointerId;
		startX = ev.clientX;
		startY = ev.clientY;
		const rect = cardEl.getBoundingClientRect();
		grabX = ev.clientX - rect.left;
		grabY = ev.clientY - rect.top;
		cardEl.setPointerCapture?.(ev.pointerId);
	});
	component.registerDomEvent(cardEl, "pointermove", onMove);
	component.registerDomEvent(cardEl, "pointerup", finish);
	component.registerDomEvent(cardEl, "pointercancel", finish);
}

/** Detect pairs of cards whose edges touch and flag them so CSS can sharpen
 *  the touching corners (and drop the double border between them) — making two
 *  adjacent cards read as a single merged tile, like grouped Android
 *  notifications. Reads live DOM offsets so it works both at rest and while a
 *  card is being dragged (its inline position is already current). */
export function applyEdgeMerging(gridEl: HTMLElement): void {
	const cards = Array.from(gridEl.querySelectorAll<HTMLElement>(":scope > .sbd-card"));
	const MERGE_CLASSES = [
		"merge-top", "merge-bottom", "merge-left", "merge-right",
		"merge-tl", "merge-tr", "merge-bl", "merge-br",
	];
	for (const c of cards) {
		c.classList.remove(...MERGE_CLASSES);
	}
	if (cards.length < 2) return;

	// Touch threshold: cards snap edges to a 0-gap line, so a couple of px of
	// slack covers sub-pixel rendering without merging cards that merely sit
	// near each other. The perpendicular overlap floor avoids joining cards
	// that only brush at a corner.
	const TOUCH = 2;
	const OVERLAP = 6;
	// Per-card corner-end coverage. Each flag records whether the given end of
	// the given edge is reached by a touching neighbour, e.g. `rT` = the top end
	// of the right edge is covered. A corner sharpens when either edge meeting
	// at it is covered there; a border drops only when its whole edge is covered
	// (both ends), so a partially-shared edge keeps its outline.
	const rects = cards.map((el) => ({
		el,
		left: el.offsetLeft,
		top: el.offsetTop,
		right: el.offsetLeft + el.offsetWidth,
		bottom: el.offsetTop + el.offsetHeight,
		rT: false, rB: false, lT: false, lB: false,
		tL: false, tR: false, bL: false, bR: false,
	}));

	for (let i = 0; i < rects.length; i++) {
		for (let j = i + 1; j < rects.length; j++) {
			const a = rects[i];
			const b = rects[j];
			// Horizontal adjacency (side by side): the right edge of one meets
			// the left edge of the other, with real vertical overlap.
			const aLeftOfB = Math.abs(a.right - b.left) <= TOUCH;
			const bLeftOfA = Math.abs(b.right - a.left) <= TOUCH;
			if (aLeftOfB || bLeftOfA) {
				const vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
				if (vOverlap > OVERLAP) {
					// L sits to the left of R along the shared edge (L's right
					// edge meets R's left edge). A corner-end is covered only
					// where the neighbour actually reaches that end.
					const L = aLeftOfB ? a : b;
					const R = aLeftOfB ? b : a;
					if (R.top <= L.top + TOUCH) L.rT = true;
					if (R.bottom >= L.bottom - TOUCH) L.rB = true;
					if (L.top <= R.top + TOUCH) R.lT = true;
					if (L.bottom >= R.bottom - TOUCH) R.lB = true;
				}
			}
			// Vertical adjacency (stacked): bottom edge meets top edge, with
			// real horizontal overlap.
			const aAboveB = Math.abs(a.bottom - b.top) <= TOUCH;
			const bAboveA = Math.abs(b.bottom - a.top) <= TOUCH;
			if (aAboveB || bAboveA) {
				const hOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
				if (hOverlap > OVERLAP) {
					// T sits above Bot (T's bottom edge meets Bot's top edge).
					const T = aAboveB ? a : b;
					const Bot = aAboveB ? b : a;
					if (Bot.left <= T.left + TOUCH) T.bL = true;
					if (Bot.right >= T.right - TOUCH) T.bR = true;
					if (T.left <= Bot.left + TOUCH) Bot.tL = true;
					if (T.right >= Bot.right - TOUCH) Bot.tR = true;
				}
			}
		}
	}

	for (const r of rects) {
		const cl = r.el.classList;
		// Sharpen a corner when either edge meeting there is covered at that end.
		if (r.tL || r.lT) cl.add("merge-tl");
		if (r.tR || r.rT) cl.add("merge-tr");
		if (r.bL || r.lB) cl.add("merge-bl");
		if (r.bR || r.rB) cl.add("merge-br");
		// Drop a shared border only when the whole edge is covered end-to-end.
		if (r.tL && r.tR) cl.add("merge-top");
		if (r.bL && r.bR) cl.add("merge-bottom");
		if (r.lT && r.lB) cl.add("merge-left");
		if (r.rT && r.rB) cl.add("merge-right");
	}

	// The frosted-glass blur is shared across touching cards, and its mask keys
	// off the merge classes just set above, so rebuild it here — every reflow
	// path (initial render, drag/resize, viewport resize, fit) already routes
	// through applyEdgeMerging.
	updateFrostLayers(gridEl);
}

/** Fallback card corner radius (px), matching the `border-radius` fallback in
 *  styles.css, used when the board hasn't set --sbd-card-radius. */
const CARD_RADIUS_FALLBACK = 32;

/** Resolve the board's live corner radius (px) from the --sbd-card-radius
 *  CSS variable set by renderDashboard, so the frost mask rounds by exactly the
 *  same amount the cards do. Falls back to the design baseline if unset. */
function resolveGridRadius(gridEl: HTMLElement): number {
	const raw = getComputedStyle(gridEl).getPropertyValue("--sbd-card-radius");
	const n = parseFloat(raw);
	return Number.isFinite(n) && n >= 0 ? n : CARD_RADIUS_FALLBACK;
}

/** SVG path for one card's border-box silhouette, rounding each corner to
 *  `radius` unless that corner is merged flat. A zero-radius elliptical arc
 *  renders as a straight line to its endpoint, so all four arcs are always
 *  emitted regardless of merge state. Coordinates are in the grid's own pixel
 *  space (offset* is relative to the positioned grid). */
function cardSilhouettePath(el: HTMLElement, radius: number): string {
	const x = el.offsetLeft;
	const y = el.offsetTop;
	const w = el.offsetWidth;
	const h = el.offsetHeight;
	const cl = el.classList;
	// Prefer the card's OWN corner over the board default. Most cards take the
	// board's radius, but a kind may set its own — the searchbar card is the
	// reference's 34px against every other card's 42px — and masking that card
	// with the board's larger corner would reveal a crescent of blurred
	// wallpaper just outside its rim at each corner.
	const own = parseFloat(getComputedStyle(el).borderTopLeftRadius);
	const r = Number.isFinite(own) && own >= 0 ? own : radius;
	const tl = cl.contains("merge-tl") ? 0 : r;
	const tr = cl.contains("merge-tr") ? 0 : r;
	const br = cl.contains("merge-br") ? 0 : r;
	const bl = cl.contains("merge-bl") ? 0 : r;
	return (
		`M${x + tl},${y}` +
		`L${x + w - tr},${y}A${tr},${tr} 0 0 1 ${x + w},${y + tr}` +
		`L${x + w},${y + h - br}A${br},${br} 0 0 1 ${x + w - br},${y + h}` +
		`L${x + bl},${y + h}A${bl},${bl} 0 0 1 ${x},${y + h - bl}` +
		`L${x},${y + tl}A${tl},${tl} 0 0 1 ${x + tl},${y}Z`
	);
}

/** Rebuild the shared frosted-glass blur layers behind the cards. See the
 *  .sbd-frost note in styles.css for why the blur is shared rather than
 *  per-card. One .sbd-frost layer is created per distinct resolved blur value
 *  (stashed on each card as data-blur), each masked — via an inline SVG built
 *  from the cards' live silhouettes — to the union of its cards. The blur is
 *  therefore computed once per value and shows only under the cards, so touching
 *  cards blur as one seamless surface while gaps stay sharp. */
export function updateFrostLayers(gridEl: HTMLElement): void {
	let root = gridEl.querySelector<HTMLElement>(":scope > .sbd-frost-root");
	const cards = Array.from(
		gridEl.querySelectorAll<HTMLElement>(":scope > .sbd-card.has-blur"),
	);
	if (cards.length === 0) {
		root?.remove();
		return;
	}
	if (!root) {
		root = gridEl.createDiv("sbd-frost-root");
		// Paint behind every card by sitting first in the grid.
		gridEl.prepend(root);
	}

	// Group cards by resolved blur so touching cards that share a value blur as
	// one surface; a card with a custom blur gets its own layer (and may still
	// seam against a neighbour of a different blur — that difference is intended).
	const byBlur = new Map<string, HTMLElement[]>();
	for (const c of cards) {
		const b = c.dataset.blur ?? "0";
		const list = byBlur.get(b);
		if (list) list.push(c);
		else byBlur.set(b, [c]);
	}

	const w = gridEl.clientWidth;
	const h = gridEl.clientHeight;
	const radius = resolveGridRadius(gridEl);
	const seen = new Set<string>();
	for (const [blur, group] of byBlur) {
		seen.add(blur);
		let layer = root.querySelector<HTMLElement>(
			`:scope > .sbd-frost[data-blur="${blur}"]`,
		);
		if (!layer) {
			layer = root.createDiv("sbd-frost");
			layer.dataset.blur = blur;
		}
		// saturate(120%) rides along with the blur, matching the reference's
		// backdrop-filter exactly (blur(18px) saturate(120%)); the layer used to
		// blur without it, leaving card interiors a shade flatter than the
		// artboard's. Nothing else: rendering the reference over the wallpaper
		// it is drawn on shows the card is exactly this blur under a white
		// 10% tint, with no darkening of any kind.
		const filter = `blur(${blur}px) saturate(120%)`;
		layer.style.setProperty("backdrop-filter", filter);
		layer.style.setProperty("-webkit-backdrop-filter", filter);
		const paths = group
			.map((c) => `<path d="${cardSilhouettePath(c, radius)}" fill="#fff"/>`)
			.join("");
		const svg =
			`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
			`viewBox="0 0 ${w} ${h}">${paths}</svg>`;
		const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
		layer.style.setProperty("mask-image", mask);
		layer.style.setProperty("-webkit-mask-image", mask);
	}
	// Drop layers for blur values that no longer have any cards.
	for (const layer of Array.from(
		root.querySelectorAll<HTMLElement>(":scope > .sbd-frost"),
	)) {
		if (!seen.has(layer.dataset.blur ?? "")) layer.remove();
	}
}
