/**
 * state-outline — the coarse index of a rendered state payload.
 *
 * The State tab rests as one byte-exact figure (see
 * docs/10-system-design/explainers/state-tab-options.html, R2.1 posture 1) and
 * focuses one top-level piece at a time (posture 2). Both need the same thing:
 * where each top-level sub-block of `<state>` begins and ends, in LINES of the
 * captured payload, so a slice can be taken without reformatting a single byte.
 *
 * This is deliberately NOT an XML parser. The payload is not well-formed XML —
 * the board digest contains bare `<`, `>`, quotes and arrows, and its
 * indentation is load-bearing containment. So the outline is line-shaped: a
 * top-level sub-block is a line that is nothing but an opening tag, closed by a
 * later line that is nothing but its matching closing tag. Anything else is
 * content. That rule is what the kernel's renderer actually emits, and it can
 * never mistake a board row for structure.
 *
 * Parse failure is a first-class outcome: `null` means "no offsets", and the
 * caller must degrade to zones plus the raw figure with no focus targets.
 */

import { looksLikeStateBlock } from "./state-block";

export interface StateSubBlock {
	/** Tag name, e.g. "board". */
	tag: string;
	/** 1-based inclusive line of the opening tag. */
	startLine: number;
	/** 1-based inclusive line of the closing tag (== startLine when inline). */
	endLine: number;
	/** Attributes read off the opening tag, e.g. { attached: "3", taken: "5" }. */
	attributes: Readonly<Record<string, string>>;
	/** The payload's own bytes for [startLine, endLine], joined by "\n". */
	source: string;
}

export interface StateOutline {
	/** 1-based line of the `<state …>` opening tag. */
	rootLine: number;
	/** Attributes on `<state …>`, e.g. { v: "15", turn: "5" }. */
	rootAttributes: Readonly<Record<string, string>>;
	/** Total lines in the captured payload. */
	totalLines: number;
	/** Total characters in the captured payload. */
	totalChars: number;
	/** Top-level children of `<state>`, in payload order. */
	blocks: readonly StateSubBlock[];
}

const ROOT_OPEN = /^\s*<state\b[^<>]*>\s*$/;
const OPEN_LINE = /^\s*<([A-Za-z][\w:.-]*)((?:\s[^<>]*)?)>\s*$/;
const SELF_CLOSING_LINE = /^\s*<([A-Za-z][\w:.-]*)((?:\s[^<>]*)?)\/>\s*$/;
const INLINE_LINE = /^\s*<([A-Za-z][\w:.-]*)((?:\s[^<>]*)?)>.*<\/\1>\s*$/;
const ATTR = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"|([A-Za-z_:][\w:.-]*)\s*=\s*'([^']*)'/g;

function closingLine(tag: string): RegExp {
	return new RegExp(`^\\s*</${tag}>\\s*$`);
}

function attributesOf(raw: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	ATTR.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = ATTR.exec(raw)) !== null) {
		const key = match[1] ?? match[3];
		const value = match[2] ?? match[4];
		if (key !== undefined && value !== undefined) attributes[key] = value;
	}
	return attributes;
}

/** The payload's own bytes for the 1-based inclusive line range. */
export function sliceLines(
	text: string,
	startLine: number,
	endLine: number,
): string {
	return text.split("\n").slice(startLine - 1, endLine).join("\n");
}

/**
 * Index the top-level sub-blocks of a rendered state payload.
 *
 * Returns null when the text is not a state render, when `<state …>` does not
 * stand on a line of its own, or when it has no top-level sub-blocks — every
 * case in which the viewer has no trustworthy offsets and must fall back to the
 * undivided figure.
 */
export function parseStateOutline(text: string): StateOutline | null {
	if (!looksLikeStateBlock(text)) return null;

	const lines = text.split("\n");
	const rootIndex = lines.findIndex((line) => ROOT_OPEN.test(line));
	if (rootIndex < 0) return null;

	const rootClose = closingLine("state");
	const blocks: StateSubBlock[] = [];
	let index = rootIndex + 1;

	while (index < lines.length) {
		const line = lines[index]!;
		if (rootClose.test(line)) break;

		const inline = INLINE_LINE.exec(line) ?? SELF_CLOSING_LINE.exec(line);
		if (inline) {
			blocks.push({
				tag: inline[1]!,
				startLine: index + 1,
				endLine: index + 1,
				attributes: attributesOf(inline[2] ?? ""),
				source: line,
			});
			index += 1;
			continue;
		}

		const open = OPEN_LINE.exec(line);
		if (open) {
			const tag = open[1]!;
			const close = closingLine(tag);
			const reopen = new RegExp(`^\\s*<${tag}(?:\\s[^<>]*)?>\\s*$`);
			let depth = 1;
			let cursor = index + 1;
			let endIndex = -1;
			while (cursor < lines.length) {
				const candidate = lines[cursor]!;
				if (close.test(candidate)) {
					depth -= 1;
					if (depth === 0) {
						endIndex = cursor;
						break;
					}
				} else if (reopen.test(candidate)) {
					depth += 1;
				}
				cursor += 1;
			}
			if (endIndex >= 0) {
				blocks.push({
					tag,
					startLine: index + 1,
					endLine: endIndex + 1,
					attributes: attributesOf(open[2] ?? ""),
					source: lines.slice(index, endIndex + 1).join("\n"),
				});
				index = endIndex + 1;
				continue;
			}
		}

		index += 1;
	}

	if (blocks.length === 0) return null;

	const rootOpen = OPEN_LINE.exec(lines[rootIndex]!);
	return {
		rootLine: rootIndex + 1,
		rootAttributes: attributesOf(rootOpen?.[2] ?? ""),
		totalLines: lines.length,
		totalChars: text.length,
		blocks,
	};
}
