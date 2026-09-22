import {
	apiVersion,
	Modal,
	Notice,
	Platform,
	prepareFuzzySearch,
	setIcon,
	type App,
} from "obsidian";
import {
	CARD_CATEGORIES,
	CARD_TEMPLATES,
	templateCategory,
	templateDescription,
	templateName,
	unmetRequirement,
	type CardCategory,
	type CardTemplateDef,
} from "./cards";
import { templateDefaultSize, templateSizes } from "./cards/definition";
import { sizeSpec, type WidgetSize } from "./widgetsize";
import { cardRequestGithubUrl, cardRequestMailtoUrl } from "./cardrequest";
import { t } from "./i18n";

/**
 * The "Add card" picker.
 *
 * It used to be a flat Obsidian `Menu`: one unlabelled line per template, in
 * one column, in registry order. That worked at a dozen cards; the catalogue is
 * now ~30 and the menu had become a wall of names taller than a laptop screen,
 * with no way to search it, nothing saying what any card actually does, and —
 * worst — a third of it invisible, because plugin-backed cards were hidden
 * until their plugin happened to be installed.
 *
 * This replaces it with a modal that shows the catalogue as it is: every card,
 * always, grouped into categories, searchable, each with a one-line
 * description, and the ones whose plugin is missing marked (and offering a jump
 * to Obsidian's plugin browser) rather than hidden. The last rail entry is
 * "Request a card", because the picker is exactly where you notice the card you
 * wanted doesn't exist yet.
 */

/** What the rail can be showing: every card, one category, or the request page.
 * (`CardCategory` values are used verbatim, so the rail is derived from the
 * registry rather than a second hand-kept list.) */
type PickerScope = "all" | "request" | CardCategory;

/** localStorage key for the scope the picker reopens on. */
const SCOPE_KEY = "sbd-card-picker-scope";

/** Pixels per grid cell in a size chip's footprint box. At 3px the widest
 * box (8 cells) is 24px, so a row of four chips is ~150px — narrow enough to
 * sit inside the picker's 210px tile column without the chips' own
 * min-content width pushing the grid's columns wider than the sheet. */
const SIZE_CHIP_UNIT = 3;

export interface CardPickerOptions {
	/** The running Second Brain Dashboard version, stamped into a card request. */
	sbdVersion: string;
	/** Add this template to the dashboard at the chosen size. */
	onChoose: (template: CardTemplateDef, size: WidgetSize) => void;
}

/** Open the add-card picker. */
export function openCardPicker(app: App, opts: CardPickerOptions): void {
	new CardPickerModal(app, opts).open();
}

class CardPickerModal extends Modal {
	private opts: CardPickerOptions;
	/** Named `pickerScope`, not `scope`: `Modal` already has a `scope` (its
	 * keymap `Scope`), and shadowing it would break the modal's key handling —
	 * the #52 naming hazard documented on `SbdTabbedModal`. */
	private pickerScope: PickerScope = "all";
	private query = "";

	/** Every size chip on screen, in visual order — the flat list Left/Right
	 * walks. Rebuilt on every results render. */
	private tiles: HTMLElement[] = [];
	/** The same chips grouped by tile, so Up/Down can step a whole widget at a
	 * time rather than four chips at a time. */
	private tileChips: HTMLElement[][] = [];
	/** Where each chip sits: [tile index, chip index within that tile]. */
	private chipPos = new Map<HTMLElement, [number, number]>();
	/** The chip Enter in the search field activates — the top match at its
	 * default size. Null while nothing is listed. */
	private topChoice: HTMLElement | null = null;

	private searchEl: HTMLInputElement | null = null;
	private railEl: HTMLElement | null = null;
	private resultsEl: HTMLElement | null = null;

	constructor(app: App, opts: CardPickerOptions) {
		super(app);
		this.opts = opts;
	}

