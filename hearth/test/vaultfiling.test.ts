import { describe, expect, it } from "vitest";
import {
	AGENT_DOCS,
	buildFilingNote,
	canonicalCourse,
	courseFromLink,
	courseLink,
	attachmentsFolder,
	eventTouchesFolder,
	pathInFolder,
	destinationFolder,
	findCourseInText,
	isIgnoredPath,
	nextSequence,
	NOTE_TYPE_SPECS,
	noteTitleFor,
	noteTypeForPath,
	noteTypeSpec,
	orderFrontmatter,
	padSequence,
	filingNoteFilename,
	INBOX_FOLDER,
	normalizeFilingFolder,
	NEEDS_FILING_KEY,
	UNSORTED_FOLDER,
	sanitizeNoteTitle,
	sequenceInTitle,
	templateFieldOrder,
	topicFromTitle,
	type NoteType,
} from "../src/vaultfiling";

/** The 14 canonical names, as `Claude/AGENTS.md` §6 spells them. The two
 * Business Research Methods entries are inconsistently formatted on purpose. */
const COURSES = [
	"Accountancy 1A",
	"Business Economics",
	"Business Research Methods 2",
	"Business Research Methods One",
	"Digital Skills",
	"Economic Applications",
	"Economic Principles",
	"Fundamentals of Programming",
	"Global Business",
	"Global Challenges",
	"Globalisation and Trade",
	"Innovation and Enterprise",
	"Planning for a Startup",
	"The Business of Edinburgh",
];

describe("note type specs", () => {
	it("covers every type, each in its own flat folder with a matching base", () => {
		const types: NoteType[] = ["course", "lecture", "reading", "tutorial", "essay", "project", "revision"];
		expect(NOTE_TYPE_SPECS.map((s) => s.type)).toEqual(types);
		for (const spec of NOTE_TYPE_SPECS) {
			expect(spec.base).toBe(`${spec.folder}.base`);
			expect(spec.folder).not.toContain("/");
		}
	});

	it("keeps Revision's capital Course key and lowercase everywhere else", () => {
		expect(noteTypeSpec("revision").courseKey).toBe("Course");
		for (const spec of NOTE_TYPE_SPECS) {
			if (spec.type !== "revision") expect(spec.courseKey).toBe("course");
		}
	});

	it("sorts lectures by delivery date and assignments by due date", () => {
		// memory.md: lectures have a delivery date, not a deadline — `due` does
		// not exist on them.
		expect(noteTypeSpec("lecture").dateKey).toBe("date");
		expect(noteTypeSpec("tutorial").dateKey).toBe("due");
		expect(noteTypeSpec("essay").dateKey).toBe("due");
		expect(noteTypeSpec("project").dateKey).toBe("due");
	});

	it("maps a path to the type whose folder holds it", () => {
		expect(noteTypeForPath("Lectures/Business Economics L03 - Market Structure.md")).toBe("lecture");
		expect(noteTypeForPath("Revision/Business Economics - Revision - Topic.md")).toBe("revision");
		expect(noteTypeForPath("Resources/Business Economics/Slides/deck.pdf")).toBeNull();
		expect(noteTypeForPath("Unsorted/something.md")).toBeNull();
	});
});

describe("ignored paths", () => {
	it("excludes the backup directories and the Notion export", () => {
		expect(isIgnoredPath("Notion Import/Lectures/whatever.md")).toBe(true);
		expect(isIgnoredPath(".audit-backup-20260819/Lectures/x.md")).toBe(true);
		expect(isIgnoredPath(".notion-import-backup-20260819/x.md")).toBe(true);
		expect(isIgnoredPath(".template-migration-backup-20260819-143257/x.md")).toBe(true);
		expect(isIgnoredPath(".smart-env/x.json")).toBe(true);
	});

	it("keeps real notes", () => {
		expect(isIgnoredPath("Lectures/Business Economics L03 - Market Structure.md")).toBe(false);
		expect(isIgnoredPath("Claude/AGENTS.md")).toBe(false);
	});
});

