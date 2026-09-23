/**
 * Pure line editing for Tasks-plugin metadata: the emoji markers, their
 * values, and the rewrites that keep a user's task line intact around them.
 *
 * Lives outside `cards/tasks.ts` so it can be tested directly. That module
 * sits in the card registry's import cycle (see `cards/README.md`), and a test
 * that imports it gets a half-built registry — while everything here is plain
 * string work with no Obsidian import, and it is also the code most able to
 * damage a vault: every function below rewrites text the user wrote.
 */

/** Every Tasks-plugin metadata emoji marker, used to strip metadata from a
 * card's display text and to compare cards ignoring their metadata. */
export const TASK_EMOJI_CLASS = "📅⏳🛫🔁✅❌➕⏫🔼🔽🔺⏬";

/** The subset of metadata emoji Second Brain Dashboard's editor manages (due/scheduled/start/
 * recurrence/priority). Completion (✅), created (➕) and cancelled (❌) markers
 * are left untouched when rewriting a card's metadata. */
export const MANAGED_EMOJI_CLASS = "📅⏳🛫🔁⏫🔼🔽🔺⏬";

/**
 * The value that follows a metadata marker, for every WRITE path: up to the
 * next marker, but never across a `#tag` or a `^block-id`.
 *
 * The write paths used to take "everything up to the next marker", which on a
 * line like `- [x] Pay rent 📅 2024-01-15 ✅ 2024-01-15 ^rent #finance` meant
 * the ✅ field's "value" was `2024-01-15 ^rent #finance`. Unchecking it deleted
 * the tag and the block id — and with the block id went every `[[note#^rent]]`
 * link and embed pointing at that line. The same happened on every priority or
 * date edit and every recurring roll-forward. No marker's value contains `#`
 * or `^` (dates, priorities and "every week"-style rules don't), so stopping
 * there costs nothing and keeps both.
 *
 * `stripTaskMetadata` keeps its old, greedier class on purpose: it is display
 * and comparison only, never written, and changing it would change what a card
 * shows and how two readings of one line compare.
 */
export const FIELD_VALUE = `[^\\n\\r#^${TASK_EMOJI_CLASS}]*`;

/**
 * Split a trailing `^block-id` off a task's text.
 *
 * Obsidian honours a block id only as the LAST token on its line, so anything
 * appended after it — a fresh ✅ date, a rebuilt metadata suffix — silently
 * detaches it even when the id itself survives. Every write that appends goes
 * through this: edit the body, then put the id back at the end.
 */
export function splitBlockId(text: string): { body: string; blockId: string } {
	const m = /\s+(\^[A-Za-z0-9-]+)\s*$/.exec(text);
	return m ? { body: text.slice(0, m.index), blockId: m[1] } : { body: text, blockId: "" };
}

export function withBlockId(body: string, blockId: string): string {
	return blockId ? `${body} ${blockId}`.trim() : body;
}

/** Strip all Tasks-plugin emoji metadata (each marker and its trailing value up
 * to the next marker) from a task's text, collapsing leftover whitespace. Used
 * for clean Kanban card display and for stable text comparison on writeback
 * (idempotent, so a raw and an already-stripped text compare equal). */
export function stripTaskMetadata(text: string): string {
	const re = new RegExp(`[${TASK_EMOJI_CLASS}][^\\n\\r${TASK_EMOJI_CLASS}]*`, "gu");
	return text.replace(re, "").replace(/\s+/g, " ").trim();
}

/** Add or remove the Tasks-plugin done-date marker (✅ YYYY-MM-DD) on a card's
 * text: any existing ✅ field is dropped, then today's is appended when `done`.
 * Used to keep the completion date in sync as cards are checked/unchecked. */
export function withDoneDate(text: string, done: boolean, today: string): string {
	const { body, blockId } = splitBlockId(text);
	const re = new RegExp(`✅${FIELD_VALUE}`, "gu");
	const base = body.replace(re, "").replace(/\s+/g, " ").trim();
	return withBlockId(done ? `${base} ✅ ${today}`.trim() : base, blockId);
}

/** Set (or, when null, remove) a Tasks-plugin date field (e.g. 📅/⏳/🛫) on a
 * task's text to `date`, replacing any existing value for that marker. */
export function withEmojiDate(text: string, emoji: string, date: string | null): string {
	const { body, blockId } = splitBlockId(text);
	const re = new RegExp(`${emoji}${FIELD_VALUE}`, "gu");
	const base = body.replace(re, "").replace(/\s+/g, " ").trim();
	return withBlockId(date ? `${base} ${emoji} ${date}`.trim() : base, blockId);
}
