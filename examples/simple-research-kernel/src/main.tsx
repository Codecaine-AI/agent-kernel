import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { KernelTraceViewer } from "@agent-kernel/viewer-shell";
import {
	KERNEL_TRACE_READ_PATHS,
	buildTraceSpans,
	type KernelTraceSessionDetail
} from "@agent-kernel/viewer-core";

import "./styles.css";

type ResearchHarnessInfo = {
	kernelId: string;
	concurrency: { maxBackgroundAgents: number };
	memoryDir: string;
	agents: { name: string; description: string; model: string; hasContext: boolean }[];
	activeRuns: {
		id: string;
		prompt: string;
		kind: "dummy" | "user";
		status: "running" | "completed" | "error";
		startedAt: string;
		completedAt: string | null;
		error: string | null;
	}[];
	dummySession: {
		id: string;
		label: string;
		description: string;
	};
	trace: {
		label: string;
		piSessionCount: number;
		eventCount: number;
		latestEventAt: string | null;
	};
	latestReport: string;
};

function App() {
	const [detail, setDetail] = useState<KernelTraceSessionDetail | null>(null);
	const [info, setInfo] = useState<ResearchHarnessInfo | null>(null);
	const [prompt, setPrompt] = useState(
		"Research the simplest useful Agent Harness demo: coordinator, subagents, memory, and report."
	);
	const [loading, setLoading] = useState(true);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		const [detailResponse, infoResponse] = await Promise.all([
			fetch(KERNEL_TRACE_READ_PATHS.traceSessionDetail("simple-research-kernel")),
			fetch("/api/research")
		]);
		if (!detailResponse.ok) throw new Error(`Trace read failed: ${detailResponse.status}`);
		if (!infoResponse.ok) throw new Error(`Research read failed: ${infoResponse.status}`);
		const nextDetail = (await detailResponse.json()) as KernelTraceSessionDetail;
		const nextInfo = (await infoResponse.json()) as ResearchHarnessInfo;
		setDetail(nextDetail);
		setInfo(nextInfo);
		return nextInfo;
	}, []);

	useEffect(() => {
		refresh()
			.catch((err) => setError(err instanceof Error ? err.message : String(err)))
			.finally(() => setLoading(false));
	}, [refresh]);

	useEffect(() => {
		if (!info?.activeRuns.length) return;
		const timer = window.setInterval(() => {
			refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
		}, 700);
		return () => window.clearInterval(timer);
	}, [info?.activeRuns.length, refresh]);

	const spans = useMemo(() => {
		if (!detail) return [];
		return buildTraceSpans(detail.events, detail.pi_sessions, detail.agent_runs);
	}, [detail]);

	const runAgent = async () => {
		setRunning(true);
		setError(null);
		try {
			const response = await fetch("/api/run", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ prompt })
			});
			if (!response.ok) throw new Error(`Run failed: ${response.status}`);
			for (let i = 0; i < 90; i += 1) {
				const nextInfo = await refresh();
				if (nextInfo.activeRuns.length === 0) break;
				await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 700));
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setRunning(false);
		}
	};

	return (
		<main className="flex min-h-screen flex-col gap-4 bg-background p-4 font-sans text-foreground md:p-7">
			<header className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,520px)] lg:items-end lg:gap-6">
				<div>
					<p className="mb-1.5 font-display text-[11px] font-extrabold uppercase tracking-[0.14em] text-agentprism-badge-chain-foreground">
						Pi Agent Kernel
					</p>
					<h1 className="font-display text-[32px] font-bold leading-none tracking-normal md:text-[34px]">
						Simple Research Kernel
					</h1>
					<p className="mt-2.5 max-w-[780px] text-sm leading-6 text-muted-foreground">
						A local research agent that fans out to scout subagents, waits for their
						reports, reviews gaps, and queues a final report writer.
					</p>
				</div>
				<div className="rounded-lg border border-border bg-card p-3.5">
					<label
						className="mb-2 block font-display text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground"
						htmlFor="prompt"
					>
						Research request
					</label>
					<div className="flex flex-col gap-2 sm:flex-row">
						<input
							className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-ring"
							id="prompt"
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
						/>
						<button
							className="h-9 shrink-0 rounded-md border border-border bg-foreground px-4 text-sm font-bold text-background transition-opacity disabled:cursor-wait disabled:opacity-60"
							type="button"
							onClick={runAgent}
							disabled={running}
						>
							{running ? "Researching" : "Run Research"}
						</button>
					</div>
				</div>
			</header>

			{error && (
				<div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
					{error}
				</div>
			)}

			<section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Kernel status">
				<StatusCard label="Kernel" value={info?.kernelId ?? "loading"} detail="createKernel + AgentManager" />
				<StatusCard
					label="Agents"
					value={`${info?.agents.length ?? 0} defined`}
					detail="agent.md + context.ts catalog"
				/>
				<StatusCard
					label="Memory"
					value={info?.memoryDir ?? "research-memory"}
					detail="brief, scout reports, final reports"
				/>
				<StatusCard
					label="Trace"
					value={`${info?.trace.eventCount ?? detail?.events.length ?? 0} events`}
					detail={`${info?.trace.piSessionCount ?? detail?.pi_sessions.length ?? 0} Pi sessions, ${info?.activeRuns.length ?? 0} running`}
				/>
			</section>

			<section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
				<div className="h-[calc(100vh-300px)] min-h-[620px] overflow-hidden rounded-lg border border-border bg-card">
				{loading ? (
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
						Loading kernel trace...
					</div>
				) : (
					<KernelTraceViewer
						className="flex h-full flex-col"
						spans={spans}
						initialTraceLevel={3}
						plugins={{
							containerHeader: (
								<div className="flex items-center justify-between border-b border-border bg-card px-4 py-3.5">
									<div>
										<p className="mb-1.5 font-display text-[11px] font-extrabold uppercase tracking-[0.14em] text-agentprism-badge-chain-foreground">
											Container
										</p>
										<h2 className="font-display text-lg font-bold">
											{detail?.container?.label ?? "Simple Research Kernel"}
										</h2>
									</div>
									<div className="flex gap-2">
										<span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
											{detail?.container?.phase ?? "kernel_demo"}
										</span>
										<span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
											{detail?.events.length ?? 0} events
										</span>
									</div>
								</div>
							)
						}}
					/>
				)}
				</div>

				<aside className="flex min-h-[360px] flex-col rounded-lg border border-border bg-card">
					<div className="border-b border-border px-4 py-3.5">
						<p className="mb-1.5 font-display text-[11px] font-extrabold uppercase tracking-[0.14em] text-agentprism-badge-chain-foreground">
							Final Report
						</p>
						<h2 className="font-display text-lg font-bold">Simple research kernel output</h2>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">
							{info?.activeRuns.length
								? `Running ${info.activeRuns.length} research run${info.activeRuns.length === 1 ? "" : "s"}`
								: info?.dummySession.description ?? "Seeded dummy session is available for viewing."}
						</p>
					</div>
					<div className="min-h-0 flex-1 overflow-auto p-4">
						{info?.latestReport ? (
							<pre className="whitespace-pre-wrap text-[12px] leading-5 text-muted-foreground">
								{info.latestReport}
							</pre>
						) : (
							<p className="text-sm leading-6 text-muted-foreground">
								The seeded coordinator run is preparing the first report.
							</p>
						)}
					</div>
				</aside>
			</section>
		</main>
	);
}

function StatusCard({
	label,
	value,
	detail
}: {
	label: string;
	value: string;
	detail: string;
}) {
	return (
		<div className="rounded-lg border border-border bg-card p-3.5">
			<span className="block font-display text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
				{label}
			</span>
			<strong className="mt-2 block text-lg font-bold">{value}</strong>
			<p className="mt-1.5 text-[13px] text-muted-foreground">{detail}</p>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>
);
