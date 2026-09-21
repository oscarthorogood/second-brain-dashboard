import { describe, expect, it } from "vitest";
import {
	ASSIGNMENT_TYPES,
	DEADLINE_TYPES,
	dayMs,
	newestFirst,
	nextNumberFor,
	recentLectures,
	upcoming,
	type CourseworkItem,
} from "../src/coursework";
import { courseColumns } from "../src/cards/course";
import type { NoteType } from "../src/vaultfiling";

/** A course item, with only the fields a given assertion cares about set. */
function item(partial: Partial<CourseworkItem> & { type: NoteType; when?: string }): CourseworkItem {
	const when = partial.when ?? "";
	return {
		path: `${partial.type}/${partial.title ?? "note"}.md`,
		title: partial.title ?? "note",
		topic: partial.topic ?? partial.title ?? "note",
		type: partial.type,
		when,
		whenMs: dayMs(when),
		code: partial.code ?? "",
		sequence: partial.sequence ?? null,
		status: partial.status ?? "",
	};
}

// Fixed "now" so every assertion below reads against one calendar day.
const NOW = new Date(2026, 8, 15, 12, 0, 0).getTime(); // 15 Sep 2026, local noon

describe("dayMs", () => {
	it("reads a YYYY-MM-DD as local midnight", () => {
		expect(dayMs("2026-09-15")).toBe(new Date(2026, 8, 15).getTime());
	});

	it("reads the date half of a datetime", () => {
		expect(dayMs("2026-09-15T10:30:00")).toBe(new Date(2026, 8, 15).getTime());
	});

	it("returns null for anything else", () => {
		expect(dayMs("")).toBeNull();
		expect(dayMs("Monday")).toBeNull();
		expect(dayMs("15/09/2026")).toBeNull();
	});
});

describe("newestFirst", () => {
	it("orders by date, newest first, and keeps only the wanted types", () => {
		const items = [
			item({ type: "lecture", title: "L12", when: "2026-09-01" }),
			item({ type: "tutorial", title: "T02", when: "2026-09-20" }),
			item({ type: "lecture", title: "L14", when: "2026-09-14" }),
			item({ type: "lecture", title: "L13", when: "2026-09-08" }),
		];
		expect(newestFirst(items, ["lecture"]).map((i) => i.title)).toEqual(["L14", "L13", "L12"]);
	});

	it("sorts undated notes last", () => {
		const items = [
			item({ type: "lecture", title: "undated" }),
			item({ type: "lecture", title: "dated", when: "2026-01-01" }),
		];
		expect(newestFirst(items, ["lecture"]).map((i) => i.title)).toEqual(["dated", "undated"]);
	});
});

describe("recentLectures", () => {
	it("excludes lectures that have not happened yet", () => {
		// A timetable loaded a term ahead would otherwise report next month's
		// lecture as the course's most recent one.
		const items = [
			item({ type: "lecture", title: "future", when: "2026-10-20" }),
			item({ type: "lecture", title: "today", when: "2026-09-15" }),
			item({ type: "lecture", title: "past", when: "2026-09-01" }),
		];
		expect(recentLectures(items, NOW).map((i) => i.title)).toEqual(["today", "past"]);
	});

	it("keeps an undated lecture rather than dropping it", () => {
		const items = [item({ type: "lecture", title: "undated" })];
		expect(recentLectures(items, NOW).map((i) => i.title)).toEqual(["undated"]);
	});

	it("ignores everything that is not a lecture", () => {
		const items = [
			item({ type: "tutorial", title: "T01", when: "2026-09-01" }),
			item({ type: "reading", title: "R01", when: "2026-09-02" }),
		];
		expect(recentLectures(items, NOW)).toEqual([]);
	});
});

describe("upcoming", () => {
	it("returns dated items still ahead, soonest first", () => {
		const items = [
			item({ type: "essay", title: "essay", when: "2026-10-01" }),
			item({ type: "tutorial", title: "tutorial", when: "2026-09-18" }),
			item({ type: "project", title: "past", when: "2026-08-01" }),
		];
		expect(upcoming(items, ASSIGNMENT_TYPES, NOW).map((i) => i.title)).toEqual(["tutorial", "essay"]);
	});

	it("counts something due today as upcoming", () => {
		const items = [item({ type: "tutorial", title: "today", when: "2026-09-15" })];
		expect(upcoming(items, ASSIGNMENT_TYPES, NOW).map((i) => i.title)).toEqual(["today"]);
	});

	it("drops undated items — nothing can be upcoming without a date", () => {
		const items = [item({ type: "essay", title: "undated" })];
		expect(upcoming(items, ASSIGNMENT_TYPES, NOW)).toEqual([]);
	});

	it("treats assessments as assignments, since they live in Revision", () => {
		const items = [item({ type: "revision", title: "MCQ", when: "2026-09-30" })];
		expect(upcoming(items, ASSIGNMENT_TYPES, NOW).map((i) => i.title)).toEqual(["MCQ"]);
		expect(ASSIGNMENT_TYPES).toContain("revision");
	});
});

