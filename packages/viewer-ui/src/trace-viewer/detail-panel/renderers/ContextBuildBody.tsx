import { readNumberAttr, readStringAttr } from "../../span-style";
import type {
	DetailBlockSpec,
	DetailBodyRenderer,
	DetailView,
} from "../contract";
import { prettyJson } from "./json-document";
import { ContextSection } from "./turn/ContextSection";

interface DeclaredInput {
	kind: string;
	ref: string;
}

interface ResolvedInput {
	loader_kind: string;
	input_ref: string;
	status: string;
	bytes: number;
}

function parseJson(raw: string | undefined): unknown {
	if (!raw) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function declaredInputs(raw: string | undefined): DeclaredInput[] {
	const value = parseJson(raw);
	if (!Array.isArray(value)) return [];

	return value.flatMap((entry) => {
		if (!entry || typeof entry !== "object") return [];
		const record = entry as Record<string, unknown>;
		if (typeof record.kind !== "string" || typeof record.ref !== "string") {
			return [];
		}
		return [{ kind: record.kind, ref: record.ref }];
	});
}

function resolvedInputs(raw: string | undefined): ResolvedInput[] {
	const value = parseJson(raw);
	if (!Array.isArray(value)) return [];

	return value.flatMap((entry) => {
		if (!entry || typeof entry !== "object") return [];
		const record = entry as Record<string, unknown>;
		if (
			typeof record.loader_kind !== "string" ||
			typeof record.input_ref !== "string" ||
			typeof record.status !== "string" ||
			typeof record.bytes !== "number" ||
			!Number.isFinite(record.bytes)
		) {
			return [];
		}
		return [
			{
				loader_kind: record.loader_kind,
				input_ref: record.input_ref,
				status: record.status,
				bytes: Math.max(0, record.bytes),
			},
		];
	});
}

export const ContextBuildBody: DetailBodyRenderer = ({ span }): DetailView => {
	const declaredRaw = span.input;
	const resolvedRaw = readStringAttr(span, "resolved_inputs");
	const declared = declaredInputs(declaredRaw);
	const resolved = resolvedInputs(resolvedRaw);
	const reportedCount =
		readNumberAttr(span, "inputs_count") ??
		readNumberAttr(span, "declared_inputs_count");
	const inputCount =
		reportedCount ??
		(resolved.length > 0
			? resolved.length
			: declared.length > 0
				? declared.length
				: undefined);
	const declaredBlock: DetailBlockSpec =
		declared.length > 0 && declaredRaw !== undefined
			? {
					id: "context:declared-inputs",
					slot: "input",
					order: 0,
					caption: "Declared inputs",
					body: prettyJson(declaredRaw),
					language: "json",
				}
			: {
					id: "context:declared-inputs",
					slot: "input",
					order: 0,
					caption: "Declared inputs",
					node: (
						<p
							data-context-stage="declared"
							className="text-sm leading-relaxed text-muted-foreground"
						>
							Declared input details were not recorded.
						</p>
					),
				};
	const loadedFallback =
		inputCount === undefined
			? "Per-input lineage"
			: `${inputCount.toLocaleString("en-US")} ${inputCount === 1 ? "input was" : "inputs were"} loaded; per-input lineage`;
	const loadedBlock: DetailBlockSpec =
		resolved.length > 0 && resolvedRaw !== undefined
			? {
					id: "context:loaded-inputs",
					slot: "input",
					order: 10,
					caption: "Loaded",
					body: prettyJson(resolvedRaw),
					language: "json",
				}
			: {
					id: "context:loaded-inputs",
					slot: "input",
					order: 10,
					caption: "Loaded",
					node: (
						<p
							data-context-stage="loaded"
							className="text-sm leading-relaxed text-muted-foreground"
						>
							{loadedFallback} was not recorded in this older trace.
						</p>
					),
				};

	const blocks: DetailBlockSpec[] = [
		declaredBlock,
		loadedBlock,
		...ContextSection({
			entries: [],
			apiBase: "",
			id: "context:rendered",
			caption: "Rendered context",
			body: span.output ?? "",
			tagged: false,
		}),
	];

	return {
		blocks,
	};
};
