/**
 * prompt-edit-session/render — server-side renders for the agent's eyes.
 *
 * Two surfaces:
 *
 * 1. `renderPromptWithNodeIds` — the target prompt rendered with node ids.
 *    ANNOTATED RENDER FORMAT (documented contract, tests pin it):
 *    every block node is preceded by a marker line `<!-- #<nodeId> -->` at the
 *    block's indentation; the block body follows in a compact xml-markdown
 *    dialect (sections/examples/context as XML tags, paragraphs as text with
 *    `{{var}}` inline tokens, lists as `-` / `n.`, fields as `label: value`,
 *    code fenced). List items are NOT marked — ops address block nodes only.
 *    This is a simpler stand-in for the lab's rendered-line-model stamping
 *    (src/ui/view/rendered-line-model.ts) and is good enough for id-relative
 *    ops; it is not byte-identical to `renderXmlMarkdown`.
 *
 * 2. `formatPromptEditRequestsBlock` — the canvas `<requests>` block ported to
 *    prompt targets: one thread per entry, session-stable aliases, disposed
 *    entries render their closing note, agent questions flagged
 *    `waiting-on-human`. Re-rendered from the live queue every time it is
 *    asked for, so mid-session `add_note` entries appear immediately.
 */
import type {
	ListItemNode,
	PromptBlockNode,
	PromptDocument,
	PromptInline,
} from "@codecaine-ai/prompt-kit";
import { inlineToEditableText } from "@codecaine-ai/prompt-kit/ui";

import type {
	PromptEditRequestEntry,
	PromptEditTarget,
} from "./types";

const INDENT = "  ";

// ---------------------------------------------------------------------------
// Annotated prompt render
// ---------------------------------------------------------------------------

export function renderPromptWithNodeIds(doc: PromptDocument): string {
	const lines: string[] = [];
	renderBlocks(doc.nodes, 0, lines);
	return lines.join("\n");
}

function renderBlocks(
	nodes: readonly PromptBlockNode[],
	depth: number,
	lines: string[],
): void {
	for (const node of nodes) {
		renderBlock(node, depth, lines);
	}
}

function marker(node: PromptBlockNode, depth: number, lines: string[]): void {
	if (node.id) lines.push(`${INDENT.repeat(depth)}<!-- #${node.id} -->`);
}

function text(depth: number, body: string, lines: string[]): void {
	for (const line of body.split("\n")) {
		lines.push(`${INDENT.repeat(depth)}${line}`);
	}
}

function inline(content: readonly PromptInline[]): string {
	return inlineToEditableText(content);
}

