import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { KernelTraceViewer } from "@agent-kernel/viewer-shell";
import {
	KERNEL_TRACE_READ_PATHS,
	buildTraceSpans,
	type KernelTraceSessionDetail
} from "@agent-kernel/viewer-core";

import "./styles.css";

type WorkbenchInfo = {
	kernelId: string;
	concurrency: { maxBackgroundAgents: number };
	trace: {
		label: string;
		piSessionCount: number;
		eventCount: number;
		latestEventAt: string | null;
	};
};

function App() {
	const [detail, setDetail] = useState<KernelTraceSessionDetail | null>(null);
	const [info, setInfo] = useState<WorkbenchInfo | null>(null);
	const [prompt, setPrompt] = useState("Show the context loader and viewer wiring.");
	const [loading, setLoading] = useState(true);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		const [detailResponse, infoResponse] = await Promise.all([
			fetch(KERNEL_TRACE_READ_PATHS.traceSessionDetail("basic-demo")),
			fetch("/api/workbench")
		]);
		if (!detailResponse.ok) throw new Error(`Trace read failed: ${detailResponse.status}`);
		if (!infoResponse.ok) throw new Error(`Workbench read failed: ${infoResponse.status}`);
		setDetail((await detailResponse.json()) as KernelTraceSessionDetail);
		setInfo((await infoResponse.json()) as WorkbenchInfo);
	}, []);

	useEffect(() => {
		refresh()
			.catch((err) => setError(err instanceof Error ? err.message : String(err)))
			.finally(() => setLoading(false));
	}, [refresh]);

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
			await refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setRunning(false);
		}
	};

	return (
		<main className="flex min-h-screen flex-col gap-4 bg-background p-7 font-sans text-foreground">
			<header className="grid grid-cols-[minmax(0,1fr)_520px] items-end gap-6">
				<div>
					<p className="mb-1.5 font-display text-[11px] font-extrabold uppercase tracking-[0.14em] text-agentprism-badge-chain-foreground">
						Pi Agent Kernel
					</p>
					<h1 className="font-display text-[34px] font-bold leading-none tracking-normal">
						Basic Kernel Workbench
					</h1>
					<p className="mt-2.5 max-w-[780px] text-sm leading-6 text-muted-foreground">
						A tiny non-Spectre app wiring the kernel runtime facade, context loader catalog,
						protocol events, read API, and viewer shell.
					</p>
				</div>
				<div className="rounded-lg border border-border bg-card p-3.5">
					<label
						className="mb-2 block font-display text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground"
						htmlFor="prompt"
					>
						Demo prompt
					</label>
					<div className="flex gap-2">
						<input
							className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-ring"
							id="prompt"
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
						/>
						<button
							className="h-9 rounded-md border border-border bg-foreground px-4 text-sm font-bold text-background transition-opacity disabled:cursor-wait disabled:opacity-60"
							type="button"
							onClick={runAgent}
							disabled={running}
						>
							{running ? "Running" : "Run Agent"}
						</button>
					</div>
				</div>
			</header>

			{error && (
				<div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
					{error}
				</div>
			)}

			<section className="grid grid-cols-4 gap-3" aria-label="Kernel status">
				<StatusCard label="Kernel" value={info?.kernelId ?? "loading"} detail="createKernel instance" />
				<StatusCard
					label="Context"
					value="text + memory"
					detail="base loader plus app-registered loader"
				/>
				<StatusCard
					label="Trace"
					value={`${info?.trace.eventCount ?? detail?.events.length ?? 0} events`}
					detail={`${info?.trace.piSessionCount ?? detail?.pi_sessions.length ?? 0} Pi sessions`}
				/>
				<StatusCard label="Viewer" value={`${spans.length} roots`} detail="viewer-core -> viewer-shell" />
			</section>

			<section className="h-[calc(100vh-255px)] min-h-[660px] overflow-hidden rounded-lg border border-border bg-card">
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
											{detail?.container?.label ?? "Basic Kernel Workbench"}
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
