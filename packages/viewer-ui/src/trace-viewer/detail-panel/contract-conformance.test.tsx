import { describe, expect, test } from "bun:test";
import {
	readdirSync,
	readFileSync,
	type Dirent,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import type {
	TraceSpan,
	TraceSpanAttribute,
} from "@evilmartians/agent-prism-types";

import { SpanDetailPanel } from "../SpanDetailPanel";
import { BLOCK_SLOT_ORDER, type BlockSlot } from "./contract";
import { DetailShell, DetailShellFrame } from "./DetailShell";
import { DetailsView } from "./DetailsView";
import {
	rendererRegistry,
	resolveRenderer,
} from "./rendererRegistry";
import { FactCard } from "./renderers/FactCard";
import { buildSnapshotContextView } from "./renderers/TurnBody";
import { realTurnContext } from "./renderers/__fixtures__/real-turn-context";
import { canvasTurnContext } from "./renderers/__fixtures__/turn-snapshots";
import type { SanitizedContentBlock } from "./renderers/request-snapshot-api";
import { ContentBlock } from "./renderers/snapshot-message-view";
import { parseSectionTags } from "./renderers/turn-sections";

/**
 * The 471-character board-digest line measured during the live review. Keeping
 * the literal here makes the regression contract about the actual bytes rather
 * than an arbitrary repeated-character stress case.
 */
const REAL_STATE_LINE_471 =
	"A system diagram showing how interview inputs drive an AI-led question loop. The agent asks and adapts questions, records interview context in the **Memory Bank**, evaluates whether responses satisfy the research objective, and routes outcomes either toward the next question or a probing response. Within the Memory Bank, actions create, update, delete, or preserve memory, while **Retrieval: per-question recall** shows how stored context is recalled for each question.";

/** Section ③ of the real capture: the kernel's marker, byte for byte. */
const REAL_ELISION_MARKER = "[turns 1–10 elided]";

/**
 * Section ④ of the real capture: the one tool the run offered, in the
 * canonical 2-space JSON form the json-document carve-out produces.
 */
const REAL_PROBE_BODY = [
	"{",
	'  "name": "probe",',
	'  "description": "Echo a note back verbatim. Deterministic, no side effects.",',
	'  "parameters": {',
	'    "type": "object",',
	'    "required": [',
	'      "note"',
	"    ],",
	'    "properties": {',
	'      "note": {',
	'        "type": "string"',
	"      }",
	"    }",
	"  }",
	"}",
].join("\n");

const REAL_UPDATE_STICKY_INPUT = JSON.stringify({
	raw: {
		stickyId: "sticky-memory-bank",
		patch: {
			geometry: {
				x: 3968,
				y: 864,
				width: 544,
				height: 336,
			},
		},
		view: "section-memory-bank",
	},
});

const REAL_UPDATE_STICKY_RESULT =
	"APPLIED · update_sticky sticky-memory-bank";
const WRAP_UTILITY = ["whitespace", "pre-wrap"].join("-");

function stringAttr(key: string, value: string): TraceSpanAttribute {
	return { key, value: { stringValue: value } };
}

function intAttr(key: string, value: number): TraceSpanAttribute {
	return { key, value: { intValue: String(value) } };
}

function baseSpan(
	eventType: string,
	overrides: Partial<TraceSpan> = {},
): TraceSpan {
	return {
		id: `conformance:${eventType}`,
		title: `${eventType} representative`,
		startTime: new Date("2026-07-27T12:00:00.000Z"),
		endTime: new Date("2026-07-27T12:00:00.025Z"),
		duration: 25,
		type: "event",
		raw: "{}",
		status: "success",
		attributes: [stringAttr("event_type", eventType)],
		...overrides,
	};
}

function representativeSpan(eventType: string): TraceSpan {
	switch (eventType) {
		case "system_prompt_resolved":
			return baseSpan(eventType, {
				output: "You are a careful layout editor.\nKeep the board legible.",
				attributes: [
					stringAttr("event_type", eventType),
					stringAttr("agent_name", "layout-editor"),
				],
			});
		case "tool_call_start":
		case "tool_call_end":
			return baseSpan(eventType, {
				input: '{"raw":{"stickyId":"sticky-memory-bank","view":"board"}}',
				output: eventType === "tool_call_end" ? "applied" : undefined,
				attributes: [
					stringAttr("event_type", eventType),
					stringAttr("tool_name", "update_sticky"),
					intAttr("turn_number", 1),
				],
			});
		case "user_message":
			return baseSpan(eventType, {
				input: "Please align the selected cards.",
				attributes: [
					stringAttr("event_type", eventType),
					stringAttr("phase", "kickoff"),
				],
			});
		case "assistant_message":
			return baseSpan(eventType, {
				output: "I aligned the selected cards.",
				attributes: [
					stringAttr("event_type", eventType),
					stringAttr("block_type", "text"),
					intAttr("input_tokens", 1_024),
					intAttr("output_tokens", 256),
					stringAttr("model", "conformance-model"),
					stringAttr("stop_reason", "end_turn"),
				],
			});
		case "context_build_started":
		case "context_build_completed":
			return baseSpan(eventType, {
				input: JSON.stringify([
					{ kind: "capabilities", ref: "capabilities" },
				]),
				output: "<context><capabilities>ready</capabilities></context>",
				attributes: [
					stringAttr("event_type", eventType),
					intAttr("inputs_count", 1),
					intAttr("total_bytes", 11_635),
					stringAttr(
						"resolved_inputs",
						JSON.stringify([
							{
								loader_kind: "capabilities",
								input_ref: "capabilities",
								status: "ok",
								bytes: 11_635,
							},
						]),
					),
				],
			});
		case "warning":
		case "error":
			return baseSpan(eventType, {
				status: eventType === "error" ? "error" : "warning",
				attributes: [
					stringAttr("event_type", eventType),
					stringAttr("warning_type", "Verification warning"),
					stringAttr(
						"message",
						"Verification needs attention\nChecks: layout=fail, contrast=pass",
					),
				],
			});
		case "pi_request_snapshot":
			return baseSpan(eventType, {
				input: JSON.stringify([
					{
						index: 0,
						role: "system",
						text_chars: 120,
						image_count: 0,
						tool_call_count: 0,
					},
					{
						index: 1,
						role: "user",
						text_chars: 42,
						image_count: 1,
						tool_call_count: 0,
					},
				]),
				attributes: [
					stringAttr("event_type", eventType),
					stringAttr("run_id", "run-offline"),
					intAttr("turn_number", 1),
					intAttr("message_count", 2),
					intAttr("total_image_count", 1),
				],
			});
		default:
			// Usage aggregates intentionally exercise their no-usageContext path,
			// which must conform as the empty-body FactCard standard.
			return baseSpan(eventType, {
				attributes: [
					stringAttr("event_type", eventType),
					stringAttr("agent_name", "layout-editor"),
				],
			});
	}
}

function decodeText(value: string): string {
	return value
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&amp;/g, "&")
		.trim();
}

