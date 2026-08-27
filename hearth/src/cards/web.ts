import { Component, setIcon, Setting } from "obsidian";
import { emptyState } from "../cardbodies";
import { addResetButton } from "../editors";
import { t } from "../i18n";
import { type DashboardCard } from "../types";
import { type CardDefinition, type CardEditorContext } from "./definition";


// ---- Web / iframe embed -------------------------------------------------

export function renderWeb(card: DashboardCard, body: HTMLElement, component: Component): void {
	const url = card.url?.trim();
	if (!url) {
		emptyState(body, "globe", t().cards.empty.webNoUrl);
		return;
	}
	// Only allow http(s) URLs into the iframe.
	if (!/^https?:\/\//i.test(url)) {
		emptyState(body, "globe", "URL must start with http:// or https://");
		return;
	}

	body.addClass("sbd-web-body");

	// Widget Set → WEB puts the address above the page on a chip, the way a
	// browser chrome does — without it the card is an unlabelled rectangle of
	// someone else's site. Text only: it is a label, not a field.
	const bar = body.createDiv("sbd-web-bar");
	const chip = bar.createDiv("sbd-web-url");
	setIcon(chip.createDiv("sbd-web-url-icon"), "lock");
	chip.createDiv({ cls: "sbd-web-url-text", text: hostLabel(url) });

	const frame = body.createEl("iframe", { cls: "sbd-web" });
	frame.setAttribute("src", url);
	frame.setAttribute("loading", "lazy");
	frame.setAttribute("referrerpolicy", "no-referrer");
	// Sandbox keeps embedded pages from reaching into the app while still
	// letting normal sites run their scripts. `allow-same-origin` together with
	// `allow-scripts` is the well-known combination that can let framed content
	// escape the sandbox, so it's opt-in per card ("trusted") rather than the
	// default — most sites render fine without it.
	const tokens = ["allow-scripts", "allow-popups", "allow-forms"];
	if (card.sandboxTrusted) tokens.push("allow-same-origin");
	frame.setAttribute("sandbox", tokens.join(" "));

	// The reference closes the address row with a reload glyph and the interval
	// the page refreshes on, so a card that reloads itself says so. Only drawn
	// when the card actually has an interval — otherwise the glyph would
	// promise a schedule there isn't one of.
	const refreshSec = card.refreshSec ?? 0;
	if (refreshSec > 0) {
		const reload = bar.createEl("button", {
			cls: "sbd-web-reload",
			attr: { "aria-label": t().cards.web.reloadNow },
		});
		setIcon(reload, "rotate-cw");
		reload.addEventListener("click", () => {
			frame.setAttribute("src", url);
		});
		bar.createDiv({ cls: "sbd-web-every", text: refreshLabel(refreshSec) });
	}

	// A small always-available "open in browser" button, plus a fallback shown
	// if the frame never loads (e.g. the site refuses framing via
	// X-Frame-Options / CSP, which can't be detected reliably cross-origin).
	const openExternally = () => window.open(url, "_blank");
	const ext = body.createEl("button", {
		cls: "sbd-web-external",
		attr: { "aria-label": t().cards.web.openInBrowser },
	});
	setIcon(ext, "external-link");
	ext.addEventListener("click", openExternally);

	let loaded = false;
	frame.addEventListener("load", () => {
		loaded = true;
		body.removeClass("sbd-web-blocked");
		// A slow but successful load can arrive after the fallback showed — clear it.
		body.querySelector(".sbd-web-fallback")?.remove();
	});
	const timer = window.setTimeout(() => {
		if (loaded) return;
		body.addClass("sbd-web-blocked");
		const fallback = body.createDiv("sbd-web-fallback");
		setIcon(fallback.createDiv("sbd-card-empty-icon"), "globe");
		fallback.createDiv({
			cls: "sbd-card-empty-text",
			text: t().cards.web.mayRefuse,
		});
		const open = fallback.createEl("button", { cls: "sbd-daily-create", text: t().cards.web.openInBrowser });
		open.addEventListener("click", openExternally);
	}, 4000);
	component.register(() => window.clearTimeout(timer));
}


/** The host part of a URL, as the reference labels it ("status.obsidian.md").
 *  The full address is rarely readable at card width and the host is what
 *  identifies the page. Falls back to the raw string when it won't parse — a
 *  malformed URL is the user's own text and showing it is more useful than
 *  showing nothing. */
function hostLabel(url: string): string {
	try {
		return new URL(url).host || url;
	} catch {
		return url;
	}
}


export function webEditor(ctx: CardEditorContext, containerEl: HTMLElement): void {
	const card = ctx.card;
	new Setting(containerEl).setName(t().editors.web.url).addText((txt) =>
		txt
			.setPlaceholder(t().editors.web.urlPlaceholder)
			.setValue(card.url ?? "")
			.onChange((v) => {
				card.url = v;
				ctx.opts.save();
			}),
	);
	new Setting(containerEl)
		.setName(t().editors.web.trusted)
		.setDesc(t().editors.web.trustedDesc)
		.addToggle((tg) =>
			tg.setValue(card.sandboxTrusted ?? false).onChange((v) => {
				card.sandboxTrusted = v || undefined;
				ctx.opts.save();
			}),
		);
	refreshSetting(ctx, containerEl);
}


/** Auto-refresh interval (seconds) for web cards. 0 = off. (Embed and daily
 * cards update live from vault events and don't need this.) */
export function refreshSetting(ctx: CardEditorContext, containerEl: HTMLElement): void {
	const card = ctx.card;
	const setting = new Setting(containerEl)
		.setName(t().editors.web.autoRefresh)
		.setDesc(t().editors.web.autoRefreshDesc);
	setting.addText((txt) => {
		txt.setValue(String(card.refreshSec ?? 0)).onChange((v) => {
			const n = parseInt(v, 10);
			card.refreshSec = Number.isNaN(n) || n <= 0 ? undefined : n;
			ctx.opts.save();
		});
		txt.inputEl.type = "number";
		txt.inputEl.addClass("sbd-count-input");
		txt.inputEl.setAttribute(
			"aria-label",
			t().editors.web.refreshIntervalAria,
		);
	});
	addResetButton(ctx, setting, t().settings.resetField, () => {
		card.refreshSec = undefined;
	});
}

/** The auto-refresh interval as the reference writes it — "30 sec", "5 min",
 * "2 hr" — picking the largest unit the interval divides into exactly, so a
 * 300-second card reads "5 min" rather than "300 sec". */
function refreshLabel(seconds: number): string {
	const strings = t().cards.web;
	if (seconds >= 3600 && seconds % 3600 === 0) return strings.everyHours(seconds / 3600);
	if (seconds >= 60 && seconds % 60 === 0) return strings.everyMinutes(seconds / 60);
	return strings.everySeconds(seconds);
}


/** A web page in a sandboxed iframe, with optional polling refresh. */
export const webCard: CardDefinition<"web"> = {
	kind: "web",
	templates: [
		{ id: "web", name: "Web page (iframe)", icon: "globe", build: () => ({ kind: "web", title: "Web", url: "", w: 6, h: 4 }) },
	],
	render: (_view, card, body, component) => renderWeb(card, body, component),
	renderEditor: (container, ctx) => webEditor(ctx, container),
	liveness: { mode: "poll" },
};
