/**
 * accumulation-guard.ts — Session-level "inject context once" guard.
 *
 * After the per-spawn-Pi-session change every plan agent spawn creates a
 * fresh Pi session, so this guard is a defensive no-op for plan agents on
 * the default path. It only matters for the opt-in reuseExistingSession
 * path (e.g. PlanAgentService.sendFeedback) where multiple turns share one
 * session — there the marker prevents re-running the context loader and
 * re-appending the rendered block on the second+ turn.
 *
 * The marker is written as a CustomMessageEntry (not a plain CustomEntry)
 * so the rendered context block participates in the LLM transcript on
 * replay. agentName lives in `details` because CustomMessageEntry.customType
 * is a flat string — `details` carries the extra discrimination needed for
 * multi-agent session isolation.
 */

import type { BuildContextResult, InputsSummaryEntry } from "./types";

export const AGENT_CONTEXT_MARKER = "agent-context";

export interface AgentContextEntryData {
	agentName: string;
	inputs: InputsSummaryEntry[];
	totalBytes: number;
	writtenAt: string;
}

interface AppendableSession {
	sessionManager: unknown;
}

function readEntries(session: AppendableSession): ReadonlyArray<unknown> {
	const mgr = session.sessionManager as unknown as {
		getEntries?: () => unknown[];
	} | undefined;
	if (!mgr || typeof mgr.getEntries !== "function") return [];
	try {
		return mgr.getEntries();
	} catch {
		return [];
	}
}

export function hasAgentContext(
	session: AppendableSession,
	agentName: string,
): boolean {
	for (const entry of readEntries(session)) {
		const e = entry as {
			type?: string;
			customType?: string;
			details?: { agentName?: string } | null;
		};
		if (e.type !== "custom_message") continue;
		if (e.customType !== AGENT_CONTEXT_MARKER) continue;
		if (e.details?.agentName !== agentName) continue;
		return true;
	}
	return false;
}

export function injectAgentContext(
	session: AppendableSession,
	agentName: string,
	result: BuildContextResult,
): void {
	const details: AgentContextEntryData = {
		agentName,
		inputs: result.inputsSummary,
		totalBytes: result.totalBytes,
		writtenAt: new Date().toISOString(),
	};
	const mgr = session.sessionManager as unknown as {
		appendCustomMessageEntry(
			customType: string,
			content: string,
			display: boolean,
			details: AgentContextEntryData,
		): string;
	};
	mgr.appendCustomMessageEntry(
		AGENT_CONTEXT_MARKER,
		result.renderedContext,
		false,
		details,
	);
}