interface DirectChild {
	tag: string;
	openingTag: string;
}

interface ElementSlice extends DirectChild {
	innerMarkup: string;
	fullMarkup: string;
}

const VOID_ELEMENTS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

function sliceElement(
	markup: string,
	start: number,
	openingTag: string,
	tag: string,
): ElementSlice {
	const innerStart = start + openingTag.length;
	if (openingTag.endsWith("/>") || VOID_ELEMENTS.has(tag)) {
		return { tag, openingTag, innerMarkup: "", fullMarkup: openingTag };
	}
	const tokens = /<!--[\s\S]*?-->|<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi;
	tokens.lastIndex = innerStart;
	let depth = 1;
	let token: RegExpExecArray | null;
	while ((token = tokens.exec(markup))) {
		if (token[0].startsWith("<!--")) continue;
		const nestedTag = (token[1] ?? "").toLowerCase();
		const closing = token[0].startsWith("</");
		if (closing) {
			depth -= 1;
			if (depth === 0) {
				return {
					tag,
					openingTag,
					innerMarkup: markup.slice(innerStart, token.index),
					fullMarkup: markup.slice(start, tokens.lastIndex),
				};
			}
			continue;
		}
		if (!token[0].endsWith("/>") && !VOID_ELEMENTS.has(nestedTag)) {
			depth += 1;
		}
	}
	throw new Error(`Closing tag was not found for ${openingTag}`);
}

function elementsWithAttribute(
	markup: string,
	name: string,
): ElementSlice[] {
	const matcher = new RegExp(
		`<([a-z][a-z0-9:-]*)\\b[^>]*\\b${name}(?:="[^"]*"|(?=\\s|>))[^>]*>`,
		"gi",
	);
	return [...markup.matchAll(matcher)].map((match) => {
		const openingTag = match[0];
		const tag = (match[1] ?? "").toLowerCase();
		return sliceElement(markup, match.index, openingTag, tag);
	});
}

/**
 * Read only an element's direct children. A small depth scanner is less
 * brittle here than a regex spanning nested figures, tables, and SVGs.
 */
function directElementChildren(element: ElementSlice): DirectChild[] {
	const children: DirectChild[] = [];
	const tokens = /<!--[\s\S]*?-->|<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi;
	let depth = 0;
	let token: RegExpExecArray | null;
	while ((token = tokens.exec(element.innerMarkup))) {
		if (token[0].startsWith("<!--")) continue;
		const tag = (token[1] ?? "").toLowerCase();
		const closing = token[0].startsWith("</");
		if (closing) {
			depth -= 1;
			continue;
		}
		if (depth === 0) {
			children.push({ tag, openingTag: token[0] });
		}
		if (!token[0].endsWith("/>") && !VOID_ELEMENTS.has(tag)) {
			depth += 1;
		}
	}
	return children;
}

