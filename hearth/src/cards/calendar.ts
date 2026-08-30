import { Component, setIcon, Setting, TFile } from "obsidian";
import {
	activityByDay,
	dailyNotePath,
	dailyNotesOptions,
	emptyState,
	heatLevel,
	moment,
	summaryTile,
	type DailyNotesOptions,
	type Moment,
} from "../cardbodies";
import {
	buildIcsContext,
	calendarChipsEditor,
	calendarSourcesEditor,
	openDailyNote,
	renderEventRow,
	showDayMenu,
	showEventDetail,
	taskNotesSourceEditor,
	type IcsContext,
} from "../calendarsource";
import { formatRelativeDate } from "../dates";
import { taskNotesEnabled, taskNotesMeta } from "../tasknotes";
import { t } from "../i18n";
import { type DashboardCard } from "../types";
import { makeClickable } from "../ui";
import { type HomeView } from "../view";
import { type CardDefinition, type CardEditorContext } from "./definition";

// ---- Mini calendar -------------------------------------------------------

/** A month grid resolved against the core Daily notes plugin's format/folder:
 * dots mark days with an existing note, clicking one opens it, clicking
 * today when it doesn't exist yet safely falls back to the core "Open
 * today's daily note" command (template-aware). Other empty days are left
 * alone rather than guessing at template handling for arbitrary dates. */
export function renderCalendar(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	component: Component,
): void {
	const options = dailyNotesOptions(view);
	const cfg = card.calendar ?? {};
	const sources = (cfg.sources ?? []).filter((s) => s.url.trim() && s.enabled !== false);
	const useTaskNotes = cfg.taskNotes?.enabled === true && taskNotesEnabled(view.app);

	// The card needs a reason to exist: daily notes (for the note grid), an
	// external calendar to overlay, or TaskNotes as a source.
	if (!options && sources.length === 0 && !useTaskNotes) {
		emptyState(body, "calendar-days", t().cards.empty.dailyEnable);
		return;
	}

	// Widget Set → CALENDAR's small tile is today's date under its month. A
	// seven-column month grid plus an agenda does not fit in 158x158, and the
	// date is what a glance at a calendar is for.
	if (card.size === "small") {
		const today = moment();
		summaryTile(body, {
			value: today.format("D"),
			label: today.format("MMMM"),
		});
		return;
	}

	const wrap = body.createDiv("sbd-calendar");
	// Activity counts are only needed for the heatmap tint.
	const activity = cfg.heatmap ? activityByDay(view.app, cfg.heatmapMetric ?? "modified") : null;

	const ics = buildIcsContext(view, cfg, sources, component);
	if (cfg.view === "agenda") {
		const days = cfg.agendaDays && cfg.agendaDays > 0 ? Math.min(cfg.agendaDays, 60) : 14;
		const draw = () => {
			wrap.empty();
			const start = moment().startOf("day");
			ics.expand(start.valueOf(), start.clone().add(days, "days").valueOf());
			renderCalendarAgenda(view, wrap, options, cfg, activity, ics);
		};
		ics.onLoaded(draw);
		draw();
		ics.start();
		return;
	}

	let cursor: Moment = moment().startOf("month");
	const draw = () => {
		wrap.empty();
		renderCalendarHead(wrap, cursor, {
			onPrev: () => {
				cursor = cursor.clone().subtract(1, "month");
				draw();
			},
			onNext: () => {
				cursor = cursor.clone().add(1, "month");
				draw();
			},
			onToday: () => {
				cursor = moment().startOf("month");
				draw();
			},
		});
		// Expand events across a window comfortably covering the visible grid.
		ics.expand(
			cursor.clone().startOf("month").subtract(7, "days").valueOf(),
			cursor.clone().endOf("month").add(7, "days").valueOf(),
		);
		renderCalendarGrid(view, wrap, cursor, options, cfg, activity, ics);
		renderMiniAgenda(view, wrap, ics);
	};
	ics.onLoaded(draw);
	draw();
	ics.start();
}





