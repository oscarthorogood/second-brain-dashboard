# Design reference

The source of truth for the dashboard's visual system. `hearth/styles.css`
is written against these two files, and the token block at the top of that
stylesheet names the values measured out of them.

- `Widget Set.dc.html` — every card kind in the registry, drawn at rest with
  realistic vault content. Defines the card material (white at 10% over an
  18px blur, a 1px white rim at 42%, a 42px corner), the two inner tiers
  that sit on it (a translucent glass panel and a near-opaque white sheet
  that flips its text to dark), and the tracked-out monospace caption that
  names each surface.
- `Canvas.dc.html` — the board's chrome: the toolbar's two button pills, the
  move handle, the card-header hover actions and their popover, the
  Add-a-card picker (nav rail, search field, catalogue tiles) and the card
  settings sheet (tab switcher, dropdown pills, text fields, toggles).

Both are Claude Design `.dc.html` artboards. They render standalone in a
browser apart from `support.js` / `image-slot.js`, which only fill the
`<image-slot>` placeholders and the `{{ }}` sample data — the styling that
matters is inline on the elements and reads fine without them.

When retuning the look, change the tokens in `hearth/styles.css` rather than
the rules that consume them, and update these files if the design itself
moves.