	onOpen(): void {
		const saved = this.app.loadLocalStorage(SCOPE_KEY) as string | null;
		if (typeof saved === "string" && this.isScope(saved)) this.pickerScope = saved;

		this.titleEl.setText(t().cardPicker.title);
		const { contentEl, modalEl } = this;
		// The frame is sized on modalEl (a grid of tiles needs more than the
		// default modal width); the content layout hangs off contentEl.
		modalEl.addClass("sbd-card-picker-modal", "sbd-glass-modal");
		contentEl.empty();
		contentEl.addClass("sbd-card-picker");

		this.renderSearch(contentEl);
		const body = contentEl.createDiv("sbd-picker-body");
		this.railEl = body.createDiv("sbd-picker-rail");
		this.resultsEl = body.createDiv("sbd-picker-results");
		this.render();

		// Phones get the keyboard shoved in their face by an autofocused field,
		// covering the very grid the picker exists to show; the same reason the
		// search bar in `search.ts` only focuses on desktop.
		if (!Platform.isMobile) this.searchEl?.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** Redraw both panes. */
	private render(): void {
		this.renderRail();
		this.renderResults();
	}

	private isScope(value: string): value is PickerScope {
		return value === "all" || value === "request" || (CARD_CATEGORIES as string[]).includes(value);
	}

	private setScope(scope: PickerScope): void {
		if (scope === this.pickerScope) return;
		this.pickerScope = scope;
		this.app.saveLocalStorage(SCOPE_KEY, scope);
		this.renderRail();
		this.renderResults();
		// Start a new category at its top: the results column keeps its height
		// now, so a scrolled-down position would otherwise carry over and land
		// you in the middle of the next category.
		if (this.resultsEl) this.resultsEl.scrollTop = 0;
	}

	// ---- Search ---------------------------------------------------------

	private renderSearch(containerEl: HTMLElement): void {
		const row = containerEl.createDiv("sbd-picker-search");
		setIcon(row.createSpan("sbd-picker-search-icon"), "search");
		const input = row.createEl("input", {
			cls: "sbd-picker-search-input",
			attr: {
				type: "text",
				placeholder: t().cardPicker.searchPlaceholder,
				"aria-label": t().cardPicker.searchPlaceholder,
			},
		});
		this.searchEl = input;
		input.addEventListener("input", () => {
			this.query = input.value.trim();
			// Typing searches the whole catalogue: a query that matches nothing in
			// the category you happen to be standing in reads as "Second Brain Dashboard has no
			// such card", which is exactly the wrong answer.
			if (this.query && this.pickerScope !== "all") this.setScope("all");
			else this.renderResults();
		});
		input.addEventListener("keydown", (evt: KeyboardEvent) => {
			if (!this.tiles.length) return;
			// Enter takes the top match without a detour through the grid — the
			// point of typing "pet" is to get the pet card.
			if (evt.key === "Enter") {
				evt.preventDefault();
				// The top match at the size it prefers — the chip a mouse would
				// most likely have gone for, not whichever chip is leftmost.
				(this.topChoice ?? this.tiles[0]).click();
			} else if (evt.key === "ArrowDown") {
				evt.preventDefault();
				this.tiles[0].focus();
			}
		});
	}

	// ---- Rail -----------------------------------------------------------

	private renderRail(): void {
		const rail = this.railEl;
		if (!rail) return;
		rail.empty();
		const strings = t().cardPicker;

		this.railButton(rail, "all", strings.allCards, "layout-grid");
		for (const category of CARD_CATEGORIES) {
			this.railButton(rail, category, strings.categories[category], CATEGORY_ICONS[category]);
		}
		rail.createDiv("sbd-picker-rail-sep");
		this.railButton(rail, "request", strings.request.railLabel, "message-square-plus");
	}

	private railButton(rail: HTMLElement, scope: PickerScope, label: string, icon: string): void {
		const btn = rail.createEl("button", { cls: "sbd-picker-rail-btn" });
		btn.toggleClass("is-active", this.pickerScope === scope);
		btn.toggleClass("is-request", scope === "request");
		btn.setAttribute("aria-pressed", String(this.pickerScope === scope));
		setIcon(btn.createSpan("sbd-picker-rail-icon"), icon);
		btn.createSpan({ cls: "sbd-picker-rail-label", text: label });
		btn.addEventListener("click", () => this.setScope(scope));
	}

	// ---- Results --------------------------------------------------------

	private renderResults(): void {
		const results = this.resultsEl;
		if (!results) return;
		results.empty();
		this.tiles = [];
		this.tileChips = [];
		this.chipPos.clear();
		this.topChoice = null;

		if (this.pickerScope === "request") {
			this.renderRequest(results);
			return;
		}

		const matches = this.matchingTemplates();
		if (!matches.length) {
			this.renderNoMatches(results);
			return;
		}

		// Said once, above the chips that act on it: a size is chosen when the
		// widget is added and kept for its life, so the row of four is a
		// decision rather than a preview.
		results.createDiv({ cls: "sbd-picker-hint", text: t().cardPicker.size.note });

		// Sections are the point of the redesign, so keep them whenever there is
		// more than one to show; a single-category scope needs no heading, and a
		// search result reads better as one ranked list.
		if (this.query || this.pickerScope !== "all") {
			this.renderGrid(results, matches);
		} else {
			for (const category of CARD_CATEGORIES) {
				const inCategory = matches.filter((tpl) => templateCategory(tpl.id) === category);
				if (!inCategory.length) continue;
				results.createDiv({
					cls: "sbd-picker-section",
					text: t().cardPicker.categories[category],
				});
				this.renderGrid(results, inCategory);
			}
		}

		// A quiet way out at the end of the list, for the case the picker can't
		// answer: you scrolled everything and none of it was the card you wanted.
		const foot = results.createDiv("sbd-picker-foot");
		foot.createSpan({ text: t().cardPicker.request.footPrompt });
		const link = foot.createEl("button", {
			cls: "sbd-picker-foot-link",
			text: t().cardPicker.request.footLink,
		});
		link.addEventListener("click", () => this.setScope("request"));
	}

	// ---- Adding a widget -------------------------------------------------

	/** Add the widget at the given size and close. */
	private addWidget(template: CardTemplateDef, size: WidgetSize): void {
		const missing = unmetRequirement(this.app, template);
		this.close();
		// The widget is added either way — it renders its own "install X" prompt
		// in place, which is a far better teacher than a missing menu entry —
		// but say so, with a one-click way to fix it.
		if (missing) this.noticeMissing(missing.name, missing.pluginId);
		this.opts.onChoose(template, size);
	}

	/** The templates to show, filtered by scope and ranked by the query. */
	private matchingTemplates(): CardTemplateDef[] {
		const scoped =
			this.pickerScope === "all" || this.pickerScope === "request"
				? CARD_TEMPLATES
				: CARD_TEMPLATES.filter((tpl) => templateCategory(tpl.id) === this.pickerScope);
		if (!this.query) return scoped;

		// Name and description both feed the match, so "todo" finds Tasks and
		// "iframe" finds the web card. Obsidian's own fuzzy matcher, for the same
		// feel as every other search surface in Second Brain Dashboard.
		const fuzzy = prepareFuzzySearch(this.query);
		const ranked: { template: CardTemplateDef; score: number }[] = [];
		for (const template of scoped) {
			const name = fuzzy(templateName(template));
			const desc = fuzzy(templateDescription(template));
			// A description hit is a weaker signal than a name hit, and scores are
			// negative (less negative is better), so push description matches down.
			const score = Math.max(name?.score ?? -Infinity, (desc?.score ?? -Infinity) - 2);
			if (score > -Infinity) ranked.push({ template, score });
		}
		ranked.sort((a, b) => b.score - a.score);
		return ranked.map((entry) => entry.template);
	}

	private renderGrid(containerEl: HTMLElement, templates: CardTemplateDef[]): void {
		const grid = containerEl.createDiv("sbd-picker-grid");
		for (const template of templates) this.renderTile(grid, template);
	}

	private renderTile(grid: HTMLElement, template: CardTemplateDef): void {
		const missing = unmetRequirement(this.app, template);
		// A div, not a button: the tile is no longer the thing you press — the
		// four size chips inside it are, and a button may not nest buttons.
		const tile = grid.createDiv("sbd-card-tile");
		tile.toggleClass("is-unmet", !!missing);
		tile.setAttribute("role", "group");
		tile.setAttribute("aria-label", templateName(template));
		setIcon(tile.createSpan("sbd-card-tile-icon"), template.icon);

		const text = tile.createDiv("sbd-card-tile-text");
		text.createDiv({ cls: "sbd-card-tile-name", text: templateName(template) });
		const description = templateDescription(template);
		if (description) text.createDiv({ cls: "sbd-card-tile-desc", text: description });
		if (missing) {
			const badge = text.createDiv("sbd-card-tile-badge");
			setIcon(badge.createSpan("sbd-card-tile-badge-icon"), "puzzle");
			badge.createSpan({ text: t().cardPicker.requires(missing.name) });
		}

		this.renderSizeChips(tile, template);
	}

	/**
	 * The four sizes, on the tile itself.
	 *
	 * Choosing a size used to be a second page: click a widget, the catalogue
	 * was replaced by a "Choose a size" step, pick one of four, press Add. Three
	 * clicks and a lost place in the catalogue to add one widget — and the step
	 * showed nothing the tile could not, because a size is four boxes and four
	 * names. The four boxes now live on the tile, so adding a widget at the size
	 * you want is a single click and the catalogue never goes away.
	 *
	 * Each box is drawn at its size's true footprint — a small widget really is
	 * a quarter the width of an extra-large one — so the row is read by eye
	 * rather than by its labels. A template that offers fewer than four sizes
	 * (SEARCH, which has no tall tile) shows only the ones it offers.
	 */
	private renderSizeChips(tile: HTMLElement, template: CardTemplateDef): void {
		const strings = t().cardPicker.size;
		const row = tile.createDiv("sbd-card-tile-sizes");
		// `build()` is what names the kind, and the kind is what `sizeSpec` reads
		// for the per-kind footprint overrides. Once per tile, not once per chip.
		const kind = template.build().kind;
		const offered = templateSizes(template);
		const specs = offered.map((size) => sizeSpec(kind, size));
		// Every box in a row is measured against the same footprint, so the boxes
		// stay in proportion to each other and the four chips stay the same width.
		const widest = specs.reduce((max, spec) => Math.max(max, spec.cols), 1);
		const tallest = specs.reduce((max, spec) => Math.max(max, spec.rows), 1);
		const preferred = templateDefaultSize(template);
		const chips: HTMLElement[] = [];
		const tileIndex = this.tileChips.length;

		offered.forEach((size, index) => {
			const spec = specs[index];
			const chip = row.createEl("button", { cls: "sbd-size-chip" });
			// The name and the cell count are the size step's own caption, kept as
			// the chip's accessible name — the chip itself has room for "S".
			const label = `${strings.names[size]} · ${strings.cells(spec.cols, spec.rows)}`;
			chip.setAttribute("aria-label", label);
			chip.setAttribute("title", label);

			const frame = chip.createDiv("sbd-size-chip-frame");
			frame.style.width = `${widest * SIZE_CHIP_UNIT}px`;
			frame.style.height = `${tallest * SIZE_CHIP_UNIT}px`;
			const box = frame.createDiv("sbd-size-chip-box");
			box.style.width = `${spec.cols * SIZE_CHIP_UNIT}px`;
			box.style.height = `${spec.rows * SIZE_CHIP_UNIT}px`;
			chip.createDiv({ cls: "sbd-size-chip-label", text: strings.short[size] });

			// Roving tab stop: Tab walks the catalogue one WIDGET at a time, as
			// it did when the tile itself was the button, and the arrow keys
			// walk the chips within. Four tab stops per widget would be ~120
			// across the catalogue, which is not a catalogue any more.
			chip.tabIndex = size === preferred ? 0 : -1;
			chip.addEventListener("keydown", (evt: KeyboardEvent) => this.onChipKey(evt, chip));
			chip.addEventListener("click", () => this.addWidget(template, size));

			this.chipPos.set(chip, [tileIndex, index]);
			chips.push(chip);
			this.tiles.push(chip);
		});

		this.tileChips.push(chips);
		// What Enter in the search field adds: the top match, at the size the
		// template itself prefers rather than the first one offered.
		if (!this.topChoice) {
			this.topChoice = chips[offered.indexOf(preferred)] ?? chips[0] ?? null;
		}
	}

	/**
	 * Arrow-key movement across the size chips.
	 *
	 * Left/Right walk the flat list, so they cross from a tile's last chip to
	 * the next tile's first. Up/Down step a whole tile at a time, holding the
	 * chip's position within its tile — four presses to leave a widget would be
	 * three too many, and the grid reflows with the modal's width, so there is
	 * no fixed column count to step by either.
	 */
	private onChipKey(evt: KeyboardEvent, chip: HTMLElement): void {
		const pos = this.chipPos.get(chip);
		if (!pos) return;
		const [tileIndex, chipIndex] = pos;

		if (evt.key === "ArrowLeft" || evt.key === "ArrowRight") {
			evt.preventDefault();
			const next = this.tiles.indexOf(chip) + (evt.key === "ArrowRight" ? 1 : -1);
			if (next < 0) this.searchEl?.focus();
			else this.tiles[next]?.focus();
			return;
		}

		if (evt.key === "ArrowUp" || evt.key === "ArrowDown") {
			evt.preventDefault();
			const nextTile = tileIndex + (evt.key === "ArrowDown" ? 1 : -1);
			if (nextTile < 0) {
				this.searchEl?.focus();
				return;
			}
			const row = this.tileChips[nextTile];
			if (!row?.length) return;
			// A row may be shorter than the one you came from (SEARCH offers two
			// sizes), so hold the column where it exists and clamp where it doesn't.
			row[Math.min(chipIndex, row.length - 1)].focus();
		}
	}

	private noticeMissing(name: string, pluginId?: string): void {
		const frag = createFragment();
		frag.appendText(t().cardPicker.missingNotice(name));
		if (!pluginId) {
			new Notice(frag, 8000);
			return;
		}
		frag.appendText(" ");
		const link = frag.createEl("a", {
			text: t().cardPicker.installLink(name),
			href: `obsidian://show-plugin?id=${pluginId}`,
		});
		link.addEventListener("click", (evt) => {
			evt.preventDefault();
			window.open(link.href);
		});
		new Notice(frag, 8000);
	}

	private renderNoMatches(containerEl: HTMLElement): void {
		const empty = containerEl.createDiv("sbd-picker-empty");
		setIcon(empty.createSpan("sbd-picker-empty-icon"), "search-x");
		empty.createDiv({ cls: "sbd-picker-empty-text", text: t().cardPicker.noMatches });
		const btn = empty.createEl("button", {
			cls: "mod-cta",
			text: t().cardPicker.request.railLabel,
		});
		btn.addEventListener("click", () => this.setScope("request"));
	}

	// ---- Request a card -------------------------------------------------

	private renderRequest(containerEl: HTMLElement): void {
		const strings = t().cardPicker.request;
		const page = containerEl.createDiv("sbd-picker-request");
		page.createDiv({ cls: "sbd-picker-section", text: strings.heading });
		page.createDiv({ cls: "sbd-picker-request-intro", text: strings.intro });

		const context = {
			sbdVersion: this.opts.sbdVersion,
			obsidianVersion: apiVersion,
			platform: Platform.isMobile ? "Mobile" : "Desktop",
		};

		this.requestOption(page, {
			icon: "github",
			title: strings.githubTitle,
			description: strings.githubDesc,
			action: strings.githubAction,
			url: cardRequestGithubUrl(context),
		});
		this.requestOption(page, {
			icon: "mail",
			title: strings.emailTitle,
			// The address itself is never printed on screen — it only ever exists
			// inside the mailto: the button opens.
			description: strings.emailDesc,
			action: strings.emailAction,
			url: cardRequestMailtoUrl(context),
		});

		page.createDiv({ cls: "sbd-picker-request-note", text: strings.prefilledNote });
	}

	private requestOption(
		containerEl: HTMLElement,
		opts: { icon: string; title: string; description: string; action: string; url: string },
	): void {
		const row = containerEl.createDiv("sbd-picker-request-option");
		setIcon(row.createSpan("sbd-picker-request-icon"), opts.icon);
		const text = row.createDiv("sbd-picker-request-text");
		text.createDiv({ cls: "sbd-picker-request-title", text: opts.title });
		text.createDiv({ cls: "sbd-picker-request-desc", text: opts.description });
		const btn = row.createEl("button", { cls: "mod-cta", text: opts.action });
		btn.addEventListener("click", () => {
			// mailto: and https: both go through the OS handler — the browser (or
			// Electron) picks the mail client, which is the only portable way to
			// open a composer from a plugin.
			window.open(opts.url, "_blank");
		});
	}
}

/** Rail icons, one per category. Kept beside the picker rather than on the
 * registry: they are a property of this menu, not of the cards. */
const CATEGORY_ICONS: Record<CardCategory, string> = {
	notes: "file-text",
	planning: "calendar-check",
	vault: "bar-chart-3",
	tools: "wrench",
	integrations: "plug",
	ai: "bot",
	fun: "sparkles",
};
