/**
 * Reading the vault as coursework: what a course is, and what belongs to it.
 *
 * The vault joins a note to a course by a link, never by nesting (AGENTS.md
 * §3.1) — every folder is flat, and `Lectures/Business Economics L03 - Market
 * Structure.md` belongs to Business Economics only because its `course:` field
 * says so. So "everything for this course" is a metadata query across the seven
 * folders, not a directory listing, and that query is what this module is.
 *
 * Every read goes through Obsidian's already-loaded metadata cache — the same
 * index the file explorer and Bases views use — so a full pass over 429 notes
 * costs no file I/O. Nothing here opens a file.
 *
 * The selection and ordering rules are exported as pure functions over plain
 * objects, so the interesting behaviour (a course's lectures are its past ones,
 * newest first; its assignments are the ones still ahead) is unit-testable
 * without a vault.
 */
import { TFile, type App } from "obsidian";
import {
	courseFromLink,
	isIgnoredPath,
	noteTypeSpec,
	sequenceInTitle,
	topicFromTitle,
	type NoteType,
} from "./vaultfiling";

/** One note belonging to a course, flattened to what a card draws. */
export interface CourseworkItem {
	path: string;
	/** The note's own title (its basename). */
	title: string;
	/** The title with the course (and any `L03 - `) prefix removed. */
	topic: string;
	type: NoteType;
	/** `YYYY-MM-DD` from the type's date field (`date` for lectures, `due` for
	 * everything with a deadline), or "" when the note carries none. */
	when: string;
	/** `when` as epoch ms for sorting, or null. */
	whenMs: number | null;
	/** `L14` / `T02`, or "" for a type that isn't numbered. */
	code: string;
	/** The `Lecture No.` / `Tutorial No.` value, for continuing the sequence. */
	sequence: number | null;
	status: string;
}

/** A course, as its hub note declares it. */
export interface Course {
	name: string;
	path: string;
	/** `S1` / `S2`, from the hub note's `semester`. Empty when unset. */
	code: string;
	year: string;
	status: string;
	/** A stable colour for this course's dot, assigned by registry position. */
	color: string;
}

/**
 * The course dot colours, in registry order.
 *
 * Assigned by position rather than stored per course: the vault's Course
 * template has no colour field, and adding one would mean editing the template,
 * the `.base` and 14 notes (AGENTS.md §3.3) to decorate a widget. Position is
 * stable as long as the course list is, which it is — the registry is fixed.
 */
const COURSE_COLORS = [
	"#e8a94f",
	"#5b9bd1",
	"#b579d6",
	"#4caf6f",
	"#e07a5f",
	"#6c8ee3",
	"#d6a2c4",
	"#5bb9b0",
] as const;

/**
 * Read a frontmatter value as a trimmed string.
 *
 * Obsidian hands dates back as `Date`, numbers as numbers, and a missing key
 * as undefined. A value of any other shape — a list under `tags`, a nested map
 * someone hand-edited in — reads as empty rather than as "[object Object]":
 * none of the fields this module addresses are lists, so a structured value
 * there means the note isn't saying what we asked, and empty is the honest
 * answer.
 */
function str(value: unknown): string {
	if (value == null) return "";
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}

/** A `YYYY-MM-DD` prefix as epoch ms (local midnight), or null. */
export function dayMs(value: string): number | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
	if (!match) return null;
	const ms = new Date(+match[1], +match[2] - 1, +match[3]).getTime();
	return Number.isFinite(ms) ? ms : null;
}

