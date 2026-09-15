/**
 * Handing an unfiled item to Claude, without an API key.
 *
 * The three coursework cards (course overview, calendar sync, add detail) all
 * reach a point where something has to be *decided*: which of the seven note
 * types a calendar event becomes, which course a dropped PDF belongs to, where
 * in a note a paragraph of prose should go. Those decisions need the vault's
 * own rules and a reading of what is already there — `Claude/AGENTS.md` and its
 * three companion files — which is judgement, not parsing.
 *
 * Second Brain Dashboard does not make those calls itself, and does not ship an
 * Anthropic API key to have them made. Instead every such item takes the same
 * two-step path:
 *
 * 1. **Hold it.** The content is written straight into the vault, in
 *    `Unsorted/`, flagged `needs-filing`. Nothing is ever lost waiting on a
 *    decision, and nothing is ever parked in a typed folder it may not belong
 *    in — a note in `Lectures/` is claiming to be a lecture, and an
 *    unclassified item hasn't earned that claim.
 * 2. **Ask for it to be filed.** A request note goes into `Claude/inbox/`,
 *    naming the item, the holding note, and the four instruction files. Claude
 *    Code — through the Claudian plugin, which runs an agent with the vault as
 *    its working directory, or a headless session on the same folder — drains
 *    that inbox and does the real filing with full read/write access.
 *
 * Claudian is therefore optional rather than required. With it, ambiguous items
 * get resolved in place; without it, they queue visibly in two folders the user
 * can work through by hand. What never happens is this plugin inventing a
 * filing scheme of its own and quietly getting it wrong.
 */
import { Notice, TFile, TFolder, normalizePath, type App } from "obsidian";
import { t } from "./i18n";
import {
	buildFilingRequestNote,
	HOLDING_FOLDER,
	INBOX_FOLDER,
	isIgnoredPath,
	NEEDS_FILING_KEY,
	sanitizeNoteTitle,
	type FilingRequest,
} from "./vaultfiling";

/**
 * Claudian's community-plugin id, as the plugin registry lists it
 * (community.obsidian.md/plugins/realclaudian).
 *
 * Only ever used to *report* whether Claudian is there — nothing in this file
 * calls into it, so a wrong or renamed id degrades to "we can't tell you it's
 * installed", never to a broken feature.
 */
export const CLAUDIAN_PLUGIN_ID = "realclaudian";

/** Whether Claudian is installed and switched on right now. Defensive for the
 * same reason `integrationStatus` is: `plugins` is an Obsidian internal and
 * this runs while a card is being drawn. */
export function claudianEnabled(app: App): boolean {
	try {
		return app.plugins?.enabledPlugins?.has(CLAUDIAN_PLUGIN_ID) === true;
	} catch {
		return false;
	}
}

/** Create a folder (and its parents) when it isn't there yet. */
export async function ensureFolder(app: App, path: string): Promise<TFolder | null> {
	const clean = normalizePath(path);
	const existing = app.vault.getAbstractFileByPath(clean);
	if (existing instanceof TFolder) return existing;
	try {
		await app.vault.createFolder(clean);
	} catch {
		// Raced with another write, or the name is taken by a file.
	}
	const made = app.vault.getAbstractFileByPath(clean);
	return made instanceof TFolder ? made : null;
}

/** Write a markdown note, letting Obsidian pick a non-colliding filename.
 * Frontmatter is written through `processFrontMatter` so Obsidian owns the YAML
 * quoting rather than this module hand-rolling it. */
export async function writeNote(
	app: App,
	folder: string,
	filename: string,
	frontmatter: Record<string, unknown>,
	body: string,
): Promise<TFile | null> {
	const parent = (await ensureFolder(app, folder)) ?? app.vault.getRoot();
	const name = sanitizeNoteTitle(filename) || "Untitled";
	let file: TFile;
	try {
		file = await app.fileManager.createNewMarkdownFile(parent, name);
	} catch {
		return null;
	}
	try {
		if (body.trim()) await app.vault.modify(file, `${body.replace(/\s+$/, "")}\n`);
		if (Object.keys(frontmatter).length) {
			await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				for (const [key, value] of Object.entries(frontmatter)) fm[key] = value;
			});
		}
	} catch {
		// The note exists even when a follow-up write failed; hand it back so
		// the caller can still link to it rather than losing the content.
	}
	return file;
}

