import { Modal, Notice, setIcon, Setting, TFile, type App } from "obsidian";
import { fileForClaude, revealTray, trayCount, writeAttachment } from "../claudebridge";
import { courseNames } from "../coursework";
import { t } from "../i18n";
import { FilePickerModal } from "../pickers";
import { type DashboardCard } from "../types";
import { makeClickable } from "../ui";
import { findCourseInText, UNSORTED_FOLDER } from "../vaultfiling";
import { type HomeView } from "../view";
import { type CardDefinition, type CardEditorContext } from "./definition";

/**
 * Add detail to unsorted — a page, files or prose, dropped into
 * `Claude/unsorted`.
 *
 * The three things this collects are the three that are tedious by hand and
 * easy to get wrong: linking the right page, putting an attachment in the
 * right course folder (`Resources/` for finished reference material,
 * `OneDrive/` for active working files — AGENTS.md §9), and writing something
 * into a note in the shape that note already uses.
 *
 * None of those are decided here. Everything the user supplies lands in
 * `Claude/unsorted` immediately — prose as a note, files in
 * `Claude/unsorted/attachments/` with a note beside them — carrying the target
 * note's name and the vault's rules, and waits there for a reader. See
 * `claudebridge.ts` for why the decision doesn't live in this plugin.
 *
 * The tray is named at every size but small, for the same reason the sync card
 * names its inbox: a card that writes into the vault should say where.
 *
 * Reference (Widget Set v2 → DETAIL): small is a single add button, medium
 * gains the page field and two chips, large stacks the three actions as rows,
 * extra large runs them as three columns.
 */

/** Where dropped files wait. A subfolder of the tray so an attachment never
 * sits loose beside the notes that describe it. */
const UNSORTED_ATTACHMENTS = `${UNSORTED_FOLDER}/attachments`;

export function renderDetail(view: HomeView, card: DashboardCard, body: HTMLElement): void {
	const strings = t().cards.detail;
	const open = () => openDetailModal(view, targetOf(view.app, card));

	switch (card.size) {
		case "small": {
			const tile = body.createDiv("sbd-detail-tile");
			setIcon(tile.createDiv("sbd-detail-plus"), "plus");
			tile.createDiv({ cls: "sbd-detail-title", text: strings.toUnsorted });
			// At 158px the subtitle is the only room to say where things go, and
			// "page · files · notes" is already said by the icon and the dialog.
			tile.createDiv({ cls: "sbd-detail-sub", text: UNSORTED_FOLDER });
			clickable(tile, open, strings.addDetail);
			break;
		}
		case "medium": {
			const head = body.createDiv("sbd-card-headline");
			setIcon(head.createDiv("sbd-card-headline-icon"), "folder-input");
			head.createDiv({ cls: "sbd-card-headline-text", text: strings.addDetail });
			destinationChip(head);
			const row = body.createDiv("sbd-detail-row");
			searchField(row, open);
			chip(row, strings.dropFiles, open);
			chip(row, strings.writeNotes, open);
			break;
		}
		case "large":
		case "xlarge": {
			const head = body.createDiv("sbd-course-head is-stacked");
			const text = head.createDiv("sbd-course-headtext");
			text.createDiv({ cls: "sbd-card-eyebrow", text: strings.eyebrow });
			text.createDiv({
				cls: "sbd-course-name is-large",
				text: card.size === "xlarge" ? strings.headlineLong : strings.addDetail,
			});
			destinationChip(text);
			const wrap = body.createDiv(card.size === "xlarge" ? "sbd-detail-cols" : "sbd-detail-stack");
			action(wrap, "link", strings.linkPage, strings.linkPageSub, open, "glass");
			action(wrap, "download", strings.dropFiles, strings.dropFilesSub, open, "sheet");
			action(wrap, "pencil", strings.writeNotes, strings.writeNotesSub, open, "sheet");
			break;
		}
	}

	// Drawn empty or not, and at every size but small: the tray is where this
	// card's output goes, so its depth is the card's result — and a tray nothing
	// is draining is the one failure mode worth surfacing here, since the plugin
	// has done its half and the items are still waiting.
	if (card.size !== "small") trayLine(view, body);
}

