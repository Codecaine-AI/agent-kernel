import { Fragment, type ReactNode } from "react";

import type { BlockSlot, DetailBlockSpec } from "../../../contract";
import { CLAMP } from "../../../doc-figure/clamp";

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