describe("templateFieldOrder", () => {
	it("reads keys verbatim, in template order", () => {
		const lecture = [
			"---",
			"tags: ",
			'base: "[[Lectures.base]]"',
			"course: ",
			"Lecture No.: ",
			"status: ",
			"date: ",
			"resources: ",
			"readings: ",
			"related: ",
			"summary: ",
			"sticker: ",
			"---",
			"",
			"# Body",
		].join("\n");
		expect(templateFieldOrder(lecture)).toEqual([
			"tags",
			"base",
			"course",
			"Lecture No.",
			"status",
			"date",
			"resources",
			"readings",
			"related",
			"summary",
			"sticker",
		]);
	});

	it("keeps the spaced keys Readings uses and Revision's capital", () => {
		const reading = "---\ntags: \ncourse: \nitem type: \nfull citation: \nin text citation: \n---\n";
		expect(templateFieldOrder(reading)).toContain("item type");
		expect(templateFieldOrder(reading)).toContain("in text citation");
		expect(templateFieldOrder("---\nCourse: \ndate: \n---\n")).toEqual(["Course", "date"]);
	});

	it("ignores nested values and list items", () => {
		const raw = "---\ntags:\n  - lecture\n  - term1\nstatus: \n---\n";
		expect(templateFieldOrder(raw)).toEqual(["tags", "status"]);
	});

	it("returns nothing for a template with no frontmatter", () => {
		expect(templateFieldOrder("# Just a heading\n")).toEqual([]);
	});
});

describe("orderFrontmatter", () => {
	const order = ["tags", "base", "course", "Lecture No.", "status", "date"];

	it("emits every template field, in order, empty when unknown", () => {
		const out = orderFrontmatter({ course: "[[Business Economics]]", date: "2026-09-15" }, order);
		expect(Object.keys(out)).toEqual(order);
		expect(out.course).toBe("[[Business Economics]]");
		expect(out.tags).toBe("");
	});

	it("drops anything the template does not declare", () => {
		// AGENTS.md §3.3: same fields, no additions. An extra key would be a
		// deviation in a vault verified at zero of them.
		const out = orderFrontmatter({ status: "Done", "sbd-uid": "abc-123", due: "2026-01-01" }, order);
		expect(Object.keys(out)).toEqual(order);
		expect(out).not.toHaveProperty("sbd-uid");
		expect(out).not.toHaveProperty("due");
	});
});

describe("canonicalCourse", () => {
	it("matches exactly", () => {
		expect(canonicalCourse("Business Economics", COURSES)).toBe("Business Economics");
	});

	it("matches through case, punctuation and spacing", () => {
		expect(canonicalCourse("business economics", COURSES)).toBe("Business Economics");
		expect(canonicalCourse("Globalisation & Trade", COURSES)).toBeNull();
		expect(canonicalCourse("  Fundamentals of Programming  ", COURSES)).toBe("Fundamentals of Programming");
	});

	it("refuses to collapse the two Business Research Methods courses", () => {
		// They are two different courses, inconsistently formatted on purpose
		// (AGENTS.md §6). A partial match here would silently orphan notes.
		expect(canonicalCourse("Business Research Methods", COURSES)).toBeNull();
		expect(canonicalCourse("Business Research Methods One", COURSES)).toBe("Business Research Methods One");
		expect(canonicalCourse("Business Research Methods 2", COURSES)).toBe("Business Research Methods 2");
	});

	it("returns null rather than guessing", () => {
		expect(canonicalCourse("Econ", COURSES)).toBeNull();
		expect(canonicalCourse("", COURSES)).toBeNull();
		expect(canonicalCourse("Inovation and Enterprise", COURSES)).toBeNull();
	});
});

describe("findCourseInText", () => {
	it("finds the course named in an event summary", () => {
		expect(findCourseInText("Business Economics L14 - Market Structure", COURSES)).toBe("Business Economics");
		expect(findCourseInText("Lecture: Fundamentals of Programming (Appleton Tower)", COURSES)).toBe(
			"Fundamentals of Programming",
		);
	});

	it("prefers the longest match so the two BRM courses stay distinct", () => {
		expect(findCourseInText("Business Research Methods One T03", COURSES)).toBe("Business Research Methods One");
		expect(findCourseInText("Business Research Methods 2 T03", COURSES)).toBe("Business Research Methods 2");
	});

	it("returns null when no canonical name appears", () => {
		expect(findCourseInText("Dentist, 3pm", COURSES)).toBeNull();
	});
});

