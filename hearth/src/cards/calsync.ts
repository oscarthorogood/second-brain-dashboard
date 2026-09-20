import { Notice, setIcon, Setting, type Component } from "obsidian";
import { feedHost } from "../cardbodies";
import { holdForFiling, pendingRequestCount, revealFilingQueue, type HeldItem } from "../claudebridge";
import { courseNames } from "../coursework";
import { formatCompactAge } from "../dates";
import { t } from "../i18n";
import { calendarStatus, expandEvents, loadCalendar, type IcsOccurrence } from "../ics";
import { effectiveAutoRefreshMinutes, type CalendarSyncSlotId, type DashboardCard } from "../types";
import { makeClickable } from "../ui";
import { findCourseInText } from "../vaultfiling";
import { type HomeView } from "../view";

import { type CardDefinition, type CardEditorContext } from "./definition";

/**
 * Calendar sync — three iCal feeds, and a note waiting for every event on them.
 *
 * The three slots are fixed rather than an open list, because they mean
 * different things: `Classes` is a timetable whose events become lectures,
 * `Assignments` is a deadline feed whose events become tutorials, essays,
 * projects or assessments, and `Obsidian` is whatever the user puts on their
 * own calendar. Naming them in the card (instead of offering "add a calendar")
 * is what lets each event carry its origin into the filing request, which is
 * the single most useful thing the person filing it can know.
 *
 * What this card does *not* do is decide what any event becomes. A timetable
 * entry reading "BUEC08018 Lec 14" could be a lecture, a rescheduled seminar or
 * a one-off revision session, and the vault's rules for telling those apart
 * (AGENTS.md §4–7) are rules for a reader. So every new event is written into
 * the holding folder and queued for Claude — see `claudebridge.ts`.
 *
 * Reference (Widget Set v2 → SYNC): small is three status dots and a refresh,
 * medium three tiles, large three sheet rows, extra large three sheet columns
 * carrying the event counts.
 */

/** The three feeds, in the order every size draws them. */
const SLOTS: readonly CalendarSyncSlotId[] = ["classes", "assignments", "obsidian"];

/** How far either side of today an event has to fall before it is worth a
 * note. A term's timetable is published months ahead; a note per lecture for
 * all of it would bury the queue, so the window walks forward with the user. */
const DEFAULT_PAST_DAYS = 7;
const DEFAULT_AHEAD_DAYS = 21;

const DAY_MS = 86_400_000;

/**
 * Whether a sync is in flight, and which cards have kicked their first one.
 *
 * Module-level rather than on the card or in settings: both are transient facts
 * about this session. A `syncing` flag written into the card's config would be
 * persisted, so a crash mid-fetch would leave the card permanently "syncing"
 * and refusing to refresh — and the flag is global anyway, since two sync cards
 * on one board share the feeds, the index and the queue.
 */
let syncing = false;
const started = new Set<string>();

/** One feed's live state, resolved per render. */
interface SlotState {
	id: CalendarSyncSlotId;
	label: string;
	url: string;
	enabled: boolean;
	/** Where the feed is fetched from ("calendar.google.com"), for the row's
	 * second line — the real origin rather than a description of it. */
	host: string;
	state: "synced" | "syncing" | "error" | "blocked" | "unset";
	detail: string;
	events: number;
}

export function renderCalSync(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	component: Component,
): void {
	const cfg = (card.calsync ??= {});
	// A repaint paints; it does not re-enter this function. It used to, and the
	// scheduling below came with it: a sync repaints twice (once as it starts,
	// once as it finishes), so every sync left two more auto-refresh timers on
	// the component. Those timers live until the card is remounted, and each
	// one's own sync adds two more again — so a board left open ends up
	// refetching all three feeds over and over. Everything past `paint()` is
	// mount-time wiring and runs once, which is the shape the RSS and Git cards
	// already use.
	const paint = () => {
		body.empty();
		paintCalSync(view, card, body, paint);
	};
	paint();

	// The first render kicks a fetch and, when the board stays open, schedules
	// the repeat — the same shape the calendar card's IcsContext uses, so a
	// dashboard left on a second monitor keeps the vault current by itself.
	const configured = SLOTS.map((id) => slotState(view, card, id)).filter((s) => s.enabled && s.url);
	if (!configured.length) return;
	if (!started.has(card.id)) {
		started.add(card.id);
		void syncNow(view, card, false, paint);
	}
	const minutes = effectiveAutoRefreshMinutes(view.plugin.settings, cfg.refreshMin ?? 60);
	if (minutes > 0) {
		component.registerInterval(
			window.setInterval(() => void syncNow(view, card, true, paint), minutes * 60_000),
		);
	}
}

