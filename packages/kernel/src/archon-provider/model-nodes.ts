/**
 * The extract and decide nodes of the Archon fork. Archon builds each one as
 * an agent node on provider `agent-kernel` with a `model_node` config in
 * `nodeConfig`, and renders the node's `input` template as the prompt.
 *
 * - extract: one `kernel.call` of a BAML function of the workflow's pack, on
 *   the pack kernel, checked against the node's `output_format`. A parse
 *   failure or a result that misses the schema sends one more call, up to
 *   `retries`. The last failure throws, so the node fails.
 * - decide: one `kernel.decide` on the base kernel with one choice question.
 *   A low-confidence abstain answers `other`. An engine error, a refusal or a
 *   malformed answer throws, so the node fails.
 */
import { createRequire } from "node:module";
import { join } from "node:path";

import { validateToolArguments, type Tool } from "@earendil-works/pi-ai";
import type { TraceTags } from "@codecaine-ai/agent-kernel-protocol";

import type { KernelInstance } from "../index";
import { bamlEngine, type BamlRuntimeLike } from "../model-nodes/baml-engine";
import { KernelCallError, type CallEngine, type ChoiceQuestion, type KernelCallFn } from "../model-nodes/types";
import type { DecideModelNode, DecideResult, ExtractModelNode, ModelNodeConfig } from "./contract";

export type { DecideModelNode, DecideResult, ExtractModelNode, ModelNodeConfig } from "./contract";

/** The enum value an abstained decide answers. The fork's grammar puts it in every enum. */
export const DECIDE_FALLBACK_CHOICE = "other";

/** The id of the one question a decide node asks. */
const DECIDE_QUESTION_ID = "choice";

/**
 * `value` checked against `schema` the way Pi checks a tool call's arguments,
 * with the same coercion, or undefined when it does not match. The provider
 * declares `structuredOutput: enforced`, so Archon trusts what it returns.
 */