describe("course links", () => {
	it("round-trips a name through a wikilink", () => {
		expect(courseLink("Business Economics")).toBe("[[Business Economics]]");
		expect(courseFromLink("[[Business Economics]]")).toBe("Business Economics");
	});

	it("reads a bare name, an alias and a heading", () => {
		expect(courseFromLink("Business Economics")).toBe("Business Economics");
		expect(courseFromLink("[[Business Economics|BE]]")).toBe("Business Economics");
		expect(courseFromLink("[[Business Economics#Week 3]]")).toBe("Business Economics");
		expect(courseFromLink(undefined)).toBeNull();
	});
});

describe("naming conventions", () => {
	it("zero-pads to two digits", () => {
		expect(padSequence(3)).toBe("03");
		expect(padSequence(14)).toBe("14");
		expect(padSequence(103)).toBe("103");
	});

	it("continues a course's run from its highest number, not its count", () => {
		expect(nextSequence([1, 2, 3])).toBe(4);
		// L02 deleted: the next lecture is still L04, so numbers stay stable.
		expect(nextSequence([1, 3])).toBe(4);
		expect(nextSequence([])).toBe(1);
	});

	it("reads a sequence number back out of a title", () => {
		expect(sequenceInTitle("Business Economics L03 - Market Structure", "L")).toBe(3);
		expect(sequenceInTitle("Business Economics T12 - Problem Set", "T")).toBe(12);
		expect(sequenceInTitle("Business Economics - Essay - Market Failure", "L")).toBeNull();
	});

	it("strips characters that break links and OneDrive sync", () => {
		expect(sanitizeNoteTitle("Supply / Demand: an intro?")).toBe("Supply Demand an intro");
		expect(sanitizeNoteTitle("Tag [[link]] #hash")).toBe("Tag link hash");
	});

	it("builds each type's title pattern", () => {
		expect(noteTitleFor("lecture", { course: "Business Economics", sequence: 3, topic: "Market Structure" })).toBe(
			"Business Economics L03 - Market Structure",
		);
		expect(noteTitleFor("tutorial", { course: "Business Economics", sequence: 2, topic: "Cost Curves" })).toBe(
			"Business Economics T02 - Cost Curves",
		);
		expect(noteTitleFor("essay", { course: "Global Business", topic: "Market Entry" })).toBe(
			"Global Business - Essay - Market Entry",
		);
		expect(noteTitleFor("revision", { course: "Business Economics", topic: "Market Structure" })).toBe(
			"Business Economics - Revision - Market Structure",
		);
		expect(noteTitleFor("course", { course: "Business Economics" })).toBe("Business Economics");
	});

	it("refuses to name a note it lacks the parts for", () => {
		expect(noteTitleFor("lecture", { course: "Business Economics", topic: "No number" })).toBeNull();
		expect(noteTitleFor("essay", { course: null, topic: "Orphan" })).toBeNull();
		// A reading is `{Author} ({Year}) - {Title}`, which has to come off the
		// source's own title page — never synthesised (open-items.md).
		expect(noteTitleFor("reading", { course: "Business Economics", topic: "Something" })).toBeNull();
	});
});

describe("topicFromTitle", () => {
	it("drops the course and number the card already shows", () => {
		expect(topicFromTitle("Business Economics L14 - Market Structure", "Business Economics")).toBe(
			"Market Structure",
		);
		expect(topicFromTitle("Business Economics T02 - Cost Curves", "Business Economics")).toBe("Cost Curves");
	});

	it("drops the type label from the labelled patterns", () => {
		expect(topicFromTitle("Global Business - Essay - Market Entry", "Global Business")).toBe("Market Entry");
		expect(topicFromTitle("Business Economics - Revision - Market Structure", "Business Economics")).toBe(
			"Market Structure",
		);
	});

	it("leaves a title that breaks the convention alone", () => {
		// open-items.md lists five readings whose titles can't be reconstructed;
		// showing the real title beats guessing which half matters.
		const odd = "A Crisis Needs a Firewall not a Ringfence";
		expect(topicFromTitle(odd, "Business Economics")).toBe(odd);
		expect(topicFromTitle("Cabral (2017) - Introduction to Industrial Organization", "Business Economics")).toBe(
			"Cabral (2017) - Introduction to Industrial Organization",
		);
	});

	it("returns the title unchanged without a course", () => {
		expect(topicFromTitle("Some Note", "")).toBe("Some Note");
	});
});

