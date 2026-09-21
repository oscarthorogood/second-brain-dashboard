import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eventWhenLabel, occurrenceKey } from "../src/cards/calsync";

// The suite runs under TZ=UTC (vitest.config.ts), where a UTC date and a local
// date are the same string and the bug this file guards is invisible. Node
// re-reads process.env.TZ, so these assertions run east of Greenwich.
beforeAll(() => {
	vi.stubEnv("TZ", "Asia/Tokyo");
});
afterAll(() => {
	vi.unstubAllEnvs();
});

describe("eventWhenLabel", () => {
	it("dates a timed event by the local day, not the UTC day", () => {
		// 08:30 in Tokyo on 16 Sep is still 23:30 on 15 Sep in UTC.
		const start = new Date("2026-09-15T23:30:00Z").getTime();
		expect(eventWhenLabel({ start })).toBe("2026-09-16 08:30");
	});

	it("dates an all-day event by the local day too", () => {
		const start = new Date(2026, 8, 16).getTime();
		expect(eventWhenLabel({ start, allDay: true })).toBe("2026-09-16");
	});

	it("keeps the date and the clock time on the same day", () => {
		const start = new Date("2026-09-15T20:30:00Z").getTime(); // 05:30 on the 16th
		expect(eventWhenLabel({ start })).toBe("2026-09-16 05:30");
	});
});

describe("occurrenceKey", () => {
	it("keys on uid and start, so a moved event is a new occurrence", () => {
		expect(occurrenceKey({ uid: "a", start: 1, summary: "x" })).not.toBe(
			occurrenceKey({ uid: "a", start: 2, summary: "x" }),
		);
	});

	it("falls back to the summary for a feed that omits uid", () => {
		expect(occurrenceKey({ uid: "", start: 1, summary: "Lecture 3" })).toBe("nouid:Lecture 3@1");
	});
});