function attrsText(
	attrs: Record<string, string | number | boolean | null | undefined> | undefined,
): string {
	if (!attrs) return "";
	const parts = Object.entries(attrs)
		.filter(([, value]) => value !== undefined && value !== null)
		.map(([key, value]) => `${key}=${JSON.stringify(String(value))}`);
	return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function renderBlock(
	node: PromptBlockNode,
	depth: number,
	lines: string[],
): void {
	switch (node.type) {
		case "section": {
			marker(node, depth, lines);
			text(depth, `<${node.tag}${attrsText(node.attrs)}>`, lines);
			renderBlocks(node.children, depth + 1, lines);
			text(depth, `</${node.tag}>`, lines);
			return;
		}
		case "paragraph": {
			marker(node, depth, lines);
			text(depth, inline(node.content), lines);
			return;
		}
		case "bulletList": {
			marker(node, depth, lines);
			renderListItems(node.items, depth, lines, () => "-");
			return;
		}
		case "orderedList": {
			marker(node, depth, lines);
			const start = node.start ?? 1;
			renderListItems(node.items, depth, lines, (index) => `${start + index}.`);
			return;
		}
		case "field": {
			marker(node, depth, lines);
			text(depth, `${node.label}: ${inline(node.value)}`, lines);
			if (node.children && node.children.length > 0) {
				renderBlocks(node.children, depth + 1, lines);
			}
			return;
		}
		case "codeBlock": {
			marker(node, depth, lines);
			text(depth, `\`\`\`${node.language ?? ""}`, lines);
			text(depth, node.code, lines);
			text(depth, "```", lines);
			return;
		}
		case "example": {
			marker(node, depth, lines);
			const title = node.title ? ` title=${JSON.stringify(node.title)}` : "";
			text(depth, `<example${title}>`, lines);
			renderBlocks(node.children, depth + 1, lines);
			text(depth, "</example>", lines);
			return;
		}
		case "raw": {
			marker(node, depth, lines);
			text(depth, node.value, lines);
			return;
		}
		case "contextUsage": {
			marker(node, depth, lines);
			const tag = node.tag ?? "context";
			text(depth, `<${tag} contextId=${JSON.stringify(node.contextId)}>`, lines);
			renderBlocks(node.instructions, depth + 1, lines);
			text(depth, `</${tag}>`, lines);
			return;
		}
	}
}

function renderListItems(
	items: readonly ListItemNode[],
	depth: number,
	lines: string[],
	bullet: (index: number) => string,
): void {
	items.forEach((item, index) => {
		text(depth, `${bullet(index)} ${inline(item.content)}`, lines);
		if (item.children && item.children.length > 0) {
			renderBlocks(item.children, depth + 1, lines);
		}
	});
}

// ---------------------------------------------------------------------------
// Requests block
// ---------------------------------------------------------------------------

export const PROMPT_EDIT_REQUESTS_EMPTY =
	"(none — no annotation requests on this prompt)";

export function promptEditTargetText(target: PromptEditTarget): string {
	switch (target.kind) {
		case "doc":
			return "doc";
		case "node":
			return `node:${target.nodeId}`;
		case "range":
			return `range:${target.nodeId}[${target.start}..${target.end}]`;
	}
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

/**
 * One compact queue line. Open and proposal-staged entries carry target,
 * opening author, and body; disposed entries carry the disposition note.
 */
export function formatPromptEditRequestLine(
	entry: PromptEditRequestEntry,
): string {
	if (entry.status === "done" || entry.status === "declined") {
		return `${entry.alias} ${entry.status} ${JSON.stringify(oneLine(entry.note ?? ""))}`;
	}
	const status =
		entry.status === "proposal-ready" ? "proposal-staged" : "open";
	const waiting = entry.waitingOnHuman ? " · waiting-on-human" : "";
	return (
		`${entry.alias} ${status}${waiting}  ${promptEditTargetText(entry.target)}` +
		`  ${entry.author} — ${JSON.stringify(oneLine(entry.body))}`
	);
}

/** The entry rendered as its thread: queue line, then one line per reply,
 * oldest first. A disposed entry renders alone — its line carries the note. */
export function formatPromptEditRequestThread(
	entry: PromptEditRequestEntry,
): string[] {
	if (entry.status === "done" || entry.status === "declined") {
		return [formatPromptEditRequestLine(entry)];
	}
	return [
		formatPromptEditRequestLine(entry),
		...entry.replies.map(
			(reply) => `    > ${reply.author} — ${JSON.stringify(oneLine(reply.body))}`,
		),
	];
}

/** The REQUESTS block for tool results and the re-rendered prompt section:
 * disposal tally plus the queue threads. */
export function formatPromptEditRequestsBlock(
	entries: readonly PromptEditRequestEntry[],
): string {
	if (entries.length === 0) return `REQUESTS · none\n${PROMPT_EDIT_REQUESTS_EMPTY}`;
	const disposed = entries.filter(
		(entry) => entry.status === "done" || entry.status === "declined",
	).length;
	return [
		`REQUESTS · ${disposed}/${entries.length} disposed`,
		...entries.flatMap((entry) =>
			formatPromptEditRequestThread(entry).map((line) => `  ${line}`),
		),
	].join("\n");
}
