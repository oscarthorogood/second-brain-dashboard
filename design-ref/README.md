# Design reference

The source of truth for the dashboard's visual system. `hearth/styles.css`
is written against these two files, and the token block at the top of that
stylesheet names the values measured out of them.

- `Widget Set.dc.html` — every widget in the registry, drawn at all four
  fixed sizes with realistic vault content. Defines the widget material
  (white at 10% over an 18px blur, a 1px white rim at 42%), the two inner
  tiers that sit on it (a translucent glass panel and a near-opaque white
  sheet that flips its text to dark), and the tracked-out monospace caption
  that names each surface.
- `Canvas.dc.html` — the board's chrome: the toolbar's two button pills, the
  move handle, the card-header hover actions and their popover, the
  Add-a-card picker (nav rail, search field, catalogue tiles) and the card
  settings sheet (tab switcher, dropdown pills, text fields, toggles).

## The four sizes

Widgets are not resizable. A size is chosen when the widget is added, and
every widget is one of Apple's four HIG footprints, measured here in cells
of the board's invisible grid:

| Size        | Cells | Reference px | Corner |
|-------------|-------|--------------|--------|
| Small       | 2 × 2 | 158 × 158    | 30px   |
| Medium      | 4 × 2 | 338 × 158    | 30px   |
| Large       | 4 × 4 | 338 × 354    | 40px   |
| Extra large | 8 × 4 | 702 × 354    | 40px   |

The grid those cells come from is a 68px square cell with a 22px gap, which
is what reproduces 158 (`2·68 + 22`) and 338 (`4·68 + 3·22`) exactly. The
reference draws the two four-row tiles 16px taller than a square grid gives
(354 rather than 338); the implementation keeps the cell square, because a
single uniform cell is what makes the invisible grid work in both axes.

The search widget is the one documented exception: it ships as 4×2 and 8×2
(a search field with file-type filter chips below), never as a tall tile.

Content grows with the frame rather than merely scaling — each widget's
entry shows what it draws at each size, and that per-size content is the
part `styles.css` and the `src/cards/*.ts` modules implement.

Both are Claude Design `.dc.html` artboards. They render standalone in a
browser apart from `support.js` / `image-slot.js`, which only fill the
`<image-slot>` placeholders and the `{{ }}` sample data — the styling that
matters is inline on the elements and reads fine without them.

When retuning the look, change the tokens in `hearth/styles.css` rather than
the rules that consume them, and update these files if the design itself
moves.