describe("trays", () => {
	it("puts both trays inside Claude's own folder, beside the rules", () => {
		expect(destinationFolder("inbox")).toBe("Claude/inbox");
		expect(destinationFolder("unsorted")).toBe("Claude/unsorted");
		// Nothing unfiled sits in a typed folder, where it would claim to be a
		// lecture (or an essay) before anyone has decided it is one.
		expect(noteTypeForPath(`${INBOX_FOLDER}/x.md`)).toBeNull();
		expect(noteTypeForPath(`${UNSORTED_FOLDER}/x.md`)).toBeNull();
	});

	it("files into the trays a vault names for itself", () => {
		const folders = { inbox: "Agent/in", unsorted: "Agent/loose" };
		expect(destinationFolder("inbox", folders)).toBe("Agent/in");
		expect(destinationFolder("unsorted", folders)).toBe("Agent/loose");
		// Attachments always sit under the unsorted tray, wherever it is, so a
		// dropped file is never loose beside the notes describing it.
		expect(attachmentsFolder(folders)).toBe("Agent/loose/attachments");
		expect(attachmentsFolder()).toBe(`${UNSORTED_FOLDER}/attachments`);
	});
});

describe("normalizeFilingFolder", () => {
	it("spells one folder one way, however it was typed", () => {
		// Each of these is the same folder; keeping them distinct would write
		// notes to one string and count them at another.
		for (const typed of ["Claude/inbox", "/Claude/inbox", "Claude/inbox/", "Claude//inbox", " Claude / inbox "]) {
			expect(normalizeFilingFolder(typed, UNSORTED_FOLDER)).toBe("Claude/inbox");
		}
	});

	it("falls back rather than scattering filing notes across the vault root", () => {
		// A cleared field is a cleared setting, not "write to the vault root".
		expect(normalizeFilingFolder("", INBOX_FOLDER)).toBe(INBOX_FOLDER);
		expect(normalizeFilingFolder("   ", INBOX_FOLDER)).toBe(INBOX_FOLDER);
		expect(normalizeFilingFolder("///", INBOX_FOLDER)).toBe(INBOX_FOLDER);
		// A hand-edited or half-synced data.json can hold anything at all.
		expect(normalizeFilingFolder(undefined, INBOX_FOLDER)).toBe(INBOX_FOLDER);
		expect(normalizeFilingFolder(7, INBOX_FOLDER)).toBe(INBOX_FOLDER);
	});
});