/** Draw the card as it stands right now. Called on mount and on every repaint,
 * and deliberately schedules nothing — that is what keeps the auto-refresh to
 * one timer per mount. */
function paintCalSync(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	redraw: () => void,
): void {
	const slots = SLOTS.map((id) => slotState(view, card, id));

	switch (card.size) {
		case "small":
			renderSmall(view, card, body, slots, syncing, redraw);
			break;
		case "medium":
			renderMedium(view, card, body, slots, syncing, redraw);
			break;
		case "large":
			renderLarge(view, card, body, slots, syncing, redraw);
			break;
		case "xlarge":
			renderXLarge(view, card, body, slots, syncing, redraw);
			break;
	}

	const pending = pendingRequestCount(view.app);
	if (pending > 0 && card.size !== "small") {
		const queue = body.createDiv({ cls: "sbd-detail-queue", text: t().cards.calsync.pending(pending) });
		makeClickable(queue, () => void revealFilingQueue(view.app), t().cards.calsync.pending(pending));
		queue.addEventListener("click", () => void revealFilingQueue(view.app));
	}
}

// ---- Sizes ----------------------------------------------------------------

function renderSmall(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	slots: SlotState[],
	syncing: boolean,
	redraw: () => void,
): void {
	const head = body.createDiv("sbd-sync-head");
	head.createDiv({ cls: "sbd-sync-title", text: t().cards.calsync.sync });
	refreshButton(view, card, head, syncing, redraw, "icon");

	const list = body.createDiv("sbd-sync-mini");
	for (const slot of slots) {
		const row = list.createDiv("sbd-sync-mini-row");
		row.createDiv({ cls: "sbd-sync-name", text: slot.label });
		statusDot(row, slot);
	}

	const foot = body.createDiv("sbd-sync-foot");
	foot.createDiv({ cls: "sbd-sync-when", text: lastSyncedLabel(view, syncing) });
	foot.createDiv({ cls: "sbd-sync-total", text: t().cards.calsync.eventsTotal(totalEvents(slots)) });
}

function renderMedium(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	slots: SlotState[],
	syncing: boolean,
	redraw: () => void,
): void {
	const head = body.createDiv("sbd-sync-head");
	const text = head.createDiv("sbd-sync-headtext");
	text.createDiv({ cls: "sbd-sync-title is-large", text: t().cards.calsync.calendarSync });
	text.createDiv({ cls: "sbd-sync-when", text: lastSyncedLabel(view, syncing) });
	refreshButton(view, card, head, syncing, redraw, "pill");

	const row = body.createDiv("sbd-sync-tiles");
	for (const slot of slots) {
		const tile = row.createDiv("sbd-sync-tile");
		statusDot(tile, slot);
		tile.createDiv({ cls: "sbd-sync-name", text: slot.label });
		tile.createDiv({ cls: "sbd-sync-status", text: slot.detail });
	}
}

function renderLarge(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	slots: SlotState[],
	syncing: boolean,
	redraw: () => void,
): void {
	syncHeader(view, card, body, syncing, redraw, t().cards.calsync.refresh);
	const list = body.createDiv("sbd-sync-rows");
	for (const slot of slots) {
		const row = list.createDiv("sbd-sync-row is-sheet");
		const left = row.createDiv("sbd-sync-rowleft");
		statusDot(left, slot);
		const text = left.createDiv("sbd-sync-rowtext");
		text.createDiv({ cls: "sbd-sync-name", text: slot.label });
		text.createDiv({ cls: "sbd-sync-provider", text: slot.host || t().cards.calsync.notConnected });
		row.createDiv({ cls: "sbd-sync-status", text: slot.detail });
	}
}

