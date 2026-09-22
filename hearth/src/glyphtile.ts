import { setIcon } from "obsidian";

/**
 * The tinted rounded-square icon tile Obsidian's own settings sidebar wears.
 *
 * Obsidian 1.13 draws every row of its settings list — General, Appearance,
 * Editor, each core plugin — as a coloured tile with a white glyph, and the
 * Cupertino theme leans the whole window on that shape. A plugin's pane sits
 * inside the same window, so a monochrome glyph beside a native tinted one
 * reads as a different app rather than a section of this one.
 *
 * The tint is a hue, not a colour: every value here is one of the eight
 * `--color-*` variables Obsidian defines and a theme retunes, so a theme that
 * has its own idea of "purple" gets its purple rather than a literal hex this
 * file guessed. `grey` is the neutral one — Obsidian's own General row — and is
 * the only value that doesn't come from that set, because there is no
 * `--color-grey`; it reads the theme's muted text colour instead.
 *
 * Kept apart from `ui.ts` so both the settings pane and the card picker can
 * reach it without either importing the other's module (see `cards/README.md`
 * on the registry's import cycle).
 */
export type TileTint =
	| "grey"
	| "red"
	| "orange"
	| "green"
	| "cyan"
	| "blue"
	| "purple"
	| "pink";

/**
 * Draw one tile into `parent` and return it.
 *
 * The tint rides a class rather than an inline `style`, so the whole palette
 * stays in the stylesheet where a theme or a user snippet can reach it — an
 * inline custom property would win over both.
 */
export function glyphTile(parent: HTMLElement, icon: string, tint: TileTint): HTMLElement {
	const tile = parent.createSpan(`sbd-glyph-tile is-${tint}`);
	setIcon(tile, icon);
	return tile;
}