/** Every course the vault declares, in name order. */
export function readCourses(app: App): Course[] {
	const spec = noteTypeSpec("course");
	const out: Course[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (isIgnoredPath(file.path) || file.parent?.path !== spec.folder) continue;
		const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const semester = str(fm.semester);
		out.push({
			name: file.basename,
			path: file.path,
			code: semester ? `S${semester.replace(/^S/i, "")}` : "",
			year: str(fm.year),
			status: str(fm.status),
			color: "",
		});
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	for (let i = 0; i < out.length; i++) out[i].color = COURSE_COLORS[i % COURSE_COLORS.length];
	return out;
}

/** Just the canonical course names, for the resolvers in `vaultfiling`. */
export function courseNames(app: App): string[] {
	return readCourses(app).map((c) => c.name);
}

/**
 * Every note linked to `course`, across the six non-course types.
 *
 * One pass over the markdown index, reading each note's own type from the
 * folder it sits in — which is also how the vault decides what a note is, so a
 * note can never be read as a type it isn't.
 */
export function readCourseItems(app: App, course: string): CourseworkItem[] {
	const byFolder = new Map<string, NoteType>();
	for (const spec of ["lecture", "reading", "tutorial", "essay", "project", "revision"] as const) {
		byFolder.set(noteTypeSpec(spec).folder, spec);
	}

	const items: CourseworkItem[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (isIgnoredPath(file.path)) continue;
		const type = byFolder.get(file.parent?.path ?? "");
		if (!type) continue;
		const spec = noteTypeSpec(type);
		const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const linked = courseFromLink(fm[spec.courseKey]);
		if (!linked || linked !== course) continue;

		const when = spec.dateKey ? str(fm[spec.dateKey]) : "";
		const marker = type === "lecture" ? "L" : type === "tutorial" ? "T" : null;
		const rawSequence = spec.sequenceKey ? str(fm[spec.sequenceKey]) : "";
		const parsed = rawSequence ? parseInt(rawSequence.replace(/^[LT]/i, ""), 10) : NaN;
		const sequence = Number.isFinite(parsed)
			? parsed
			: marker
				? sequenceInTitle(file.basename, marker)
				: null;

		items.push({
			path: file.path,
			title: file.basename,
			topic: topicFromTitle(file.basename, course),
			type,
			when,
			whenMs: dayMs(when),
			code: marker && sequence != null ? `${marker}${String(sequence).padStart(2, "0")}` : "",
			sequence,
			status: str(fm.status),
		});
	}
	return items;
}

// ---- Selection rules (pure) -----------------------------------------------

/** Items of the given types, newest first. Undated notes sort last: a lecture
 * with no `date` can't claim to be the most recent one. */
export function newestFirst(items: readonly CourseworkItem[], types: readonly NoteType[]): CourseworkItem[] {
	const wanted = new Set(types);
	return items
		.filter((i) => wanted.has(i.type))
		.sort((a, b) => (b.whenMs ?? -Infinity) - (a.whenMs ?? -Infinity));
}

/**
 * A course's lectures that have actually happened, newest first.
 *
 * "Recent" means delivered, so anything dated after today is excluded rather
 * than shown as recent — a timetable loaded a term ahead would otherwise make
 * next month's lecture the course's latest.
 */
export function recentLectures(
	items: readonly CourseworkItem[],
	now: number = Date.now(),
): CourseworkItem[] {
	const today = endOfDay(now);
	return newestFirst(items, ["lecture"]).filter((i) => i.whenMs == null || i.whenMs <= today);
}

/** Dated items of the given types still ahead, soonest first. */
export function upcoming(
	items: readonly CourseworkItem[],
	types: readonly NoteType[],
	now: number = Date.now(),
): CourseworkItem[] {
	const today = startOfDay(now);
	const wanted = new Set(types);
	return items
		.filter((i) => wanted.has(i.type) && i.whenMs != null && i.whenMs >= today)
		.sort((a, b) => (a.whenMs ?? 0) - (b.whenMs ?? 0));
}

/** The assignment types — everything with a deadline that isn't a lecture or a
 * reading. Assessments live in Revision, not Tutorials (`Claude/memory.md`). */
export const ASSIGNMENT_TYPES: readonly NoteType[] = ["tutorial", "essay", "project", "revision"];

/** The next `Lecture No.` / `Tutorial No.` for a course: max + 1 across the
 * whole course, since numbering runs continuously rather than per semester. */
export function nextNumberFor(items: readonly CourseworkItem[], type: NoteType): number {
	let max = 0;
	for (const item of items) {
		if (item.type !== type || item.sequence == null) continue;
		if (item.sequence > max) max = item.sequence;
	}
	return max + 1;
}

function startOfDay(ts: number): number {
	const d = new Date(ts);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function endOfDay(ts: number): number {
	return startOfDay(ts) + 86_399_999;
}

/** Whether a file is a note this plugin may read at all. */
export function isReadableNote(file: unknown): file is TFile {
	return file instanceof TFile && file.extension === "md" && !isIgnoredPath(file.path);
}
