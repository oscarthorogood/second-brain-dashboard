/**
 * The vault's own filing contract, as data.
 *
 * This vault (see `Claude/AGENTS.md` in the vault itself) is strict in a way a
 * general-purpose dashboard is not: seven flat note folders, a template per
 * type whose frontmatter fields must match *exactly* — same set, same order,
 * same capitalisation — a fixed course registry that notes join by link rather
 * than by nesting, and naming patterns with zero-padded sequence numbers.
 *
 * Two rules shape everything here:
 *
 * 1. **Nothing is hardcoded that the vault already states.** The course list is
 *    read from `Courses/`, and each type's frontmatter field order is read from
 *    its file in `Templates/`. AGENTS.md §3.3 says a new field means editing
 *    the template first — so reading the template at runtime is the only way
 *    this code can't drift from it. A TypeScript copy of those field lists
 *    would be a second source of truth that silently goes stale.
 *
 * 2. **This module never guesses.** It resolves what is resolvable by exact
 *    lookup (is this string one of the 14 canonical course names?) and returns
 *    null for everything else, so the caller routes the item to a human or to
 *    Claude rather than filing it somewhere plausible-looking. A wrong course
 *    link silently orphans a note (AGENTS.md §6), which is far worse than an
 *    item sitting visibly unfiled.
 *
 * Pure by design: no Obsidian imports, so every rule here is unit-testable
 * without a vault, and the card modules that use it stay out of the registry's
 * import cycle (see `cards/README.md`).
 */

/** The seven note types, one per flat folder. */
export type NoteType =
	| "course"
	| "lecture"
	| "reading"
	| "tutorial"
	| "essay"
	| "project"
	| "revision";

/** Where a note type lives and what it must carry. */
export interface NoteTypeSpec {
	type: NoteType;
	/** The flat, top-level folder. Notes never nest below it (AGENTS.md §3.1). */
	folder: string;
	/** The `base:` value every note of this type declares (AGENTS.md §3.2). */
	base: string;
	/** The file in `Templates/` that defines this type's frontmatter. */
	template: string;
	/**
	 * The frontmatter key holding the course wikilink.
	 *
	 * Revision uses a capital `Course` and every other type lowercase `course`.
	 * That inconsistency is deliberate in the vault, and AGENTS.md §4 calls it
	 * "the single thing agents get wrong most often" — so it is encoded here
	 * rather than left to a caller to remember.
	 */
	courseKey: "course" | "Course";
	/** The frontmatter key holding this type's sequence number, when it has one. */
	sequenceKey?: "Lecture No." | "Tutorial No.";
	/** The date field this type sorts by: lectures are delivered, everything
	 * else is due. Lectures have no `due` at all (see `Claude/memory.md`). */
	dateKey: "date" | "due" | null;
}

/**
 * Every note type, in the order `Claude/VAULT-INDEX.md` lists them.
 *
 * `Readings` and `Revision` are the two that break the pattern: spaced keys on
 * Readings (`item type`, `full citation`, `in text citation`), a capital
 * `Course` on Revision, and neither carries `sticker` or `resources`. Those
 * differences live in the templates, which is why nothing here restates the
 * field lists — only the handful of keys this code must address by name.
 */
export const NOTE_TYPE_SPECS: readonly NoteTypeSpec[] = [
	{ type: "course", folder: "Courses", base: "Courses.base", template: "Templates/Course.md", courseKey: "course", dateKey: null },
	{ type: "lecture", folder: "Lectures", base: "Lectures.base", template: "Templates/Lecture.md", courseKey: "course", sequenceKey: "Lecture No.", dateKey: "date" },
	{ type: "reading", folder: "Readings", base: "Readings.base", template: "Templates/Reading.md", courseKey: "course", dateKey: "date" },
	{ type: "tutorial", folder: "Tutorials", base: "Tutorials.base", template: "Templates/Tutorial.md", courseKey: "course", sequenceKey: "Tutorial No.", dateKey: "due" },
	{ type: "essay", folder: "Essays", base: "Essays.base", template: "Templates/Essay.md", courseKey: "course", dateKey: "due" },
	{ type: "project", folder: "Projects", base: "Projects.base", template: "Templates/Project.md", courseKey: "course", dateKey: "due" },
	{ type: "revision", folder: "Revision", base: "Revision.base", template: "Templates/Revision.md", courseKey: "Course", dateKey: "date" },
];