/** Write a dropped file into the vault, de-duplicating its name. Binary is
 * written verbatim: converting or renaming an attachment here would break the
 * content-hash matching that `Claude/memory.md` requires. */
export async function writeAttachment(
	app: App,
	folder: string,
	filename: string,
	data: ArrayBuffer,
): Promise<TFile | null> {
	await ensureFolder(app, folder);
	const clean = sanitizeNoteTitle(filename) || "attachment";
	const dot = clean.lastIndexOf(".");
	const stem = dot > 0 ? clean.slice(0, dot) : clean;
	const ext = dot > 0 ? clean.slice(dot) : "";
	for (let attempt = 0; attempt < 50; attempt++) {
		const suffix = attempt === 0 ? "" : ` ${attempt + 1}`;
		const path = normalizePath(`${folder}/${stem}${suffix}${ext}`);
		if (app.vault.getAbstractFileByPath(path)) continue;
		try {
			return await app.vault.createBinary(path, data);
		} catch {
			return null;
		}
	}
	return null;
}

/** An item held for filing: the holding note, and the request that asks for it
 * to be filed. Either may be null when a write failed. */
export interface HeldItem {
	holding: TFile | null;
	request: TFile | null;
}

/**
 * Hold an item and ask for it to be filed.
 *
 * `holdingBody` is the item's actual content — the event's description, the
 * user's prose — so the holding note is worth reading on its own, not just a
 * pointer. The `sbd-*` frontmatter keys live only here, in `Unsorted/`, which
 * has no template contract; whoever files the note into one of the seven typed
 * folders drops them, because those folders allow no fields beyond their
 * template's (AGENTS.md §3.3).
 */
export async function holdForFiling(
	app: App,
	req: Omit<FilingRequest, "holdingPath">,
	holdingBody: string,
	extraFrontmatter: Record<string, unknown> = {},
): Promise<HeldItem> {
	const now = new Date();
	const holding = await writeNote(
		app,
		HOLDING_FOLDER,
		req.summary || t().cards.calsync.untitledEvent,
		{
			[NEEDS_FILING_KEY]: true,
			"sbd-source": req.source,
			...(req.uid ? { "sbd-uid": req.uid } : {}),
			...extraFrontmatter,
		},
		holdingBody,
	);
	if (!holding) return { holding: null, request: null };

	const note = buildFilingRequestNote({ ...req, holdingPath: holding.path }, now);
	const request = await writeNote(app, INBOX_FOLDER, note.filename, note.frontmatter, note.body);
	return { holding, request };
}

/** How many filing requests are still waiting. Drawn on the sync and detail
 * cards so a queue that nothing is draining is visible rather than silent. */
export function pendingRequestCount(app: App): number {
	const inbox = app.vault.getAbstractFileByPath(normalizePath(INBOX_FOLDER));
	if (!(inbox instanceof TFolder)) return 0;
	return inbox.children.filter((f) => f instanceof TFile && f.extension === "md").length;
}

/** Every note still flagged `needs-filing`, cheapest-first: the holding folder
 * is read from the vault index, never by opening files. */
export function heldNotes(app: App): TFile[] {
	const folder = app.vault.getAbstractFileByPath(normalizePath(HOLDING_FOLDER));
	if (!(folder instanceof TFolder)) return [];
	return folder.children.filter(
		(f): f is TFile => f instanceof TFile && f.extension === "md" && !isIgnoredPath(f.path),
	);
}

/**
 * Show the user where the queue is.
 *
 * Deliberately modest about Claudian: this opens the inbox folder's newest
 * request so there is always something to act on, and says whether Claudian is
 * available to hand it to. It does not drive Claudian's UI — its commands and
 * view types are its own business and could change under us, and a dead
 * "Open in Claudian" button would be worse than an honest pointer to the note.
 */
export async function revealFilingQueue(app: App): Promise<void> {
	const inbox = app.vault.getAbstractFileByPath(normalizePath(INBOX_FOLDER));
	const requests =
		inbox instanceof TFolder
			? inbox.children
					.filter((f): f is TFile => f instanceof TFile && f.extension === "md")
					.sort((a, b) => b.stat.ctime - a.stat.ctime)
			: [];
	if (!requests.length) {
		new Notice(t().notices.filingQueueEmpty);
		return;
	}
	await app.workspace.getLeaf(false).openFile(requests[0]);
	new Notice(
		claudianEnabled(app)
			? t().notices.filingQueueClaudian(requests.length)
			: t().notices.filingQueueManual(requests.length),
	);
}