function renderCalendarHead(
	wrap: HTMLElement,
	cursor: Moment,
	handlers: { onPrev: () => void; onNext: () => void; onToday: () => void },
): void {
	// Widget Set → CALENDAR: the month name alone on the left, the year in
	// mono on the right. The reference draws no month arrows at all — it is a
	// still artboard — so the two the card actually needs are tucked beside
	// the year and only fade in on hover, leaving the resting header exactly
	// the reference's two pieces of text.
	const head = wrap.createDiv("sbd-calendar-head");

	const label = head.createDiv({ cls: "sbd-calendar-label", text: cursor.format("MMMM") });
	label.setAttribute("title", t().cards.calendar.backToToday);
	label.addEventListener("click", handlers.onToday);

	const side = head.createDiv("sbd-calendar-side");
	side.createDiv({ cls: "sbd-calendar-year", text: cursor.format("YYYY") });

	const navs = side.createDiv("sbd-calendar-navs");
	const prev = navs.createEl("button", { cls: "sbd-calendar-nav", attr: { "aria-label": t().cards.calendar.previousMonth } });
	setIcon(prev, "chevron-left");
	prev.addEventListener("click", handlers.onPrev);

	const next = navs.createEl("button", { cls: "sbd-calendar-nav", attr: { "aria-label": t().cards.calendar.nextMonth } });
	setIcon(next, "chevron-right");
	next.addEventListener("click", handlers.onNext);
}



function renderCalendarGrid(
	view: HomeView,
	wrap: HTMLElement,
	cursor: Moment,
	options: DailyNotesOptions | null,
	cfg: NonNullable<DashboardCard["calendar"]>,
	activity: Map<string, number> | null,
	ics: IcsContext,
): void {
	const grid = wrap.createDiv("sbd-calendar-grid");
	const startOfWeek = moment.localeData().firstDayOfWeek();
	const weekNumbers = cfg.showWeekNumbers === true;
	if (weekNumbers) {
		// One extra leading column for the week number.
		grid.addClass("has-week-numbers");
		// A single "W", as the reference heads the gutter — the column is only
		// 24px wide and a two-letter head crowds it.
		grid.createDiv({ cls: "sbd-calendar-dow sbd-calendar-wk", text: t().cards.calendar.weekColumn });
	}

	for (let i = 0; i < 7; i++) {
		const dow = (startOfWeek + i) % 7;
		// One letter per column, as the reference draws it (M T W T F S S).
		// Array.from, not [0]: a locale whose short weekday starts with an
		// astral character would otherwise be sliced mid-surrogate.
		const short = moment().day(dow).format("dd");
		grid.createDiv({ cls: "sbd-calendar-dow", text: Array.from(short)[0] ?? short });
	}

	const monthStart = cursor.clone().startOf("month");
	const monthEnd = cursor.clone().endOf("month");
	const gridStart = monthStart.clone().subtract((monthStart.day() - startOfWeek + 7) % 7, "days");
	const totalCells = Math.ceil((monthEnd.diff(gridStart, "days") + 1) / 7) * 7;

	// Highest edit count in the visible range, so the heatmap tint is relative.
	let peak = 1;
	if (activity) {
		for (let i = 0; i < totalCells; i++) {
			const key = gridStart.clone().add(i, "days").format("YYYY-MM-DD");
			peak = Math.max(peak, activity.get(key) ?? 0);
		}
	}

	const today: string = moment().format("YYYY-MM-DD");
	for (let i = 0; i < totalCells; i++) {
		const day = gridStart.clone().add(i, "days");
		if (weekNumbers && i % 7 === 0) {
			grid.createDiv({ cls: "sbd-calendar-wk", text: day.format("W") });
		}
		const dayKey = day.format("YYYY-MM-DD");
		const path = options ? dailyNotePath(day, options) : null;
		const file = path ? view.app.vault.getAbstractFileByPath(path) : null;
		const isToday = dayKey === today;
		const events = ics.on(dayKey);

		const cell = grid.createDiv("sbd-calendar-day");
		cell.toggleClass("is-outside", day.month() !== cursor.month());
		cell.toggleClass("is-today", isToday);
		cell.toggleClass("has-note", file instanceof TFile);
		if (activity) {
			const count = activity.get(dayKey) ?? 0;
			cell.style.setProperty("--heat", count > 0 ? String(heatLevel(count, peak)) : "0");
			cell.toggleClass("has-heat", count > 0);
			cell.setAttribute("aria-label", t().cards.calendar.dayEdited(day.format("MMM D"), count));
		}
		cell.createDiv({ cls: "sbd-calendar-daynum", text: String(day.date()) });

		// Markers row: the daily-note dot, then one coloured dot per external
		// event (capped) so a busy day reads at a glance without overflowing.
		if (file instanceof TFile || events.length) {
			const dots = cell.createDiv("sbd-calendar-dots");
			if (file instanceof TFile) dots.createDiv("sbd-calendar-dot");
			for (const ev of events.slice(0, 3)) {
				const dot = dots.createDiv("sbd-calendar-evdot");
				dot.style.setProperty("--ev-color", ics.eventColor(ev));
				// A finished task's dot fades, so a busy day still reads as
				// "what's left" at a glance — the way TaskNotes shows it.
				dot.toggleClass("is-done", taskNotesMeta(ev)?.done === true);
			}
			if (events.length) {
				cell.setAttribute(
					"aria-label",
					t().cards.calendar.dayEvents(day.format("MMM D"), events.length),
				);
			}
		}

		// A day with events opens the picker (note + events); a plain day opens
		// its note directly, exactly as before.
		const activate = (evt?: MouseEvent) => {
			if (events.length) {
				showDayMenu(view, day, options, file, isToday, events, ics, evt ?? cell);
			} else {
				openDailyNote(view, day, options, file, isToday);
			}
		};
		cell.addEventListener("click", (e) => activate(e));
		makeClickable(cell, () => activate(), day.format("MMMM D, YYYY"));
	}
}