/** The spec for a type. */
export function noteTypeSpec(type: NoteType): NoteTypeSpec {
	// Total by construction: NOTE_TYPE_SPECS covers the whole NoteType union,
	// which the test in test/vaultfiling.test.ts pins.
	return NOTE_TYPE_SPECS.find((s) => s.type === type)!;
}

/** The type whose folder a vault path sits in, or null for anything outside
 * the seven (attachments, `Claude/`, the holding area, a backup directory). */
export function noteTypeForPath(path: string): NoteType | null {
	const folder = path.split("/")[0];
	return NOTE_TYPE_SPECS.find((s) => s.folder === folder)?.type ?? null;
}

/**
 * Top-level folders that must never be read (AGENTS.md §1).
 *
 * The Notion export and the three backup directories hold near-duplicates of
 * live notes — 4–5 false hits per real note, indistinguishable from the real
 * thing by content. Every scan in this plugin filters through here, so a
 * course's "recent lectures" can never be a backup copy of one.
 *
 * The rule is "any dot-prefixed top-level folder", which is exactly what the
 * ripgrep invocation in AGENTS.md §1 excludes — a negated glob on every
 * dot-directory, plus one for `Notion Import`. That covers the three backups
 * and every app folder in a single rule, and it means
 * this module never has to name a configuration directory — Obsidian's is
 * user-configurable, so hardcoding `.obsidian` would be wrong in any vault
 * that moved it.
 */
const IGNORED_FOLDERS = ["Notion Import"];

/** Whether a vault path is one this plugin must ignore entirely. */
export function isIgnoredPath(path: string): boolean {
	const top = path.split("/")[0];
	return top.startsWith(".") || IGNORED_FOLDERS.includes(top);
}

// ---- Templates as the schema ---------------------------------------------

/**
 * The frontmatter keys a template declares, in the order it declares them.
 *
 * Only top-level keys count: an indented line is a nested value or a list item,
 * not a field. Keys are taken verbatim — `Lecture No.` keeps its dot and space,
 * `item type` keeps its space, `Course` keeps its capital — because matching
 * the template exactly is the contract (AGENTS.md §3.3), and normalising here
 * would quietly break it.
 */
export function templateFieldOrder(raw: string): string[] {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw.replace(/^\uFEFF/u, ""));
	if (!match) return [];
	const keys: string[] = [];
	for (const line of match[1].split(/\r?\n/)) {
		if (!line.trim() || /^\s/.test(line) || line.trimStart().startsWith("#")) continue;
		const colon = line.indexOf(":");
		if (colon <= 0) continue;
		const key = line.slice(0, colon).trim();
		if (key && !keys.includes(key)) keys.push(key);
	}
	return keys;
}

/**
 * Lay values out in the template's field order: every template field present,
 * nothing extra, unknown values empty.
 *
 * "Same fields, same order, no additions" is the whole rule (AGENTS.md §3.3),
 * and it is verified at 0 deviations across 429 notes — so a note this plugin
 * writes has to hold that line too. Anything the caller passes that the
 * template doesn't declare is dropped rather than appended: needing a new field
 * means editing the template, then the `.base`, then backfilling.
 */
export function orderFrontmatter(
	values: Record<string, unknown>,
	order: readonly string[],
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of order) {
		const value = values[key];
		out[key] = value === undefined || value === null ? "" : value;
	}
	return out;
}

// ---- The course registry --------------------------------------------------

/**
 * Resolve a string to one of the vault's canonical course names.
 *
 * Exact match first, then a match ignoring case, punctuation and whitespace —
 * and nothing else. No prefix, substring or edit-distance matching, because
 * `Business Research Methods One` and `Business Research Methods 2` are two
 * different courses that are inconsistently formatted *on purpose* (AGENTS.md
 * §6), and any fuzzy scheme that "helpfully" collapses them silently files a
 * note against the wrong course.
 *
 * Returns null when there is no exact answer. The caller escalates instead of
 * guessing.
 */
export function canonicalCourse(raw: string, courses: readonly string[]): string | null {
	const value = raw.trim();
	if (!value) return null;
	const exact = courses.find((c) => c === value);
	if (exact) return exact;
	const normalized = normalizeCourse(value);
	const matches = courses.filter((c) => normalizeCourse(c) === normalized);
	return matches.length === 1 ? matches[0] : null;
}