export function matchOutputFormat(
	value: unknown,
	schema: Record<string, unknown>,
): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const name = "structured_output";
	try {
		return validateToolArguments(
			{ name, description: "", parameters: schema as unknown as Tool["parameters"] },
			{ type: "toolCall", id: name, name, arguments: value as Parameters<typeof validateToolArguments>[1]["arguments"] },
		) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

/** `nodeConfig.model_node`, checked at the provider boundary. Undefined when the node is not a model node. */
export function parseModelNode(raw: unknown): ModelNodeConfig | undefined {
	if (raw === undefined || raw === null) return undefined;
	const node = raw as Partial<ExtractModelNode> & Partial<DecideModelNode>;
	if (node.kind === "extract" && typeof node.function === "string" && typeof node.tier === "string" && Number.isInteger(node.retries)) {
		return node as ExtractModelNode;
	}
	if (
		node.kind === "decide" &&
		typeof node.question === "string" &&
		Array.isArray(node.enum) &&
		node.enum.every((value) => typeof value === "string") &&
		typeof node.classifier === "string"
	) {
		return node as DecideModelNode;
	}
	throw new Error(`nodeConfig.model_node is not an extract or decide config: ${JSON.stringify(raw)}`);
}

/** A pack's generated BAML client, known at run time by function name only. */
export type PackCalls = Record<`${Uppercase<string>}${string}`, (input: string, options?: unknown) => Promise<unknown>>;

/**
 * The BAML call engine of the pack at `packDir`: the committed `baml_client`
 * and the `@boundaryml/baml` runtime that the pack installs. The kernel never
 * loads BAML itself, so the runtime comes from the pack's own dependencies.
 */
export async function loadPackCallEngine(packDir: string): Promise<CallEngine<PackCalls>> {
	const requireFromPack = createRequire(join(packDir, "package.json"));
	const runtimePath = requireFromPack.resolve("@boundaryml/baml");
	const baml = (await import(runtimePath)) as BamlRuntimeLike;
	const { b } = (await import(join(packDir, "baml_client", "index.ts"))) as { b: PackCalls };
	const { getBamlFiles } = (await import(join(packDir, "baml_client", "inlinedbaml.ts"))) as {
		getBamlFiles: () => Record<string, string>;
	};
	return bamlEngine({ client: b, baml, sources: getBamlFiles(), manifests: {} });
}

export interface ModelNodeScope {
	/** The `archon-node` container of the attempt. */
	containerId: string;
	traceTags: TraceTags;
	/** The rendered `input` template. */
	prompt: string;
	signal?: AbortSignal;
}

/**
 * Runs one extract node on the pack kernel. Returns the typed object that
 * passed `schema`, or throws after the last of `1 + retries` calls fails
 * with a parse failure or a schema miss. Any other call failure throws at once.
 */
export async function runExtract(
	kernel: KernelInstance,
	node: ExtractModelNode,
	schema: Record<string, unknown>,
	scope: ModelNodeScope,
): Promise<Record<string, unknown>> {
	// The pack kernel's call engine comes from the pack at run time, so its client type is PackCalls.
	const call = kernel.call as KernelCallFn<PackCalls>;
	let lastFailure = "";
	for (let attempt = 0; attempt <= node.retries; attempt++) {
		let value: unknown;
		try {
			value = await call(node.function as keyof PackCalls, [scope.prompt], {
				model: node.tier,
				containerId: scope.containerId,
				traceTags: scope.traceTags,
				...(scope.traceTags.node_path !== undefined && { displayLabel: scope.traceTags.node_path }),
				...(scope.signal !== undefined && { signal: scope.signal }),
			});
		} catch (error) {
			if (!(error instanceof KernelCallError) || error.failure.kind !== "parse") throw error;
			lastFailure = error.message;
			continue;
		}
		const structured = matchOutputFormat(value, schema);
		if (structured !== undefined) return structured;
		lastFailure = `${node.function} returned a result that does not match output_format`;
	}
	throw new Error(`extract failed after ${node.retries + 1} calls: ${lastFailure}`);
}

/** Runs one decide node on the base kernel and maps its outcome to the decide result. */
export async function runDecide(
	kernel: KernelInstance,
	node: DecideModelNode,
	scope: ModelNodeScope,
): Promise<DecideResult> {
	const question: ChoiceQuestion = {
		type: "choice",
		instructions: node.question,
		// The grammar gives only the labels, so each label describes itself.
		criteria: Object.fromEntries(node.enum.map((label) => [label, label])),
		...(node.threshold !== undefined && {
			minTop: node.threshold.minProbability,
			minMargin: node.threshold.minMargin,
		}),
	};
	const outcome = await kernel.decide(scope.traceTags.node_path ?? "decide", scope.prompt, {
		model: node.classifier,
		questions: { [DECIDE_QUESTION_ID]: question },
		containerId: scope.containerId,
		traceTags: scope.traceTags,
		...(scope.signal !== undefined && { signal: scope.signal }),
	});
	// A low-confidence abstain and a refusal are answers. An engine error or a malformed answer fails the node.
	const refused = outcome.abstained && outcome.abstainReason === "refusal";
	if (!refused && (outcome.error !== undefined || (outcome.abstained && outcome.abstainReason !== "low-confidence"))) {
		const detail = outcome.error !== undefined ? `${outcome.error.kind}: ${outcome.error.message}` : outcome.abstainReason;
		throw new Error(`decide failed on ${outcome.model || node.classifier}: ${detail}`);
	}
	const distribution = outcome.answers[DECIDE_QUESTION_ID]?.distribution ?? {};
	// `chosen` is "abstain" when the kernel abstained, and also when a label named "abstain" won.
	const choice = outcome.abstained ? DECIDE_FALLBACK_CHOICE : outcome.chosen;
	return {
		choice,
		reason: refused ? "refusal" : outcome.abstained ? "low-confidence" : spread(distribution),
		probability: distribution[choice] ?? 0,
		abstained: outcome.abstained,
	};
}

/** "top 0.88, margin 0.71": the top probability and its lead over the runner-up. */
function spread(distribution: Record<string, number>): string {
	const [top = 0, next = 0] = Object.values(distribution).sort((a, b) => b - a);
	return `top ${top.toFixed(2)}, margin ${(top - next).toFixed(2)}`;
}
