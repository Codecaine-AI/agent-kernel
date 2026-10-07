import { Fragment, type ReactNode } from "react";

export type FieldTableRow = {
	/** Stable per table; also the row's `data-field` hook. */
	key: string;
	label: string;
	value: ReactNode;
};

export type FieldTableProps = {
	rows: readonly FieldTableRow[];
};

/** Kept geometry: labels size to their content, values take the rest and wrap. */
const FIELD_TABLE_COLUMNS = { gridTemplateColumns: "max-content minmax(0, 1fr)" };

/**
 * Values wrap at their spaces; a token longer than the line (a hash, a path)
 * breaks only where it must, never mid-word in running text.
 */
const VALUE_WRAP = { overflowWrap: "anywhere" } as const;

/**
 * A label/value table for model-node facts (call summary, typed output fields,
 * step attributes, thresholds). Values are mono: they are data.
 */
export function FieldTable({ rows }: FieldTableProps) {
	return (
		<dl
			data-field-table=""
			className="grid min-w-0 gap-x-4 gap-y-1 text-[length:var(--ds-font-size-ui-xs)] leading-[var(--ds-line-height-row)]"
			style={FIELD_TABLE_COLUMNS}
		>
			{rows.map((row) => (
				<Fragment key={row.key}>
					<dt className="text-muted-foreground">{row.label}</dt>
					<dd data-field={row.key} className="min-w-0 font-mono text-foreground" style={VALUE_WRAP}>
						{row.value}
					</dd>
				</Fragment>
			))}
		</dl>
	);
}
