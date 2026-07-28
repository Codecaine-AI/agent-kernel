"use client";

/**
 * DetailsView — the full-panel home for diagnostic span information.
 *
 * Timing, usage, identity, attributes, and the complete raw record replace the
 * event body while the shell's Details mode is active. Multiline strings in
 * the display record become real indented blocks, while Copy JSON preserves
 * the exact round-trippable JSON representation.
 */
import { useMemo, type JSX, type ReactNode } from "react";
import type {
	TraceSpan,
	TraceSpanAttribute,
} from "@evilmartians/agent-prism-types";
import { Copy } from "lucide-react";
import cn from "classnames";

import type { DetailBlockSpec } from "./contract";
import { SECTION_LABEL_CLASS } from "./renderers/snapshot-message-view";
import { DocFigure } from "./doc-figure/DocFigure";
import { CLAMP } from "./doc-figure/clamp";

function formatTimestamp(ts: Date): string {
	return ts.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

function attributeValue(attribute: TraceSpanAttribute): string {
	const value = attribute.value;
	if (typeof value?.stringValue === "string") return value.stringValue;
	if (typeof value?.intValue === "string") return value.intValue;
	if (typeof value?.boolValue === "boolean") return String(value.boolValue);
	return "—";
}

async function copyText(value: string): Promise<void> {
	if (
		typeof navigator === "undefined" ||
		typeof navigator.clipboard?.writeText !== "function"
	) {
		return;
	}
	try {
		await navigator.clipboard.writeText(value);
	} catch {
		// Clipboard permissions can be denied by the host; reading the view
		// must remain unaffected.
	}
}

function CopyButton({ label, value }: { label: string; value: string }) {
	return (
		<button
			type="button"
			aria-label={`Copy ${label}`}
			title={`Copy ${label}`}
			onClick={() => void copyText(value)}
			className="grid size-6 shrink-0 place-items-center rounded-[3px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-info-border"
		>
			<Copy aria-hidden="true" className="size-3" />
		</button>
	);
}

function DetailRow({
	label,
	children,
	className,
}: {
	label: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className="grid min-w-0 grid-cols-[minmax(7rem,0.75fr)_minmax(0,1.25fr)] gap-x-4 py-0.5 text-sm">
			<span className="min-w-0 break-words text-muted-foreground">{label}</span>
			<span className={cn("min-w-0 text-xs", className)}>{children}</span>
		</div>
	);
}

function CopyableDetailRow({
	label,
	value,
}: {
	label: string;
	value: string;
}) {
	return (
		<DetailRow label={label}>
			<span className="flex min-w-0 items-start gap-1">
				<span className="min-w-0 flex-1 break-all font-mono">{value}</span>
				<CopyButton label={label} value={value} />
			</span>
		</DetailRow>
	);
}

function DetailSection({
	id,
	title,
	meta,
	action,
	children,
}: {
	id: string;
	title: string;
	meta?: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section data-details-section={id} className="min-w-0 space-y-1.5">
			<div className="flex min-w-0 items-center gap-2">
				<h4 className={SECTION_LABEL_CLASS}>{title}</h4>
				{meta || action ? (
					<div className="ml-auto flex min-w-0 items-center gap-2">
						{meta ? (
							<span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
								{meta}
							</span>
						) : null}
						{action}
					</div>
				) : null}
			</div>
			<div className="min-w-0">{children}</div>
		</section>
	);
}

const USAGE_ATTRIBUTES = [
	"input_tokens",
	"output_tokens",
	"cache_read_tokens",
	"cache_write_tokens",
	"cost_estimate",
	"model",
	"stop_reason",
] as const;

const USAGE_LABELS: Record<(typeof USAGE_ATTRIBUTES)[number], string> = {
	input_tokens: "Input tokens",
	output_tokens: "Output tokens",
	cache_read_tokens: "Cache read tokens",
	cache_write_tokens: "Cache write tokens",
	cost_estimate: "Cost estimate",
	model: "Model",
	stop_reason: "Stop reason",
};

const NUMERIC_USAGE_ATTRIBUTES: ReadonlySet<string> = new Set([
	"input_tokens",
	"output_tokens",
	"cache_read_tokens",
	"cache_write_tokens",
	"cost_estimate",
]);

interface UsageEntry {
	key: (typeof USAGE_ATTRIBUTES)[number];
	value: string;
}

function usageEntries(span: TraceSpan): UsageEntry[] {
	const attributes = span.attributes ?? [];
	const byKey = new Map(attributes.map((attribute) => [attribute.key, attribute]));
	return USAGE_ATTRIBUTES.flatMap((key) => {
		const attribute = byKey.get(key);
		if (!attribute) return [];
		const raw = attributeValue(attribute);
		if (raw === "—") return [];
		if (!NUMERIC_USAGE_ATTRIBUTES.has(key)) return [{ key, value: raw }];
		const number = Number(raw);
		return [
			{
				key,
				value: Number.isFinite(number) ? number.toLocaleString("en-US") : raw,
			},
		];
	});
}

type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

function appendComma(lines: string[], comma: boolean): string[] {
	if (!comma || lines.length === 0) return lines;
	const copy = [...lines];
	copy[copy.length - 1] = `${copy[copy.length - 1]},`;
	return copy;
}

/**
 * JSON-like diagnostic text with multiline strings promoted to indented block
 * scalars. Scalars and structure retain JSON spelling; triple quotes make the
 * one deliberate display-only transformation explicit.
 */
function formatRawValue(value: JsonValue, depth = 0): string[] {
	const indent = " ".repeat(depth);

	if (typeof value === "string" && value.includes("\n")) {
		return [
			`${indent}"""`,
			...value.split("\n").map((line) => `${indent}${line}`),
			`${indent}"""`,
		];
	}
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return [`${indent}${JSON.stringify(value)}`];
	}
	if (Array.isArray(value)) {
		if (value.length === 0) return [`${indent}[]`];
		const lines = [`${indent}[`];
		value.forEach((entry, index) => {
			lines.push(
				...appendComma(formatRawValue(entry, depth + 2), index < value.length - 1),
			);
		});
		lines.push(`${indent}]`);
		return lines;
	}

	const entries = Object.entries(value);
	if (entries.length === 0) return [`${indent}{}`];
	const lines = [`${indent}{`];
	entries.forEach(([key, entry], index) => {
		const comma = index < entries.length - 1;
		const keyPrefix = `${" ".repeat(depth + 2)}${JSON.stringify(key)}:`;
		if (typeof entry === "string" && entry.includes("\n")) {
			lines.push(keyPrefix);
			lines.push(...appendComma(formatRawValue(entry, depth + 4), comma));
			return;
		}
		const valueLines = formatRawValue(entry, depth + 2);
		const first = valueLines[0]?.trimStart() ?? "null";
		lines.push(`${keyPrefix} ${first}`);
		lines.push(...valueLines.slice(1));
		if (comma) {
			lines[lines.length - 1] = `${lines[lines.length - 1]},`;
		}
	});
	lines.push(`${indent}}`);
	return lines;
}