/** The folder everything this card collects lands in. */
function destinationChip(parent: HTMLElement): void {
	const chip = parent.createDiv("sbd-sync-dest");
	setIcon(chip.createDiv("sbd-sync-dest-icon"), "corner-down-right");
	chip.createSpan({ cls: "sbd-sync-dest-path", text: UNSORTED_FOLDER });
}

/** How much is still sitting in `Claude/unsorted`, and a way into it. */
function trayLine(view: HomeView, body: HTMLElement): void {
	const waiting = trayCount(view.app, "unsorted");
	const strings = t().cards.detail;
	const label = waiting > 0 ? strings.waiting(waiting, UNSORTED_FOLDER) : strings.trayEmpty(UNSORTED_FOLDER);
	const line = body.createDiv("sbd-tray-line");
	line.toggleClass("is-empty", waiting === 0);
	setIcon(line.createDiv("sbd-tray-icon"), "folder-open");
	line.createDiv({ cls: "sbd-tray-text", text: label });
	const open = () => void revealTray(view.app, "unsorted");
	// Opening the folder is not "add something to it", so the click stops here
	// rather than also reaching whatever the card surface does with one.
	line.addEventListener("click", (e) => {
		e.stopPropagation();
		open();
	});
	makeClickable(line, open, label);
}

/** The note a card is pinned to, when it still exists. */
function targetOf(app: App, card: DashboardCard): TFile | undefined {
	const path = card.detail?.target?.trim();
	if (!path) return undefined;
	const file = app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? file : undefined;
}

function clickable(el: HTMLElement, fn: () => void, label: string): void {
	el.addEventListener("click", fn);
	makeClickable(el, fn, label);
}

function searchField(parent: HTMLElement, open: () => void): void {
	const field = parent.createDiv("sbd-detail-search");
	setIcon(field.createDiv("sbd-detail-search-icon"), "search");
	field.createDiv({ cls: "sbd-detail-search-text", text: t().cards.detail.searchPages });
	clickable(field, open, t().cards.detail.searchPages);
}

function chip(parent: HTMLElement, label: string, open: () => void): void {
	const el = parent.createDiv({ cls: "sbd-detail-chip", text: label });
	clickable(el, open, label);
}

function action(
	parent: HTMLElement,
	icon: string,
	title: string,
	sub: string,
	open: () => void,
	surface: "sheet" | "glass",
): void {
	const el = parent.createDiv("sbd-detail-action");
	el.toggleClass(surface === "sheet" ? "is-sheet" : "is-glass", true);
	setIcon(el.createDiv("sbd-detail-action-icon"), icon);
	const text = el.createDiv("sbd-detail-action-text");
	text.createDiv({ cls: "sbd-detail-action-title", text: title });
	text.createDiv({ cls: "sbd-detail-action-sub", text: sub });
	clickable(el, open, title);
}

// ---- The modal ------------------------------------------------------------

/** Open the add-detail dialog, optionally already pointed at a note. */
export function openDetailModal(view: HomeView, target?: TFile): void {
	new DetailModal(view, target).open();
}

/**
 * Collects a target note, any number of files, and a block of prose.
 *
 * Save writes all three into `Claude/unsorted` and leaves the filing decision
 * there; it never edits the target note directly. Editing it would mean
 * choosing a heading and a wording, which is the judgement being deferred — and
 * a note silently appended to in the wrong place is harder to notice than an
 * item sitting in a tray.
 */
class DetailModal extends Modal {
	private target: TFile | undefined;
	private notes = "";
	private readonly files: File[] = [];
	private listEl: HTMLElement | null = null;
	private targetEl: HTMLElement | null = null;