function renderXLarge(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	slots: SlotState[],
	syncing: boolean,
	redraw: () => void,
): void {
	syncHeader(view, card, body, syncing, redraw, t().cards.calsync.refreshAll);
	const cols = body.createDiv("sbd-sync-cols");
	for (const slot of slots) {
		const col = cols.createDiv("sbd-sync-col is-sheet");
		const head = col.createDiv("sbd-sync-colhead");
		head.createDiv({ cls: "sbd-card-eyebrow is-on-sheet", text: slot.label });
		statusDot(head, slot);
		col.createDiv({ cls: "sbd-sync-colstatus", text: slot.detail });
		col.createDiv({ cls: "sbd-sync-provider", text: slot.host || t().cards.calsync.notConnected });
		col.createDiv({ cls: "sbd-sync-count", text: t().cards.calsync.eventsTracked(slot.events) });
	}
}

// ---- Pieces ---------------------------------------------------------------

function syncHeader(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	syncing: boolean,
	redraw: () => void,
	label: string,
): void {
	const head = body.createDiv("sbd-sync-head is-stacked");
	const text = head.createDiv("sbd-sync-headtext");
	text.createDiv({ cls: "sbd-card-eyebrow", text: t().cards.calsync.eyebrow });
	text.createDiv({ cls: "sbd-sync-title is-large", text: t().cards.calsync.calendarSync });
	text.createDiv({ cls: "sbd-sync-when", text: lastSyncedLabel(view, syncing) });
	refreshButton(view, card, head, syncing, redraw, "pill", label);
}

function statusDot(parent: HTMLElement, slot: SlotState): void {
	const dot = parent.createDiv("sbd-sync-dot");
	dot.addClass(`is-${slot.state}`);
	dot.setAttribute("aria-label", slot.detail);
}

function refreshButton(
	view: HomeView,
	card: DashboardCard,
	parent: HTMLElement,
	syncing: boolean,
	redraw: () => void,
	shape: "icon" | "pill",
	label = t().cards.calsync.refresh,
): void {
	const btn = parent.createDiv(shape === "icon" ? "sbd-sync-refresh is-icon" : "sbd-sync-refresh");
	const icon = btn.createDiv("sbd-sync-refresh-icon");
	setIcon(icon, "refresh-cw");
	btn.toggleClass("is-spinning", syncing);
	if (shape === "pill") btn.createSpan({ cls: "sbd-sync-refresh-label", text: label });
	const run = () => {
		if (syncing) return;
		void syncNow(view, card, true, redraw);
	};
	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		run();
	});
	makeClickable(btn, run, label);
}

function lastSyncedLabel(view: HomeView, syncing: boolean): string {
	if (syncing) return t().cards.calsync.syncing;
	const at = view.plugin.settings.calendarSyncLast;
	return at ? t().cards.calsync.syncedAgo(formatCompactAge(at)) : t().cards.calsync.neverSynced;
}

function totalEvents(slots: SlotState[]): number {
	return slots.reduce((sum, s) => sum + s.events, 0);
}

/** One slot's configuration and whatever the last fetch of it produced. */
function slotState(view: HomeView, card: DashboardCard, id: CalendarSyncSlotId): SlotState {
	const strings = t().cards.calsync;
	const slot = card.calsync?.[id] ?? {};
	const url = (slot.url ?? "").trim();
	const enabled = slot.enabled !== false;
	const label = strings.slots[id];
	if (!url || !enabled) {
		return { id, label, url, enabled, host: "", state: "unset", detail: enabled ? strings.notConnected : strings.off, events: 0 };
	}
	const status = calendarStatus(url);
	const host = feedHost(url);
	if (status.blocked) return { id, label, url, enabled, host, state: "blocked", detail: strings.blocked, events: status.events };
	if (status.error) return { id, label, url, enabled, host, state: "error", detail: syncError(status.error), events: status.events };
	if (!status.loaded) return { id, label, url, enabled, host, state: "syncing", detail: strings.syncing, events: 0 };
	return { id, label, url, enabled, host, state: "synced", detail: strings.synced, events: status.events };
}

/** A fetch failure in the user's own words, falling back to what the network
 * layer said. `not-calendar` is the one worth translating: it means the URL
 * resolved but isn't an ICS feed, which is almost always a webpage URL pasted
 * instead of the subscription link. */
