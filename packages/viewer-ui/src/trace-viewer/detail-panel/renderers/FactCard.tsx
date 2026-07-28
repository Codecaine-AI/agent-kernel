import type { TraceSpan, TraceSpanAttribute } from "@evilmartians/agent-prism-types";

import { readNumberAttr, readStringAttr } from "../../span-style";
import type { DetailBlockSpec, DetailView } from "../contract";
import { CLAMP } from "../doc-figure/clamp";
import type { RendererProps } from "../types";
import { jsonDocument } from "./json-document";
import { SystemPromptSection } from "./turn/SystemPromptSection";

const FACT_KEYS: Record<string, string> = {
	agent_name: "Agent",
	agent_type: "Agent",
	block_type: "Block",
	bytes: "Size",
	detail: "Detail",
	error: "Error",
	error_message: "Error",
	input_ref: "Input",
	loader_kind: "Loader",
	message: "Message",
	model: "Model",
	model_alias: "Provider",
	operation: "Operation",
	phase: "Phase",
	status: "Status",
	stop_reason: "Stop reason",
	turn_number: "Turn",
	warning_type: "Warning",
};

const OMITTED_KEYS = new Set([
	"trace_level",
	"event_type",
	"container_id",
	"input_tokens",
	"output_tokens",
	"cache_read_tokens",
	"cache_write_tokens",
	"cost",
	"cost_estimate",
	"from_cache",
]);

function titleCase(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) {
		return `${Number((bytes / 1024).toFixed(1)).toLocaleString("en-US")} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function booleanAttr(span: TraceSpan, key: string): boolean | undefined {
	const value = span.attributes?.find((attribute) => attribute.key === key)?.value
		?.boolValue;
	return typeof value === "boolean" ? value : undefined;
}

function attrText(attribute: TraceSpanAttribute): string | undefined {
	const value = attribute.value;
	if (typeof value?.stringValue === "string") return value.stringValue;
	if (typeof value?.intValue === "string") return value.intValue;
	if (typeof value?.boolValue === "boolean") return String(value.boolValue);
	return undefined;
}

function isTechnical(attribute: TraceSpanAttribute): boolean {
	if (OMITTED_KEYS.has(attribute.key)) return true;
	if (attribute.key.endsWith("_id") || attribute.key.includes("hash")) return true;
	const value = attrText(attribute) ?? "";
	return /(?:^|[^0-9a-f])[0-9a-f]{40,}(?:[^0-9a-f]|$)/i.test(value);
}

function statusWord(span: TraceSpan): string {
	return span.status === "error" ? "error" : span.status === "warning" ? "warning" : "complete";
}

function explicitFact(span: TraceSpan, eventType: string): string | null {
	const turn = readNumberAttr(span, "turn_number");
	const agent = readStringAttr(span, "agent_name") ?? readStringAttr(span, "agent_type");
	const status = readStringAttr(span, "status");

	switch (eventType) {
		case "context_input_resolved": {
			const input = readStringAttr(span, "input_ref") ?? readStringAttr(span, "loader_kind") ?? "input";
			const bytes = readNumberAttr(span, "bytes");
			const resolution = status === "error" || status === "empty"
				? status
				: booleanAttr(span, "from_cache")
					? "cached"
					: "fresh";
			return [status === "error" ? `Failed ${input}` : `Loaded ${input}`, bytes === undefined ? null : formatBytes(bytes), resolution]
				.filter(Boolean)
				.join(" · ");
		}
		case "agent_session_start": {
			const alias = readStringAttr(span, "model_alias");
			const model = readStringAttr(span, "model");
			const modelLabel = alias && model && alias !== model ? `${alias}/${model}` : (model ?? alias);
			return ["Session started", agent, modelLabel].filter(Boolean).join(" · ");
		}
		case "agent_session_end":
			return ["Session ended", status ?? statusWord(span)].filter(Boolean).join(" · ");
		case "agent_run_start":
			return ["Run started", agent].filter(Boolean).join(" · ");
		case "agent_run_end":
			return ["Run ended", agent, status].filter(Boolean).join(" · ");
		case "pi_agent_start":
			return ["Agent started", agent].filter(Boolean).join(" · ");
		case "pi_agent_end":
			return ["Agent ended", agent, status].filter(Boolean).join(" · ");
		case "pi_turn_start":
			return turn === undefined ? "Turn started" : `Turn ${turn} started`;
		case "pi_turn_end": {
			const prefix = turn === undefined ? "Turn ended" : `Turn ${turn} ended`;
			const reason = readStringAttr(span, "stop_reason");
			return reason ? `${prefix} · stopped on ${reason}` : prefix;
		}
		case "system_prompt_resolved": {
			const lines = (span.output ?? "").split("\n").length;
			return ["Resolved system prompt", agent, span.output ? `${lines.toLocaleString()} lines` : null]
				.filter(Boolean)
				.join(" · ");
		}
		default:
			return null;
	}
}

export function factLines(span: TraceSpan): string[] {
	const eventType = readStringAttr(span, "event_type") ?? span.type;
	const explicit = explicitFact(span, eventType);
	if (explicit) return [explicit];

	const values = (span.attributes ?? [])
		.filter((attribute) => !isTechnical(attribute))
		.flatMap((attribute) => {
			const value = attrText(attribute);
			if (!value) return [];
			const label = FACT_KEYS[attribute.key] ?? titleCase(attribute.key);
			return [`${label}: ${value}`];
		})
		.slice(0, 2);
	const label = titleCase(eventType || span.title || "Event");
	return [label, ...values];
}

function factBlocks(span: TraceSpan, eventType: string): DetailBlockSpec[] {
	const facts = factLines(span);
	const factsBlock: DetailBlockSpec = {
		id: "facts",
		slot: "content",
		order: -100,
		caption: "Facts",
		node: (
			<ul data-fact-list="" className="space-y-1 text-sm leading-relaxed text-foreground">
				{facts.map((fact, index) => (
					<li key={`${index}:${fact}`} className="break-words">
						{fact}
					</li>
				))}
			</ul>
		),
		expandable: false,
	};
	if (eventType === "system_prompt_resolved" && span.output !== undefined) {
		return [
			factsBlock,
			...SystemPromptSection({
				systemPrompt: span.output ?? null,
				id: "system-prompt",
				tagged: false,
			}),
		];
	}
	const blocks: DetailBlockSpec[] = [];
	if (span.input !== undefined) {
		const input = jsonDocument(span.input);
		blocks.push({
			id: "input",
			slot: "input",
			caption: "Input",
			body: input.body,
			language: input.language,
			clamp: CLAMP.block,
		});
	}
	blocks.push(factsBlock);
	if (span.output !== undefined) {
		const output = jsonDocument(span.output);
		blocks.push({
			id: "output",
			slot: "output",
			caption: "Output",
			body: output.body,
			language: output.language,
			clamp: CLAMP.block,
		});
	}
	return blocks;
}

/** The complete facts + Details standard, with optional genuine I/O blocks. */
export function FactCard({ span }: RendererProps): DetailView {
	const eventType = readStringAttr(span, "event_type") ?? span.type;
	return {
		blocks: factBlocks(span, eventType),
	};
}