function rawRecord(span: TraceSpan): { display: string; json: string } {
	const { children: _children, ...rest } = span;
	const json = JSON.stringify(rest, null, 2) ?? "{}";
	const parsed = JSON.parse(json) as JsonValue;
	return {
		display: formatRawValue(parsed).join("\n"),
		json,
	};
}

export interface DetailsViewProps {
	span: TraceSpan;
	extras?: ReactNode;
	onOpenModal?: (block: DetailBlockSpec) => void;
	/** Shared region id referenced by the shell-owned header control. */
	id?: string;
}

/**
 * Directly renderable Details surface. DetailShell owns its visibility and all
 * entry/exit controls; this component owns only the diagnostic content shape.
 */
export function DetailsView({
	span,
	extras,
	onOpenModal,
	id,
}: DetailsViewProps): JSX.Element {
	const usage = useMemo(() => usageEntries(span), [span]);
	const raw = useMemo(() => rawRecord(span), [span]);
	const toolName = span.attributes
		?.find((attribute) => attribute.key === "tool_name")
		?.value?.stringValue;

	return (
		<div
			id={id}
			data-details-view=""
			data-details-region=""
			role="region"
			aria-label="Details"
			className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4"
		>
			<div className="grid min-w-0 gap-5 lg:grid-cols-2">
				<DetailSection id="identity" title="Identity & attributes">
					<CopyableDetailRow label="Span ID" value={span.id} />
					{span.attributes?.map((attribute, index) => (
						<CopyableDetailRow
							key={`${attribute.key}:${index}`}
							label={attribute.key}
							value={attributeValue(attribute)}
						/>
					))}
				</DetailSection>

				<div className="min-w-0 space-y-5">
					<DetailSection id="timing" title="Timing">
						<DetailRow label="Start" className="font-sans">
							{formatTimestamp(span.startTime)}
						</DetailRow>
						<DetailRow label="End" className="font-sans">
							{formatTimestamp(span.endTime)}
						</DetailRow>
						<DetailRow label="Duration" className="font-sans">
							{formatDuration(span.duration)}
						</DetailRow>
						<DetailRow label="Type" className="font-sans">
							{span.type}
						</DetailRow>
						<DetailRow
							label="Status"
							className={cn(
								"font-sans",
								span.status === "error" && "text-destructive",
								span.status === "warning" && "text-status-warning",
							)}
						>
							{span.status}
						</DetailRow>
						{toolName && (
							<DetailRow label="Tool" className="font-sans">
								{toolName}
							</DetailRow>
						)}
					</DetailSection>

					{usage.length > 0 && (
						<DetailSection id="usage" title="Usage">
							{usage.map((entry) => (
								<DetailRow
									key={entry.key}
									label={USAGE_LABELS[entry.key]}
									className="font-mono tabular-nums"
								>
									{entry.value}
								</DetailRow>
							))}
						</DetailSection>
					)}
				</div>
			</div>

			<div
				data-details-section="raw"
				data-raw-record=""
				className="mt-5 min-w-0"
			>
				<div className="mb-2 flex justify-end">
					<button
						type="button"
						onClick={() => void copyText(raw.json)}
						className="inline-flex items-center gap-1.5 rounded-[3px] border border-border px-2 py-1 font-sans text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-info-border"
					>
						<Copy aria-hidden="true" className="size-3" />
						Copy JSON
					</button>
				</div>
				<DocFigure
					caption="Raw"
					body={raw.display}
					language="json"
					clamp={CLAMP.tall}
					dedent={false}
					onOpenModal={
						onOpenModal
							? () =>
									onOpenModal({
										id: "details:raw",
										slot: "content",
										caption: "Raw",
										body: raw.display,
										language: "json",
										clamp: CLAMP.tall,
									})
							: undefined
					}
				/>
			</div>

			{extras ? <div className="mt-5 min-w-0">{extras}</div> : null}
		</div>
	);
}
