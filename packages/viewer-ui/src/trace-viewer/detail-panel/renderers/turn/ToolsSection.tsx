import type { DetailBlockSpec } from "../../contract";
import { CLAMP } from "../../doc-figure/clamp";
import { jsonDocument } from "../json-document";
import type { SanitizedToolDefinition } from "../request-snapshot-api";

export interface ToolsSectionProps {
	/**
	 * The roster captured with this request, in provider order. `undefined` is
	 * NOT an empty toolbox — it means the snapshot predates tool capture, and
	 * the reader is told exactly that instead of being shown a blank shelf.
	 */
	tools: readonly SanitizedToolDefinition[] | undefined;
	/**
	 * Offline only: the span records that a roster WAS captured (it carries a
	 * tools blob) but this viewer cannot read it. That is a different fact from
	 * "never captured", and the reader gets told which one they are looking at.
	 */
	unavailable?: boolean;
	/**
	 * Section markers are only emitted for a real, captured roster on a
	 * section-tagged snapshot. A "we do not know" notice is not section ④, so it
	 * never wears the marker.
	 */
	tagged?: boolean;
	order?: number;
	/** Spacing between successive tool blocks, mirroring the context section. */
	step?: number;
}

export const TOOLS_NOT_CAPTURED_BODY =
	"Tool definitions were not captured for this trace.";
export const TOOLS_EMPTY_BODY = "No tools were active for this request.";
export const TOOLS_UNAVAILABLE_BODY =
	"The request tool roster is unavailable in this viewer.";

function noticeBlock(
	id: string,
	body: string,
	order: number,
	tagged = false,
): DetailBlockSpec {
	return {
		id,
		slot: "content",
		caption: "Tools",
		body,
		language: "text",
		clamp: CLAMP.tight,
		expandable: false,
		order,
		...(tagged ? { turnSection: "tools" as const } : {}),
	};
}

/**
 * Section ④ as contract data: the tool block the agent had on THIS request.
 *
 * One standard JSON data block per tool, in the order the provider received
 * them, each carrying the full definition — name, description, parameter
 * schema. The shell supplies every frame and control.
 */
export function ToolsSection({
	tools,
	unavailable = false,
	tagged = true,
	order = 60,
	step = 10,
}: ToolsSectionProps): DetailBlockSpec[] {
	if (tools === undefined) {
		return unavailable
			? [noticeBlock("turn:tools-unavailable", TOOLS_UNAVAILABLE_BODY, order)]
			: [
					noticeBlock(
						"turn:tools-not-captured",
						TOOLS_NOT_CAPTURED_BODY,
						order,
					),
				];
	}
	if (tools.length === 0) {
		return [noticeBlock("turn:tools-empty", TOOLS_EMPTY_BODY, order, tagged)];
	}

	const seen = new Set<string>();
	return tools.map((tool, index) => {
		const name = tool.name;
		// Two tools may legitimately arrive under one name (a shadowed override,
		// a malformed capture). Ids stay unique so the shell can key them — a
		// collision would make it DROP one — while the caption still reads as the
		// tool the agent saw.
		const baseId = `turn:tool:${name}`;
		const id = seen.has(baseId) ? `${baseId}:${index}` : baseId;
		seen.add(baseId);
		const definition: Record<string, unknown> = { name };
		if (tool.description !== undefined) definition.description = tool.description;
		if (tool.parameters !== undefined) definition.parameters = tool.parameters;
		// Everything here came out of a JSON response, so this always stringifies;
		// the guard keeps a pathological definition from taking the panel down.
		let raw: string;
		try {
			raw = JSON.stringify(definition) ?? String(name);
		} catch {
			raw = String(name);
		}
		const { body, language } = jsonDocument(raw);
		return {
			id,
			slot: "content" as const,
			caption: name,
			body,
			language,
			clamp: CLAMP.block,
			order: order + index * step,
			...(tagged ? { turnSection: "tools" as const } : {}),
		};
	});
}
