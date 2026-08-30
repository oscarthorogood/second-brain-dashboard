import {
	Component,
	debounce,
	setIcon,
	setTooltip,
	type TAbstractFile,
} from "obsidian";
import { emptyState } from "./cardbodies";
import { deferRedrawWhileTyping } from "./cardfocus";
import { confirmAction } from "./ui";
import { t } from "./i18n";
import type { HomeView } from "./view";
import {
	createVaultEventHub,
	type VaultEvent,
	type VaultEventHub,
	watchedCardReactsToKind,
} from "./cardevents";
import { cardClasses, cardDefinition, cardFromTemplate } from "./cards";
import { openCardPicker } from "./cardpicker";
import { CardSettingsModal } from "./editors";
import {
	activeCards,
	type DashboardCard,
	effectiveCardBorderWidth,
	effectiveCardOpacity,
	effectiveCardRadius,
	effectiveMaxWidth,
	effectiveWidgetScale,
	lowPowerActive,
	removeCard,
	renderCards,
	resolveCardBlur,
	resolveCardBorderWidth,
} from "./types";
import {
	applyEdgeMerging,
	boardMetrics,
	enableReorderDrag,
	type GridLayout,
	relayout,
} from "./grid";
import { sizeSpec } from "./widgetsize";

/** Renders the dashboard toolbar and the grid of widgets. In arrange mode
 * widgets can be moved, added, removed and re-targeted; they are never resized
 * — a widget's size is fixed when it is added. */
export function renderDashboard(
	view: HomeView,
	container: HTMLElement,
	component: Component,
): void {
	const s = view.plugin.settings;
	const cards = renderCards(s);

	renderToolbar(view, container);

	const grid = container.createDiv("sbd-grid");
	grid.toggleClass("is-arranging", view.arrangeMode);
	// Board-level defaults; per-card overrides are set in the render loop below.
	grid.style.setProperty("--card-opacity", String(effectiveCardOpacity(s)));
	// Board-wide corner radius (px). Every card reads this via CSS; the frost
	// mask in grid.ts reads the resolved value back off the grid so its rounding
	// matches. Merged-edge corners still flatten to 0 regardless (see styles.css).
	grid.style.setProperty("--sbd-card-radius", `${effectiveCardRadius(s)}px`);
	grid.style.setProperty("--card-border-width", `${effectiveCardBorderWidth(s)}px`);

	// An empty board is left blank — no placeholder text or icon. The Arrange
	// toolbar (with "Add card") is still available above.
	if (cards.length === 0) return;

	const commit = () => void view.plugin.saveData(s);

	// Shared vault-event fan-out for every card on this board (see
	// createVaultEventHub). Lives on the render component, torn down with it.
	const events = createVaultEventHub(view.app, (ref) => component.registerEvent(ref));

	// Shared layout state for the packer and the reorder drag. The metrics are
	// measured below, once the grid element is in the DOM and has a width.
	const gridLayout: GridLayout = {
		cards,
		elements: new Map(),
		metrics: boardMetrics(effectiveMaxWidth(s), effectiveWidgetScale(s)),
	};

	for (const card of cards) {
		const el = grid.createDiv("sbd-card");
		gridLayout.elements.set(card, el);

		// The widget's fixed size, as a class the stylesheet keys its per-size
		// layout off (Widget Set draws every widget four times, and what changes
		// between the four is the content, not just the frame).
		el.addClass(`is-size-${card.size}`);
		const spec = sizeSpec(card.kind, card.size);
		el.style.setProperty("--sbd-widget-radius", `${spec.radius}px`);

		// Every card carries its kind as a class, so styles.css can state the
		// reference's per-widget chrome (its card padding, above all) without
		// each kind having to declare a cardClass of its own.
		el.addClass(`is-${card.kind}-card`);
		const kindClasses = cardClasses(card);
		if (kindClasses.length) el.addClass(...kindClasses);
		if (card.cardOpacity != null) {
			el.style.setProperty("--card-opacity", String(card.cardOpacity));
		}
		// Per-card border width overrides the board-level variable set on the grid.
		if (card.cardBorderWidth != null) {
			el.style.setProperty(
				"--card-border-width",
				`${resolveCardBorderWidth(s, card)}px`,
			);
		}
		// Cards whose resolved blur is > 0 feed the shared frost layer (see
		// updateFrostLayers / the .sbd-frost note in styles.css). The value is
		// stashed on the element so the frost rebuild can group cards by blur
		// without re-reading settings, and blur-off cards never enter a layer.
		// A seamless card paints no surface of its own, so frosting the wallpaper
		// behind it would leave a blurred rectangle floating on the board with no
		// card on it. Such a card never joins a frost layer.
		const cardBlur = kindClasses.includes("is-seamless") ? 0 : resolveCardBlur(s, card);
		if (cardBlur > 0) {
			el.addClass("has-blur");
			el.dataset.blur = String(cardBlur);
		}

		const head = el.createDiv("sbd-card-head");
		if (view.arrangeMode) {
			renderCardControls(view, card, head);
		} else {
			head.addClass("is-untitled");
		}

		const body = el.createDiv("sbd-card-body");
		const redraw = mountCardBody(view, card, body, component, events);

		// Post-render header/floating extras (the embed card's second-view
		// switcher). Not shown while arranging, where the header holds the title
		// editor.
		if (!view.arrangeMode) {
			cardDefinition(card).mountExtras?.(view, card, el, head, redraw);
		}

		if (view.arrangeMode) {
			enableReorderDrag(view, el, grid, card, gridLayout, component, commit);
		}
	}

	// Lay the board out from the measured pane width, then keep it in step with
	// the pane: the column count is derived from the width (widgets keep a
	// constant size and the board gains columns as it widens), so a resize can
	// change the packing, not merely stretch it.
	const layoutNow = () => {
		if (!grid.isConnected) return;
		const width = grid.clientWidth || effectiveMaxWidth(s);
		const next = boardMetrics(width, effectiveWidgetScale(s));
		gridLayout.metrics = next;
		grid.style.setProperty("--sbd-grid-cell", `${next.cell}px`);
		grid.style.setProperty("--sbd-grid-gap", `${next.gap}px`);
		relayout(grid, gridLayout);
		// Sharpen touching corners so adjacent widgets read as one merged tile,
		// and rebuild the shared frost mask that keys off those classes.
		applyEdgeMerging(grid);
	};
	// Lay out before the first paint, so widgets never flash at a stale width.
	window.requestAnimationFrame(layoutNow);
	const observer = new ResizeObserver(debounce(layoutNow, 60, true));
	observer.observe(grid);
	component.register(() => observer.disconnect());
}

