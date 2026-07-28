"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { PiRequestSnapshotMessageRef } from "@agent-kernel/viewer-core";

import type {
	DetailBlockSpec,
	DetailBodyRenderer,
	DetailTab,
	DetailView,
} from "../contract";
import { DocFigure } from "../doc-figure/DocFigure";
import { CLAMP } from "../doc-figure/clamp";
import { useTraceViewerApi } from "../TraceViewerApiContext";
import { readNumberAttr, readStringAttr } from "../../span-style";
import {
	hasApiBase,
	runTurnContextUrl,
	type RunTurnContextResponse,
	type SanitizedMessage,
	type SanitizedToolDefinition,
} from "./request-snapshot-api";
import { prettyJson } from "./json-document";
import {
	roleStyleOf,
} from "./snapshot-message-view";
import { groupTurnSections, parseSectionTags } from "./turn-sections";
import { ContextSection } from "./turn/ContextSection";
import { StateSection } from "./turn/StateSection";
import { withPrimaryFigurePolicy } from "./primary-figure";
import { SystemPromptSection } from "./turn/SystemPromptSection";
import { ToolsSection } from "./turn/ToolsSection";
import {
	TurnMessage,
} from "./turn/turn-block-content";

/**
 * Every Turn exposes State → Context → System prompt → Tools tabs. State is
 * first (and therefore the shell default); its section range stays in message
 * order, followed by the recent-message tail and any unexpected untagged
 * messages. Tools is last: the roster the agent could reach on this request.
 */
const TURN_CONTENT_ORDER = {
	system: 10,
	context: 20,
	state: 30,
	recentMessages: 40,
	untagged: 50,
	tools: 60,
} as const;

function parseRefs(input: string | undefined): PiRequestSnapshotMessageRef[] {
	if (!input) return [];
	try {
		const parsed = JSON.parse(input);
		return Array.isArray(parsed) ? (parsed as PiRequestSnapshotMessageRef[]) : [];
	} catch {
		return [];
	}
}

export function TurnRefsFigure({
	raw,
}: {
	raw: string;
}) {
	return (
		<div data-turn-message-refs="">
			<DocFigure
				caption="Message references"
				body={prettyJson(raw)}
				language="json"
				clamp={CLAMP.none}
				dedent={false}
			/>
		</div>
	);
}

type FetchState =
	| { phase: "idle" }
	| { phase: "loading" }
	| { phase: "error"; message: string }
	| { phase: "loaded"; context: RunTurnContextResponse };

function useRunTurnContext(
	apiBase: string | null,
	runId: string | undefined,
	turnNumber: number | undefined,
): FetchState {
	const [state, setState] = useState<FetchState>({ phase: "idle" });

	useEffect(() => {
		if (!hasApiBase(apiBase) || !runId || turnNumber === undefined) {
			setState({ phase: "idle" });
			return;
		}
		let cancelled = false;
		setState({ phase: "loading" });
		fetch(runTurnContextUrl(apiBase, runId, turnNumber))
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as RunTurnContextResponse;
			})
			.then((context) => {
				if (cancelled) return;
				if (!Array.isArray(context?.messages)) {
					throw new Error("malformed response");
				}
				setState({ phase: "loaded", context });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setState({
					phase: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			});
		return () => {
			cancelled = true;
		};
	}, [apiBase, runId, turnNumber]);

	return state;
}

function flatMessageBlocks(
	messages: readonly SanitizedMessage[],
	apiBase: string,
): DetailBlockSpec[] {
	if (messages.length === 0) {
		return [
			{
				id: "turn:context",
				slot: "content",
				caption: "Context window",
				body: "No messages were captured in this request.",
				language: "text",
				clamp: CLAMP.block,
				order: TURN_CONTENT_ORDER.context,
			},
		];
	}
	return messages.map((message, index) => {
		const role = roleStyleOf(message).label;
		return {
			id: `turn:message:${index}`,
			slot: "content" as const,
			caption:
				index === 0
					? `Context window · Message ${index + 1} · ${role}`
					: `Message ${index + 1} · ${role}`,
			node: (
				<TurnMessage
					entry={{ message, index }}
					apiBase={apiBase}
					flatView={index === 0}
				/>
			),
			clamp: CLAMP.block,
			order: TURN_CONTENT_ORDER.context + index * 10,
		};
	});
}

function responseBlocks(response: string | undefined): DetailBlockSpec[] {
	if (!response?.trim()) return [];
	return [
		{
			id: "turn:response",
			slot: "output",
			caption: "Response",
			body: response,
			language: "prompt",
			clamp: CLAMP.block,
			order: 10,
		},
	];
}

function stateUnavailableBlock(message: string): DetailBlockSpec {
	return {
		id: "turn:state-unavailable",
		slot: "content",
		caption: "State",
		body: message,
		language: "text",
		clamp: CLAMP.tight,
		expandable: false,
		order: TURN_CONTENT_ORDER.state,
	};
}

function turnTabs(
	state: DetailBlockSpec[],
	context: DetailBlockSpec[],
	system: DetailBlockSpec[],
	tools: DetailBlockSpec[],
	stateSurface?: Pick<DetailTab, "zones">,
): DetailTab[] {
	// Every tab's figures read the same way by default (see turn-figure): a
	// future tab inherits the reading window without having to ask for it.
	return [
		{
			id: "state",
			name: "State",
			blocks: withPrimaryFigurePolicy(state),
			...(stateSurface ?? {}),
		},
		{ id: "context", name: "Context", blocks: withPrimaryFigurePolicy(context) },
		{
			id: "system",
			name: "System prompt",
			blocks: withPrimaryFigurePolicy(system),
		},
		{ id: "tools", name: "Tools", blocks: withPrimaryFigurePolicy(tools) },
	];
}