	constructor(
		private readonly view: HomeView,
		target: TFile | undefined,
	) {
		super(view.app);
		this.target = target;
	}

	onOpen(): void {
		const strings = t().cards.detail;
		this.modalEl.addClass("sbd-detail-modal");
		this.titleEl.setText(strings.addDetail);

		// ---- Target note ----
		new Setting(this.contentEl)
			.setName(strings.linkPage)
			.setDesc(strings.linkPageSub)
			.addButton((b) =>
				b.setButtonText(strings.choosePage).onClick(() => {
					new FilePickerModal(
						this.app,
						(file) => {
							this.target = file;
							this.renderTarget();
						},
						strings.searchPages,
					).open();
				}),
			);
		this.targetEl = this.contentEl.createDiv("sbd-detail-target");
		this.renderTarget();

		// ---- Files ----
		new Setting(this.contentEl).setName(strings.dropFiles).setDesc(strings.dropFilesSub).setHeading();
		const drop = this.contentEl.createDiv("sbd-detail-drop");
		drop.createDiv({ cls: "sbd-detail-drop-text", text: strings.dropHere });
		drop.createDiv({ cls: "sbd-detail-drop-sub", text: strings.orBrowse });
		const input = drop.createEl("input", { attr: { type: "file", multiple: "true" } });
		input.addClass("sbd-detail-file-input");
		input.addEventListener("change", () => {
			this.addFiles(input.files);
			input.value = "";
		});
		drop.addEventListener("dragover", (e) => {
			e.preventDefault();
			drop.addClass("is-over");
		});
		drop.addEventListener("dragleave", () => drop.removeClass("is-over"));
		drop.addEventListener("drop", (e) => {
			e.preventDefault();
			drop.removeClass("is-over");
			this.addFiles(e.dataTransfer?.files ?? null);
		});
		this.listEl = this.contentEl.createDiv("sbd-detail-files");

		// ---- Notes ----
		new Setting(this.contentEl).setName(strings.writeNotes).setDesc(strings.writeNotesSub).setHeading();
		const area = this.contentEl.createEl("textarea", {
			cls: "sbd-detail-notes",
			attr: { placeholder: strings.notesPlaceholder, rows: "6" },
		});
		area.addEventListener("input", () => {
			this.notes = area.value;
		});

		// ---- Actions ----
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(strings.cancel).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(strings.save)
					.setCta()
					.onClick(() => void this.save()),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderTarget(): void {
		if (!this.targetEl) return;
		this.targetEl.empty();
		const strings = t().cards.detail;
		if (!this.target) {
			this.targetEl.createDiv({ cls: "sbd-detail-target-none", text: strings.noPage });
			return;
		}
		this.targetEl.createDiv({ cls: "sbd-detail-target-name", text: this.target.path });
		const clear = this.targetEl.createDiv({ cls: "sbd-detail-target-clear", text: "✕" });
		clickable(clear, () => {
			this.target = undefined;
			this.renderTarget();
		}, strings.clearPage);
	}

	private addFiles(list: FileList | null): void {
		for (const file of Array.from(list ?? [])) this.files.push(file);
		this.renderFiles();
	}

	private renderFiles(): void {
		if (!this.listEl) return;
		this.listEl.empty();
		this.files.forEach((file, index) => {
			const row = this.listEl!.createDiv("sbd-detail-file");
			row.createDiv({ cls: "sbd-detail-file-name", text: file.name });
			const remove = row.createDiv({ cls: "sbd-detail-file-remove", text: "✕" });
			clickable(remove, () => {
				this.files.splice(index, 1);
				this.renderFiles();
			}, t().cards.detail.removeFile);
		});
	}

	/**
	 * Write everything into `Claude/unsorted`.
	 *
	 * Files are written before the note that mentions them, so a note can never
	 * point at an attachment that failed to land.
	 */
	private async save(): Promise<void> {
		const prose = this.notes.trim();
		if (!prose && !this.files.length) {
			new Notice(t().notices.detailNothingToSave);
			return;
		}

		const app = this.app;
		const courses = courseNames(app);
		const targetPath = this.target?.path ?? "";
		// A hint only: an exact registry lookup on the target's own title, never
		// a decision (see `findCourseInText`).
		const courseHint = targetPath ? findCourseInText(this.target!.basename, courses) : null;
		const source = targetPath || t().cards.detail.noPage;
		let queued = 0;

		for (const file of this.files) {
			let written: TFile | null = null;
			try {
				written = await writeAttachment(app, UNSORTED_ATTACHMENTS, file.name, await file.arrayBuffer());
			} catch {
				written = null;
			}
			if (!written) {
				new Notice(t().notices.detailAttachmentFailed(file.name));
				continue;
			}
			await fileForClaude(
				app,
				{
					kind: "attachment",
					destination: "unsorted",
					source,
					summary: file.name,
					courseHint,
					attachmentPath: written.path,
					content: `![[${written.path}]]`,
					details: {
						[t().cards.detail.detailTargetNote]: targetPath,
						[t().cards.detail.detailSize]: `${Math.max(1, Math.round(file.size / 1024))} KB`,
					},
				},
				targetPath ? { "sbd-target": targetPath } : {},
			);
			queued++;
		}

		if (prose) {
			await fileForClaude(
				app,
				{
					kind: "note-detail",
					destination: "unsorted",
					source,
					summary: prose.split("\n")[0].slice(0, 80) || t().cards.detail.writeNotes,
					courseHint,
					content: prose,
					details: { [t().cards.detail.detailTargetNote]: targetPath },
				},
				targetPath ? { "sbd-target": targetPath } : {},
			);
			queued++;
		}

		this.close();
		new Notice(queued ? t().notices.detailQueued(queued) : t().notices.detailNothingToSave);
		this.view.render();
	}
}

// ---- Editor ---------------------------------------------------------------

export function detailEditor(ctx: CardEditorContext, containerEl: HTMLElement): void {
	const strings = t().editors.detail;
	const cfg = (ctx.card.detail ??= {});

	const setting = new Setting(containerEl).setName(strings.target).setDesc(strings.targetDesc);
	setting.addText((txt) =>
		txt
			.setPlaceholder(strings.targetPlaceholder)
			.setValue(cfg.target ?? "")
			.onChange((v) => {
				cfg.target = v.trim() || undefined;
				ctx.opts.save();
			}),
	);
	setting.addExtraButton((b) =>
		b
			.setIcon("file-symlink")
			.setTooltip(strings.pickTarget)
			.onClick(() => {
				new FilePickerModal(ctx.app, (file) => {
					cfg.target = file.path;
					ctx.opts.save();
					ctx.requestRender();
				}).open();
			}),
	);
	setting.addExtraButton((b) =>
		b
			.setIcon("x")
			.setTooltip(strings.clearTarget)
			.onClick(() => {
				cfg.target = undefined;
				ctx.opts.save();
				ctx.requestRender();
			}),
	);
}

/** Drop a page, files or notes into `Claude/unsorted` for Claude to file. */
export const detailCard: CardDefinition<"detail"> = {
	kind: "detail",
	templates: [
		{
			id: "detail",
			name: "Add detail to unsorted",
			icon: "folder-input",
			defaultSize: "medium",
			build: () => ({ kind: "detail", title: "Add detail to unsorted", detail: {} }),
		},
	],
	render: (view, card, body) => renderDetail(view, card, body),
	renderEditor: (container, ctx) => detailEditor(ctx, container),
	cloneConfig: (source, copy) => {
		if (source.detail) copy.detail = { ...source.detail };
	},
	cardClass: "is-detail-card",
	// The tray line is read from the vault, so the card follows it — but only
	// for its own folder, rather than rebuilding on every note in the vault.
	liveness: { mode: "vault", shouldRedraw: (_card, ev) => ev.file.path.startsWith(UNSORTED_FOLDER) },
};