/** Render a card's body. Each (re)draw renders under a fresh child component so
 * markdown/iframe embeds are torn down and rebuilt cleanly without leaking the
 * previous render.
 *
 * Liveness is per kind:
 * - web cards keep the optional polling refresh (refreshSec);
 * - embed/daily cards redraw from vault events. A create/delete/rename of the
 *   tracked file always redraws (it flips between the content and the
 *   "missing file" state); for content edits (modify) read-only cards redraw
 *   while editable cards sync their textarea in place so the cursor is kept. */
function mountCardBody(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	parent: Component,
	events: VaultEventHub,
): () => void {
	const def = cardDefinition(card);
	let child: Component | null = null;
	const draw = () => {
		if (child) parent.removeChild(child);
		child = new Component();
		parent.addChild(child);
		body.empty();
		try {
			def.render(view, card, body, child);
		} catch (err) {
			// A card kind must not be able to take the board down with it. This
			// call is *synchronous* inside renderDashboard's per-card loop, and
			// the arrange-mode drag overlay and resize grips are attached after
			// it — so an exception here doesn't merely leave one card half-drawn,
			// it leaves that card unmovable and unresizable and abandons every
			// card after it in the loop. Same intent as cardDefinition()'s inert
			// fallback for an unknown kind, one level down: contain the failure
			// to the one card and say so on its face, with the real error on the
			// console for a bug report.
			console.error(`Second Brain Dashboard: the ${card.kind} card failed to render`, err);
			body.empty();
			emptyState(body, "alert-triangle", t().cards.empty.renderFailed);
		}
	};
	draw();

	const live = def.liveness;
	if (live.mode === "poll") {
		// Low power mode suppresses the timer (not the first draw): a web card
		// keeps showing what it loaded, it just stops reloading on a clock.
		const configured = card.refreshSec && card.refreshSec > 0 ? card.refreshSec : 0;
		const every = lowPowerActive(view.plugin.settings) ? 0 : configured;
		// registerInterval ties the timer to the view's render lifecycle, so it
		// is cleared on the next full rebuild (and on view close).
		if (every) parent.registerInterval(window.setInterval(draw, every * 1000));
		return draw;
	}

	// Redraws the vault asks for are held while a field inside the card body has
	// focus, and run once after focus leaves (#212). `editableInPlace` below
	// covers only the card's *own* textarea; a card also renders focusable
	// content it doesn't own — anything a plugin puts inside an embed — and that
	// content is typically what writes the file the card watches, so typing into
	// it schedules the redraw that destroys it. The returned `draw` stays
	// un-held: a redraw the user asked for must still be immediate.
	//
	// A factory (rather than one shared value) so only the card kinds that
	// actually redraw from events register the focusout listener — static and
	// poll cards never call it.
	const createLiveDraw = () => deferRedrawWhileTyping(body, draw, parent);

	if (live.mode === "watch-file") {
		// Editable cards sync content edits in their textarea, so don't redraw on
		// modify (it would drop the cursor) — but still redraw on existence changes.
		// An embed can switch between a read-only and an editable view, so this is
		// evaluated per event against whichever view is currently shown.
		watchCardFile(view, card, events, createLiveDraw(), () => !live.editableInPlace(card), live.watchedPath);
		return draw;
	}

	// Data-driven cards derive their content from the vault as a whole (tasks,
	// counts, daily-note existence, query matches, edit timestamps), so redraw
	// them — debounced — whenever the vault or its metadata changes.
	if (live.mode === "vault") {
		const shouldRedraw = live.shouldRedraw;
		// Held the same way: a dataview/search card can host a plugin's input
		// just as an embed can. The hold is inside the debounce so it is decided
		// when the redraw fires, not when it was scheduled.
		const redraw = debounce(createLiveDraw(), 400, true);
		events.subscribe((ev) => {
			// A folder-scoped tasks card reads nothing outside its folders, so
			// events that provably can't change its content are skipped instead
			// of redrawing (and instead of resetting the debounce timer).
			if (!shouldRedraw || shouldRedraw(card, ev)) redraw();
		});
	}
	return draw;
}

