import { afterEach, describe, expect, it, vi } from "vitest";

const requestUrl = vi.fn(() => Promise.reject(new Error("offline")));
vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	requestUrl,
}));

const { loadFeed } = await import("../src/rss");
const { loadWeather } = await import("../src/weather");
type WeatherRequest = import("../src/weather").WeatherRequest;

/**
 * A failed fetch leaves nothing fresh in the cache, so without a backoff the
 * next board redraw requested a dead or offline source all over again.
 */
describe("failed-fetch backoff", () => {
	afterEach(() => {
		requestUrl.mockClear();
		vi.useRealTimers();
	});

	it("holds an RSS feed off after a failure, until forced or the backoff ends", async () => {
		vi.useFakeTimers();
		const url = "https://example.com/feed.xml";
		await loadFeed(url, { ttlMs: 30 * 60_000 });
		await loadFeed(url, { ttlMs: 30 * 60_000 });
		expect(requestUrl).toHaveBeenCalledTimes(1);
		await loadFeed(url, { ttlMs: 30 * 60_000, force: true });
		expect(requestUrl).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(2 * 60_000 + 1);
		await loadFeed(url, { ttlMs: 30 * 60_000 });
		expect(requestUrl).toHaveBeenCalledTimes(3);
	});

	it("holds a forecast off after a failure", async () => {
		const req: WeatherRequest = {
			lat: 50.08,
			lon: 14.43,
			tempUnit: "c",
			windUnit: "kmh",
			precipUnit: "mm",
		};
		await loadWeather(req, { ttlMs: 30 * 60_000 });
		await loadWeather(req, { ttlMs: 30 * 60_000 });
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});
});