function normalizeCourse(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * The canonical course named in a longer string — a calendar event summary
 * like "Business Economics L14 - Market Structure".
 *
 * The longest match wins. With `Business Research Methods One` and
 * `Business Research Methods 2` both in the registry, a shortest- or first-
 * match rule would be a coin flip between two real courses; longest-match is
 * unambiguous because neither canonical name contains the other.
 */
export function findCourseInText(text: string, courses: readonly string[]): string | null {
	const haystack = normalizeCourse(text);
	if (!haystack) return null;
	let best: string | null = null;
	for (const course of courses) {
		const needle = normalizeCourse(course);
		if (!needle || !haystack.includes(needle)) continue;
		if (!best || needle.length > normalizeCourse(best).length) best = course;
	}
	return best;
}

/** The wikilink a `course:` / `Course:` field holds. */
export function courseLink(course: string): string {
	return `[[${course}]]`;
}

/** The course name inside a wikilink value, with any alias or heading dropped.
 * Accepts the bare name too, since a field may hold either. */
export function courseFromLink(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const inner = /^\s*\[\[([^\]]+)\]\]\s*$/.exec(value)?.[1] ?? value;
	const name = inner.split("|")[0].split("#")[0].trim();
	return name || null;
}

// ---- Naming conventions (AGENTS.md §5) ------------------------------------

/** Zero-pad a lecture or tutorial number to two digits: `L03`, never `L3`. */
export function padSequence(n: number): string {
	return String(Math.max(0, Math.trunc(n))).padStart(2, "0");
}

/**
 * The next number in a course's sequence.
 *
 * Lectures are numbered chronologically across the whole course, not per
 * semester (`Claude/memory.md`), so this continues the single run rather than
 * restarting it — it is max + 1, not count + 1, which keeps the sequence
 * stable when an earlier note is deleted.
 */
export function nextSequence(existing: readonly number[]): number {
	let max = 0;
	for (const n of existing) if (Number.isFinite(n) && n > max) max = Math.trunc(n);
	return max + 1;
}

/** The sequence number in a title like `Business Economics L03 - Market
 * Structure`, or null when it carries none. */
export function sequenceInTitle(title: string, marker: "L" | "T"): number | null {
	const match = new RegExp(`\\b${marker}(\\d{1,3})\\b`).exec(title);
	return match ? parseInt(match[1], 10) : null;
}

/**
 * Strip characters that can't appear in a vault filename.
 *
 * `/ \ : * ? " < > |` break links and OneDrive sync (AGENTS.md §5); `#` and
 * `[ ]` break wikilinks. Whitespace collapses so a stripped character doesn't
 * leave a double space behind.
 */
