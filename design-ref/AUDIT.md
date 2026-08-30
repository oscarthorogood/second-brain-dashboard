# Widget audit — 27 widgets × 4 sizes, plus menus and buttons

Every widget compared against its entry in `Widget Set.dc.html`, and the
board's chrome against `Canvas.dc.html`. Recorded here because the four sizes
turned "does this widget match the reference?" into 108 separate questions,
and the answers are worth keeping.

## How the reference varies a widget by size

Measured across the whole artboard rather than assumed:

- **Type barely moves.** Body text sits at 11–15px at every size; only the
  extra-large tiles reach 16px. A size is *not* a scale factor.
- **The inset steps with the tile**: 18 / 18–20 / 22–24 / 26–28px.
- **The content is what changes.** RECENT draws 1, 2, 5 and 7 files; JIRA 1, 5
  and 7 issues; STATS 1, 2, 6 and 6 figures.
- **The shape changes twice.** The two short tiles centre what little they
  hold; the extra-large tile splits its list into two columns.
- **The corner is 30px on a two-row tile and 40px on a four-row one.**

## The finding that drove most of the work

At 158 × 158 a list-shaped widget can show exactly one row, and the reference
decided one arbitrary row is the wrong thing to show. Its small tile is a
**summary** instead — TASKS draws "8 / open tasks", JIRA "5 / open issues",
STATS "2,481 / notes", GIT its branch over "↑2 ↓0".

Truncating to one row was what the first pass did. It is now a shared
`summaryTile()` (see `src/cardbodies.ts`), used by every widget whose reference
small tile is a summary.

## Per widget

| Widget | S | M | L | XL | Notes |
|---|---|---|---|---|---|
| EMBED | summary | ✓ | ✓ | ✓ | S names the note; rendering markdown into 158px clipped a few words and paid a full render for them |
| SLIDESHOW | ✓ | ✓ | ✓ | ✓ | Photo is edge-to-edge and scales; no inset at any size |
| DAILY | ✓ | ✓ | ✓ | ✓ | Date block already reads at every size |
| TEXT | ✓ | ✓ | ✓ | ✓ | Jot lines; density by CSS |
| WEB | summary | ✓ | ✓ | ✓ | S is the address only — an iframe at 158px is a postage stamp that still costs a full page load |
| CLOCK | ✓ | ✓ | ✓ | ✓ | Face is sized to the tile's shorter axis |
| CALENDAR | summary | ✓ | ✓ | ✓ | S is today's date over its month; a 7-column grid plus agenda needs the tall tile |
| SCHEDULE | summary | ✓ | ✓ | ✓ | S is today's date; month/week/day grids need the large tile |
| TASKS | summary | ✓ | ✓ | ✓ | Count of what's outstanding |
| SEARCH | — | ✓ | — | ✓ | The documented exception: 4×2 and 8×2 only, four filter chips then eight |
| LINKS | ✓ | ✓ | ✓ | ✓ | Tiles; the user's own list, never capped |
| COMMANDS | ✓ | ✓ | ✓ | ✓ | As above |
| TEMPLATER | ✓ | ✓ | ✓ | ✓ | As above |
| BOOKMARKS | ✓ | ✓ | ✓ | ✓ | As above |
| FAVORITES | ✓ | ✓ | ✓ | ✓ | As above |
| RECENT | ✓ | ✓ | ✓ | ✓ | 1 / 2 / 5 / 7, the reference's own counts |
| LEAF | summary | ✓ | ✓ | ✓ | S names the hosted view; mounting a real workspace leaf into 158px spends a leaf to say nothing |
| STATS | summary | ✓ | ✓ | ✓ | 1 / 2 / 6 / 6 |
| HEATMAP | summary | ✓ | ✓ | ✓ | S is this week's count; 26 weeks of squares in 158px are under 2px each |
| DATAVIEW | summary | ✓ | ✓ | ✓ | S names the query |
| DATACORE | summary | ✓ | ✓ | ✓ | As above |
| RSS | summary | ✓ | ✓ | ✓ | Count of what's waiting |
| JIRA | summary | ✓ | ✓ | ✓ | Count of open issues |
| CALCULATOR | keypad hidden | ✓ | ✓ | ✓ | 16 keys in 158px are under 30px each, below any usable touch target |
| GIT | summary | ✓ | ✓ | ✓ | Branch over ahead/uncommitted |
| WEATHER | ✓ | ✓ | ✓ | ✓ | Already has its own container-query design that condenses to a glyph and a temperature |
| PET | ✓ | ✓ | ✓ | ✓ | Sprite scales to the tile |

The plugin carries one widget the reference does not: the saved-query **SEARCH**
card. `github.md` records that the design project folded the old SEARCH and
SEARCHBAR into a single search-bar-with-filters widget. Deleting a working
feature is well outside a sizing overhaul, so the saved-query card is kept and
given the density its neighbours are drawn at (1 / 2 / 5 / 7); the search *bar*
is the one that matches the reference's SEARCH entry.

## Menus and buttons

`Canvas.dc.html` is byte-identical to the copy already in this repo, and the
chrome was built against it in an earlier pass, so most of it already matched.
What changed or is worth noting:

- **Add-a-card picker** — the reference's frame, rail, search field and tiles
  are unchanged. A second step is new: after picking a widget the sheet hides
  the rail and search and offers the four sizes, drawn at their true relative
  widths and aspect ratios so the choice is made by eye. It says once, there,
  that the choice is final.
- **Card settings modal** — the reference draws Content and Layout tabs. The
  Layout tab held a width and a height field, which is precisely the free-form
  geometry the fixed sizes replace, so it is gone and the size is *stated*
  rather than edited. That leaves one tab, and a ribbon of one is a label
  pretending to be a control, so the ribbon is hidden at a single tab.
- **Move handle / card header actions** — unchanged; the round white-34% chips
  the reference draws still float on the widget.
- **Resize grips** — deleted, along with the magnetic alignment guides. Neither
  appears in the reference and neither has anything to act on now.
- **Toolbar** — *open finding, not changed.* The reference's TOOLBAR panel
  shows exactly two pills in arrange mode ("Add card", "Done arranging"); the
  implementation has a third, "Hide card headers". The reference's CARD HEADER ·
  HOVER panel does show a "Hide card headers" popover, but it is drawn against
  a round header button in a way that could be either a per-card control or a
  tooltip for the toolbar one. Guessing would move a working control on a
  reading of the artboard that is genuinely ambiguous, so it is left where it
  is and flagged here instead.