/** The list the reference draws under the month grid, below a dashed rule: a
 *  coloured dot, the event's title, and its start time down the right edge.
 *  Scoped to today, which is what a month grid leaves unanswered — the grid
 *  says which days are busy, this says what today actually holds. Renders
 *  nothing at all when today is clear, so a card with no calendar attached
 *  looks exactly as it did. */
function renderMiniAgenda(view: HomeView, wrap: HTMLElement, ics: IcsContext): void {
	const events = ics.on(moment().format("YYYY-MM-DD"));
	if (!events.length) return;

	const list = wrap.createDiv("sbd-mini-agenda");
	for (const ev of events.slice(0, MINI_AGENDA_MAX)) {
		const row = list.createDiv("sbd-mini-agenda-row");
		const dot = row.createDiv("sbd-mini-agenda-dot");
		dot.style.setProperty("--ev-color", ics.eventColor(ev));
		row.createDiv({ cls: "sbd-mini-agenda-title", text: ev.summary });
		// "LT" is moment's locale-aware short time, so this follows whatever
		// clock the user's locale uses. The mini calendar has no clock setting
		// of its own — unlike the schedule card, which offers one.
		const at = ev.allDay
			? t().cards.calendar.allDay
			: moment(new Date(ev.start)).format("LT");
		row.createDiv({ cls: "sbd-mini-agenda-time", text: at });
		const open = () => showEventDetail(view, ev, ics);
		row.addEventListener("click", open);
		makeClickable(row, open, ev.summary);
	}
}

/** How many of today's events the footer lists before it stops. The reference
 *  draws two; a hard cap matters more than the exact number, because the
 *  footer shares the card's height with the grid above it. */
const MINI_AGENDA_MAX = 3;


/** The agenda layout of the calendar card: a chronological list of days from
 * today forward (`agendaDays`, default 14). Each day header opens its daily note
 * (or offers to create it, exactly like the month grid), and any external
 * calendar events for that day are listed beneath it, coloured by source. Days
 * with a note are emphasised with a dot; the optional heatmap tints each header
 * by that day's activity. Suits narrow or tall cards, and is the natural home
 * for subscribed ICS calendars. */