function syncError(error: string): string {
	return error === "not-calendar" ? t().cards.calsync.notCalendar : error;
}

// ---- The sync itself ------------------------------------------------------

/**
 * Fetch every configured feed and queue anything new.
 *
 * `seen` is keyed by UID *and* occurrence start, not UID alone: a weekly
 * lecture is one VEVENT with an RRULE, so every week of term shares a UID, and
 * keying on it would file the first Monday and silently skip the other ten.
 */
export async function syncNow(
	view: HomeView,
	card: DashboardCard,
	force: boolean,
	redraw: () => void,
): Promise<void> {
	const cfg = card.calsync ?? {};
	const plugin = view.plugin;
	if (syncing) return;

	const slots = SLOTS.map((id) => ({ id, slot: cfg[id] ?? {} })).filter(
		(s) => (s.slot.url ?? "").trim() && s.slot.enabled !== false,
	);
	if (!slots.length) return;

	syncing = true;
	redraw();
	try {
		const disabled = plugin.settings.disableExternalCalls;
		const ttlMs = Math.max(cfg.refreshMin ?? 60, 1) * 60_000;
		const calendars = await Promise.all(
			slots.map((s) => loadCalendar((s.slot.url ?? "").trim(), { ttlMs, disabled, force })),
		);

		const now = Date.now();
		const from = now - (cfg.pastDays ?? DEFAULT_PAST_DAYS) * DAY_MS;
		const to = now + (cfg.aheadDays ?? DEFAULT_AHEAD_DAYS) * DAY_MS;
		const seen = (plugin.settings.calendarSyncSeen ??= {});
		const courses = courseNames(view.app);
		let queued = 0;

		for (let i = 0; i < slots.length; i++) {
			const calendar = calendars[i];
			if (!calendar) continue;
			const label = t().cards.calsync.slots[slots[i].id];
			for (const occurrence of expandEvents(calendar.events, from, to)) {
				const key = occurrenceKey(occurrence);
				if (seen[key]) continue;
				// Recorded before the write, not after: a half-failed write that
				// left a holding note behind would otherwise be re-queued on every
				// refresh, and a duplicate note is worse than a missing one the
				// user can re-sync for.
				seen[key] = new Date().toISOString();
				// A write that produced nothing at all is the other case, and it
				// needs the opposite treatment: the event has no note and the mark
				// would be the only record of it, so the event would be dropped
				// silently and for good. Take the mark back and let the next
				// refresh try again.
				const held = await queueEvent(view, label, occurrence, courses);
				if (!held.holding) {
					delete seen[key];
					continue;
				}
				queued++;
			}
		}

		plugin.settings.calendarSyncLast = Date.now();
		if (queued > 0) new Notice(t().notices.calsyncQueued(queued));
	} finally {
		// Cleared first, before anything that can throw: a `syncing` left true
		// refuses every later refresh for the rest of the session.
		syncing = false;
		// Saved here rather than at the end of the try, for the same reason the
		// index is written before the note: a throw part-way through the loop
		// would otherwise discard the marks for the events that *were* filed,
		// and the next refresh would file every one of them a second time.
		void plugin.saveData(plugin.settings);
		redraw();
	}
}

/** The identity of one occurrence of one event. */
export function occurrenceKey(occurrence: { uid: string; start: number; summary: string }): string {
	// A feed that omits UID (rare, but legal for some exporters) still needs a
	// stable key, so the summary stands in for it.
	const id = occurrence.uid || `nouid:${occurrence.summary}`;
	return `${id}@${occurrence.start}`;
}

/** Write one event into the holding folder and ask for it to be filed. Hands
 * back what landed, so the caller can tell a write that failed from one that
 * worked (see the `seen` index in {@link syncNow}). */