describe("filing notes", () => {
	const now = new Date("2026-09-15T14:05:09Z");

	it("names a note so it sorts by time and survives as a filename", () => {
		const name = filingNoteFilename(
			{ kind: "calendar-event", destination: "inbox", source: "Classes", summary: "Econ: L14 / Market?" },
			now,
		);
		expect(name.startsWith("2026-09-15-14-05-09")).toBe(true);
		expect(name).not.toMatch(/[\\/:*?"<>|#^[\]]/);
	});

	it("carries the item itself, and points the reader at the vault's own rules", () => {
		const note = buildFilingNote(
			{
				kind: "calendar-event",
				destination: "inbox",
				source: "Classes",
				summary: "Business Economics L14 - Market Structure",
				courseHint: "Business Economics",
				uid: "evt-1",
				content: "Monopoly and monopsony. Read Cabral ch. 4 first.",
				details: { When: "2026-09-15 10:00", Location: "Appleton Tower", Empty: "" },
			},
			now,
		);
		for (const doc of AGENT_DOCS) expect(note.body).toContain(doc);
		// The note *is* the event: its description is in the body, not behind a
		// link to a second note in a second folder.
		expect(note.body).toContain("Monopoly and monopsony");
		expect(note.body).toContain(INBOX_FOLDER);
		expect(note.body).toContain("Business Economics");
		expect(note.body).toContain("Appleton Tower");
		// Blank details would render as an empty bullet.
		expect(note.body).not.toContain("**Empty:**");
		expect(note.frontmatter["sbd-uid"]).toBe("evt-1");
		expect(note.frontmatter["sbd-request"]).toBe("calendar-event");
		expect(note.frontmatter["sbd-tray"]).toBe("inbox");
		expect(note.frontmatter[NEEDS_FILING_KEY]).toBe(true);
	});

	it("names the unsorted tray, and links an attachment written beside it", () => {
		const note = buildFilingNote(
			{
				kind: "attachment",
				destination: "unsorted",
				source: "Lectures/Business Economics L03 - Market Structure.md",
				summary: "slides.pdf",
				attachmentPath: "Claude/unsorted/attachments/slides.pdf",
			},
			now,
		);
		expect(note.body).toContain(UNSORTED_FOLDER);
		expect(note.body).not.toContain(INBOX_FOLDER);
		expect(note.body).toContain("[[Claude/unsorted/attachments/slides.pdf]]");
		expect(note.frontmatter["sbd-attachment"]).toBe("Claude/unsorted/attachments/slides.pdf");
	});

	it("tells the reader which tray this vault actually uses", () => {
		// The body is the instruction sheet for whoever drains the tray, so it has
		// to name the folder the note was written to — not the default one.
		const note = buildFilingNote(
			{ kind: "note-detail", destination: "unsorted", source: "s", summary: "x" },
			now,
			{ inbox: "Agent/in", unsorted: "Agent/loose" },
		);
		expect(note.body).toContain("Agent/loose");
		expect(note.body).not.toContain(UNSORTED_FOLDER);
	});

	it("ends every kind with a step that empties the tray", () => {
		for (const kind of ["calendar-event", "attachment", "note-detail"] as const) {
			const note = buildFilingNote(
				{ kind, destination: "unsorted", source: "s", summary: "x" },
				now,
			);
			expect(note.body).toContain("Move this note out of");
		}
	});

	it("omits the course hint when no exact match was found", () => {
		const note = buildFilingNote(
			{ kind: "calendar-event", destination: "inbox", source: "Classes", summary: "Dentist" },
			now,
		);
		expect(note.body).not.toContain("exact match");
	});

	it("leaves out the content section when there is nothing to say", () => {
		const note = buildFilingNote(
			{ kind: "calendar-event", destination: "inbox", source: "Classes", summary: "Dentist", content: "  " },
			now,
		);
		expect(note.body).not.toContain("## What it says");
	});
});


describe("pathInFolder", () => {
	it("matches the folder and anything under it", () => {
		expect(pathInFolder("Claude/inbox", "Claude/inbox")).toBe(true);
		expect(pathInFolder("Claude/inbox/a.md", "Claude/inbox")).toBe(true);
		expect(pathInFolder("Claude/inbox/deep/b.md", "Claude/inbox")).toBe(true);
	});

	it("respects the folder boundary rather than a bare prefix", () => {
		// The case a user-chosen tray exposes: "Inbox" must not claim its siblings.
		expect(pathInFolder("Inboxes/a.md", "Inbox")).toBe(false);
		expect(pathInFolder("Inbox archive/a.md", "Inbox")).toBe(false);
		expect(pathInFolder("Inbox/a.md", "Inbox")).toBe(true);
	});
});

describe("eventTouchesFolder", () => {
	const tray = "Claude/inbox";

	it("sees a note arriving in the tray", () => {
		expect(eventTouchesFolder({ file: { path: "Claude/inbox/x.md" } }, tray)).toBe(true);
	});

	it("sees a note being filed out of the tray", () => {
		// Draining the tray is a move whose new path is elsewhere: only the old
		// path says the tray just got shallower. Missing this left the count stale.
		const filed = { file: { path: "Lectures/x.md" }, oldPath: "Claude/inbox/x.md" };
		expect(eventTouchesFolder(filed, tray)).toBe(true);
	});

	it("ignores events elsewhere in the vault", () => {
		expect(eventTouchesFolder({ file: { path: "Lectures/x.md" } }, tray)).toBe(false);
		const moved = { file: { path: "Lectures/y.md" }, oldPath: "Essays/y.md" };
		expect(eventTouchesFolder(moved, tray)).toBe(false);
	});
});