/**
 * A tab body may be a flat block list or a zoned stream (the State tab's
 * resting posture, where State and Messages are subtabbed surfaces). Zones are
 * shell-owned surfaces, so they are transparent to the block vocabulary: they
 * hold the same standard sections, in the same slot order, and anything else
 * inside one is a conformance failure.
 */
function standardBlockChildren(container: ElementSlice): DirectChild[] {
	const stream = elementsWithAttribute(
		container.innerMarkup,
		"data-detail-stream",
	)[0];
	const root = stream ?? container;
	const zones = elementsWithAttribute(root.innerMarkup, "data-detail-zone");
	return directElementChildren(root).flatMap((child) => {
		if (attribute(child.openingTag, "data-detail-zone") === null) return [child];
		const zone = zones.find((slice) => slice.openingTag === child.openingTag);
		return zone ? directElementChildren(zone) : [];
	});
}

function attribute(openingTag: string, name: string): string | null {
	const match = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(openingTag);
	return match?.[1] ?? null;
}

function decodeMarkupText(value: string): string {
	return value
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&amp;/g, "&");
}

function detailBlock(markup: string, id: string): ElementSlice {
	const block = elementsWithAttribute(markup, "data-detail-block").find(
		(element) => attribute(element.openingTag, "data-detail-block") === id,
	);
	if (!block) throw new Error(`Detail block "${id}" was not rendered`);
	return block;
}

function unifiedDataFigures(markup: string): ElementSlice[] {
	return elementsWithAttribute(markup, "data-doc-figure").filter(
		(figure) => attribute(figure.openingTag, "data-doc-language") !== null,
	);
}

function renderedFigureSource(figure: ElementSlice): string {
	const lines = elementsWithAttribute(
		figure.fullMarkup,
		"data-doc-source-line",
	);
	if (lines.length === 0) {
		throw new Error("The unified data figure did not render source-line cells");
	}
	return lines.map((line) => decodeMarkupText(line.innerMarkup)).join("\n");
}

/**
 * Every string-backed block goes through DocFigure. Its source body count is
 * therefore one-for-one with data-doc-language figures, and the default gutter
 * contributes both source cells and non-selectable line-number cells.
 */
function assertUnifiedDataContract(markup: string): void {
	const figures = unifiedDataFigures(markup);
	const bodyCount = (markup.match(/\bdata-doc-body=""/g) ?? []).length;
	expect(figures).toHaveLength(bodyCount);

	for (const figure of figures) {
		expect(figure.openingTag).toContain('data-doc-figure=""');
		expect(figure.fullMarkup).toContain('data-doc-gutter=""');
		expect(figure.fullMarkup).toContain('data-doc-line-number=""');
		expect(figure.fullMarkup).toContain('data-doc-source-line=""');
		expect(figure.fullMarkup).toContain("prompt-editor-row");
		expect(figure.fullMarkup).not.toContain(WRAP_UTILITY);
	}

	// DocFigure's explicit non-source opt-out may use its own ExactSource <pre>.
	// No renderer, details view, or nested message implementation may introduce one.
	for (const pre of markup.match(/<pre\b[^>]*>/gi) ?? []) {
		expect(pre).toContain('data-doc-body=""');
	}
}

function assertDataBlock(markup: string, id: string): ElementSlice {
	const block = detailBlock(markup, id);
	const figures = unifiedDataFigures(block.fullMarkup);
	expect(figures.length).toBeGreaterThan(0);
	for (const figure of figures) {
		expect(figure.fullMarkup).toContain('data-doc-gutter=""');
	}
	return block;
}

function assertStandardBlocks(children: DirectChild[]): void {
	const slotIndexes: number[] = [];
	for (const child of children) {
		expect(child.tag).toBe("section");
		expect(attribute(child.openingTag, "data-detail-block")).not.toBeNull();
		const slot = attribute(child.openingTag, "data-detail-slot");
		expect(BLOCK_SLOT_ORDER).toContain(slot as BlockSlot);
		slotIndexes.push(BLOCK_SLOT_ORDER.indexOf(slot as BlockSlot));
	}
	expect(slotIndexes).toEqual([...slotIndexes].sort((a, b) => a - b));
}

const NON_EMPTY_BODY_FAILURE =
	"Every detail renderer must return a non-empty body with at least one standard block so dead ends are structurally impossible.";