async function queueEvent(
	view: HomeView,
	calendar: string,
	occurrence: IcsOccurrence,
	courses: readonly string[],
): Promise<HeldItem> {
	const strings = t().cards.calsync;
	const when = new Date(occurrence.start);
	const whenLabel = occurrence.allDay
		? when.toISOString().slice(0, 10)
		: `${when.toISOString().slice(0, 10)} ${when.toTimeString().slice(0, 5)}`;

	return holdForFiling(
		view.app,
		{
			kind: "calendar-event",
			source: strings.sourceLabel(calendar),
			summary: occurrence.summary || strings.untitledEvent,
			uid: occurrence.uid,
			courseHint: findCourseInText(occurrence.summary, courses),
			details: {
				[strings.detailWhen]: whenLabel,
				[strings.detailCalendar]: calendar,
				[strings.detailLocation]: occurrence.location,
				[strings.detailUrl]: occurrence.url,
			},
		},
		occurrence.description || "",
		{ "sbd-event-start": whenLabel, "sbd-calendar": calendar },
	);
}

// ---- Editor ---------------------------------------------------------------

export function calSyncEditor(ctx: CardEditorContext, containerEl: HTMLElement): void {
	const strings = t().editors.calsync;
	const cfg = (ctx.card.calsync ??= {});

	new Setting(containerEl).setName(strings.heading).setHeading();
	new Setting(containerEl).setDesc(strings.headingDesc);

	for (const id of SLOTS) {
		const slot = (cfg[id] ??= {});
		const row = new Setting(containerEl).setName(t().cards.calsync.slots[id]).setClass("sbd-rss-setting");
		row.addText((txt) => {
			txt
				.setPlaceholder(strings.urlPlaceholder)
				.setValue(slot.url ?? "")
				.onChange((v) => {
					slot.url = v.trim() || undefined;
					ctx.opts.save();
					ctx.opts.rerender();
				});
			txt.inputEl.addClass("sbd-rss-url");
		});
		row.addExtraButton((b) =>
			b
				.setIcon(slot.enabled === false ? "eye-off" : "eye")
				.setTooltip(slot.enabled === false ? strings.enable : strings.disable)
				.onClick(() => {
					slot.enabled = slot.enabled === false ? undefined : false;
					ctx.opts.save();
					ctx.requestRender();
				}),
		);
	}

	new Setting(containerEl)
		.setName(strings.refresh)
		.setDesc(strings.refreshDesc)
		.addSlider((s) =>
			s
				.setLimits(0, 180, 5)
				.setValue(cfg.refreshMin ?? 60)
				.onChange((v) => {
					cfg.refreshMin = v === 60 ? undefined : v;
					ctx.opts.save();
				}),
		);

	new Setting(containerEl)
		.setName(strings.window)
		.setDesc(strings.windowDesc)
		.addText((txt) => {
			txt.setValue(String(cfg.aheadDays ?? DEFAULT_AHEAD_DAYS)).onChange((v) => {
				const n = parseInt(v, 10);
				cfg.aheadDays = Number.isFinite(n) && n > 0 ? n : undefined;
				ctx.opts.save();
			});
			txt.inputEl.type = "number";
			txt.inputEl.addClass("sbd-count-input");
		});

	// A full re-sync is the way out of "I deleted the holding note and want it
	// back": the index is what suppresses a second copy, so clearing it is the
	// only thing that can bring one.
	new Setting(containerEl)
		.setName(strings.forget)
		.setDesc(strings.forgetDesc)
		.addButton((b) =>
			b.setButtonText(strings.forgetButton).onClick(() => {
				ctx.opts.settings.calendarSyncSeen = {};
				ctx.opts.save();
				new Notice(t().notices.calsyncForgotten);
			}),
		);
}

/** Three iCal feeds, kept in step with the vault. */
export const calSyncCard: CardDefinition<"calsync"> = {
	kind: "calsync",
	templates: [
		{
			id: "calsync",
			name: "Calendar sync",
			icon: "refresh-cw",
			defaultSize: "medium",
			build: () => ({ kind: "calsync", title: "Calendar sync", calsync: {} }),
		},
	],
	render: (view, card, body, component) => renderCalSync(view, card, body, component),
	renderEditor: (container, ctx) => calSyncEditor(ctx, container),
	cloneConfig: (source, copy) => {
		if (!source.calsync) return;
		copy.calsync = {
			...source.calsync,
			classes: { ...source.calsync.classes },
			assignments: { ...source.calsync.assignments },
			obsidian: { ...source.calsync.obsidian },
		};
	},
	cardClass: "is-sync-card",
	liveness: { mode: "vault" },
};