function renderCalendarAgenda(
	view: HomeView,
	wrap: HTMLElement,
	options: DailyNotesOptions | null,
	cfg: NonNullable<DashboardCard["calendar"]>,
	activity: Map<string, number> | null,
	ics: IcsContext,
): void {
	wrap.addClass("is-agenda");
	const days = cfg.agendaDays && cfg.agendaDays > 0 ? Math.min(cfg.agendaDays, 60) : 14;
	const start = moment().startOf("day");

	// Highest edit count in the visible range, so the heatmap tint is relative.
	let peak = 1;
	if (activity) {
		for (let i = 0; i < days; i++) {
			const key = start.clone().add(i, "days").format("YYYY-MM-DD");
			peak = Math.max(peak, activity.get(key) ?? 0);
		}
	}

	const list = wrap.createDiv("sbd-agenda");
	let lastMonth = -1;
	for (let i = 0; i < days; i++) {
		const day = start.clone().add(i, "days");
		const dayKey = day.format("YYYY-MM-DD");
		// A light month separator whenever the agenda crosses into a new month.
		if (day.month() !== lastMonth) {
			list.createDiv({ cls: "sbd-agenda-month", text: day.format("MMMM YYYY") });
			lastMonth = day.month();
		}

		const path = options ? dailyNotePath(day, options) : null;
		const file = path ? view.app.vault.getAbstractFileByPath(path) : null;
		const hasNote = file instanceof TFile;
		const isToday = i === 0;
		const events = ics.on(dayKey);

		const row = list.createDiv("sbd-agenda-row");
		row.toggleClass("is-today", isToday);
		row.toggleClass("has-note", hasNote);

		const dateBox = row.createDiv("sbd-agenda-date");
		dateBox.createDiv({ cls: "sbd-agenda-dow", text: day.format("ddd") });
		dateBox.createDiv({ cls: "sbd-agenda-daynum", text: String(day.date()) });

		const main = row.createDiv("sbd-agenda-main");
		main.createDiv({ cls: "sbd-agenda-label", text: formatRelativeDate(dayKey) });
		// Faint "No note" hint only for truly empty days (no note, no events).
		if (!hasNote && events.length === 0 && options) {
			main.createDiv({ cls: "sbd-agenda-sub", text: t().cards.calendar.agendaNoNote });
		}

		if (activity) {
			const count = activity.get(dayKey) ?? 0;
			row.style.setProperty("--heat", count > 0 ? String(heatLevel(count, peak)) : "0");
			row.toggleClass("has-heat", count > 0);
			row.setAttribute("aria-label", t().cards.calendar.dayEdited(day.format("MMM D"), count));
		}
		if (hasNote) row.createDiv("sbd-calendar-dot sbd-agenda-dot");

		// The day header opens/creates the daily note (events are listed
		// separately below, each clickable); with no daily notes it's inert.
		if (options) {
			const activate = () => openDailyNote(view, day, options, file, isToday);
			row.addEventListener("click", activate);
			makeClickable(row, activate, day.format("MMMM D, YYYY"));
		} else {
			row.addClass("is-static");
		}

		// External calendar events for the day, listed under its header. Each is
		// clickable to view its details, so the day offers both note and events.
		if (events.length) {
			const evList = list.createDiv("sbd-agenda-events");
			for (const ev of events) renderEventRow(view, evList, ev, day, ics);
		}
	}
}


/** One event line in the agenda: a coloured bullet, its time (or "All day"),
 * and the summary, with the source name as a trailing badge when more than one
 * calendar is in play. A TaskNotes entry additionally carries a completion box,
 * its due/recurring markers, and strikes through once it's done — so the agenda
 * reads like TaskNotes' own list while staying a calendar. */






