"use client";

import cn from "classnames";
import { useEffect, useState } from "react";
import {
	KERNEL_CATALOG_PATHS,
	type PromptRevisionStats,
} from "@agent-kernel/viewer-core";

export interface RevisionStatsStripProps {
	/** Kernel API origin, e.g. "http://localhost:4477". */
	baseUrl: string;
	agentName: string;
	/** Revision hash to show stats for; renders nothing when absent. */
	hash?: string;
	className?: string;
}

/**
 * Compact run-analytics strip for one prompt revision: runs, average tokens
 * per run, failures, and cost ("—" when the kernel has no cost estimate).
 * Fetches GET /kernel/catalog/agents/:name/revisions/:hash/stats.
 */
export function RevisionStatsStrip({
	baseUrl,
	agentName,
	hash,
	className,
}: RevisionStatsStripProps) {
	const [stats, setStats] = useState<PromptRevisionStats | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);

	useEffect(() => {
		setStats(undefined);
		setError(undefined);
		if (!hash) return;

		const controller = new AbortController();
		const url = `${trimTrailingSlash(baseUrl)}${KERNEL_CATALOG_PATHS.revisionStats(agentName, hash)}`;
		fetch(url, { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error(`stats request failed (${response.status})`);
				return (await response.json()) as PromptRevisionStats;
			})
			.then(setStats)
			.catch((cause: unknown) => {
				if (controller.signal.aborted) return;
				setError(cause instanceof Error ? cause.message : "stats unavailable");
			});
		return () => controller.abort();
	}, [baseUrl, agentName, hash]);

	if (!hash) return null;

	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[2px] border border-border bg-muted/20 px-2.5 py-1.5 font-mono",
				className,
			)}
		>
			{error ? (
				<span className="text-[10px] text-muted-foreground/70">{error}</span>
			) : (
				<>
					<Stat label="runs" value={stats ? formatCount(stats.runs) : "…"} />
					<Stat label="avg tok" value={stats ? formatCount(Math.round(stats.avgTokens)) : "…"} />
					<Stat
						label="failures"
						value={stats ? formatCount(stats.failures) : "…"}
						tone={stats && stats.failures > 0 ? "warn" : undefined}
					/>
					<Stat label="cost" value={stats ? formatCost(stats.cost) : "…"} />
				</>
			)}
		</div>
	);
}

function Stat({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "warn";
}) {
	return (
		<span className="flex items-baseline gap-1.5">
			<span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">
				{label}
			</span>
			<span
				className={cn(
					"tabular-nums text-[12px]",
					tone === "warn" ? "text-status-warning" : "text-foreground",
				)}
			>
				{value}
			</span>
		</span>
	);
}

function formatCount(value: number): string {
	return Number.isFinite(value) ? value.toLocaleString() : "—";
}

function formatCost(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return "—";
	return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function trimTrailingSlash(value: string): string {
	return value.endsWith("/") ? value.slice(0, -1) : value;
}
