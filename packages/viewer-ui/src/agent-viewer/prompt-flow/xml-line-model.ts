import type {
	CodeBlockNode,
	ContextUsageNode,
	ExampleNode,
	FieldNode,
	PromptBlockNode,
	PromptDocument,
	PromptListNode,
	RawNode,
	SectionNode,
} from "@codecaine-ai/prompt-kit";
import {
	createRenderContext,
	escapeXmlAttribute,
	escapeXmlText,
	indent,
	renderInline,
	renderXmlMarkdown,
	type XmlMarkdownRenderContext,
} from "@codecaine-ai/prompt-kit";

/**
 * The Agent XML editing surface renders the *same* text the read-only Raw view
 * renders, but as an editable, per-line model. To guarantee the editor's line
 * numbers track Raw's line-for-line, this module mirrors the prompt-kit XML
 * renderer (renderNode / renderNodes in prompt-kit) exactly — same indentation,
 * same `\n\n` separator between sibling blocks, same `\n` framing around section
 * bodies — but instead of a flat string it emits one `XmlLine` per rendered
 * line, tagged with the owning node so hover/selection/drag/inline-edit layers
 * can attach.
 *
 * INVARIANT (verified by xml-line-model.test.ts): joining every line's `text`
 * with "\n" equals `renderXmlMarkdown(prompt)`. If prompt-kit's renderer changes
 * its layout, that test fails and this mirror must be updated in lockstep.
 */

export type XmlLineRole =
	/** Blank separator line the renderer emits between sibling blocks. */
	| "gap"
	/** Opening tag of a container (section / example / contextUsage). */
	| "open"
	/** Closing tag of a container. */
	| "close"
	/** A single editable line of leaf content (paragraph, field, raw, code). */
	| "content"
	/** Code fence line (``` open/close). */
	| "fence"
	/** A list item line. */
	| "item";

export interface XmlLine {
	/** Rendered text for this line (exactly what Raw shows on the same row). */
	text: string;
	/** Owning block node. */
	node: PromptBlockNode;
	/** Node id (blocks always carry ids in the editor model). */
	nodeId: string;
	/** Nesting depth, matching PromptEditorTreeEntry.depth (top level = 0). */
	depth: number;
	role: XmlLineRole;
	/**
	 * Whether clicking the line's text region should open an inline text editor
	 * for this node. Only the primary content line of leaf nodes is editable
	 * inline; tags/fences/gaps are structural.
	 */
	editable: boolean;
	/** For list nodes: which item this line renders (0-based). */
	itemIndex?: number;
	/** For multi-line leaf content (raw / code): line offset within the node. */
	contentLineIndex?: number;
}

interface Cursor {
	depth: number;
	ctx: XmlMarkdownRenderContext;
	lines: XmlLine[];
}

export interface XmlLineModel {
	lines: XmlLine[];
	/** The whole-document render, identical to Raw's source string. */
	rendered: string;
}

export function buildXmlLineModel(
	prompt: PromptDocument,
	options: { variables?: Record<string, unknown> } = {},
): XmlLineModel {
	const ctx = createRenderContext({ variables: options.variables });
	const cursor: Cursor = { depth: 0, ctx, lines: [] };
	emitNodes(prompt.nodes, 0, cursor);
	return {
		lines: cursor.lines,
		rendered: renderXmlMarkdown(prompt, { variables: options.variables }),
	};
}

/**
 * Mirror of prompt-kit `renderNodes`: render each non-empty block and join with
 * a blank line. We insert an explicit `gap` line between rendered siblings so
 * cumulative line numbers include the blank rows Raw shows.
 */
function emitNodes(
	nodes: readonly PromptBlockNode[],
	level: number,
	cursor: Cursor,
): void {
	let first = true;
	for (const node of nodes) {
		const before = cursor.lines.length;
		emitNode(node, level, cursor);
		const produced = cursor.lines.length > before;
		if (!produced) continue; // renderNodes filters empty renders
		if (!first) {
			// The blank separator belongs *before* this block's first line.
			insertGapBefore(cursor, before, node, level);
		}
		first = false;
	}
}

function insertGapBefore(
	cursor: Cursor,
	index: number,
	node: PromptBlockNode,
	level: number,
): void {
	const gap: XmlLine = {
		text: "",
		node,
		nodeId: requireId(node),
		depth: level,
		role: "gap",
		editable: false,
	};
	cursor.lines.splice(index, 0, gap);
}

function emitNode(
	node: PromptBlockNode,
	level: number,
	cursor: Cursor,
): void {
	switch (node.type) {
		case "section":
			emitSection(node, node.tag, node.attrs, node.children, level, cursor);
			return;
		case "example":
			emitExample(node, level, cursor);
			return;
		case "contextUsage":
			emitContextUsage(node, level, cursor);
			return;
		case "paragraph":
			pushLine(cursor, {
				text: `${indent(level, cursor.ctx.indentText)}${renderInline(node.content, cursor.ctx)}`,
				node,
				depth: level,
				role: "content",
				editable: true,
			});
			return;
		case "bulletList":
		case "orderedList":
			emitList(node, level, cursor);
			return;
		case "field":
			emitField(node, level, cursor);
			return;
		case "codeBlock":
			emitCodeBlock(node, level, cursor);
			return;
		case "raw":
			emitRaw(node, level, cursor);
			return;
	}
}

