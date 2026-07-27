import {
	KERNEL_TRACE_READ_PATHS,
	type KernelTraceSessionDetail,
	type KernelTraceSessionSummary
} from "@agent-kernel/viewer-core";

import type { ResearchHarnessInfo, ResearchRunSummary } from "./types";

export const RESEARCH_KERNEL_ID = "simple-research-kernel";

/**
 * Base URL handed to KernelTraceViewer so the detail-panel renderers can fetch
 * content-addressed payloads — snapshot blobs and the per-turn request context
 * behind the three-section turn view.
 *
 * "" is same-origin: the renderers gate on `apiBase === null`, so an empty
 * prefix stays online and yields relative "/kernel/…" URLs. Vite proxies
 * /kernel to the API server in dev, and prod serves both together, so
 * same-origin is right in both — and it needs no `window` at import time.
 */
export const KERNEL_TRACE_API_BASE = "";

export type ResearchKernelState = {
	detail: KernelTraceSessionDetail | null;
	info: ResearchHarnessInfo;
	selectedTraceSessionId: string | null;
	traceSessions: KernelTraceSessionSummary[];
};

export type StartResearchRunResponse = {
	ok: boolean;
	run: ResearchRunSummary;
	trace: KernelTraceSessionSummary | null;
};

export type DeleteTraceSessionResponse = {
	ok: boolean;
	containerIds: string[];
	piSessionIds: string[];
	deleted: {
		traceEvents: number;
		agentRuns: number;
		piAgentSessions: number;
		containers: number;
	};
};

export type FetchResearchKernelStateOptions = {
	selectActiveRunTrace?: boolean;
	selectFallbackTrace?: boolean;
};

function fallbackTraceId(sessions: KernelTraceSessionSummary[]): string | null {
	const trace = sessions[0] ?? null;
	return trace?.id ?? trace?.containerId ?? null;
}

export async function fetchTraceSessions(): Promise<KernelTraceSessionSummary[]> {
	const response = await fetch(KERNEL_TRACE_READ_PATHS.listTraceSessions);
	if (!response.ok) throw new Error(`Trace list failed: ${response.status}`);
	const list = (await response.json()) as { trace_sessions: KernelTraceSessionSummary[] };
	return list.trace_sessions;
}

export async function fetchTraceSessionDetail(
	traceSessionId: string
): Promise<KernelTraceSessionDetail> {
	const response = await fetch(KERNEL_TRACE_READ_PATHS.traceSessionDetail(traceSessionId));
	if (!response.ok) throw new Error(`Trace read failed: ${response.status}`);
	return (await response.json()) as KernelTraceSessionDetail;
}

export async function fetchResearchInfo(): Promise<ResearchHarnessInfo> {
	const response = await fetch("/api/research");
	if (!response.ok) throw new Error(`Research read failed: ${response.status}`);
	return (await response.json()) as ResearchHarnessInfo;
}

export async function startResearchRun(prompt: string): Promise<StartResearchRunResponse> {
	const response = await fetch("/api/run", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ prompt })
	});
	if (!response.ok) throw new Error(`Research run failed: ${response.status}`);
	return (await response.json()) as StartResearchRunResponse;
}

export async function deleteTraceSession(
	traceSessionId: string
): Promise<DeleteTraceSessionResponse> {
	const response = await fetch(`/api/traces/${encodeURIComponent(traceSessionId)}`, {
		method: "DELETE"
	});
	if (!response.ok) {
		let message = `Trace delete failed: ${response.status}`;
		try {
			const payload = (await response.json()) as { error?: unknown };
			if (typeof payload.error === "string") message = `${message}: ${payload.error}`;
		} catch {
			// Keep the status-only error if the response is not JSON.
		}
		throw new Error(message);
	}
	return (await response.json()) as DeleteTraceSessionResponse;
}

export async function fetchResearchKernelState(
	traceSessionId: string | null = null,
	options: FetchResearchKernelStateOptions = {}
): Promise<ResearchKernelState> {
	const [traceSessions, info] = await Promise.all([
		fetch(KERNEL_TRACE_READ_PATHS.listTraceSessions),
		fetch("/api/research")
	]);

	if (!traceSessions.ok) throw new Error(`Trace list failed: ${traceSessions.status}`);
	if (!info.ok) throw new Error(`Research read failed: ${info.status}`);

	const list = (await traceSessions.json()) as { trace_sessions: KernelTraceSessionSummary[] };
	const sessions = list.trace_sessions;
	const researchInfo = (await info.json()) as ResearchHarnessInfo;
	const activeRunTraceId = researchInfo.activeRuns[0]?.containerId ?? null;
	const selectedTraceSessionId =
		traceSessionId ??
		(options.selectActiveRunTrace ? activeRunTraceId : null) ??
		(options.selectFallbackTrace ? fallbackTraceId(sessions) : null);
	let detail: KernelTraceSessionDetail | null = null;

	if (selectedTraceSessionId) {
		try {
			detail = await fetchTraceSessionDetail(selectedTraceSessionId);
		} catch (error) {
			const fallbackId = fallbackTraceId(sessions);
			if (!traceSessionId || !fallbackId || fallbackId === selectedTraceSessionId) {
				throw error;
			}
			detail = await fetchTraceSessionDetail(fallbackId);
		}
	}

	return {
		detail,
		info: researchInfo,
		selectedTraceSessionId: detail?.session.id ?? selectedTraceSessionId ?? null,
		traceSessions: sessions
	};
}