export function sanitizeNoteTitle(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** The filename for a note of `type`, per the patterns in AGENTS.md §5. Returns
 * null when the type's pattern needs a part the caller didn't supply. */
export function noteTitleFor(
	type: NoteType,
	parts: { course?: string | null; sequence?: number | null; topic?: string | null },
): string | null {
	const course = parts.course?.trim();
	const topic = parts.topic?.trim();
	if (type === "course") return course ? sanitizeNoteTitle(course) : null;
	if (!course || !topic) return null;
	switch (type) {
		case "lecture":
		case "tutorial": {
			if (parts.sequence == null) return null;
			const marker = type === "lecture" ? "L" : "T";
			return sanitizeNoteTitle(`${course} ${marker}${padSequence(parts.sequence)} - ${topic}`);
		}
		case "essay":
			return sanitizeNoteTitle(`${course} - Essay - ${topic}`);
		case "project":
			return sanitizeNoteTitle(`${course} - Project - ${topic}`);
		case "revision":
			return sanitizeNoteTitle(`${course} - Revision - ${topic}`);
		// A reading is `{Author} ({Year}) - {Title}`, which no calendar event or
		// dropped file carries — naming one means reading the source's own title
		// page (open-items.md). Never synthesised here.
		case "reading":
			return null;
	}
}

/**
 * The topic half of a note title, with the part the card already shows removed.
 *
 * A course card is drawn under the course's own name, so repeating it on every
 * row ("Business Economics L14 - Market Structure", eleven times) spends the
 * widget's whole width saying what the header said. Stripping the known
 * `{Course} L{NN} - ` / `{Course} - Essay - ` prefix leaves the part that
 * differs between rows, which is the part worth reading.
 *
 * Anything that doesn't match a known pattern is returned untouched — a note
 * that breaks the convention still shows its real title rather than a guess at
 * which half of it matters.
 */
export function topicFromTitle(title: string, course: string): string {
	const trimmed = title.trim();
	if (!course) return trimmed;
	const normalizedCourse = normalizeCourse(course);
	if (!normalizedCourse || !normalizeCourse(trimmed).startsWith(normalizedCourse)) return trimmed;
	const rest = trimmed.slice(course.length).trim();
	// `L03 - Topic` / `T12 - Topic`, or `- Essay - Title` / `- Revision - Topic`.
	const sequenced = /^[LT]\d{1,3}\s*[-–—]\s*(.+)$/.exec(rest);
	if (sequenced) return sequenced[1].trim();
	const labelled = /^[-–—]\s*(?:Essay|Project|Revision|Reading Pack|Reading Notes)\s*[-–—]\s*(.+)$/i.exec(rest);
	if (labelled) return labelled[1].trim();
	const bare = /^[-–—]\s*(.+)$/.exec(rest);
	if (bare) return bare[1].trim();
	return trimmed;
}

// ---- Handing an item to Claude -------------------------------------------

/**
 * Claude's own folder: the instructions, and the two trays beside them.
 *
 * Everything unfiled now lands inside `Claude/` rather than in a top-level
 * holding folder. That is what makes the two trays legible to whoever drains
 * them: an agent given the vault as its working directory reads
 * `Claude/AGENTS.md` and finds the work sitting in the next folder along,
 * instead of an inbox in one place pointing at content in another. It also
 * keeps unfiled items out of the seven typed folders, so nothing half-filed
 * ever shows up in a `.base` view.
 */
export const CLAUDE_FOLDER = "Claude";

/**
 * The inbox tray's default location: every calendar event the sync card writes.
 *
 * One tray per source, not per stage. A calendar event arrives already
 * described — it has a time, a calendar and a summary — so it only ever needs
 * one note, and that note is the item *and* the request to file it.
 *
 * A default, not a constant the rest of the plugin reads: the two trays are a
 * vault-wide choice, so where they actually are lives in settings (see
 * `effectiveFilingFolders` in `types.ts`) and travels through this module as a
 * {@link FilingFolders}. This value is only what a vault that has never said
 * otherwise gets.
 */
export const INBOX_FOLDER = `${CLAUDE_FOLDER}/inbox`;

/**
 * The unsorted tray's default location: prose and attachments from the detail
 * card.
 *
 * Separate from the inbox because it is drained differently. An inbox item is
 * a decision about what a thing *is*; an unsorted item usually knows what it
 * is (it names a target note) and needs a decision about where inside that
 * note, or which course folder, it belongs.
 */
export const UNSORTED_FOLDER = `${CLAUDE_FOLDER}/unsorted`;

/** Which tray an item lands in. */
export type FilingDestination = "inbox" | "unsorted";

/**
 * Where the two trays are in this vault.
 *
 * Both cards and every write path take this rather than reading a module
 * constant, so a vault that keeps its trays somewhere other than `Claude/` —
 * a different agent folder, a plain `Inbox/` at the root — is configured in
 * one place instead of being a fork of this file.
 */
export interface FilingFolders {
	inbox: string;
	unsorted: string;
}

/** The trays a vault gets until it says otherwise. */
export const DEFAULT_FILING_FOLDERS: FilingFolders = {
	inbox: INBOX_FOLDER,
	unsorted: UNSORTED_FOLDER,
};

/**
 * A user-typed folder as a vault path, or the fallback when they typed nothing
 * usable.
 *
 * Leading and trailing slashes, doubled separators and stray whitespace all
 * come from typing a path by hand or pasting one, and each of them produces a
 * *different* string for the same folder — which would split a tray in two:
 * notes written to `Claude/inbox/` and a count read from `/Claude/inbox`. A
 * path that normalises to nothing falls back rather than writing to the vault
 * root, since an empty field is a cleared setting, not a request to scatter
 * filing notes across the vault.
 */
export function normalizeFilingFolder(raw: unknown, fallback: string): string {
	if (typeof raw !== "string") return fallback;
	const clean = raw
		.split("/")
		.map((part) => part.trim())
		.filter(Boolean)
		.join("/");
	return clean || fallback;
}

/** The folder a destination names, in the vault the folders describe. */
export function destinationFolder(
	destination: FilingDestination,
	folders: FilingFolders = DEFAULT_FILING_FOLDERS,
): string {
	return destination === "inbox" ? folders.inbox : folders.unsorted;
}

/**
 * Whether a vault path is inside `folder` (or is the folder itself).
 *
 * A folder boundary, not a bare prefix: `startsWith("Inbox")` also matches
 * `Inboxes/…` and `Inbox archive/…`, which is harmless while the tray is the
 * fixed `Claude/inbox` and wrong the moment a user names their own. The tray
 * cards redraw off this, so a sibling folder's edits were restarting their
 * debounce for nothing.
 */
export function pathInFolder(path: string, folder: string): boolean {
	return path === folder || path.startsWith(`${folder}/`);
}

/**
 * Whether a vault event touched a tray, on either side of a move.
 *
 * Both sides, because draining a tray *is* a move: whoever files an inbox note
 * renames it from `Claude/inbox/…` to `Lectures/…`, so the event's new path is
 * outside the tray and only its old path says the tray just got shallower.
 * Checking the new path alone left the card's "N waiting" stuck at its old
 * count after every filing.
 */
export function eventTouchesFolder(
	ev: { file: { path: string }; oldPath?: string },
	folder: string,
): boolean {
	return (
		pathInFolder(ev.file.path, folder) ||
		(ev.oldPath !== undefined && pathInFolder(ev.oldPath, folder))
	);
}

/** Where dropped files wait: a subfolder of the unsorted tray, so an
 * attachment never sits loose beside the notes that describe it. */
export function attachmentsFolder(folders: FilingFolders = DEFAULT_FILING_FOLDERS): string {
	return `${folders.unsorted}/attachments`;
}

/** Frontmatter flag marking a note as awaiting a filing decision. */
export const NEEDS_FILING_KEY = "needs-filing";

/** The vault's own instruction set, in the order an agent should read it.
 * Named in every request so whoever picks one up works from the vault's rules
 * rather than inventing a filing scheme. */
export const AGENT_DOCS = [
	"Claude/VAULT-INDEX.md",
	"Claude/AGENTS.md",
	"Claude/memory.md",
	"Claude/open-items.md",
] as const;

/** What kind of decision a request is asking for. */
export type FilingRequestKind = "calendar-event" | "attachment" | "note-detail";

/** One unfiled item, described for whoever files it. */
export interface FilingRequest {
	kind: FilingRequestKind;
	/** Where it came from: a calendar's display name, or a note path. */
	source: string;
	/** One line naming the item — an event summary, a filename. */
	summary: string;
	/** Which tray this note is written into. */
	destination: FilingDestination;
	/** An attachment already written beside this note, vault-relative. Only an
	 * attachment needs one: prose and events live in the note itself. */
	attachmentPath?: string;
	/** Everything known about the item, rendered as a detail list. Empty values
	 * are dropped rather than shown as blanks. */
	details?: Record<string, string | null | undefined>;
	/** The item itself — an event's description, the user's prose — written
	 * into the note's body so the tray holds the thing, not a pointer to it. */
	content?: string;
	/** The canonical course this looks like, when an exact registry lookup
	 * found one. A hint, never a decision. */
	courseHint?: string | null;
	/** The ICS UID, for a calendar event. */
	uid?: string;
}

/** An unfiled item rendered as a note: frontmatter for machines, body for
 * whoever reads it. */
export interface BuiltFilingNote {
	filename: string;
	frontmatter: Record<string, unknown>;
	body: string;
}

/** A stable, sortable, collision-free filename for an unfiled item. */
export function filingNoteFilename(req: FilingRequest, now: Date): string {
	const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
	return sanitizeNoteTitle(`${stamp} ${req.kind} ${req.summary}`).slice(0, 110) || stamp;
}

/**
 * Build the note that lands in a tray.
 *
 * One note, not two. It used to be a pair — the content in a holding folder,
 * a request pointing at it from the inbox — which meant a filing job could
 * half-exist: a request naming a note that never landed, or content nobody was
 * asked to file. Now the item and the ask are the same file, so a tray's depth
 * is exactly the number of things still to do, and filing one is moving one
 * note rather than reconciling two.
 *
 * The body is written for a reader, not a parser: what the item is, what it
 * says, the vault's rules, and the steps that finish the job — ending with
 * moving this note out of the tray, so an empty tray is the signal that
 * everything has been filed. The plugin never parses this back; its own state
 * lives in the sync index, which is why the prose can stay prose.
 */
export function buildFilingNote(
	req: FilingRequest,
	now: Date,
	folders: FilingFolders = DEFAULT_FILING_FOLDERS,
): BuiltFilingNote {
	const details: string[] = [];
	for (const [label, value] of Object.entries(req.details ?? {})) {
		if (value != null && String(value).trim()) details.push(`- **${label}:** ${String(value).trim()}`);
	}

	const reading = AGENT_DOCS.map((doc) => `\`${doc}\``).join(", ");
	const hint = req.courseHint
		? `\n\nThe course registry has an exact match for **${req.courseHint}** in this item's text. ` +
			`Confirm it before using it — it is a lookup, not a decision.`
		: "";
	const folder = destinationFolder(req.destination, folders);
	const content = (req.content ?? "").trim();
	const steps = KIND_STEPS[req.kind];

	const body = [
		`Unfiled ${KIND_NOUNS[req.kind]} from Second Brain Dashboard, sitting in \`${folder}\`. ` +
			`Decide where it belongs and file it.`,
		"",
		`Read first: ${reading}. Those four files are the rules; this note is only the item.${hint}`,
		"",
		"## The item",
		"",
		`- **Source:** ${req.source}`,
		...(req.attachmentPath ? [`- **File:** [[${req.attachmentPath}]]`] : []),
		...details,
		...(content ? ["", "## What it says", "", content] : []),
		"",
		"## To file it",
		"",
		...steps,
		`${steps.length + 1}. Move this note out of \`${folder}\` once it is filed — an empty tray means ` +
			`everything is done.`,
		"",
	].join("\n");

	return {
		filename: filingNoteFilename(req, now),
		frontmatter: {
			[NEEDS_FILING_KEY]: true,
			"sbd-request": req.kind,
			"sbd-source": req.source,
			"sbd-tray": req.destination,
			...(req.attachmentPath ? { "sbd-attachment": req.attachmentPath } : {}),
			...(req.uid ? { "sbd-uid": req.uid } : {}),
			created: now.toISOString(),
		},
		body,
	};
}

const KIND_NOUNS: Record<FilingRequestKind, string> = {
	"calendar-event": "calendar event",
	attachment: "attachment",
	"note-detail": "note detail",
};

/**
 * The steps per request kind.
 *
 * Every list ends at a note that satisfies §3.3 — right folder, right template
 * fields in template order, a `course:` that resolves — because a half-filed
 * note is worse than an unfiled one: it is in a `.base` view, claiming to be
 * something, with fields that don't match its template.
 */
const KIND_STEPS: Record<FilingRequestKind, string[]> = {
	"calendar-event": [
		"1. Decide the note type (Lecture, Tutorial, Essay, Project, Revision) and the course, per AGENTS.md §4–6. Assessments — MCQ tests, exams — are Revision, not Tutorials.",
		"2. Rename this note to the pattern for that type (§5), zero-padding any lecture or tutorial number, and continuing the course's existing sequence rather than restarting it.",
		"3. Move it into that type's flat folder — never nested under a course (§3.1).",
		"4. Replace its frontmatter with that type's template fields, in template order, and set `base:` to the matching `.base` (§3.2, §3.3). Drop the `needs-filing` and `sbd-*` keys, and this note's filing sections; they are not part of a lecture.",
	],
	attachment: [
		"1. Decide whether the file is finished reference material (`Resources/{Course}/{Type}/`, lowercase-hyphenated filename) or an active working file (`OneDrive/{Course}/{note type}/`, filename mirroring its note's title) — §9.",
		"2. Move the file there, creating the course folder if this is its first file (see open-items.md for the courses with no folder yet).",
		"3. Link it from the note that wanted it — notes link files, they never embed them. Add the link to that note's `resources` field if its template has one.",
	],
	"note-detail": [
		"1. Open the target note and read how it is already structured — match it rather than imposing a new shape.",
		"2. Fold the text below in under the right heading, creating one only if the note genuinely has nowhere for it.",
		"3. Leave the frontmatter alone unless a template field is genuinely empty and this text fills it (§3.3 — no new fields).",
	],
};