function assertNonEmptyStandardBody(children: DirectChild[]): void {
	if (children.length === 0) {
		throw new Error(NON_EMPTY_BODY_FAILURE);
	}
	assertStandardBlocks(children);
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

function assertConforms(span: TraceSpan): void {
	const eventType =
		span.attributes?.find((entry) => entry.key === "event_type")?.value
			?.stringValue ?? span.type;
	const markup = renderToStaticMarkup(<SpanDetailPanel span={span} />);
	const detailsMarkup = renderToStaticMarkup(<DetailsView span={span} />);

	const header = elementsWithAttribute(markup, "data-detail-header")[0];
	expect(header).toBeDefined();
	expect(header?.fullMarkup).toContain("data-detail-glyph");
	expect(header?.fullMarkup).toContain(span.title);
	expect(header?.fullMarkup).not.toContain("data-detail-type");
	expect(header?.fullMarkup).not.toContain(`>${formatDuration(span.duration)}<`);

	const headerButtons = /<button\b[^>]*>[\s\S]*?<\/button>/gi;
	const detailsControl = [...(header?.fullMarkup ?? "").matchAll(headerButtons)]
		.map((match) => ({
			openingTag: /^<button\b[^>]*>/i.exec(match[0])?.[0] ?? "",
			name:
				attribute(/^<button\b[^>]*>/i.exec(match[0])?.[0] ?? "", "aria-label") ??
				decodeText(match[0]),
		}))
		.find((button) => button.name.toLowerCase().includes("details"));
	expect(detailsControl).toBeDefined();
	expect(attribute(detailsControl?.openingTag ?? "", "type")).toBe("button");
	expect(attribute(detailsControl?.openingTag ?? "", "aria-expanded")).toBe(
		"false",
	);
	expect(attribute(detailsControl?.openingTag ?? "", "aria-controls")).not.toBeNull();
	expect(markup).not.toContain("data-detail-summary");
	expect(markup).toContain('data-detail-details-open="false"');

	const body = elementsWithAttribute(markup, "data-detail-body")[0];
	expect(body).toBeDefined();
	expect(body?.fullMarkup).not.toContain("data-details-drawer");
	expect(body?.fullMarkup).not.toContain("data-details-view");
	expect(body?.fullMarkup).not.toContain("data-details-section");
	const activeTab = attribute(body?.openingTag ?? "", "data-detail-active-tab");
	const bodyChildren = directElementChildren(body!);

	if (activeTab === null) {
		assertNonEmptyStandardBody(bodyChildren);
		expect(body?.fullMarkup).not.toContain('role="tablist"');
		expect(body?.fullMarkup).not.toContain('role="tabpanel"');
	} else {
		const tabList = bodyChildren[0];
		expect(attribute(tabList?.openingTag ?? "", "role")).toBe("tablist");
		const tabListSlice = elementsWithAttribute(
			body?.innerMarkup ?? "",
			"role",
		).find((element) => attribute(element.openingTag, "role") === "tablist");
		expect(tabListSlice).toBeDefined();

		const tabButtons = [
			...(tabListSlice?.fullMarkup ?? "").matchAll(
				/<button\b(?=[^>]*\brole="tab")[^>]*>([\s\S]*?)<\/button>/gi,
			),
		];
		const panels = elementsWithAttribute(
			body?.innerMarkup ?? "",
			"data-detail-tab",
		);
		expect(tabButtons).toHaveLength(panels.length);
		expect(panels.length).toBeGreaterThan(0);

		const tabIds = panels.map((panel) =>
			attribute(panel.openingTag, "data-detail-tab"),
		);
		const tabNames = tabButtons.map((button) => decodeText(button[1] ?? ""));
		expect(activeTab).toBe(tabIds[0] ?? "");

		for (const [index, panel] of panels.entries()) {
			expect(attribute(panel.openingTag, "role")).toBe("tabpanel");
			expect(attribute(tabButtons[index]?.[0] ?? "", "aria-selected")).toBe(
				index === 0 ? "true" : "false",
			);
			expect(attribute(tabButtons[index]?.[0] ?? "", "aria-controls")).toBe(
				attribute(panel.openingTag, "id"),
			);
			const panelChildren = standardBlockChildren(panel);
			if (index === 0) {
				assertNonEmptyStandardBody(panelChildren);
			} else {
				assertStandardBlocks(panelChildren);
			}
		}

		if (eventType === "pi_request_snapshot") {
			expect(tabIds).toEqual(["state", "context", "system", "tools"]);
			expect(tabNames).toEqual([
				"State",
				"Context",
				"System prompt",
				"Tools",
			]);
			expect(activeTab).toBe("state");
		}
	}

	// The normal body is header → body only; no retired bottom disclosure or
	// force-mounted details content may remain in its SSR output.
	expect(markup).not.toContain("data-details-drawer");
	expect(markup).not.toContain("data-details-view");
	assertUnifiedDataContract(markup);

	// The shell-owned takeover can be rendered directly for complete SSR
	// conformance without simulating a client click.
	expect(detailsMarkup).toContain("data-details-view");
	expect(detailsMarkup).not.toContain("data-details-drawer");
	const timing = elementsWithAttribute(detailsMarkup, "data-details-section").find(
		(section) => attribute(section.openingTag, "data-details-section") === "timing",
	);
	const identity = elementsWithAttribute(
		detailsMarkup,
		"data-details-section",
	).find(
		(section) =>
			attribute(section.openingTag, "data-details-section") === "identity",
	);
	const raw = elementsWithAttribute(detailsMarkup, "data-details-section").find(
		(section) => attribute(section.openingTag, "data-details-section") === "raw",
	);
	expect(timing).toBeDefined();
	expect(timing?.fullMarkup).toContain(">Start<");
	expect(timing?.fullMarkup).toContain(">End<");
	expect(timing?.fullMarkup).toContain(">Duration<");
	expect(timing?.fullMarkup).toContain(`>${formatDuration(span.duration)}<`);
	expect(timing?.fullMarkup).toContain(">Type<");
	expect(timing?.fullMarkup).toContain(span.type);
	expect(timing?.fullMarkup).toContain(">Status<");
	expect(timing?.fullMarkup).toContain(span.status);

	expect(identity).toBeDefined();
	const identityText = decodeMarkupText(identity?.fullMarkup ?? "");
	expect(identity?.fullMarkup).toContain(">Span ID<");
	expect(identityText).toContain(span.id);
	expect(identity?.fullMarkup).toContain(">event_type<");
	expect(identityText).toContain(eventType);
	for (const entry of span.attributes ?? []) {
		const value =
			entry.value?.stringValue ??
			entry.value?.intValue ??
			(typeof entry.value?.boolValue === "boolean"
				? String(entry.value.boolValue)
				: "—");
		expect(identity?.fullMarkup).toContain(`>${entry.key}<`);
		expect(identityText).toContain(value);
		expect(identity?.fullMarkup).toContain(`aria-label="Copy ${entry.key}"`);
	}

	const carriesUsage = (span.attributes ?? []).some((entry) =>
		[
			"input_tokens",
			"output_tokens",
			"cache_read_tokens",
			"cache_write_tokens",
			"cost_estimate",
			"model",
			"stop_reason",
		].includes(entry.key),
	);
	const usage = elementsWithAttribute(detailsMarkup, "data-details-section").find(
		(section) => attribute(section.openingTag, "data-details-section") === "usage",
	);
	if (carriesUsage) expect(usage).toBeDefined();
	else expect(usage).toBeUndefined();

	expect(raw).toBeDefined();
	expect(unifiedDataFigures(raw?.fullMarkup ?? "")).toHaveLength(1);
	expect(raw?.fullMarkup).toContain('data-doc-gutter=""');
	assertUnifiedDataContract(detailsMarkup);
}

const REQUIRED_DATA_BLOCKS: Partial<Record<string, readonly string[]>> = {
	system_prompt_resolved: ["system-prompt"],
	tool_call_start: ["tool:call", "tool:outcome"],
	tool_call_end: ["tool:call", "tool:result"],
	context_build_started: [
		"context:declared-inputs",
		"context:loaded-inputs",
		"context:rendered",
	],
	context_build_completed: [
		"context:declared-inputs",
		"context:loaded-inputs",
		"context:rendered",
	],
	// The representative span is the offline case and carries no
	// tools_blob_hash, so the Tools tab must say "never captured" rather than
	// imply an empty toolbox or an unreadable one.
	pi_request_snapshot: [
		"turn:state-unavailable",
		"turn:context-unavailable",
		"turn:system",
		"turn:tools-not-captured",
	],
};

describe("detail renderer contract conformance", () => {
	for (const [eventType, renderer] of Object.entries(rendererRegistry)) {
		test(`${eventType} conforms`, () => {
			// This identity check ensures the programmatic registry enumeration and
			// the public panel dispatch exercise the same renderer.
			expect(resolveRenderer(eventType)).toBe(renderer);
			const span = representativeSpan(eventType);
			assertConforms(span);

			const markup = renderToStaticMarkup(<SpanDetailPanel span={span} />);
			for (const blockId of REQUIRED_DATA_BLOCKS[eventType] ?? []) {
				assertDataBlock(markup, blockId);
			}
			if (eventType === "user_message" || eventType === "assistant_message") {
				const message = detailBlock(markup, "message");
				expect(unifiedDataFigures(message.fullMarkup)).toHaveLength(0);
				expect(message.fullMarkup).toContain(
					`${WRAP_UTILITY} break-words text-sm leading-7 text-foreground`,
				);
			}
		});
	}

	test("the unregistered-event fallback conforms", () => {
		const eventType = "unregistered_app_event";
		expect(Object.hasOwn(rendererRegistry, eventType)).toBe(false);
		const span = baseSpan(eventType, {
			input: '{"request":"inspect"}',
			output: "complete",
			attributes: [
				stringAttr("event_type", eventType),
				stringAttr("operation", "inspection"),
			],
		});
		assertConforms(span);
		const markup = renderToStaticMarkup(<SpanDetailPanel span={span} />);
		assertDataBlock(markup, "input");
		assertDataBlock(markup, "output");
	});

	test("app:board-render degrades to the generic facts card and Raw Details", () => {
		const eventType = "app:board-render";
		const blobHash = "b1-0123456789abcdef";
		expect(Object.hasOwn(rendererRegistry, eventType)).toBe(false);
		expect(resolveRenderer(eventType)).toBe(FactCard);

		const span = baseSpan(eventType, {
			title: "board render #3",
			raw: JSON.stringify({
				event_type: eventType,
				blob_hash: blobHash,
			}),
			attributes: [
				stringAttr("event_type", eventType),
				stringAttr("blob_hash", blobHash),
				stringAttr("mime_type", "image/png"),
				intAttr("n", 3),
				stringAttr("summary", "aligned the auth column"),
				intAttr("turn_number", 4),
			],
		});

		assertConforms(span);
		const markup = renderToStaticMarkup(<SpanDetailPanel span={span} />);
		expect(markup).toContain('data-detail-block="facts"');
		expect(markup).toContain('aria-label="Details"');
		expect(markup).not.toContain("<img");
		expect(markup).not.toContain("data-detail-image-modal-trigger");

		const detailsMarkup = renderToStaticMarkup(<DetailsView span={span} />);
		expect(detailsMarkup).toContain('data-details-section="raw"');
		expect(detailsMarkup).toContain(blobHash);
	});
});

function renderTaggedTurn(
	context: typeof realTurnContext,
): string {
	const span = baseSpan("pi_request_snapshot", {
		id: `real-turn:${context.run_id}:${context.turn_number}`,
		title: `Turn ${context.turn_number}`,
		attributes: [
			stringAttr("event_type", "pi_request_snapshot"),
			stringAttr("run_id", context.run_id),
			intAttr("turn_number", context.turn_number),
		],
	});
	return renderToStaticMarkup(
		<DetailShell
			span={span}
			view={buildSnapshotContextView({
				systemPrompt: context.system_prompt,
				messages: context.messages,
				sections: parseSectionTags(context.sections),
				apiBase: "http://localhost:4319",
				// "Every data body" has to mean every one, so a captured roster
				// enters the body set here exactly as the live renderer sends it.
				...(context.tools === undefined ? {} : { tools: context.tools }),
			})}
		/>,
	);
}

describe("real source/data SSR conformance", () => {
	test("a real tagged Turn puts every data body on the gutter substrate", () => {
		const markup = renderTaggedTurn(realTurnContext);
		assertUnifiedDataContract(markup);

		const state = assertDataBlock(markup, "turn:state");
		const context = assertDataBlock(markup, "turn:context");
		const system = assertDataBlock(markup, "turn:system");
		const tool = assertDataBlock(markup, "turn:tool:probe");
		const recent = detailBlock(markup, "turn:recent-messages");

		expect(renderedFigureSource(unifiedDataFigures(state.fullMarkup)[0]!)).toBe(
			REAL_ELISION_MARKER,
		);
		expect(renderedFigureSource(unifiedDataFigures(context.fullMarkup)[0]!)).toBe(
			(realTurnContext.messages[0]!.content as Array<{ text: string }>)[0]!
				.text,
		);
		expect(renderedFigureSource(unifiedDataFigures(system.fullMarkup)[0]!)).toBe(
			realTurnContext.system_prompt!,
		);
		// Section ④ is a data block like any other: same gutter substrate, and
		// the captured definition in the canonical 2-space JSON form.
		expect(renderedFigureSource(unifiedDataFigures(tool.fullMarkup)[0]!)).toBe(
			REAL_PROBE_BODY,
		);

		// The recent-message card keeps chat text as prose, while the real probe
		// call arguments and tool result are nested unified data figures.
		const recentSources = unifiedDataFigures(recent.fullMarkup).map(
			renderedFigureSource,
		);
		expect(recentSources).toContain('{\n  "note": "run-3"\n}');
		expect(recentSources).toContain("probe → run-3");
		expect(recentSources).not.toContain("Turn three: probe the gamma note.");
		expect(recentSources).not.toContain("run 3 complete");
		expect(recentSources).not.toContain("Turn four: probe the delta note.");
		expect(recent.fullMarkup).toContain("Turn three: probe the gamma note.");
		expect(recent.fullMarkup).toContain("run 3 complete");
		expect(recent.fullMarkup).toContain("Turn four: probe the delta note.");
	});

	test("the real 471-character state line round-trips byte-for-byte", () => {
		expect(REAL_STATE_LINE_471.length).toBe(471);
		const messages = realTurnContext.messages.map((message, index) =>
			index === 1
				? {
						...message,
						content: [{ type: "text" as const, text: REAL_STATE_LINE_471 }],
					}
				: message,
		);
		const markup = renderTaggedTurn({
			...realTurnContext,
			messages,
		});
		const state = assertDataBlock(markup, "turn:state");
		const figure = unifiedDataFigures(state.fullMarkup)[0];
		expect(figure).toBeDefined();
		expect(renderedFigureSource(figure!)).toBe(REAL_STATE_LINE_471);
	});

	test("a real tool result round-trips byte-for-byte with call and result gutters", () => {
		const span = baseSpan("tool_call_end", {
			id: "tool:update_sticky:real",
			title: "update_sticky",
			type: "tool_execution",
			input: REAL_UPDATE_STICKY_INPUT,
			output: REAL_UPDATE_STICKY_RESULT,
			attributes: [
				stringAttr("event_type", "tool_call_end"),
				stringAttr("tool_name", "update_sticky"),
			],
		});
		const markup = renderToStaticMarkup(<SpanDetailPanel span={span} />);
		assertUnifiedDataContract(markup);
		assertDataBlock(markup, "tool:call");
		const result = assertDataBlock(markup, "tool:result");
		const resultFigure = unifiedDataFigures(result.fullMarkup)[0];
		expect(resultFigure).toBeDefined();
		expect(renderedFigureSource(resultFigure!)).toBe(
			REAL_UPDATE_STICKY_RESULT,
		);
	});

	test("thinking, tool arguments, and tool results in a tagged message card are data", () => {
		const markup = renderTaggedTurn(canvasTurnContext);
		assertUnifiedDataContract(markup);
		const recent = detailBlock(markup, "turn:recent-messages");
		const sources = unifiedDataFigures(recent.fullMarkup).map(
			renderedFigureSource,
		);

		expect(sources).toContain(
			"The retry edge is unlabelled — label it.",
		);
		expect(sources).toContain(
			'{\n  "op": "connect",\n  "from": "obj-token",\n  "to": "obj-refresh",\n  "label": "retry"\n}',
		);
		expect(sources).toContain(
			'applied: connect obj-token→obj-refresh "retry"',
		);
	});

	test("an unknown structured message block degrades through the unified data figure", () => {
		const block = {
			type: "video",
			src: "nope",
			options: { autoplay: false },
		} as unknown as SanitizedContentBlock;
		const markup = renderToStaticMarkup(
			<ContentBlock block={block} apiBase="http://localhost:4319" />,
		);
		assertUnifiedDataContract(markup);
		const figures = unifiedDataFigures(markup);
		expect(figures).toHaveLength(1);
		expect(renderedFigureSource(figures[0]!)).toBe(
			JSON.stringify(block, null, 2),
		);
	});
});

/**
 * The State tab's subtabs are shell-owned chrome over the SAME block
 * vocabulary: a zone may only ever wrap standard blocks. The focus posture that
 * used to sit beside them was rejected on review and must leave no trace.
 */
describe("subtabbed tab conformance", () => {
	function statePanel(markup: string): ElementSlice {
		const panel = elementsWithAttribute(markup, "data-detail-tab").find(
			(element) => attribute(element.openingTag, "data-detail-tab") === "state",
		);
		if (!panel) throw new Error("The State tab panel was not rendered");
		return panel;
	}

	test("resting surfaces hold nothing but standard blocks, in slot order", () => {
		const markup = renderTaggedTurn(canvasTurnContext);
		const panel = statePanel(markup);
		expect(attribute(panel.openingTag, "data-detail-posture")).toBeNull();
		assertNonEmptyStandardBody(standardBlockChildren(panel));
		assertUnifiedDataContract(markup);

		const zones = elementsWithAttribute(panel.innerMarkup, "data-detail-zone");
		expect(zones.map((zone) => attribute(zone.openingTag, "data-detail-zone"))).toEqual([
			"state",
			"messages",
		]);
		for (const zone of zones) {
			expect(zone.tag).toBe("section");
			expect(attribute(zone.openingTag, "role")).toBe("tabpanel");
		}
	});

	test("surfaces are subtabbed: exactly one is visible at a time", () => {
		const markup = renderTaggedTurn(canvasTurnContext);
		const panel = statePanel(markup);
		const subtabs = elementsWithAttribute(
			panel.innerMarkup,
			"data-detail-subtabs",
		)[0];
		expect(subtabs).toBeDefined();
		const triggers = [
			...subtabs!.fullMarkup.matchAll(
				/<button\b[^>]*data-detail-subtab-trigger="([^"]+)"[^>]*>/g,
			),
		];
		expect(triggers.map(([, id]) => id)).toEqual(["state", "messages"]);
		expect(attribute(triggers[0]![0], "aria-selected")).toBe("true");
		expect(attribute(triggers[1]![0], "aria-selected")).toBe("false");

		const zones = elementsWithAttribute(panel.innerMarkup, "data-detail-zone");
		const visible = zones.filter(
			(zone) => !/\bhidden\b/.test(zone.openingTag),
		);
		expect(visible).toHaveLength(1);
		expect(attribute(visible[0]!.openingTag, "data-detail-zone")).toBe("state");
	});

	test("no index rail survives — the subtabs are the only wayfinding", () => {
		const markup = renderTaggedTurn(canvasTurnContext);
		expect(elementsWithAttribute(markup, "data-detail-rail")).toHaveLength(0);
		expect(markup).not.toContain("data-detail-rail-row");
		expect(markup).not.toContain("data-detail-lane");
	});

	test("the focus posture leaves no chrome behind", () => {
		const markup = renderTaggedTurn(canvasTurnContext);
		const panel = statePanel(markup);
		for (const token of [
			"data-detail-focus",
			"data-detail-focus-trigger",
			"data-detail-focus-back",
			"data-detail-crumb",
			"data-detail-raw-slice",
			"data-detail-posture",
		]) {
			expect(panel.fullMarkup).not.toContain(token);
		}
		// The surface is still exactly one stream of standard blocks.
		const stream = elementsWithAttribute(
			panel.innerMarkup,
			"data-detail-stream",
		)[0];
		expect(stream).toBeDefined();
		assertNonEmptyStandardBody(standardBlockChildren(panel));
		assertUnifiedDataContract(markup);
	});

	test("an inline row is presentation inside a figure, never a block", () => {
		const markup = renderTaggedTurn(canvasTurnContext);
		const panel = statePanel(markup);
		const rows = elementsWithAttribute(panel.innerMarkup, "data-doc-inline-row");
		for (const row of rows) {
			// It is a table row of the document, carrying no block vocabulary.
			expect(row.tag).toBe("tr");
			expect(attribute(row.openingTag, "data-detail-block")).toBeNull();
			expect(row.fullMarkup).not.toContain("data-doc-figure");
			expect(row.fullMarkup).not.toContain("data-doc-line-number");
		}
	});
});

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap(
		(entry: Dirent) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return sourceFiles(path);
			return entry.isFile() ? [path] : [];
		},
	);
}

