import type { CardKind } from "./types";

/**
 * The four fixed widget sizes.
 *
 * Widgets are not resizable. A size is picked when the widget is added and
 * kept for the widget's life — changing it means removing the widget and
 * adding it again, exactly as an iOS home screen works.
 *
 * Reference (Widget Set → every widget's row of four tiles): Apple's four HIG
 * footprints, small (2×2), medium (4×2), large (4×4) and extra large (8×4),
 * with the widget's content growing with the frame rather than merely scaling.
 */
export type WidgetSize = "small" | "medium" | "large" | "xlarge";

/** Every size, in the order the picker offers them (smallest first). */
export const WIDGET_SIZES: readonly WidgetSize[] = [
	"small",
	"medium",
	"large",
	"xlarge",
] as const;

/** A size's footprint on the invisible grid, and the corner it is drawn with. */
export interface SizeSpec {
	/** Width in grid cells. */
	cols: number;
	/** Height in grid cells. */
	rows: number;
	/** Corner radius in pixels, at the reference cell size. */
	radius: number;
}

/**
 * The invisible grid every widget snaps to: a square cell with a fixed gutter.
 *
 * These two numbers are what reproduce the reference's tile widths exactly —
 * 158 is `2·68 + 22` and 338 is `4·68 + 3·22` — so they are the grid the four
 * sizes were drawn on rather than a scale invented here.
 *
 * The cell is deliberately square in both axes. The reference draws its two
 * four-row tiles 354px tall, 16px more than a square grid gives (338); a
 * single uniform cell is what lets a widget of any size land on the same grid
 * as every other, which is the whole point of the fixed board, so the
 * implementation keeps the square and accepts the 16px.
 */
export const GRID_CELL = 68;
/** The gutter between two neighbouring cells, in pixels. */
export const GRID_GAP = 22;

/** The default footprint of each size (Widget Set → the size caption on each
 * tile: `S · 158×158`, `M · 338×158`, `L · 338×354`, `XL · 702×354`). */
export const SIZE_SPECS: Readonly<Record<WidgetSize, SizeSpec>> = {
	small: { cols: 2, rows: 2, radius: 30 },
	medium: { cols: 4, rows: 2, radius: 30 },
	large: { cols: 4, rows: 4, radius: 40 },
	xlarge: { cols: 8, rows: 4, radius: 40 },
};

/**
 * Kinds whose footprint differs from the table above.
 *
 * The search widget is the reference's one documented exception: it is a
 * search field with file-type filter chips under it, which reads at 4×2 and
 * 8×2 and has nothing to put in a four-row tile. Its wide option is therefore
 * two rows, not four — and keeps the 30px corner that goes with a two-row
 * tile (Widget Set → SEARCH, captioned `4×2 · 338×158` and `8×2 · 702×158`).
 */
const SIZE_OVERRIDES: Partial<Record<CardKind, Partial<Record<WidgetSize, SizeSpec>>>> = {
	searchbar: { xlarge: { cols: 8, rows: 2, radius: 30 } },
};

/** The footprint a given kind occupies at a given size. */
export function sizeSpec(kind: CardKind, size: WidgetSize): SizeSpec {
	return SIZE_OVERRIDES[kind]?.[size] ?? SIZE_SPECS[size];
}

/** Coerce an unknown value (older settings, a hand-edited export) to a size. */
export function asWidgetSize(value: unknown, fallback: WidgetSize = "medium"): WidgetSize {
	return WIDGET_SIZES.includes(value as WidgetSize) ? (value as WidgetSize) : fallback;
}
