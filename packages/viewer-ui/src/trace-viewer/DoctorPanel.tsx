/**
 * DoctorPanel — an on-demand surface for the trace doctor (kernel invariants
 * 1-8). A compact control fetches GET /api/doctor and renders either a neutral
 * "invariants OK" chip or an expandable list of violations.
 *
 * Design-system contract:
 *   - the OK state uses the neutral lifecycle/DONE treatment (status-neutral /
 *     status-success is reserved for run success, not diagnostics) — a calm,
 *     non-alarming chip consistent with the traces list;
 *   - violations are diagnostics, so they wear the RESERVED amber/red hues:
 *     the fail banner and each violation row use destructive (red) styling,
 *     the only place in this panel that reaches those colors;
 *   - row counts render as muted META meta-text.
 *
 * The panel is dumb about identity: it hits a single doctor endpoint that
 * checks the whole kernel db, so it is not scoped to the selected trace.
 */
import { useCallback, useState, type FC } from "react";

import cn from "classnames";

export interface DoctorViolation {
	invariant: number;
	name: string;
	description: string;
	count: number;
	sampleIds: string[];
}

export interface DoctorReport {
	checkedAt: string;
	counts: {
		containers: number;
		piAgentSessions: number;
		agentRuns: number;
		traceEvents: number;
	};
	violations: DoctorViolation[];
	skipped: Array<{ invariant: number; reason: string }>;
	ok: boolean;
}

export interface DoctorPanelProps {
	/** Endpoint returning a DoctorReport (defaults to the example's route). */
	endpoint?: string;
	className?: string;
}

const LABEL = "font-mono text-[13px] leading-[16px]";
const META = "font-mono text-[11px] leading-[14px]";

type FetchState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "ready"; report: DoctorReport };

async function fetchDoctor(endpoint: string): Promise<DoctorReport> {
	const response = await fetch(endpoint);
	if (!response.ok) throw new Error(`Doctor check failed: ${response.status}`);
	return (await response.json()) as DoctorReport;
}

const CountsMeta: FC<{ counts: DoctorReport["counts"] }> = ({ counts }) => (
	<span className={cn(META, "text-muted-foreground")}>
		{counts.containers} containers · {counts.piAgentSessions} sessions ·{" "}
		{counts.agentRuns} runs · {counts.traceEvents} events
	</span>
);

const ViolationRow: FC<{ violation: DoctorViolation }> = ({ violation }) => (
	<div className="flex flex-col gap-0.5 rounded-[2px] border border-destructive/40 bg-destructive/10 px-2.5 py-1.5">
		<div className="flex items-baseline justify-between gap-2">
			<span className={cn(LABEL, "font-semibold text-destructive")}>
				[{violation.invariant}] {violation.name}
			</span>
			<span className={cn(META, "shrink-0 tabular-nums text-destructive")}>
				{violation.count} {violation.count === 1 ? "row" : "rows"}
			</span>
		</div>
		<span className={cn(META, "text-muted-foreground")}>{violation.description}</span>
		{violation.sampleIds.length > 0 && (
			<span className={cn(META, "truncate text-muted-foreground/80")}>
				samples: {violation.sampleIds.join(", ")}
			</span>
		)}
	</div>
);

export const DoctorPanel: FC<DoctorPanelProps> = ({
	endpoint = "/api/doctor",
	className,
}) => {
	const [state, setState] = useState<FetchState>({ status: "idle" });
	const [expanded, setExpanded] = useState(false);

	const runCheck = useCallback(async () => {
		setState({ status: "loading" });
		setExpanded(true);
		try {
			const report = await fetchDoctor(endpoint);
			setState({ status: "ready", report });
		} catch (err) {
			setState({
				status: "error",
				message: err instanceof Error ? err.message : String(err),
			});
		}
	}, [endpoint]);

	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={runCheck}
					disabled={state.status === "loading"}
					className={cn(
						LABEL,
						"rounded-[2px] border border-border bg-card/60 px-2 py-1 font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-status-neutral-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-neutral-border disabled:opacity-60",
					)}
				>
					{state.status === "loading" ? "Checking…" : "Doctor"}
				</button>

				{state.status === "ready" && state.report.ok && (
					<span
						className={cn(
							META,
							"rounded-[2px] border border-status-neutral-border bg-status-neutral-fill px-1.5 py-0.5 font-bold uppercase tracking-[0.08em] text-status-neutral",
						)}
					>
						Invariants OK
					</span>
				)}
				{state.status === "ready" && !state.report.ok && (
					<button
						type="button"
						onClick={() => setExpanded((prev) => !prev)}
						className={cn(
							META,
							"rounded-[2px] border border-destructive/50 bg-destructive/10 px-1.5 py-0.5 font-bold uppercase tracking-[0.08em] text-destructive",
						)}
					>
						{state.report.violations.length}{" "}
						{state.report.violations.length === 1 ? "violation" : "violations"}
						{expanded ? " ▾" : " ▸"}
					</button>
				)}
				{state.status === "ready" && <CountsMeta counts={state.report.counts} />}
			</div>

			{state.status === "error" && (
				<span className={cn(META, "text-destructive")}>{state.message}</span>
			)}

			{state.status === "ready" &&
				!state.report.ok &&
				expanded &&
				state.report.violations.length > 0 && (
					<div className="flex flex-col gap-1">
						{state.report.violations.map((violation) => (
							<ViolationRow
								key={`${violation.invariant}:${violation.name}`}
								violation={violation}
							/>
						))}
					</div>
				)}
		</div>
	);
};
