import { Menu, Setting, setIcon, TFile } from "obsidian";
import { emptyState } from "../cardbodies";
import {
	ASSIGNMENT_TYPES,
	DEADLINE_TYPES,
	readCourseItems,
	readCourses,
	recentLectures,
	upcoming,
	type Course,
	type CourseworkItem,
} from "../coursework";
import { formatRelativeDate } from "../dates";
import { t } from "../i18n";
import { openFile } from "../opener";
import { type DashboardCard } from "../types";
import { makeClickable } from "../ui";
import { type HomeView } from "../view";
import { bySize, type WidgetSize } from "../widgetsize";
import { type CardDefinition, type CardEditorContext } from "./definition";
import { openDetailModal } from "./detail";

/**
 * Course overview — one course's lectures and deadlines, with a switcher.
 *
 * The vault's seven folders are flat and a note joins a course by link
 * (AGENTS.md §3.1), so this card is the view that folder structure can't give:
 * everything for Business Economics, gathered from six folders at once and
 * split by what the user actually wants to know — what was just taught, and
 * what is due next.
 *
 * Reference (Widget Set v2 → COURSE): the four HIG sizes disclose
 * progressively — small is the latest lecture alone, medium adds the course
 * header, large splits into recent lectures over assignments-and-readings, and
 * extra large runs four columns (lectures, upcoming, assignments, readings).
 * Every size carries the course switcher, because the card is worth nothing if
 * it is showing the wrong course.
 */

/** How many rows each size can hold, per pane. Reference (Widget Set v2 →
 * COURSE): two rows in the large card's stacked panes, two per column at extra
 * large where four columns share the width. */
const ROWS = { large: 2, xlarge: 2 } as const;

/** What a pane does with the rows it can't fit: say how many it is holding
 * back. Two rows of "assignments & readings" can easily be two readings, and
 * an essay dropping off the bottom with nothing said is how the card starts
 * lying about what the course owes. */

/**
 * What the panes draw from, resolved once per render.
 *
 * Exported because this is the part with an invariant worth holding: the
 * extra large card spends two rows per column, so a column list that excludes
 * a type is a type that can go missing from the card entirely. `deadlines`
 * carries everything the course owes precisely so that no column is the only
 * home for anything.
 */
export function courseColumns(
	items: CourseworkItem[],
	now?: number,
): {
	lectures: CourseworkItem[];
	due: CourseworkItem[];
	deadlines: CourseworkItem[];
	readings: CourseworkItem[];
} {
	return {
		lectures: recentLectures(items, now),
		due: upcoming(items, ASSIGNMENT_TYPES, now),
		deadlines: upcoming(items, DEADLINE_TYPES, now),
		readings: upcoming(items, ["reading"], now),
	};
}

export function renderCourse(view: HomeView, card: DashboardCard, body: HTMLElement): void {
	// Switching course redraws this card in place rather than the whole board:
	// the same self-refresh every stateful card here uses (see the tasks card).
	const redraw = () => {
		body.empty();
		renderCourse(view, card, body);
	};
	const courses = readCourses(view.app);
	if (!courses.length) {
		emptyState(body, "graduation-cap", t().cards.empty.courseNoCourses);
		return;
	}

	const selected = courses.find((c) => c.name === card.course?.selected) ?? courses[0];
	const items = readCourseItems(view.app, selected.name);
	// Both deadline pane titles promise readings too ("Assignments & readings"
	// at large, "Upcoming" at extra large), so both are fed DEADLINE_TYPES;
	// `due` is the narrower assignments column at extra large.
	const { lectures, due, deadlines, readings } = courseColumns(items);

	switch (card.size) {
		case "small":
			renderSmall(view, card, body, courses, selected, lectures, due, redraw);
			break;
		case "medium":
			renderMedium(view, card, body, courses, selected, items, lectures, redraw);
			break;
		case "large":
			renderLarge(view, card, body, courses, selected, items, lectures, deadlines, redraw);
			break;
		case "xlarge":
			renderXLarge(view, card, body, courses, selected, items, lectures, deadlines, due, readings, redraw);
			break;
	}
}

