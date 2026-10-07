import { Fragment, type ReactNode } from "react";

import type { BlockSlot, DetailBlockSpec } from "../../../contract";
import { CLAMP } from "../../../doc-figure/clamp";
import { classifyNodeInput } from "../../node-facts";

export type JsonFieldsProps = {
	value: unknown;
};

/** Kept geometry: keys size to their content, values take the rest and wrap. */
const FIELD_COLUMNS = { gridTemplateColumns: "max-content minmax(0, 1fr)" };

/**
 * String values soft-wrap and keep their own line breaks (a diff hunk, an
 * excerpt), so a long value never runs off the card. A deliberate exception
 * to the byte-exact figures, listed in contract-conformance.test.tsx.
 */
const STRING_VALUE_CLASS = "whitespace-pre-wrap break-words text-syntax-string";

function isBranch(value: unknown): value is Record<string, unknown> | unknown[] {
	return value !== null && typeof value === "object";
}

function scalar(value: unknown): ReactNode {
	if (typeof value === "string") return <span className={STRING_VALUE_CLASS}>{value}</span>;
	if (typeof value === "number") return <span className="text-syntax-number">{String(value)}</span>;
	if (typeof value === "boolean" || value === null) {
		return <span className="text-syntax-boolean">{String(value)}</span>;
	}
	return <span className="text-muted-foreground">—</span>;
}

/**
 * A JSON value as nested key/value rows: a call's input args, a decision's
 * input state, a step's output summary. Objects and arrays indent under their
 * key across the full width; scalars sit beside it in their syntax color.
 */
export function JsonFields({ value }: JsonFieldsProps) {
	if (!isBranch(value)) return scalar(value);
	const isArray = Array.isArray(value);
	const entries: Array<[string, unknown]> = isArray
		? value.map((entry, index) => [`[${index}]`, entry])
		: Object.entries(value);
	if (entries.length === 0) {
		return <span className="text-muted-foreground">{isArray ? "[]" : "{}"}</span>;
	}
	return (
		<dl
			data-json-fields=""
			className="grid min-w-0 gap-x-3 gap-y-1 font-mono text-[length:var(--ds-font-size-ui-xs)] leading-[var(--ds-line-height-row)]"
			style={FIELD_COLUMNS}
		>
			{entries.map(([key, entry]) =>
				isBranch(entry) ? (
					<Fragment key={key}>
						<dt className="col-span-2 text-syntax-key">{key}</dt>
						<dd data-json-field={key} className="col-span-2 min-w-0 border-l border-border/60 pl-3">
							<JsonFields value={entry} />
						</dd>
					</Fragment>
				) : (
					<Fragment key={key}>
						<dt className="text-syntax-key">{key}</dt>
						<dd data-json-field={key} className="min-w-0">
							{scalar(entry)}
						</dd>
					</Fragment>
				),
			)}
		</dl>
	);
}

/**
 * A detail block for JSON text: the field view when it parses, else the text
 * as a plain figure (it is not JSON, so there is nothing to structure).
 */
export function jsonBlock(
	spec: { id: string; caption: string; slot: BlockSlot; order: number },
	text: string,
): DetailBlockSpec {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ...spec, body: text, language: "text", clamp: CLAMP.block };
	}
	return { ...spec, node: <JsonFields value={parsed} /> };
}

const STATUS_LINE_CLASS = "text-[length:var(--ds-font-size-ui-xs)] text-muted-foreground";

/**
 * A node's input blob as a detail block. Real input renders under `spec.id`
 * (the field view); a claim-time copy renders there too, under a line saying
 * what it is; a placeholder that recorded nothing becomes a muted status line
 * under `<id>-unrecorded`, so no real-data selector ever shows a placeholder.
 */
export function inputBlock(
	spec: { id: string; caption: string; slot: BlockSlot; order: number },
	text: string,
): DetailBlockSpec {
	const input = classifyNodeInput(text);
	if (input.kind === "not-recorded") {
		return {
			...spec,
			id: `${spec.id}-unrecorded`,
			expandable: false,
			node: (
				<p data-input-unrecorded="" className={STATUS_LINE_CLASS}>
					{input.reason}
				</p>
			),
		};
	}
	if (input.kind === "claim-time") {
		return {
			...spec,
			node: (
				<div className="min-w-0 space-y-2">
					<p data-input-claim-time="" className={STATUS_LINE_CLASS}>
						Recorded when the run was claimed, redacted with the route credentials only; the final input was never written.
					</p>
					<JsonFields value={input.value} />
				</div>
			),
		};
	}
	return jsonBlock(spec, text);
}