test("renderer data sources do not introduce disclosure or modal chrome", () => {
	const rendererRoot = fileURLToPath(new URL("./renderers/", import.meta.url));
	const forbidden = [
		"@radix-ui/react-collapsible",
		"DetailsView",
		"data-details-view",
		"data-detail-details-open",
		'aria-label="Details"',
		'aria-label="Close details"',
		'role="dialog"',
		"data-detail-modal",
		'role="tablist"',
		'role="tab"',
		"data-detail-tab",
		// Surface chrome is the shell's too, as is every affordance the rejected
		// rail and focus postures used to add.
		"data-detail-zone",
		"data-detail-rail",
		"data-detail-crumb",
		"data-detail-stream",
		"data-detail-posture",
		"data-detail-raw-slice",
		"data-detail-subtab",
		"data-detail-focus-trigger",
	];
	const occurrences = sourceFiles(rendererRoot)
		.filter((path) => !path.includes(".test."))
		.flatMap((path) => {
			const source = readFileSync(path, "utf8");
			return forbidden
				.filter((token) => source.includes(token))
				.map((token) => `${path}: ${token}`);
		});
	expect(occurrences).toEqual([]);
});

test("the retired dead-end copy is absent from viewer-ui source", () => {
	const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
	const forbidden = ["No input or output", " for this event."].join("");
	const occurrences = sourceFiles(sourceRoot).filter((path) =>
		readFileSync(path, "utf8").includes(forbidden),
	);
	expect(occurrences).toEqual([]);
});