// ---- Sizes ----------------------------------------------------------------

function renderSmall(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	courses: Course[],
	course: Course,
	lectures: CourseworkItem[],
	due: CourseworkItem[],
	redraw: () => void,
): void {
	const head = body.createDiv("sbd-course-head");
	dot(head, course);
	head.createDiv({ cls: "sbd-course-name", text: course.name });
	switcher(view, card, head, courses, course, "small", redraw);

	const latest = lectures[0];
	const foot = body.createDiv("sbd-course-latest");
	if (latest) {
		if (latest.code) foot.createDiv({ cls: "sbd-course-code", text: latest.code });
		foot.createDiv({ cls: "sbd-course-topic", text: latest.topic });
		openOnClick(view, foot, latest);
	} else {
		foot.createDiv({ cls: "sbd-course-topic", text: t().cards.course.noLectures });
	}
	foot.createDiv({ cls: "sbd-course-meta", text: shortMeta(lectures.length, due.length) });
}

function renderMedium(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	courses: Course[],
	course: Course,
	items: CourseworkItem[],
	lectures: CourseworkItem[],
	redraw: () => void,
): void {
	courseHeader(view, card, body, courses, course, items, "medium", redraw);

	const latest = lectures[0];
	const block = body.createDiv("sbd-course-latest is-wide");
	if (!latest) {
		block.createDiv({ cls: "sbd-course-topic", text: t().cards.course.noLectures });
		return;
	}
	block.createDiv({
		cls: "sbd-card-eyebrow",
		text: latest.code ? t().cards.course.recentWithCode(latest.code) : t().cards.course.recent,
	});
	block.createDiv({ cls: "sbd-course-topic", text: latest.topic });
	if (latest.when) block.createDiv({ cls: "sbd-course-when", text: formatRelativeDate(latest.when) });
	openOnClick(view, block, latest);
}

function renderLarge(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	courses: Course[],
	course: Course,
	items: CourseworkItem[],
	lectures: CourseworkItem[],
	deadlines: CourseworkItem[],
	redraw: () => void,
): void {
	courseHeader(view, card, body, courses, course, items, "large", redraw);
	const panes = body.createDiv("sbd-course-panes");
	pane(view, panes, t().cards.course.recentLectures, lectures, ROWS.large, "sheet");
	pane(view, panes, t().cards.course.assignmentsReadings, deadlines, ROWS.large, "glass");
}

function renderXLarge(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	courses: Course[],
	course: Course,
	items: CourseworkItem[],
	lectures: CourseworkItem[],
	deadlines: CourseworkItem[],
	due: CourseworkItem[],
	readings: CourseworkItem[],
	redraw: () => void,
): void {
	courseHeader(view, card, body, courses, course, items, "xlarge", redraw);
	const cols = body.createDiv("sbd-course-cols");
	// Reference (Widget Set v2 → COURSE XL): four columns alternating sheet and
	// glass, so neighbouring panes stay distinguishable at a glance.
	pane(view, cols, t().cards.course.recentLectures, lectures, ROWS.xlarge, "sheet");
	// "Upcoming" is every deadline the course has, soonest first — readings
	// included, which is also what keeps it from redrawing the assignments
	// column beside it. The assignments column is every assignment type,
	// revision among them: filtering revision out of it while "Upcoming" ran
	// two rows deep was enough to make an exam appear in neither.
	pane(view, cols, t().cards.course.upcoming, deadlines, ROWS.xlarge, "glass");
	pane(view, cols, t().cards.course.assignments, due, ROWS.xlarge, "sheet");
	pane(view, cols, t().cards.course.readings, readings, ROWS.xlarge, "glass");
}

// ---- Pieces ---------------------------------------------------------------

function dot(parent: HTMLElement, course: Course): void {
	const el = parent.createDiv("sbd-course-dot");
	el.style.setProperty("--course-color", course.color);
}

/** The header every size but small draws: semester code, course name, and the
 * live counts that say how much material the course has. */
