import { Notice, setIcon, Setting, type Component, type TFile } from "obsidian";
import { feedHost } from "../cardbodies";
import { fileForClaude, trayCount, revealTray } from "../claudebridge";
import { courseNames } from "../coursework";
import { formatCompactAge, localDayKey } from "../dates";
import { t } from "../i18n";
import { calendarStatus, expandEvents, loadCalendar, type IcsOccurrence } from "../ics";
import {
	effectiveAutoRefreshMinutes,
	effectiveFilingFolders,
	effectiveFilingWindow,
	type CalendarSyncSlotId,
	type DashboardCard,
	type HomeSettings,
} from "../types";
import { makeClickable } from "../ui";
import { destinationFolder, eventTouchesFolder, findCourseInText, type FilingFolders } from "../vaultfiling";
import { type HomeView } from "../view";

import { type CardDefinition, type CardEditorContext } from "./definition";

/**
 * Sync to inbox — three iCal feeds, emptied into `Claude/inbox`.
 *
 * The three slots are fixed rather than an open list, because they mean
 * different things: `Classes` is a timetable whose events become lectures,
 * `Assignments` is a deadline feed whose events become tutorials, essays,
 * projects or assessments, and `Obsidian` is whatever the user puts on their
 * own calendar. Naming them in the card (instead of offering "add a calendar")
 * is what lets each event carry its origin into the note, which is the single
 * most useful thing the person filing it can know.
 *
 * What this card does *not* do is decide what any event becomes. A timetable
 * entry reading "BUEC08018 Lec 14" could be a lecture, a rescheduled seminar or
 * a one-off revision session, and the vault's rules for telling those apart
 * (AGENTS.md §4–7) are rules for a reader. So every new event becomes one note
 * in `Claude/inbox` — the event's own description, and what it would take to
 * file it — and waits there. See `claudebridge.ts`.
 *
 * The card is therefore a view of one folder as much as of three feeds: every
 * size says where events land and how many are still sitting there, because a
 * sync that works and a tray nobody drains look identical from the feed end.
 *
 * That folder, how far either side of today the sync reaches, and the button
 * that forgets what has been written are all the inbox's, not this widget's:
 * two sync cards on a board write into one tray and share one `seen` index, so
 * a per-widget answer to any of them would split a queue whose whole value is
 * being one place to look. They live in plugin settings (Behaviour → Claude
 * trays); what stays here is what only this card does — which three feeds it
 * watches, and how often its own timer fires.
 *
 * Reference (Widget Set v2 → SYNC), with the destination added at each size:
 * small is three status dots, a refresh and the inbox's depth as its one
 * figure; medium three tiles under the destination chip; large three sheet
 * rows; extra large three sheet columns carrying the event counts. Large and
 * extra large close with the tray line; medium has no room for it and names the
 * folder in its header chip instead.
 */

/** The three feeds, in the order every size draws them. */
const SLOTS: readonly CalendarSyncSlotId[] = ["classes", "assignments", "obsidian"];

const DAY_MS = 86_400_000;

/** Where this card's events land, per the vault's filing settings. Resolved
 * per draw rather than held: the folder is a setting, so a card already on
 * screen when it changes must name the new tray, not the one it booted with. */
function inboxFolder(settings: HomeSettings): string {
	return destinationFolder("inbox", effectiveFilingFolders(settings));
}

/**
 * Whether a sync is in flight, and which feeds each card has kicked one for.
 *
 * Module-level rather than on the card or in settings: both are transient facts
 * about this session. A `syncing` flag written into the card's config would be
 * persisted, so a crash mid-fetch would leave the card permanently "syncing"
 * and refusing to refresh — and the flag is global anyway, since two sync cards
 * on one board share the feeds, the index and the queue.
 *
 * `started` is a WeakMap keyed by the card object holding the URLs it last
 * fetched — the shape the RSS card already uses for its tab state. Keying by
 * `card.id` and storing nothing but "has run" meant editing a feed's URL never
 * re-fetched it, and a card that bailed because another card's sync was in
 * flight was marked started anyway, so its feeds were never fetched at all.
 */
let syncing = false;
const started = new WeakMap<DashboardCard, string>();

/** The feed URL a slot is actually set up to fetch, or "" if it isn't — an
 * empty URL and a switched-off feed both mean "don't sync this one", and
 * render, mount and sync each had their own spelling of that. */