function emitSection(
	node: SectionNode | ExampleNode | ContextUsageNode,
	tag: string,
	attrs: SectionNode["attrs"] | undefined,
	children: readonly PromptBlockNode[],
	level: number,
	cursor: Cursor,
): void {
	const pad = indent(level, cursor.ctx.indentText);
	pushLine(cursor, {
		text: `${pad}${renderOpenTag(tag, attrs)}`,
		node,
		depth: level,
		role: "open",
		editable: false,
	});
	emitNodes(children, level + 1, cursor);
	pushLine(cursor, {
		text: `${pad}</${tag}>`,
		node,
		depth: level,
		role: "close",
		editable: false,
	});
}

function emitExample(node: ExampleNode, level: number, cursor: Cursor): void {
	const attrs = node.title ? { title: node.title } : undefined;
	emitSection(node, "example", attrs, node.children, level, cursor);
}

function emitContextUsage(
	node: ContextUsageNode,
	level: number,
	cursor: Cursor,
): void {
	emitSection(
		node,
		node.tag ?? "context_usage",
		{ context_id: node.contextId },
		node.instructions,
		level,
		cursor,
	);
}

/**
 * Mirror of `renderList` + `renderListItem`: items joined by "\n" (no blank
 * separator). Item children render at level+1 as a nested block group joined by
 * "\n" to the item line — but since the prompt-flow editor does not currently
 * surface list-item children inline, we render them faithfully as content lines
 * so the whole-doc string still matches.
 */
function emitList(node: PromptListNode, level: number, cursor: Cursor): void {
	const start = node.type === "orderedList" ? (node.start ?? 1) : 0;
	const pad = indent(level, cursor.ctx.indentText);
	node.items.forEach((item, index) => {
		const marker = node.type === "orderedList" ? `${start + index}.` : "-";
		const text = `${pad}${marker} ${renderInline(item.content, cursor.ctx)}`.trimEnd();
		pushLine(cursor, {
			text,
			node,
			depth: level,
			role: "item",
			editable: true,
			itemIndex: index,
		});
		const children = item.children ?? [];
		if (children.length > 0) {
			// renderListItem joins the item line to its children with a single
			// "\n" (no blank line). emitNodes only inserts gaps *between*
			// siblings, so the first child abuts the item line as required.
			emitNodes(children, level + 1, cursor);
		}
	});
}

function emitField(node: FieldNode, level: number, cursor: Cursor): void {
	const pad = indent(level, cursor.ctx.indentText);
	const value = renderInline(node.value, cursor.ctx);
	const line = `${pad}${escapeXmlText(node.label)}: ${value}`.trimEnd();
	pushLine(cursor, {
		text: line,
		node,
		depth: level,
		role: "content",
		editable: true,
	});
	const children = node.children ?? [];
	if (children.length > 0) emitNodes(children, level + 1, cursor);
}

function emitCodeBlock(node: CodeBlockNode, level: number, cursor: Cursor): void {
	const pad = indent(level, cursor.ctx.indentText);
	pushLine(cursor, {
		text: `${pad}\`\`\`${node.language ?? ""}`,
		node,
		depth: level,
		role: "fence",
		editable: false,
	});
	const codeLines = node.code.split("\n");
	codeLines.forEach((raw, index) => {
		pushLine(cursor, {
			// indentMultiline leaves empty lines empty; non-empty get the pad.
			text: raw.length > 0 ? `${pad}${raw}` : raw,
			node,
			depth: level,
			role: "content",
			editable: true,
			contentLineIndex: index,
		});
	});
	pushLine(cursor, {
		text: `${pad}\`\`\``,
		node,
		depth: level,
		role: "fence",
		editable: false,
	});
}

function emitRaw(node: RawNode, level: number, cursor: Cursor): void {
	const pad = indent(level, cursor.ctx.indentText);
	const rawLines = node.value.split("\n");
	rawLines.forEach((raw, index) => {
		pushLine(cursor, {
			text: raw.length > 0 ? `${pad}${raw}` : raw,
			node,
			depth: level,
			role: "content",
			editable: true,
			contentLineIndex: index,
		});
	});
}

function renderOpenTag(
	tag: string,
	attrs?: SectionNode["attrs"],
): string {
	const renderedAttrs = Object.entries(attrs ?? {})
		.filter((entry): entry is [string, string | number | boolean] => {
			const value = entry[1];
			return value !== null && value !== undefined;
		})
		.map(([key, value]) => `${key}="${escapeXmlAttribute(String(value))}"`);
	if (renderedAttrs.length === 0) return `<${tag}>`;
	return `<${tag} ${renderedAttrs.join(" ")}>`;
}

function pushLine(
	cursor: Cursor,
	line: Omit<XmlLine, "nodeId">,
): void {
	cursor.lines.push({ ...line, nodeId: requireId(line.node) });
}

function requireId(node: PromptBlockNode): string {
	// The editor model runs ensurePromptNodeIds before building the tree, so
	// every block has an id by the time this surface renders.
	return node.id ?? "";
}
