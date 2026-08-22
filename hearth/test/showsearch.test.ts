import { describe, expect, it } from "vitest";
import {
	DEFAULT_SETTINGS,
	effectiveShowSearch,
	type HomeSettings,
} from "../src/types";

/**
 * The search section is controlled by a single global toggle (Settings →
 * Appearance → Home). `effectiveShowSearch` used to also resolve a
 * per-dashboard override; that went with multi-page support, so it is now a
 * plain pass-through of the setting.
 */
function settings(): HomeSettings {
	return structuredClone(DEFAULT_SETTINGS);
}

describe("effectiveShowSearch", () => {
	it("shows the section by default", () => {
		expect(effectiveShowSearch(settings())).toBe(true);
	});

	it("follows the global toggle", () => {
		const s = settings();
		s.showSearch = false;
		expect(effectiveShowSearch(s)).toBe(false);
		s.showSearch = true;
		expect(effectiveShowSearch(s)).toBe(true);
	});
});