/** Redraw a tracked-file (embed/daily) card's body when the file it tracks
 * changes on disk. create/delete/rename always redraw; modify only when
 * `redrawOnModify` (a predicate, re-evaluated per event so an embed that
 * switches between a read-only and an editable view is handled correctly). */
function watchCardFile(
	view: HomeView,
	card: DashboardCard,
	events: VaultEventHub,
	draw: () => void,
	redrawOnModify: () => boolean,
	watchedPath: (view: HomeView, card: DashboardCard) => string | null,
): void {
	// Coalesce bursts of writes (e.g. an editor autosaving) into one redraw.
	const redraw = debounce(draw, 150, true);
	const affects = (file: TAbstractFile, oldPath?: string): boolean => {
		const path = watchedPath(view, card);
		return path != null && (file.path === path || oldPath === path);
	};
	events.subscribe((ev: VaultEvent) => {
		// Tracked-file cards key off disk events only (see watchedCardReactsToKind:
		// a metadata reparse is ignored, a content edit is ignored while the card
		// is edited in place); then only the tracked file's own path redraws.
		if (!watchedCardReactsToKind(ev.kind, redrawOnModify())) return;
		if (affects(ev.file, ev.oldPath)) redraw();
	});
}

/** Save the current settings and rebuild the view (used after structural
 * changes like adding, removing or re-targeting a card). */
function persistAndRender(view: HomeView): void {
	void view.plugin.saveData(view.plugin.settings);
	view.render();
}

/** The editable card header shown in arrange mode: actions to open the
 * card's settings and to remove the card. */
function renderCardControls(
	view: HomeView,
	card: DashboardCard,
	head: HTMLElement,
): void {
	head.addClass("is-editing");

	const actions = head.createDiv("sbd-card-actions");

	const settingsBtn = actions.createEl("button", {
		cls: "sbd-card-action",
		attr: { "aria-label": t().dashboard.cardSettings },
	});
	setIcon(settingsBtn, "settings-2");
	setTooltip(settingsBtn, t().dashboard.cardSettings);
	settingsBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
	settingsBtn.addEventListener("click", () => openCardSettings(view, card));

	const remove = actions.createEl("button", {
		cls: "sbd-card-action is-danger",
		attr: { "aria-label": t().dashboard.removeCard },
	});
	setIcon(remove, "trash-2");
	setTooltip(remove, t().dashboard.removeCard);
	remove.addEventListener("pointerdown", (e) => e.stopPropagation());
	remove.addEventListener("click", () => {
		confirmAction(view.app, {
			title: t().dashboard.removeCardTitle,
			message: t().dashboard.removeCardMessage(
				card.title?.trim() || t().dashboard.thisCard,
			),
			confirmText: t().dashboard.removeCardConfirm,
			onConfirm: () => {
				removeCard(view.plugin.settings, card);
				persistAndRender(view);
			},
		});
	});
}

