import { type Component, Platform, setIcon } from "obsidian";
import type { HomeView } from "./view";
import { SearchSection } from "./search";
import { sbdIconIdFor } from "./icon";
import { resolveIconId } from "./lucide";
import {
	effectiveHeaderAlign,
	effectiveHeaderLogoScale,
	effectiveHeaderMarginTop,
	effectiveHeaderSpacingBelow,
	effectiveHeaderTitleScale,
	effectiveLogo,
	effectiveLogoIcon,
	effectiveShowSearch,
	effectiveShowTitle,
	effectiveTitle,
} from "./types";
import { t } from "./i18n";

/** The search engine used by the “Search online” button action.
 * DuckDuckGo's GET endpoint works without an API key and is privacy-friendly. */
const WEB_SEARCH_URL = "https://duckduckgo.com/?q=";

/** Renders the title/logo, the search bar with the New-note button, and the
 * auto-detected filter row. In Mobile mode, the New-note button is left out
 * here — it moves into the mobile action bar rendered below (see
 * mobileactions.ts), along with the rest of that customizable button row.
 *
 * The single button beside the search bar has two modes (configurable in
 * Settings → Appearance → “Search-bar button”):
 *   - "newNote": create a new note (the original button)
 *   - "searchOnline": run a web search for the current search-field contents */
export function renderHeader(view: HomeView, container: HTMLElement, component: Component): void {
	const s = view.plugin.settings;
	const mobileOnly = Platform.isMobile && s.mobileSearchOnly;

	container.addClass(`is-title-align-${effectiveHeaderAlign(s)}`);
	const spacingBelow = effectiveHeaderSpacingBelow(s);
	if (spacingBelow !== undefined) {
		container.style.setProperty("--sbd-header-spacing-below", `${spacingBelow}px`);
	}

	if (effectiveShowTitle(s)) {
		const titleRow = container.createDiv("sbd-title");
		// Tint the crystal and/or title text with the theme's icon color per
		// the themeColorTarget setting (see styles.css).
		const target = s.themeColorTarget;
		if (target === "icon" || target === "both") titleRow.addClass("is-icon-themed");
		if (target === "title" || target === "both") titleRow.addClass("is-title-themed");
		titleRow.style.setProperty("--sbd-title-scale", String(effectiveHeaderTitleScale(s)));
		titleRow.style.setProperty("--sbd-logo-scale", String(effectiveHeaderLogoScale(s)));
		const marginTop = effectiveHeaderMarginTop(s);
		if (marginTop !== undefined) {
			titleRow.style.setProperty("--sbd-title-margin-top", `${marginTop}px`);
		}

		// Three ways to mark the title, in order: a Lucide icon (global, or this
		// board's override), a custom emoji/text logo shown verbatim, or the
		// Second Brain Dashboard crystal as the fallback brand mark. An unknown Lucide id draws
		// nothing, so it falls through rather than leaving an empty slot.
		const logo = effectiveLogo(s).trim();
		const lucideId = resolveIconId(effectiveLogoIcon(s));
		if (lucideId) {
			const logoEl = titleRow.createSpan({ cls: "sbd-logo sbd-logo-icon" });
			setIcon(logoEl, lucideId);
		} else if (logo === "") {
			const logoEl = titleRow.createSpan({ cls: "sbd-logo sbd-logo-icon" });
			setIcon(logoEl, sbdIconIdFor(target));
		} else {
			titleRow.createSpan({ cls: "sbd-logo", text: logo });
		}
		titleRow.createSpan({ cls: "sbd-title-text", text: effectiveTitle(s) });
	}

	if (!effectiveShowSearch(s)) return;

	const search = new SearchSection(view);

	// Layout:
	//   searchWrap (flex row, align-items: flex-start)
	//     ├─ searchCol (flex:1) — the bar's width
	//     │     ├─ searchRow (the bar, which now carries the button inside it)
	//     │     └─ filter chips + results dropdown (matching the bar's width)
	// The button sits INSIDE the bar, as the reference's SEARCHBAR block draws
	// it — a white square tucked against the bar's trailing edge rather than a
	// second pill beside it. The filters still span exactly the bar's width,
	// because the bar is the full width of the column either way.
	const searchWrap = container.createDiv("sbd-search-wrap");
	const searchCol = searchWrap.createDiv("sbd-search-col");
	const searchRow = searchCol.createDiv("sbd-search");
	const bar = search.renderBar(searchRow);

	if (s.showNewNoteButton && !mobileOnly) {
		bar.append(createSearchBarButton(view, bar, s.newNoteButtonMode));
	}

	search.renderResultsAndFilters(searchCol, searchCol, component);
}

/** The button that sits beside a search bar, in either of its two modes. Shared
 * with the search-bar card, which offers the same choice per card — so the two
 * places can't drift into two subtly different buttons. `bar` is the search bar
 * the button belongs to; "searchOnline" reads its current query. */
export function createSearchBarButton(
	view: HomeView,
	bar: HTMLElement,
	mode: "newNote" | "searchOnline",
): HTMLElement {
	return mode === "searchOnline" ? createSearchOnlineButton(bar) : createNewNoteButton(view);
}

/** Read the current query out of the search bar's input element. */
function getSearchQuery(bar: HTMLElement): string {
	return bar.querySelector<HTMLInputElement>(".sbd-search-input")?.value.trim() ?? "";
}

/** Open a web search for the current query (or the engine's home page when
 * empty) in the user's default browser. */
function searchOnline(bar: HTMLElement): void {
	const q = getSearchQuery(bar);
	const url = q ? WEB_SEARCH_URL + encodeURIComponent(q) : WEB_SEARCH_URL.replace("?q=", "");
	try {
		window.open(url, "_blank");
	} catch {
		// Pop-up blocked or unavailable — fall back to Obsidian's window opener.
		window.open(url, "_blank", "noopener");
	}
}

/** The original New-note button: creates a new note on click. */
function createNewNoteButton(view: HomeView): HTMLElement {
	const btn = createEl("button", {
		cls: "sbd-newnote",
		attr: { "aria-label": t().header.newNoteAria },
	});
	setIcon(btn.createSpan("sbd-newnote-icon"), "plus");
	btn.createSpan({ cls: "sbd-newnote-label", text: t().header.newNote });
	btn.addEventListener("click", () => {
		void view.plugin.createNewNote(view);
	});
	return btn;
}

/** The Search-online button: runs a web search for the current query. */
function createSearchOnlineButton(bar: HTMLElement): HTMLElement {
	const btn = createEl("button", {
		cls: "sbd-newnote sbd-newnote-search",
		attr: { "aria-label": t().header.searchOnlineAria },
	});
	setIcon(btn.createSpan("sbd-newnote-icon"), "globe");
	btn.createSpan({ cls: "sbd-newnote-label", text: t().header.searchOnline });
	btn.addEventListener("click", () => searchOnline(bar));
	return btn;
}
