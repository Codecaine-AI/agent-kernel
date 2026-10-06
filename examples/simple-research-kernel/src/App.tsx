import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	buildTraceSpans,
	type KernelTraceSessionDetail
} from "@agent-kernel/viewer-core";

import { AgentsWorkspace } from "./_components/AgentsWorkspace";
import { ResearchWorkspace } from "./_components/ResearchWorkspace";
import { TraceWorkspace } from "./_components/TraceWorkspace";
import { ResearchKernelLayout } from "./_components/ResearchKernelLayout";
import {
	deleteTraceSession,
	fetchResearchKernelState,
	startResearchRun,
	type FetchResearchKernelStateOptions
} from "@/shared/api";
import {
	loadResearchStyleSettings,
	mergeResearchStyleSettings,
	saveResearchStyleSettings,
	type ResearchStyleSettings,
	type ResearchStyleSettingsPatch
} from "@/shared/style-settings";
import type { ResearchHarnessInfo, ResearchRunSummary } from "@/shared/types";
import { replaceTraceIdInUrl, selectedTraceIdFromLocation } from "./trace-url";
import { useWorkspaceRoute } from "./useWorkspaceRoute";
import { workspaceFromPathname } from "./workspace-paths";

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
	const [styleSettings, setStyleSettingsState] = useState<ResearchStyleSettings>(loadResearchStyleSettings);
	const requestIdRef = useRef(0);

	const setStyleSettings = useCallback((updates: ResearchStyleSettingsPatch) => {
		setStyleSettingsState((current) => mergeResearchStyleSettings(current, updates));
	}, []);

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
					? (currentResearchRun?.containerId ?? null)
					: selectedTraceSessionId
				: traceSessionId;
		const next = await fetchResearchKernelState(effectiveTraceSessionId, options);
		if (requestId !== requestIdRef.current) return next.info;
		applyState(next);
		return next.info;
	}, [activeWorkspace, applyState, currentResearchRun?.containerId, selectedTraceSessionId]);

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
		saveResearchStyleSettings(styleSettings);
	}, [styleSettings]);

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
				run.containerId === currentResearchRun.containerId
		);
		if (refreshedActiveRun) {
			setCurrentResearchRun(refreshedActiveRun);
			return;
		}
		const detailMatchesRun =
			detail &&
			(detail.session.id === currentResearchRun.containerId ||
				detail.container?.id === currentResearchRun.containerId);
		if (!detailMatchesRun) return;
		// Session containers close with "done" | "error" (container status
		// vocabulary); the run summary uses "completed" | "error".
		if (detail.session.status === "done" || detail.session.status === "error") {
			setCurrentResearchRun({
				...currentResearchRun,
				status: detail.session.status === "done" ? "completed" : "error",
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
				const nextTraceId = result.trace?.id ?? result.run.containerId;
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
			styleSettings={styleSettings}
			onStyleSettingsChange={setStyleSettings}
		>
			{error && (
				<div className="mb-4 rounded border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-ui-lg text-destructive">
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
					traceIcons={styleSettings.traceIcons}
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
					traceIcons={styleSettings.traceIcons}
				/>
			)}
			{activeWorkspace === "agents" && (
				<AgentsWorkspace
					agents={info?.agents}
					detail={detail}
					selectedAgentName={selectedAgentName}
					onAgentSelect={setSelectedAgentName}
				/>
			)}
		</ResearchKernelLayout>
	);
}