/** Open the full settings editor for a single card, driven entirely from the
 * board so nothing has to be configured in the plugin settings tab. */
function openCardSettings(view: HomeView, card: DashboardCard): void {
	const s = view.plugin.settings;
	new CardSettingsModal(view.app, card, {
		settings: s,
		favorites: s.favorites,
		externalCallsDisabled: s.disableExternalCalls,
		save: () => void view.plugin.saveData(s),
		rerender: () => view.render(),
		remove: () => {
			removeCard(s, card);
			persistAndRender(view);
		},
	}).open();
}

function renderToolbar(view: HomeView, container: HTMLElement): void {
	const bar = container.createDiv("sbd-toolbar");
	// Track arrange mode so the toolbar can switch between its compact and full controls.
	bar.toggleClass("is-arranging", view.arrangeMode);

	if (view.arrangeMode) {
		const add = bar.createEl("button", { cls: "sbd-tool-btn" });
		setIcon(add.createSpan("sbd-tool-icon"), "plus");
		add.createSpan({ cls: "sbd-tool-label", text: t().dashboard.addCard });
		add.setAttribute("aria-label", t().dashboard.addCardAria);
		setTooltip(add, t().dashboard.addCardAria);
		add.addEventListener("click", () => {
			openCardPicker(view.app, {
				sbdVersion: view.plugin.manifest.version,
				onChoose: (template, size) => {
					// A new widget goes on the end, which is where the packer puts
					// it: the first slot it fits after everything already placed.
					activeCards(view.plugin.settings).push(cardFromTemplate(template, size));
					persistAndRender(view);
				},
			});
		});

		// Toggle the per-card headers (title input + actions) off so each
		// card's full body is visible while arranging. Only available while
		// arranging; the headers come back automatically when arranging ends.
		const hideHdr = bar.createEl("button", { cls: "sbd-tool-btn" });
		hideHdr.toggleClass("is-active", view.hideHeaderInArrange);
		setIcon(
			hideHdr.createSpan("sbd-tool-icon"),
			view.hideHeaderInArrange ? "eye-off" : "eye",
		);
		hideHdr.createSpan({
			cls: "sbd-tool-label",
			text: view.hideHeaderInArrange
				? t().dashboard.showTitles
				: t().dashboard.hideTitles,
		});
		{
			const hideHdrLabel = view.hideHeaderInArrange
				? t().dashboard.showCardHeaders
				: t().dashboard.hideCardHeaders;
			hideHdr.setAttribute("aria-label", hideHdrLabel);
			setTooltip(hideHdr, hideHdrLabel);
		}
		hideHdr.addEventListener("click", () => {
			view.hideHeaderInArrange = !view.hideHeaderInArrange;
			view.render();
		});
	}

	const arrangeZone = bar.createDiv("sbd-arrange-zone");
	arrangeZone.toggleClass(
		"is-auto-hide",
		!view.arrangeMode &&
			view.plugin.settings.arrangeButtonVisibility === "hover",
	);
	const arrange = arrangeZone.createEl("button", { cls: "sbd-tool-btn" });
	arrange.toggleClass("is-active", view.arrangeMode);
	// Outside arrange mode keep it as a small, unobtrusive icon button; while
	// arranging, show the labelled "Done arranging" action.
	arrange.toggleClass("is-icon", !view.arrangeMode);
	setIcon(
		arrange.createSpan("sbd-tool-icon"),
		view.arrangeMode ? "check" : "move",
	);
	if (view.arrangeMode) {
		arrange.createSpan({
			cls: "sbd-tool-label",
			text: t().dashboard.doneArranging,
		});
	}
	{
		const arrangeLabel = view.arrangeMode
			? t().dashboard.finishArranging
			: t().dashboard.moveResize;
		arrange.setAttribute("aria-label", arrangeLabel);
		setTooltip(arrange, arrangeLabel);
	}
	arrange.addEventListener("click", () => {
		view.arrangeMode = !view.arrangeMode;
		view.render();
	});
}
