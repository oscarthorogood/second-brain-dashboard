import { Setting, type App } from "obsidian";
import { CARD_KINDS, cardDefinition } from "./cards";
import { type CardEditorContext } from "./cards/definition";
import { t } from "./i18n";
import { sizeSpec } from "./widgetsize";
import { SbdTabbedModal, type SbdModalTab } from "./tabbedmodal";
import { type CardKind, type DashboardCard, type HomeSettings } from "./types";
import { confirmAction } from "./ui";


export interface CardSettingsOptions {
	/** The plugin's global settings. Read-only as far as the editors are
	 * concerned: a couple of kind editors need the global field-name mappings
	 * (which frontmatter keys the TaskNotes source reads) to offer sensible
	 * choices, rather than guessing the defaults. */
	settings: HomeSettings;
	/** The global favorites list (shared by all favorites cards). */
	favorites: string[];
	/** Whether the global privacy setting blocks outbound requests. */
	externalCallsDisabled: boolean;
	/** Persist the current settings (no view rebuild). */
	save: () => void;
	/** Rebuild the dashboard view to reflect content/layout changes. */
	rerender: () => void;
	/** Remove this card from the dashboard. */
	remove: () => void;
}


/**
 * The single place to configure a widget — opened from the widget itself in
 * arrange mode. Covers kind, title and the kind's own content settings.
 *
 * It used to carry a second "Layout" tab holding a width and a height field,
 * which is exactly the free-form geometry the fixed grid replaced: a widget is
 * one of four sizes, chosen when it is added, so there is nothing left to tune
 * here. The tab is gone and the size is stated rather than edited.
 */
export class CardSettingsModal extends SbdTabbedModal {
	private card: DashboardCard;
	private opts: CardSettingsOptions;

	/** Per-open scratch space for kind editors (the RSS "add from GitHub" fields,
	 * the Jira load-cancellation counter). Survives the in-place rerenders that
	 * editors trigger, but is fresh for each modal open. */
	private session: Record<string, unknown> = {};

	constructor(app: App, card: DashboardCard, opts: CardSettingsOptions) {
		super(app);
		this.card = card;
		this.opts = opts;
	}

	/** Bundle the modal state a kind editor needs into a CardEditorContext. */
	private editorContext(): CardEditorContext {
		return {
			app: this.app,
			card: this.card,
			opts: this.opts,
			requestRender: () => this.render(),
			session: this.session,
		};
	}

	onOpen(): void {
		this.titleEl.setText(t().editors.title);
		this.sbdRenderShell();
	}

	/** Rebuild the modal in place, keeping the active tab. Kind-specific editors
	 * call this after a change that swaps which controls are shown. */
	private render(): void {
		this.sbdRenderShell();
	}

	protected sbdTabStorageKey(): string {
		return "sbd-card-settings-tab";
	}

	protected sbdTabs(): SbdModalTab[] {
		const tabs = t().editors.tabs;
		return [{ id: "content", label: tabs.content, icon: "square-pen" }];
	}

	protected sbdRenderBody(body: HTMLElement, tabId: string): void {
		switch (tabId) {
			case "content":
				this.identitySection(body);
				this.sizeSection(body);
				this.contentSection(body);
				break;
		}
	}

	/** Type and title — what the card is, shown at the top of the Content tab. */
	private identitySection(containerEl: HTMLElement): void {
		const card = this.card;

		new Setting(containerEl)
			.setName(t().editors.type)
			.setDesc(t().editors.typeDesc)
			.addDropdown((d) => {
				CARD_KINDS.forEach((k) => {
					d.addOption(k, t().editors.kinds[k]);
				});
				d.setValue(card.kind).onChange((v) => {
					card.kind = v as CardKind;
					this.opts.save();
					this.render();
				});
			});

		// A note under the type dropdown, when the kind wants one (e.g. the leaf
		// card's "this runs a live view, it costs more" performance hint).
		cardDefinition(card).editorTypeNote?.(containerEl, this.opts.settings);

		new Setting(containerEl)
			.setName(t().editors.cardTitle)
			.setDesc(t().editors.cardTitleDesc)
			.addText((txt) =>
				txt
					.setPlaceholder(t().editors.cardTitlePlaceholder)
					.setValue(card.title ?? "")
					.onChange((v) => {
						card.title = v;
						this.opts.save();
					}),
			);
	}

	/** Persistent footer shared by every tab: remove the card, or close. */
	protected sbdRenderFooter(footer: HTMLElement): void {
		new Setting(footer)
			.addButton((b) => {
				b.setButtonText(t().editors.removeCard).onClick(() => {
					confirmAction(this.app, {
						title: t().editors.removeCardTitle,
						message: t().editors.removeCardMessage(
							this.card.title?.trim() || t().editors.thisCard,
						),
						confirmText: t().editors.removeCardConfirm,
						onConfirm: () => {
							this.opts.remove();
							this.close();
						},
					});
				});
				b.buttonEl.addClass("sbd-danger-btn");
			})
			.addButton((b) =>
				b
					.setButtonText(t().editors.done)
					.setCta()
					.onClick(() => this.close()),
			);
	}

	/** Kind-specific content controls — delegated to the card's own module. */
	private contentSection(containerEl: HTMLElement): void {
		cardDefinition(this.card).renderEditor?.(containerEl, this.editorContext());
	}

	/** State the widget's fixed size. Not a control: sizes are chosen in the
	 * picker and can't be changed afterwards, so this only answers "which one
	 * is this?" and says where the answer is changed. */
	private sizeSection(containerEl: HTMLElement): void {
		const spec = sizeSpec(this.card.kind, this.card.size);
		const strings = t().cardPicker.size;
		new Setting(containerEl)
			.setName(t().editors.size.heading)
			.setDesc(strings.note)
			.addExtraButton((b) => {
				b.setIcon("info");
				b.setDisabled(true);
				b.extraSettingsEl.addClass("sbd-size-readout-icon");
			})
			.controlEl.createSpan({
				cls: "sbd-size-readout",
				text: `${strings.names[this.card.size]} · ${strings.cells(spec.cols, spec.rows)}`,
			});
	}

	onClose(): void {
		// Invalidate any in-flight Jira filter load so its result is dropped.
		this.session.jiraLoadVersion = ((this.session.jiraLoadVersion as number) ?? 0) + 1;
		this.contentEl.empty();
		this.opts.rerender();
	}
}


/** Add a reset (rotate-ccw) extra button that clears a field back to its
 * default, then saves and redraws so the input reflects the restored value. */
export function addResetButton(ctx: CardEditorContext, 
	setting: Setting,
	tooltip: string,
	onReset: () => void,
): void {
	setting.addExtraButton((b) =>
		b
			.setIcon("rotate-ccw")
			.setTooltip(tooltip)
			.onClick(() => {
				onReset();
				ctx.opts.save();
				ctx.requestRender();
			}),
	);
}


/** Move an item within a list, then persist and re-render the editor. */
export function moveItem<T>(ctx: CardEditorContext, arr: T[], from: number, to: number): void {
	if (to < 0 || to >= arr.length) return;
	const [item] = arr.splice(from, 1);
	arr.splice(to, 0, item);
	ctx.opts.save();
	ctx.requestRender();
}