function courseHeader(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	courses: Course[],
	course: Course,
	items: CourseworkItem[],
	size: WidgetSize,
	redraw: () => void,
): void {
	const head = body.createDiv("sbd-course-head is-stacked");
	const text = head.createDiv("sbd-course-headtext");
	if (course.code) text.createDiv({ cls: "sbd-card-eyebrow", text: course.code });
	text.createDiv({ cls: "sbd-course-name is-large", text: course.name });
	// `items` comes down from the caller rather than being re-read here: this
	// used to walk the whole vault a second time for a line of counts.
	if (size !== "medium") text.createDiv({ cls: "sbd-course-meta", text: fullMeta(items) });
	switcher(view, card, head, courses, course, size, redraw);
}

/**
 * The course switcher.
 *
 * An Obsidian `Menu` rather than the prototype's hand-drawn dropdown: it is
 * what every other picker in this plugin uses (see `showDayMenu`), it lands in
 * the right place on both desktop and mobile, and it dismisses on the same
 * gestures as the rest of the app. The pill that opens it is the reference's.
 */
function switcher(
	view: HomeView,
	card: DashboardCard,
	parent: HTMLElement,
	courses: Course[],
	course: Course,
	size: WidgetSize,
	redraw: () => void,
): void {
	if (card.course?.pinned) return;
	const pill = parent.createDiv("sbd-course-switch");
	pill.toggleClass("is-compact", size === "small" || size === "medium");
	dot(pill, course);
	// Reference (Widget Set v2 → COURSE): the pill is a bare chevron at small
	// and medium, gains "Switch" at large and the full "Switch course" at XL,
	// as the tile gets the width to carry it.
	const label = bySize(size, ["", "", t().cards.course.switchShort, t().cards.course.switchLong]);
	if (label) pill.createSpan({ cls: "sbd-course-switch-label", text: label });
	setIcon(pill.createDiv("sbd-course-switch-icon"), "chevron-down");

	const open = () => {
		const menu = new Menu();
		for (const option of courses) {
			menu.addItem((mi) =>
				mi
					.setTitle(option.code ? `${option.name}  ·  ${option.code}` : option.name)
					.setChecked(option.name === course.name)
					.onClick(() => {
						card.course = { ...card.course, selected: option.name };
						void view.plugin.saveData(view.plugin.settings);
						redraw();
					}),
			);
		}
		const rect = pill.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	};
	pill.addEventListener("click", (e) => {
		e.stopPropagation();
		open();
	});
	makeClickable(pill, open, t().cards.course.switchLong);
}

/** One titled pane of rows — on the white sheet or on the glass. */
function pane(
	view: HomeView,
	parent: HTMLElement,
	title: string,
	items: CourseworkItem[],
	rows: number,
	surface: "sheet" | "glass",
): void {
	const el = parent.createDiv("sbd-course-pane");
	el.toggleClass(surface === "sheet" ? "is-sheet" : "is-glass", true);
	const eyebrow = el.createDiv({ cls: "sbd-card-eyebrow", text: title });
	eyebrow.toggleClass("is-on-sheet", surface === "sheet");

	if (!items.length) {
		el.createDiv({ cls: "sbd-course-none", text: t().cards.course.nothingHere });
		return;
	}

	const list = el.createDiv("sbd-list");
	list.toggleClass(surface === "sheet" ? "is-sheet" : "is-bare", true);
	for (const entry of items.slice(0, rows)) {
		const row = list.createDiv("sbd-list-item");
		const main = row.createDiv("sbd-course-rowmain");
		main.createDiv({ cls: "sbd-list-label", text: entry.topic });
		if (entry.code) main.createDiv({ cls: "sbd-course-code", text: entry.code });
		if (entry.when) row.createDiv({ cls: "sbd-list-age", text: formatRelativeDate(entry.when) });
		openOnClick(view, row, entry);
	}
	const hidden = items.length - rows;
	if (hidden > 0) {
		const more = el.createDiv({ cls: "sbd-course-more", text: t().cards.course.moreCount(hidden) });
		more.toggleClass("is-on-sheet", surface === "sheet");
	}
}

