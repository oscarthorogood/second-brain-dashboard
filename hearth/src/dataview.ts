import { App, Component } from "obsidian";

/** The community-plugin id Dataview registers itself under. */
export const DATAVIEW_PLUGIN_ID = "dataview";

/** The slice of Dataview's public API Second Brain Dashboard calls. Exposed by the plugin at
 * `app.plugins.plugins.dataview.api` once Dataview is enabled.
 *
 * Both methods render into `container` using Dataview's own renderers (tables,
 * lists, task lists, calendars) and attach a refreshable render-child to
 * `component`, so the result updates itself whenever Dataview's index changes —
 * as long as the component stays alive. Second Brain Dashboard passes the per-card component,
 * which lives until the card is next redrawn, so live updates come for free. */
interface DataviewApi {
	/** Run a Dataview Query Language block (TABLE / LIST / TASK / CALENDAR). */
	execute(source: string, container: HTMLElement, component: Component, filePath: string): Promise<void>;
	/** Run DataviewJS code (the `dv` API in scope). */
	executeJs(code: string, container: HTMLElement, component: Component, filePath: string): Promise<void>;
}

/** Reach Dataview's public API, or null when the plugin isn't installed, isn't
 * enabled, or is too old to expose the render methods Second Brain Dashboard uses. */
export function getDataviewApi(app: App): DataviewApi | null {
	const plugin = app.plugins.plugins[DATAVIEW_PLUGIN_ID] as
		| { api?: unknown }
		| undefined;
	const api = plugin?.api;
	if (
		api &&
		typeof (api as DataviewApi).execute === "function" &&
		typeof (api as DataviewApi).executeJs === "function"
	) {
		return api as DataviewApi;
	}
	return null;
}

/** Whether Dataview is enabled and its render API is reachable right now. */
/**
 * Whether Dataview itself allows JavaScript queries (its "Enable JavaScript
 * queries" setting).
 *
 * The API's `executeJs` does not check this — Dataview enforces it in its own
 * `dataviewjs` code-block processor, which a card calling the API bypasses. So
 * a DataviewJS card ran JavaScript for a user who had switched JS off, and —
 * because card config travels with a settings or layout import — a board file
 * someone else shared could carry a JS query that ran, with full Node access on
 * desktop, the moment the board drew. The card now asks here first.
 *
 * Read defensively: `settings` is Dataview's internal shape, and "can't tell"
 * is answered as off, which only ever costs a query that doesn't run.
 */
export function dataviewJsEnabled(app: App): boolean {
	try {
		const plugin = app.plugins.plugins[DATAVIEW_PLUGIN_ID] as
			| { settings?: { enableDataviewJs?: unknown } }
			| undefined;
		return plugin?.settings?.enableDataviewJs === true;
	} catch {
		return false;
	}
}

export function isDataviewAvailable(app: App): boolean {
	return getDataviewApi(app) !== null;
}
