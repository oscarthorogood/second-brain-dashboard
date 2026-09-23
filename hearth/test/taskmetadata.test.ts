import { describe, expect, it } from "vitest";
import { splitBlockId, withDoneDate, withEmojiDate } from "../src/tasklines";

/**
 * The metadata write paths edit a user's markdown in place, so what they must
 * never do is take anything that isn't theirs. A marker's value used to run to
 * the end of the line, so a tag or a `^block-id` after it went with it — and a
 * block id is what every `[[note#^id]]` link and embed resolves against.
 */

describe("splitBlockId", () => {
	it("splits off a trailing block id", () => {
		expect(splitBlockId("Pay rent ✅ 2024-01-15 ^rent")).toEqual({ body: "Pay rent ✅ 2024-01-15", blockId: "^rent" });
	});

	it("leaves text with no block id alone", () => {
		expect(splitBlockId("Pay rent #finance")).toEqual({ body: "Pay rent #finance", blockId: "" });
	});

	it("only takes one at the very end", () => {
		// A caret mid-line is not a block id; Obsidian only honours the last token.
		expect(splitBlockId("x^y and more").blockId).toBe("");
	});
});

describe("withDoneDate", () => {
	const line = "Pay rent 📅 2024-01-15 ✅ 2024-01-15 ^rent #finance";

	it("keeps the tag and the block id when unchecking", () => {
		// The reported corruption: this used to become "Pay rent 📅 2024-01-15".
		const out = withDoneDate(line, false, "2024-02-01");
		expect(out).toContain("#finance");
		expect(out).toContain("^rent");
		expect(out).not.toContain("✅");
	});

	it("keeps the block id as the last token when checking", () => {
		// Appending ✅ after "^rent" would silently detach the anchor.
		const out = withDoneDate("Pay rent ^rent", true, "2024-02-01");
		expect(out).toBe("Pay rent ✅ 2024-02-01 ^rent");
		expect(out.endsWith("^rent")).toBe(true);
	});

	it("replaces an existing done date rather than stacking a second", () => {
		expect(withDoneDate("Task ✅ 2024-01-01", true, "2024-02-01")).toBe("Task ✅ 2024-02-01");
	});
});

describe("withEmojiDate", () => {
	it("moves a due date without taking the tags after it", () => {
		const out = withEmojiDate("Standup 📅 2024-06-03 #work #daily", "📅", "2024-06-10");
		expect(out).toContain("#work");
		expect(out).toContain("#daily");
		expect(out).toContain("📅 2024-06-10");
		expect(out).not.toContain("2024-06-03");
	});

	it("removes a date without taking the block id", () => {
		const out = withEmojiDate("Standup 📅 2024-06-03 ^standup", "📅", null);
		expect(out).toBe("Standup ^standup");
	});
});