export interface BuildSnapshotContextViewOptions {
	systemPrompt: string | null;
	messages: SanitizedMessage[];
	sections: ReturnType<typeof parseSectionTags>;
	apiBase: string;
	response?: string;
	/**
	 * The per-request tool roster. Absent = the snapshot predates tool capture,
	 * so the Tools tab says so; `[]` = captured with no tool active.
	 */
	tools?: SanitizedToolDefinition[];
	detailsExtras?: ReactNode;
}

/**
 * Pure builder used by the fetch-backed body and SSR tests. It returns only
 * contract data; DetailShell remains the sole owner of frames and ordering.
 */
export function buildSnapshotContextView({
	systemPrompt,
	messages,
	sections,
	apiBase,
	response,
	tools,
	detailsExtras,
}: BuildSnapshotContextViewOptions): DetailView {
	const systemBlocks = SystemPromptSection({
		systemPrompt,
		tagged: Boolean(sections),
		order: TURN_CONTENT_ORDER.system,
	});
	const contextBlocks: DetailBlockSpec[] = [];
	const stateBlocks: DetailBlockSpec[] = [];
	let stateSurface: Pick<DetailTab, "zones"> | undefined;

	if (sections) {
		const model = groupTurnSections(messages, sections);
		contextBlocks.push(
			...ContextSection({
				entries: model.context,
				apiBase,
				order: TURN_CONTENT_ORDER.context,
			}),
		);
		const state = StateSection({
			state: model.state,
			tail: model.tail,
			apiBase,
			stateOrder: TURN_CONTENT_ORDER.state,
			tailOrder: TURN_CONTENT_ORDER.recentMessages,
		});
		stateBlocks.push(...state.blocks);
		stateSurface = { zones: state.zones };
		if (model.untagged.length > 0) {
			stateBlocks.push({
				id: "turn:untagged",
				slot: "content",
				caption: "Untagged messages",
				node: (
					<div className="space-y-5">
						{model.untagged.map((entry) => (
							<TurnMessage
								key={entry.index}
								entry={entry}
								apiBase={apiBase}
							/>
						))}
					</div>
				),
				order: TURN_CONTENT_ORDER.untagged,
			});
		}
	} else {
		stateBlocks.push(
			stateUnavailableBlock(
				"Section information was not captured for this request.",
			),
		);
		contextBlocks.push(...flatMessageBlocks(messages, apiBase));
	}

	stateBlocks.push(...responseBlocks(response));
	if (stateBlocks.length === 0) {
		stateBlocks.push(
			stateUnavailableBlock("No state messages were captured for this request."),
		);
	}

	return {
		tabs: turnTabs(
			stateBlocks,
			contextBlocks,
			systemBlocks,
			ToolsSection({
				tools,
				// The roster's marker rides the snapshot's section tagging, so a
				// flat (untagged) snapshot never gains a section view from Tools.
				tagged: Boolean(sections),
				order: TURN_CONTENT_ORDER.tools,
			}),
			stateSurface,
		),
		detailsExtras,
	};
}

export const TurnBody: DetailBodyRenderer = ({ span }) => {
	const { apiBase } = useTraceViewerApi();
	const runId = readStringAttr(span, "run_id");
	const turnNumber = readNumberAttr(span, "turn_number");
	const sectionsAttr = readStringAttr(span, "sections");
	const toolsBlobHash = readStringAttr(span, "tools_blob_hash");
	const refs = useMemo(() => parseRefs(span.input), [span.input]);
	const fetchState = useRunTurnContext(apiBase, runId, turnNumber);

	const detailsExtras =
		refs.length > 0 && span.input !== undefined
			? <TurnRefsFigure raw={span.input} />
			: undefined;

	if (fetchState.phase === "loaded" && hasApiBase(apiBase)) {
		const { context } = fetchState;
		const sections = parseSectionTags(context.sections ?? sectionsAttr);
		return buildSnapshotContextView({
			systemPrompt: context.system_prompt,
			messages: context.messages,
			sections,
			apiBase,
			response: span.output,
			// Presence, not length: an absent field is a snapshot from before
			// tool capture, an empty array is a request with no tool active.
			tools: context.tools,
			detailsExtras,
		});
	}

	const message =
		fetchState.phase === "loading"
			? "Loading the full request context."
			: "The full request context is unavailable in this viewer.";
	return {
		tabs: turnTabs(
			[
				stateUnavailableBlock(
					"The request state is unavailable in this viewer.",
				),
				...responseBlocks(span.output),
			],
			[
				...ContextSection({
					entries: [],
				apiBase: apiBase ?? "",
				id: "turn:context-unavailable",
				body: message,
				tagged: false,
				language: "text",
				clamp: CLAMP.tight,
					expandable: false,
					order: TURN_CONTENT_ORDER.context,
				}),
			],
			SystemPromptSection({
				systemPrompt: null,
				tagged: false,
				order: TURN_CONTENT_ORDER.system,
			}),
			// Offline the roster itself is out of reach, but the span still says
			// whether one was ever captured: a tools blob hash means "captured,
			// just not readable here", its absence means "never captured".
			ToolsSection({
				tools: undefined,
				unavailable: Boolean(toolsBlobHash),
				tagged: false,
				order: TURN_CONTENT_ORDER.tools,
			}),
		),
		detailsExtras,
	};
};