/**
 * Wire a row to its note.
 *
 * Click opens the note, which is what every other card in Second Brain
 * Dashboard does with a row naming a file and what a reader expects from one.
 * The prototype opened its detail popup on click instead — it had no vault to
 * open into — so that capability moves to the context menu, where it can sit
 * beside "open" rather than replacing it.
 */
function openOnClick(view: HomeView, el: HTMLElement, entry: CourseworkItem): void {
	const file = view.app.vault.getAbstractFileByPath(entry.path);
	if (!(file instanceof TFile)) return;
	const open = () => void openFile(view, file, "card");
	el.addEventListener("click", open);
	el.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		e.stopPropagation();
		const menu = new Menu();
		menu.addItem((mi) => mi.setTitle(t().cards.course.openNote).setIcon("file-text").onClick(open));
		menu.addItem((mi) =>
			mi
				.setTitle(t().cards.detail.addDetail)
				.setIcon("paperclip")
				.onClick(() => openDetailModal(view, file)),
		);
		menu.showAtMouseEvent(e);
	});
	makeClickable(el, open, entry.title);
}

/** "18 lectures · 2 due" — the small tile's one line of context. */
function shortMeta(lectures: number, due: number): string {
	return `${t().cards.course.lectureCount(lectures)} · ${t().cards.course.dueCount(due)}`;
}

/** The header's live counts, computed from the course's real notes rather than
 * stored anywhere: "18 lectures · 2 upcoming · 2 assignments · 6 readings". */
function fullMeta(items: CourseworkItem[]): string {
	const strings = t().cards.course;
	const count = (type: string) => items.filter((i) => i.type === type).length;
	// DEADLINE_TYPES, matching the pane below it — counting assignments alone
	// while the pane listed readings too had the header contradict the card.
	const ahead = upcoming(items, DEADLINE_TYPES).length;
	return [
		strings.lectureCount(count("lecture")),
		strings.upcomingCount(ahead),
		strings.assignmentCount(count("tutorial") + count("essay") + count("project")),
		strings.readingCount(count("reading")),
	].join(" · ");
}

// ---- Editor ---------------------------------------------------------------

export function courseEditor(ctx: CardEditorContext, containerEl: HTMLElement): void {
	const strings = t().editors.course;
	const courses = readCourses(ctx.app);
	const cfg = (ctx.card.course ??= {});

	if (!courses.length) {
		new Setting(containerEl).setName(strings.heading).setDesc(strings.noCourses);
		return;
	}

	new Setting(containerEl)
		.setName(strings.course)
		.setDesc(strings.courseDesc)
		.addDropdown((d) => {
			for (const course of courses) d.addOption(course.name, course.name);
			d.setValue(cfg.selected && courses.some((c) => c.name === cfg.selected) ? cfg.selected : courses[0].name);
			d.onChange((v) => {
				cfg.selected = v;
				ctx.opts.save();
				ctx.opts.rerender();
			});
		});

	new Setting(containerEl)
		.setName(strings.pinned)
		.setDesc(strings.pinnedDesc)
		.addToggle((tg) =>
			tg.setValue(cfg.pinned === true).onChange((v) => {
				cfg.pinned = v || undefined;
				ctx.opts.save();
				ctx.opts.rerender();
			}),
		);
}

/** One course's lectures and deadlines, gathered from every folder. */
export const courseCard: CardDefinition<"course"> = {
	kind: "course",
	templates: [
		{
			id: "course",
			name: "Course overview",
			icon: "graduation-cap",
			defaultSize: "large",
			build: () => ({ kind: "course", title: "Course", course: {} }),
		},
	],
	render: (view, card, body) => renderCourse(view, card, body),
	renderEditor: (container, ctx) => courseEditor(ctx, container),
	cloneConfig: (source, copy) => {
		if (source.course) copy.course = { ...source.course };
	},
	cardClass: "is-course-card",
	// The card is a live read of the vault's own notes, so it must redraw when
	// one is added, retitled or re-dated — the same liveness the tasks, stats
	// and calendar cards use.
	liveness: { mode: "vault" },
};