describe("DEADLINE_TYPES", () => {
	// The large course card draws one pane titled "Assignments & readings" and
	// fills it from a single `upcoming` call. It was called with
	// ASSIGNMENT_TYPES, which excludes readings by definition, so half of what
	// the title promised could never appear there.
	it("carries readings as well as the assignment types", () => {
		expect([...DEADLINE_TYPES].sort()).toEqual(
			[...ASSIGNMENT_TYPES, "reading" as const].sort(),
		);
	});

	it("interleaves readings with assignments by date rather than appending them", () => {
		const items = [
			item({ type: "essay", title: "essay", when: "2026-10-01" }),
			item({ type: "reading", title: "reading", when: "2026-09-18" }),
			item({ type: "tutorial", title: "tutorial", when: "2026-09-25" }),
		];
		expect(upcoming(items, DEADLINE_TYPES, NOW).map((i) => i.title)).toEqual([
			"reading",
			"tutorial",
			"essay",
		]);
	});
});

describe("the course card's columns", () => {
	// The extra large card's Upcoming column was drawn from
	// `[...revision, ...assignments]` — `upcoming`'s own result taken apart and
	// put back in type order — so an exam a month out pushed out an essay due
	// tomorrow. Sorting it by date alone fixed that and broke the other half:
	// the assignments column beside it filtered revision out, so with two rows
	// per column an exam could appear in none of the four.
	it("is already soonest-first, whatever the type", () => {
		const items = [
			item({ type: "revision", title: "exam", when: "2026-10-20" }),
			item({ type: "essay", title: "essay", when: "2026-09-16" }),
			item({ type: "tutorial", title: "tutorial", when: "2026-09-30" }),
		];
		expect(courseColumns(items, NOW).due.map((i) => i.title)).toEqual([
			"essay",
			"tutorial",
			"exam",
		]);
	});

	it("leaves nothing the course owes out of every column", () => {
		const items = [
			item({ type: "revision", title: "exam", when: "2026-10-20" }),
			item({ type: "essay", title: "essay", when: "2026-09-16" }),
			item({ type: "tutorial", title: "tutorial", when: "2026-09-30" }),
			item({ type: "reading", title: "reading", when: "2026-09-18" }),
			item({ type: "project", title: "project", when: "2026-11-01" }),
		];
		const { due, deadlines, readings } = courseColumns(items, NOW);
		const listed = new Set([...due, ...deadlines, ...readings].map((i) => i.title));
		for (const entry of upcoming(items, DEADLINE_TYPES, NOW)) {
			expect(listed).toContain(entry.title);
		}
	});

	it("does not draw Upcoming and Assignments as the same column", () => {
		// Two panes side by side showing the same rows is what feeding both of
		// them `due` produced whenever a course had no revision note.
		const items = [
			item({ type: "essay", title: "essay", when: "2026-09-16" }),
			item({ type: "reading", title: "reading", when: "2026-09-18" }),
		];
		const { due, deadlines } = courseColumns(items, NOW);
		expect(deadlines.map((i) => i.title)).toEqual(["essay", "reading"]);
		expect(due.map((i) => i.title)).toEqual(["essay"]);
	});

	it("keeps recent lectures out of the deadline columns", () => {
		const items = [item({ type: "lecture", title: "lecture", when: "2026-09-10" })];
		const { lectures, deadlines } = courseColumns(items, NOW);
		expect(lectures.map((i) => i.title)).toEqual(["lecture"]);
		expect(deadlines).toEqual([]);
	});
});

describe("nextNumberFor", () => {
	it("continues the course's run from its highest number", () => {
		const items = [
			item({ type: "lecture", sequence: 12 }),
			item({ type: "lecture", sequence: 14 }),
			item({ type: "lecture", sequence: 13 }),
		];
		expect(nextNumberFor(items, "lecture")).toBe(15);
	});

	it("numbers each type independently", () => {
		const items = [item({ type: "lecture", sequence: 14 }), item({ type: "tutorial", sequence: 2 })];
		expect(nextNumberFor(items, "tutorial")).toBe(3);
	});

	it("starts at 1 for a course with nothing numbered yet", () => {
		expect(nextNumberFor([], "lecture")).toBe(1);
		expect(nextNumberFor([item({ type: "lecture" })], "lecture")).toBe(1);
	});
});
