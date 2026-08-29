import { Component, moment, Notice, setIcon, Setting, TFile } from "obsidian";
import {
	cardOverlayButton,
	dailyNotesOptions,
	emptyState,
	livePreviewSetting,
	renderEditableEmbed,
	renderLivePreviewEmbed,
	renderMarkdownFile,
	todaysDailyNotePath,
	watchedCardPath,
} from "../cardbodies";
import { t } from "../i18n";
import { openFile } from "../opener";
import { type DashboardCard } from "../types";
import { type HomeView } from "../view";
import { type CardDefinition, type CardEditorContext } from "./definition";


/**
 * Embed today's daily note, resolved fresh on every render so the card always
 * tracks the current day. Falls back to a "create today's note" prompt when the
 * note doesn't exist yet, and respects the per-card editable toggle.
 */
export function renderDaily(
	view: HomeView,
	card: DashboardCard,
	body: HTMLElement,
	component: Component,
): void {
	const options = dailyNotesOptions(view);
	if (!options) {
		emptyState(body, "calendar", t().cards.empty.dailyEnable);
		return;
	}

	const path = todaysDailyNotePath(options);
	const file = view.app.vault.getAbstractFileByPath(path);

	if (!(file instanceof TFile)) {
		const empty = body.createDiv("sbd-card-empty");
		setIcon(empty.createDiv("sbd-card-empty-icon"), "calendar-plus");
		empty.createDiv({ cls: "sbd-card-empty-text", text: t().cards.daily.noNoteYet });
		const create = empty.createEl("button", {
			cls: "sbd-daily-create",
			text: t().cards.daily.createToday,
		});
		create.addEventListener("click", () => {
			// The core "Open today's daily note" command creates it from the
			// configured template and opens it.
			if (!view.app.commands.executeCommandById("daily-notes")) {
				new Notice(t().notices.couldNotOpenDaily);
			}
		});
		return;
	}

	// Optional button to open today's note in the editor (hideable). Rendered
	// as a floating overlay on the card element (not the body) so it doesn't
	// affect the body's scroll/flow.
	if (card.showOpenButton !== false) {
		cardOverlayButton(body, "square-pen", t().cards.daily.openToday, () => {
			void openFile(view, file, "card");
		});
	}

	// Widget Set → DAILY leads with the date, set large and unadorned on the
	// card's glass — the weekday, then the day number at display size, then
	// the month and year — with the note itself in a panel below it. The card
	// used to be nothing but the note, which made it indistinguishable from a
	// plain embed pointed at today.
	renderDailyDate(body);

	if (card.editable) {
		if (card.livePreview && renderLivePreviewEmbed(view, file, body, component)) return;
		renderEditableEmbed(view, file, body, component);
		return;
	}

	const host = body.createDiv("sbd-embed sbd-daily-note markdown-rendered");
	body.addClass("is-embed-host");
	void renderMarkdownFile(view, file, host, component);
}


/** The reference's date block: weekday over the day number over "month year".
 *  Plain text on the card's glass — no chip, no panel — so the number is the
 *  loudest thing on the card. */
function renderDailyDate(body: HTMLElement): void {
	const now = moment();
	const wrap = body.createDiv("sbd-daily-date");
	wrap.createDiv({ cls: "sbd-daily-weekday", text: now.format("dddd") });
	wrap.createDiv({ cls: "sbd-daily-daynum", text: now.format("D") });
	wrap.createDiv({ cls: "sbd-daily-month", text: now.format("MMMM YYYY") });
}


export function dailyEditor(ctx: CardEditorContext, containerEl: HTMLElement): void {
	const card = ctx.card;
	new Setting(containerEl)
		.setName(t().editors.daily.editable)
		.setDesc(t().editors.daily.editableDesc)
		.addToggle((tg) =>
			tg.setValue(card.editable ?? false).onChange((v) => {
				card.editable = v || undefined;
				ctx.opts.save();
				// The live-preview choice below only exists while editing is on.
				ctx.requestRender();
			}),
		);
	if (card.editable) livePreviewSetting(ctx, containerEl, card);
	new Setting(containerEl)
		.setName(t().editors.daily.openButton)
		.setDesc(t().editors.daily.openButtonDesc)
		.addToggle((tg) =>
			tg.setValue(card.showOpenButton !== false).onChange((v) => {
				card.showOpenButton = v ? undefined : false;
				ctx.opts.save();
			}),
		);
	new Setting(containerEl)
		.setName(t().editors.daily.info)
		.setDesc(t().editors.daily.infoDesc);
}

/** Today's daily note, embedded live. */
export const dailyCard: CardDefinition<"daily"> = {
	kind: "daily",
	templates: [
		{ id: "daily", defaultSize: "large", name: "Daily note (today)", icon: "calendar", build: () => ({ kind: "daily" }) },
	],
	render: (view, card, body, component) => renderDaily(view, card, body, component),
	renderEditor: (container, ctx) => dailyEditor(ctx, container),
	liveness: {
		mode: "watch-file",
		watchedPath: (view, card) => watchedCardPath(view, card),
		editableInPlace: (card) => !!card.editable,
	},
};