const DELIBERATE_PROSE_WRAP_EXCEPTIONS = {
	"renderers/MessageBody.tsx":
		`<p className="${WRAP_UTILITY} break-words text-sm leading-7 text-foreground">`,
	"renderers/snapshot-message-view.tsx":
		`<p className="${WRAP_UTILITY} break-words text-sm leading-7 text-foreground">`,
	"renderers/turn/turn-block-content.tsx":
		`<p className="${WRAP_UTILITY} break-words text-sm leading-7 text-foreground">`,
} as const;

test("the wrapping utility is confined to named conversation-prose paths", () => {
	const detailPanelRoot = fileURLToPath(new URL("./", import.meta.url));
	const violations = sourceFiles(detailPanelRoot)
		.filter(
			(path) =>
				/\.[cm]?[jt]sx?$/.test(path) &&
				!path.includes(".test.") &&
				!path.endsWith("contract-conformance.test.tsx"),
		)
		.flatMap((path) => {
			const relativePath = path.slice(detailPanelRoot.length);
			const allowed =
				DELIBERATE_PROSE_WRAP_EXCEPTIONS[
					relativePath as keyof typeof DELIBERATE_PROSE_WRAP_EXCEPTIONS
				];
			return readFileSync(path, "utf8")
				.split("\n")
				.flatMap((line, index) => {
					if (!line.includes(WRAP_UTILITY)) return [];
					if (allowed !== undefined && line.includes(allowed)) return [];
					return [`${relativePath}:${index + 1}: ${line.trim()}`];
				});
		});

	expect(violations).toEqual([]);
});

test("DocFigure is the only production implementation that emits a pre", () => {
	const detailPanelRoot = fileURLToPath(new URL("./", import.meta.url));
	const violations = sourceFiles(detailPanelRoot)
		.filter(
			(path) =>
				/\.[cm]?[jt]sx?$/.test(path) &&
				!path.includes(".test.") &&
				!path.endsWith("doc-figure/DocFigure.tsx"),
		)
		.flatMap((path) => {
			const relativePath = path.slice(detailPanelRoot.length);
			return readFileSync(path, "utf8")
				.split("\n")
				.flatMap((line, index) =>
					line.includes("<pre")
						? [`${relativePath}:${index + 1}: ${line.trim()}`]
						: [],
				);
		});

	expect(violations).toEqual([]);
});