function slotUrl(slot: { url?: string; enabled?: boolean } | undefined): string {
	if (!slot || slot.enabled === false) return "";
	return (slot.url ?? "").trim();
}

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
	//
	// A sync may also resolve after the card is torn down and rebuilt: repainting
	// then writes into a detached node and leaves the live card stuck on its
	// spinner. Same guard the RSS, Git and weather cards use.
	let destroyed = false;
	component.register(() => {
		destroyed = true;
	});
	const paint = () => {
		if (destroyed) return;
		body.empty();
		paintCalSync(view, card, body, paint);
	};
	paint();

	// The first render kicks a fetch and, when the board stays open, schedules
	// the repeat — the same shape the calendar card's IcsContext uses, so a
	// dashboard left on a second monitor keeps the vault current by itself.
	const configured = SLOTS.map((id) => slotState(view, card, id)).filter((s) => s.url);
	if (!configured.length) return;
	const feeds = configured.map((s) => `${s.id}=${s.url}`).join("\n");
	if (started.get(card) !== feeds) {
		started.set(card, feeds);
		void syncNow(view, card, false, paint).then((ran) => {
			// A sync that bailed (another card's was already in flight) fetched
			// nothing, so the mark must not stick or these feeds are never read.
			if (!ran) started.delete(card);
		});
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

	// The tray line is drawn at large and extra large, empty or not: this card's
	// whole job is moving events into one folder, so the folder's name and depth
	// are the result, not an exception worth surfacing only when it goes wrong.
	//
	// Not at medium, where it does not fit. A 338×158 tile holds this card's
	// header and its three feed tiles and nothing else — measured, the tray line
	// ran 27px past the bottom edge — and a clipped status line is worse than an
	// absent one, because the folder's name is still half-drawn under the rim.
	// The destination chip in the header names the same folder at that size; what
	// is lost is the count, which large is one drag away. (The unsorted card's
	// own tray line does fit at medium, so it keeps it — its header is one line,
	// not three.)
	if (card.size === "large" || card.size === "xlarge") trayLine(view, body);
}

/** Where the events went, and how many are still sitting there. */
function trayLine(view: HomeView, body: HTMLElement): void {
	const folders = effectiveFilingFolders(view.plugin.settings);
	const waiting = trayCount(view.app, "inbox", folders);
	const strings = t().cards.calsync;
	const label =
		waiting > 0 ? strings.waiting(waiting, folders.inbox) : strings.trayEmpty(folders.inbox);
	const line = body.createDiv("sbd-tray-line");
	line.toggleClass("is-empty", waiting === 0);
	setIcon(line.createDiv("sbd-tray-icon"), "inbox");
	line.createDiv({ cls: "sbd-tray-text", text: label });
	const open = () => void revealTray(view.app, "inbox", folders);
	line.addEventListener("click", (e) => {
		e.stopPropagation();
		open();
	});
	makeClickable(line, open, label);
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
	const strings = t().cards.calsync;
	const head = body.createDiv("sbd-sync-head");
	head.createDiv({ cls: "sbd-sync-title", text: strings.toInbox });
	refreshButton(view, card, head, syncing, redraw, "icon");

	const list = body.createDiv("sbd-sync-mini");
	for (const slot of slots) {
		const row = list.createDiv("sbd-sync-mini-row");
		row.createDiv({ cls: "sbd-sync-name", text: slot.label });
		statusDot(row, slot);
	}

	// The small tile's figure is the tray's depth, not the feeds' event count:
	// 158px fits one number, and the one that tells the user whether to act is
	// how much is still waiting in the inbox, not how much the feeds hold.
	const foot = body.createDiv("sbd-sync-foot");
	foot.createDiv({ cls: "sbd-sync-when", text: lastSyncedLabel(view, syncing) });
	foot.createDiv({
		cls: "sbd-sync-total",
		text: strings.inInbox(trayCount(view.app, "inbox", effectiveFilingFolders(view.plugin.settings))),
	});
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
	text.createDiv({ cls: "sbd-sync-title is-large", text: t().cards.calsync.syncToInbox });
	destinationChip(text, inboxFolder(view.plugin.settings));
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
		providerLine(text, slot);
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
		providerLine(col, slot);
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
	text.createDiv({ cls: "sbd-sync-title is-large", text: t().cards.calsync.syncToInbox });
	destinationChip(text, inboxFolder(view.plugin.settings));
	text.createDiv({ cls: "sbd-sync-when", text: lastSyncedLabel(view, syncing) });
	refreshButton(view, card, head, syncing, redraw, "pill", label);
}

