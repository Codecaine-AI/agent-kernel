"use client";

import { readStringAttr } from "../../span-style";
import type {
	DetailBlockSpec,
	DetailBodyRenderer,
} from "../contract";
import { CLAMP } from "../doc-figure/clamp";
import { jsonDocument } from "./json-document";

function callBlock(input: string): DetailBlockSpec {
	// Canvas contributes thinking/program at -100/-50; the explicit call rank
	// keeps both before the model-visible call without relying on default 0.
	const order = 10;
	// Arguments arrive minified from the provider; JSON data blocks render
	// canonically pretty-printed (values exact, whitespace canonical).
	const { body, language } = jsonDocument(input);

	return {
		id: "tool:call",
		slot: "input",
		order,
		caption: "Call",
		body,
		language,
		clamp: CLAMP.block,
	};
}

/**
 * Tool calls select the standard input/output blocks. Canvas thinking and
 * renders are extension blocks and are deliberately unknown to this body.
 * These blocks live at the detail-panel root, so their captions intentionally
 * use DocFigure's default top tier; only message-nested figures opt down.
 */
export const ToolBody: DetailBodyRenderer = ({ span }) => {
	const toolName = readStringAttr(span, "tool_name") ?? span.title ?? "Tool";
	const outcome = span.status === "error" ? "error" : "applied";
	const blocks: DetailBlockSpec[] = [];

	if (span.input !== undefined) {
		blocks.push(callBlock(span.input));
	}
	if (span.output?.trim()) {
		// A JSON result is a data block too: pretty when it parses, byte-exact
		// text when it is prose like "APPLIED · update_sticky …".
		const result = jsonDocument(span.output);
		blocks.push({
			id: "tool:result",
			slot: "output",
			order: 10,
			caption: "Result",
			body: result.body,
			language: result.language,
			clamp: CLAMP.block,
		});
	} else {
		blocks.push({
			id: "tool:outcome",
			slot: "output",
			order: 10,
			caption: "Outcome",
			body: `${toolName} → ${outcome}`,
			language: "text",
			clamp: CLAMP.tight,
			expandable: false,
		});
	}

	return {
		blocks,
	};
};
