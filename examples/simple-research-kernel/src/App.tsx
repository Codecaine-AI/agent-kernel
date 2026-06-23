import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	buildTraceSpans,
	type KernelTraceSessionDetail
} from "@agent-kernel/viewer-core";

import { AgentsWorkspace } from "./_components/workspaces/AgentsWorkspace";
import { ResearchWorkspace } from "./_components/workspaces/ResearchWorkspace";
import { TraceWorkspace } from "./_components/workspaces/TraceWorkspace";
import { ResearchKernelLayout } from "./_layouts/ResearchKernelLayout";
import {
	deleteTraceSession,
	fetchResearchKernelState,
	startResearchRun,
	type FetchResearchKernelStateOptions
} from "./lib/api";
import { toAgentViewerDefinitions } from "./lib/agent-viewer-adapter";
import {
	collectLatestContextPreviews,
	collectLatestRenderedPrompts
} from "./lib/trace-selectors";
import { useWorkspaceRoute, workspaceFromPathname } from "./lib/use-workspace-route";
import type { ResearchHarnessInfo, ResearchRunSummary } from "./lib/types";

function selectedTraceIdFromLocation(): string | null {
	const params = new URLSearchParams(window.location.search);
	return params.get("traceId") ?? params.get("containerId");
}

function replaceTraceIdInUrl(traceId: string | null): void {
	const url = new URL(window.location.href);
	if (traceId) {
		url.searchParams.set("traceId", traceId);
		url.searchParams.delete("containerId");
	} else {
		url.searchParams.delete("traceId");
	}
	window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function App() {
	const { activeWorkspace, navigate } = useWorkspaceRoute();
	const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);
	const [selectedTraceSessionId, setSelectedTraceSessionId] = useState<string | null>(() =>
		activeWorkspace === "research" ? null : selectedTraceIdFromLocation()
	);
	const [detail, setDetail] = useState<KernelTraceSessionDetail | null>(null);
	const [info, setInfo] = useState<ResearchHarnessInfo | null>(null);
	const [traceSessions, setTraceSessions] = useState<
		Awaited<ReturnType<typeof fetchResearchKernelState>>["traceSessions"]
	>([]);
	const [currentResearchRun, setCurrentResearchRun] = useState<ResearchRunSummary | null>(null);
	const [loading, setLoading] = useState(true);
	const [startingRun, setStartingRun] = useState(false);
	const [deletingTraceId, setDeletingTraceId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const requestIdRef = useRef(0);

	const applyState = useCallback((next: Awaited<ReturnType<typeof fetchResearchKernelState>>) => {
		setDetail(next.detail);
		setInfo(next.info);
		setTraceSessions(next.traceSessions);
		setSelectedTraceSessionId(next.selectedTraceSessionId);
	}, []);

	const refresh = useCallback(async (
		traceSessionId?: string | null,
		options: FetchResearchKernelStateOptions = {
			selectActiveRunTrace: activeWorkspace === "research",
			selectFallbackTrace: activeWorkspace !== "research"
		}
	) => {
		const requestId = ++requestIdRef.current;
		const effectiveTraceSessionId =
			traceSessionId === undefined
				? activeWorkspace === "research"
					? (currentResearchRun?.appSessionId ?? null)
					: selectedTraceSessionId
				: traceSessionId;
		const next = await fetchResearchKernelState(effectiveTraceSessionId, options);
		if (requestId !== requestIdRef.current) return next.info;
		applyState(next);
		return next.info;
	}, [activeWorkspace, applyState, currentResearchRun?.appSessionId, selectedTraceSessionId]);

	useEffect(() => {
		setLoading(true);
		refresh()
			.catch((err) => setError(err instanceof Error ? err.message : String(err)))
			.finally(() => setLoading(false));
	}, [refresh]);

	useEffect(() => {
		if (activeWorkspace === "research" && selectedTraceIdFromLocation()) {
			replaceTraceIdInUrl(null);
		}
	}, [activeWorkspace]);

	useEffect(() => {
		function handlePopState() {
			setSelectedTraceSessionId(
				workspaceFromPathname(window.location.pathname) === "research"
					? null
					: selectedTraceIdFromLocation()
			);
		}
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	useEffect(() => {
		const selectedTrace = traceSessions.find(
			(trace) => trace.id === selectedTraceSessionId || trace.containerId === selectedTraceSessionId
		);
		const pollingCurrentRun = currentResearchRun?.status === "running";
		if (!pollingCurrentRun && !info?.activeRuns.length && selectedTrace?.status !== "running") return;
		const timer = window.setInterval(() => {
			refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
		}, 700);
		return () => window.clearInterval(timer);
	}, [currentResearchRun, info?.activeRuns.length, refresh, selectedTraceSessionId, traceSessions]);

	useEffect(() => {
		if (!currentResearchRun) return;
		const refreshedActiveRun = info?.activeRuns.find(
			(run) =>
				run.id === currentResearchRun.id ||
				run.appSessionId === currentResearchRun.appSessionId ||
				run.containerId === currentResearchRun.containerId
		);
		if (refreshedActiveRun) {
			setCurrentResearchRun(refreshedActiveRun);
			return;
		}
		const detailMatchesRun =
			detail &&
			(detail.session.id === currentResearchRun.appSessionId ||
				detail.container?.id === currentResearchRun.containerId);
		if (!detailMatchesRun) return;
		if (detail.session.status === "completed" || detail.session.status === "error") {
			setCurrentResearchRun({
				...currentResearchRun,
				status: detail.session.status,
				completedAt: detail.session.updatedAt
			});
		}
	}, [currentResearchRun, detail, info?.activeRuns]);

	useEffect(() => {
		if (!info) return;
		const firstAgent = info.agents[0]?.name ?? null;
		if (!firstAgent) return;
		if (!selectedAgentName || !info.agents.some((agent) => agent.name === selectedAgentName)) {
			setSelectedAgentName(firstAgent);
		}
	}, [info, selectedAgentName]);

	const spans = useMemo(() => {
		if (!detail) return [];
		return buildTraceSpans(detail.events, detail.pi_sessions, detail.agent_runs);
	}, [detail]);

	const renderedPrompts = useMemo(() => collectLatestRenderedPrompts(detail), [detail]);
	const contextPreviews = useMemo(() => collectLatestContextPreviews(detail), [detail]);
	const agentViewerDefinitions = useMemo(
		() => toAgentViewerDefinitions(info?.agents ?? [], renderedPrompts, contextPreviews),
		[contextPreviews, info?.agents, renderedPrompts]
	);

	const handleTraceSelect = useCallback(
		async (traceSessionId: string) => {
			setSelectedTraceSessionId(traceSessionId);
			replaceTraceIdInUrl(traceSessionId);
			setLoading(true);
			setError(null);
			try {
				await refresh(traceSessionId, { selectFallbackTrace: true });
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setLoading(false);
			}
		},
		[refresh]
	);

	const handleTraceDelete = useCallback(
		async (traceSessionId: string) => {
			const trace = traceSessions.find(
				(item) => item.id === traceSessionId || item.containerId === traceSessionId
			);
			const deletingSelectedTrace =
				selectedTraceSessionId === traceSessionId ||
				(trace
					? trace.id === selectedTraceSessionId || trace.containerId === selectedTraceSessionId
					: false);
			const label = trace?.topic ?? trace?.label ?? traceSessionId;
			const confirmed = window.confirm(
				[
					`Delete "${label}" from the database?`,
					"",
					"This removes its containers, Pi sessions, agent runs, and trace events."
				].join("\n")
			);
			if (!confirmed) return;

			setDeletingTraceId(traceSessionId);
			setLoading(true);
			setError(null);
			try {
				await deleteTraceSession(traceSessionId);
				const next = await fetchResearchKernelState(
					deletingSelectedTrace ? null : selectedTraceSessionId,
					{ selectFallbackTrace: deletingSelectedTrace || activeWorkspace === "trace" }
				);
				applyState(next);
				replaceTraceIdInUrl(next.selectedTraceSessionId);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setDeletingTraceId(null);
				setLoading(false);
			}
		},
		[activeWorkspace, applyState, selectedTraceSessionId, traceSessions]
	);

	const handleStartRun = useCallback(
		async (prompt: string) => {
			setStartingRun(true);
			setError(null);
			try {
				const result = await startResearchRun(prompt);
				const nextTraceId = result.trace?.id ?? result.run.appSessionId;
				setCurrentResearchRun(result.run);
				setSelectedTraceSessionId(nextTraceId);
				if (activeWorkspace === "research") {
					replaceTraceIdInUrl(null);
				} else {
					replaceTraceIdInUrl(nextTraceId);
				}
				await refresh(nextTraceId, { selectFallbackTrace: false });
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setStartingRun(false);
			}
		},
		[activeWorkspace, refresh]
	);

	const handleOpenTrace = useCallback(() => {
		const traceId = selectedTraceSessionId ?? detail?.session.id ?? null;
		if (traceId) replaceTraceIdInUrl(traceId);
		navigate("trace");
	}, [detail?.session.id, navigate, selectedTraceSessionId]);

	return (
		<ResearchKernelLayout
			activeWorkspace={activeWorkspace}
			onWorkspaceChange={navigate}
		>
			{error && (
				<div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
					{error}
				</div>
			)}
			{activeWorkspace === "research" && (
				<ResearchWorkspace
					detail={detail}
					info={info}
					spans={spans}
					traceSessions={traceSessions}
					selectedTraceSessionId={selectedTraceSessionId}
					currentResearchRun={currentResearchRun}
					loading={loading}
					startingRun={startingRun}
					onStartRun={handleStartRun}
					onOpenTrace={handleOpenTrace}
				/>
			)}
			{activeWorkspace === "trace" && (
				<TraceWorkspace
					detail={detail}
					spans={spans}
					traceSessions={traceSessions}
					selectedTraceSessionId={selectedTraceSessionId}
					loading={loading}
					deletingTraceId={deletingTraceId}
					onTraceSelect={handleTraceSelect}
					onTraceDelete={handleTraceDelete}
				/>
			)}
			{activeWorkspace === "agents" && (
				<AgentsWorkspace
					agents={agentViewerDefinitions}
					selectedAgentName={selectedAgentName}
					onAgentSelect={setSelectedAgentName}
				/>
			)}
		</ResearchKernelLayout>
	);
}