export function calendarEditor(ctx: CardEditorContext, containerEl: HTMLElement): void {
	const cfg = (ctx.card.calendar ??= {});
	new Setting(containerEl)
		.setName(t().editors.calendar.view)
		.setDesc(t().editors.calendar.viewDesc)
		.addDropdown((d) => {
			d.addOption("month", t().editors.calendar.viewMonth);
			d.addOption("agenda", t().editors.calendar.viewAgenda);
			d.setValue(cfg.view ?? "month").onChange((v) => {
				cfg.view = v === "agenda" ? "agenda" : undefined;
				ctx.opts.save();
				ctx.requestRender();
			});
		});
	if (cfg.view === "agenda") {
		const days = new Setting(containerEl)
			.setName(t().editors.calendar.agendaDays)
			.setDesc(t().editors.calendar.agendaDaysDesc);
		days.addSlider((s) => {
			s.setLimits(3, 60, 1)
				.setValue(cfg.agendaDays ?? 14)
				.setDynamicTooltip()
				.onChange((v) => {
					cfg.agendaDays = v === 14 ? undefined : v;
					ctx.opts.save();
				});
		});
		days.addExtraButton((b) =>
			b
				.setIcon("rotate-ccw")
				.setTooltip(t().settings.resetSlider)
				.onClick(() => {
					cfg.agendaDays = undefined;
					ctx.opts.save();
					ctx.requestRender();
				}),
		);
	} else {
		new Setting(containerEl)
			.setName(t().editors.calendar.weekNumbers)
			.setDesc(t().editors.calendar.weekNumbersDesc)
			.addToggle((t) =>
				t.setValue(cfg.showWeekNumbers ?? false).onChange((v) => {
					cfg.showWeekNumbers = v || undefined;
					ctx.opts.save();
				}),
			);
	}
	new Setting(containerEl)
		.setName(t().editors.calendar.heatmap)
		.setDesc(t().editors.calendar.heatmapDesc)
		.addToggle((t) =>
			t.setValue(cfg.heatmap ?? false).onChange((v) => {
				cfg.heatmap = v || undefined;
				ctx.opts.save();
				ctx.requestRender();
			}),
		);
	if (cfg.heatmap) {
		new Setting(containerEl)
			.setName(t().editors.calendar.heatmapCounts)
			.addDropdown((d) => {
				d.addOption("modified", t().editors.metricOptions.modified);
				d.addOption("created", t().editors.metricOptions.created);
				d.setValue(cfg.heatmapMetric ?? "modified").onChange((v) => {
					cfg.heatmapMetric = v as NonNullable<typeof cfg.heatmapMetric>;
					ctx.opts.save();
				});
			});
	}

	// The chips ride on agenda entries; the month grid draws dots instead.
	if (cfg.view === "agenda") calendarChipsEditor(ctx, containerEl, cfg);
	taskNotesSourceEditor(ctx, containerEl, cfg);
	calendarSourcesEditor(ctx, containerEl, cfg);
}







/** A mini month calendar with an optional agenda and external ICS calendars. */
export const calendarCard: CardDefinition<"calendar"> = {
	kind: "calendar",
	templates: [
		{ id: "calendar", defaultSize: "large", name: "Mini calendar", icon: "calendar-days", build: () => ({ kind: "calendar", title: "Calendar" }) },
	],
	render: (view, card, body, component) => renderCalendar(view, card, body, component),
	renderEditor: (container, ctx) => calendarEditor(ctx, container),
	cloneConfig: (source, copy) => {
		if (source.calendar)
			copy.calendar = {
				...source.calendar,
				sources: source.calendar.sources ? source.calendar.sources.map((s) => ({ ...s })) : undefined,
				taskNotes: source.calendar.taskNotes ? { ...source.calendar.taskNotes } : undefined,
				chips: source.calendar.chips ? { ...source.calendar.chips } : undefined,
				eventNote: source.calendar.eventNote
					? {
							...source.calendar.eventNote,
							fields: source.calendar.eventNote.fields
								? source.calendar.eventNote.fields.map((f) => ({ ...f }))
								: undefined,
						}
					: undefined,
			};
	},
	liveness: { mode: "vault" },
};