/** The folder every event lands in, named on the card rather than only in the
 * settings: a card called "sync" that writes notes somewhere is worth being
 * explicit about where. */
function destinationChip(parent: HTMLElement, folder: string): void {
	const chip = parent.createDiv("sbd-sync-dest");
	setIcon(chip.createDiv("sbd-sync-dest-icon"), "corner-down-right");
	chip.createSpan({ cls: "sbd-sync-dest-path", text: folder });
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

/** One slot's configuration and whatever the last fetch of it produced. */
function slotState(view: HomeView, card: DashboardCard, id: CalendarSyncSlotId): SlotState {
	const strings = t().cards.calsync;
	const slot = card.calsync?.[id] ?? {};
	const enabled = slot.enabled !== false;
	const url = slotUrl(slot);
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

/**
 * The second line of a feed's row: which server it comes from.
 *
 * It used to fall back to "Not connected" when there was no server yet — the
 * very words the status column beside it was already showing, so an
 * unconfigured row read "Classes / Not connected … Not connected". The row has
 * one thing left to say at that point and it is not the status again: it is
 * what to do about it.
 */
function providerLine(parent: HTMLElement, slot: SlotState): void {
	const strings = t().cards.calsync;
	// A feed switched off says so in its status column and needs no second
	// line at all; "add a URL" would be the wrong advice for it.
	if (!slot.host && !slot.enabled) return;
	parent.createDiv({
		cls: "sbd-sync-provider",
		text: slot.host || strings.addFeedHint,
	});
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
): Promise<boolean> {
	const cfg = card.calsync ?? {};
	const plugin = view.plugin;
	if (syncing) return false;

	const slots = SLOTS.map((id) => ({ id, url: slotUrl(cfg[id]) })).filter((s) => s.url);
	if (!slots.length) return false;

	syncing = true;
	try {
		// Inside the try: a repaint that throws would otherwise leave `syncing`
		// true and every later refresh would bail for the rest of the session.
		redraw();
		const disabled = plugin.settings.disableExternalCalls;
		const ttlMs = Math.max(cfg.refreshMin ?? 60, 1) * 60_000;
		const calendars = await Promise.all(
			slots.map((s) => loadCalendar(s.url, { ttlMs, disabled, force })),
		);

		const now = Date.now();
		// The window is the inbox's, not this card's: two sync cards feeding one
		// tray must agree on how much calendar is worth a note, or the queue's
		// depth depends on which widget happened to refresh last.
		// Not named `window`: that shadows the global this file calls
		// `setInterval` on, and a later edit reaching for it here would get days.
		const range = effectiveFilingWindow(plugin.settings);
		const from = now - range.pastDays * DAY_MS;
		const to = now + range.aheadDays * DAY_MS;
		const seen = (plugin.settings.calendarSyncSeen ??= {});
		const folders = effectiveFilingFolders(plugin.settings);
		const courses = courseNames(view.app);
		let queued = 0;
		let failed = 0;

		for (let i = 0; i < slots.length; i++) {
			const calendar = calendars[i];
			if (!calendar) continue;
			const label = t().cards.calsync.slots[slots[i].id];
			for (const occurrence of expandEvents(calendar.events, from, to)) {
				const key = occurrenceKey(occurrence);
				if (seen[key]) continue;
				// Recorded before the write, not after: a half-failed write that
				// left a note in the inbox would otherwise be re-filed on every
				// refresh, and a duplicate note is worse than a missing one the
				// user can re-sync for.
				seen[key] = new Date().toISOString();
				// A write that failed is the other case, and it needs the opposite
				// treatment: with no note in the inbox the event is never filed,
				// and the mark would be the only record of it, so it would be
				// dropped silently and for good. Take the mark back and let the
				// next refresh try again.
				// ponytail: retries every refresh with no backoff — a permanently
				// failing event re-attempts forever. Add a per-key attempt count
				// to `seen` if a broken vault path starts hammering the inbox.
				const note = await fileEvent(view, label, occurrence, courses, folders);
				if (!note) {
					delete seen[key];
					failed++;
					continue;
				}
				queued++;
			}
		}

		// Only claim a sync happened if something actually landed. A run where
		// every write failed and rolled back has synced nothing, and stamping it
		// would tell the user the vault is current when it is not.
		if (queued > 0 || failed === 0) plugin.settings.calendarSyncLast = Date.now();
		if (queued > 0) new Notice(t().notices.calsyncQueued(queued, folders.inbox));
		// A rollback used to be entirely silent: no note, no notice, no clue.
		if (failed > 0) new Notice(t().notices.calsyncFailed(failed, folders.inbox));
	} finally {
		// Cleared first, before anything that can throw: a `syncing` left true
		// refuses every later refresh for the rest of the session.
		syncing = false;
		// Saved here rather than at the end of the try, for the same reason the
		// index is written before the note: a throw part-way through the loop
		// would otherwise discard the marks for the events that *were* filed,
		// and the next refresh would file every one of them a second time.
		await plugin.saveData(plugin.settings);
		redraw();
	}
	return true;
}

/**
 * When an event happens, as the filing request shows it and as the note's
 * `sbd-event-start` frontmatter records it.
 *
 * Local throughout. `toISOString()` is UTC, so pairing its date with a local
 * clock time put a 9am Tokyo lecture on the day before, and an all-day event a
 * day early at any positive offset.
 */
export function eventWhenLabel(occurrence: { start: number; allDay?: boolean }): string {
	const day = localDayKey(occurrence.start);
	if (occurrence.allDay) return day;
	return `${day} ${new Date(occurrence.start).toTimeString().slice(0, 5)}`;
}

/** The identity of one occurrence of one event. */
export function occurrenceKey(occurrence: { uid: string; start: number; summary: string }): string {
	// A feed that omits UID (rare, but legal for some exporters) still needs a
	// stable key, so the summary stands in for it.
	const id = occurrence.uid || `nouid:${occurrence.summary}`;
	return `${id}@${occurrence.start}`;
}

/** Write one event into `Claude/inbox`. Hands back the note, or null when the
 * write failed, so the caller can roll its `seen` mark back (see {@link
 * syncNow}). */
async function fileEvent(
	view: HomeView,
	calendar: string,
	occurrence: IcsOccurrence,
	courses: readonly string[],
	folders: FilingFolders,
): Promise<TFile | null> {
	const strings = t().cards.calsync;
	const whenLabel = eventWhenLabel(occurrence);

	return fileForClaude(
		view.app,
		{
			kind: "calendar-event",
			destination: "inbox",
			source: strings.sourceLabel(calendar),
			summary: occurrence.summary || strings.untitledEvent,
			uid: occurrence.uid,
			courseHint: findCourseInText(occurrence.summary, courses),
			content: occurrence.description || "",
			details: {
				[strings.detailWhen]: whenLabel,
				[strings.detailCalendar]: calendar,
				[strings.detailLocation]: occurrence.location,
				[strings.detailUrl]: occurrence.url,
			},
		},
		{ "sbd-event-start": whenLabel, "sbd-calendar": calendar },
		folders,
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
					// The auto-refresh timer is set up at mount, so a new interval
					// only takes effect once the card is rebuilt.
					ctx.opts.rerender();
				}),
		);

	// Where the events land, how wide a window they come from and how to re-sync
	// them are all properties of the inbox itself, shared by every sync widget on
	// every board — so they live in the plugin's settings, and this editor says
	// so rather than offering a second, per-widget answer.
	new Setting(containerEl)
		.setName(strings.systemSettings)
		.setDesc(strings.systemSettingsDesc(inboxFolder(ctx.opts.settings)));
}

/** Three iCal feeds, emptied into `Claude/inbox`. */
export const calSyncCard: CardDefinition<"calsync"> = {
	kind: "calsync",
	templates: [
		{
			id: "calsync",
			name: "Sync to inbox",
			icon: "inbox",
			defaultSize: "medium",
			build: () => ({ kind: "calsync", title: "Sync to inbox", calsync: {} }),
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
	// The only vault state this card draws is the inbox tray's depth, so a
	// rebuild on every note edit bought nothing — and each rebuild restarted the
	// auto-refresh clock, which meant a board in use auto-synced roughly never.
	liveness: {
		mode: "vault",
		shouldRedraw: (_card, ev, view) => eventTouchesFolder(ev, inboxFolder(view.plugin.settings)),
	},
};
