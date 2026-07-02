"use client";

import cn from "classnames";
import { useMemo, useState } from "react";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import {
	diffPromptDocuments,
	type PromptBlockDiffEntry,
	type PromptBlockDiffKind,
	type PromptRevisionSummary,
} from "@agent-kernel/viewer-core";

export interface RevisionHistoryPanelProps {
	/** Revision metadata rows (from GET .../revisions), newest first or not. */
	revisions: PromptRevisionSummary[];
	/** Hash of the currently saved revision (marks the row, resolves its doc). */
	currentHash?: string;
	/** Document of the current revision (from GET :name). */
	currentDocument?: PromptDocument;
	/**
	 * Documents for older revisions, keyed by hash. The revisions route only
	 * returns metadata, so a pair without loaded documents renders a
	 * "document not loaded" notice instead of a diff.
	 */
	documentsByHash?: Record<string, PromptDocument>;
	loading?: boolean;
	error?: string;
	className?: string;
}

/**
 * Lists prompt revisions and renders a block-level structural diff (by
 * stable node id — inserted / removed / moved / edited) between two selected
 * revisions.
 */
export function RevisionHistoryPanel({
	revisions,
	currentHash,
	currentDocument,
	documentsByHash,
	loading,
	error,
	className,
}: RevisionHistoryPanelProps) {
	const [selected, setSelected] = useState<string[]>([]);

	const ordered = useMemo(
		() =>
			[...revisions].sort(
				(left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
			),
		[revisions],
	);

	function toggle(hash: string) {
		setSelected((current) => {
			if (current.includes(hash)) return current.filter((entry) => entry !== hash);
			// Keep at most two selections; the oldest pick drops first.
			return [...current.slice(-1), hash];
		});
	}

	function documentFor(hash: string): PromptDocument | undefined {
		if (hash === currentHash && currentDocument) return currentDocument;
		return documentsByHash?.[hash];
	}

	const pair = useMemo(() => {
		if (selected.length !== 2) return undefined;
		// Diff older -> newer so "inserted" means "added since".
		const byAge = [...selected].sort((left, right) => {
			const leftAt = ordered.find((entry) => entry.hash === left)?.createdAt ?? "";
			const rightAt = ordered.find((entry) => entry.hash === right)?.createdAt ?? "";
			return Date.parse(leftAt) - Date.parse(rightAt);
		});
		return { older: byAge[0] as string, newer: byAge[1] as string };
	}, [selected, ordered]);

	const diff = useMemo(() => {
		if (!pair) return undefined;
		const olderDoc = documentFor(pair.older);
		const newerDoc = documentFor(pair.newer);
		if (!olderDoc || !newerDoc) return undefined;
		return diffPromptDocuments(olderDoc, newerDoc);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pair, currentHash, currentDocument, documentsByHash]);

	return (
		<section className={cn("flex min-h-0 flex-col bg-card font-mono", className)}>
			<header className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-muted/20 px-3">
				<span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
					Revisions
				</span>
				<span className="tabular-nums text-[10px] text-muted-foreground/70">
					{revisions.length}
				</span>
				<span className="ml-auto text-[10px] text-muted-foreground/60">
					select two to diff
				</span>
			</header>

			<div className="flex min-h-0 flex-1">
				<div className="min-h-0 w-72 shrink-0 overflow-auto border-r border-border">
					{loading ? (
						<Notice>Loading revisions…</Notice>
					) : error ? (
						<Notice tone="error">{error}</Notice>
					) : ordered.length === 0 ? (
						<Notice>No revisions yet</Notice>
					) : (
						<ul className="flex flex-col">
							{ordered.map((revision, index) => {
								const isSelected = selected.includes(revision.hash);
								const isCurrent = revision.hash === currentHash;
								return (
									<li key={revision.hash}>
										<button
											type="button"
											onClick={() => toggle(revision.hash)}
											aria-pressed={isSelected}
											className={cn(
												"flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors",
												index > 0 && "border-t border-border/60",
												isSelected
													? "bg-status-success-fill/25 text-foreground"
													: "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
											)}
										>
											<span className="flex items-center gap-2">
												<span className="truncate text-[12px] tabular-nums" title={revision.hash}>
													{shortHash(revision.hash)}
												</span>
												{isCurrent && (
													<span className="rounded-[2px] border border-status-success-border bg-status-success-fill/30 px-1 text-[9px] uppercase tracking-[0.1em] text-status-success">
														current
													</span>
												)}
											</span>
											<span className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
												<span className="uppercase tracking-[0.08em]">{revision.source}</span>
												<span className="tabular-nums">{formatTimestamp(revision.createdAt)}</span>
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</div>

				<div className="min-h-0 min-w-0 flex-1 overflow-auto">
					{!pair ? (
						<Notice>Select two revisions to compare their blocks.</Notice>
					) : !diff ? (
						<Notice>
							Document not loaded for {missingDocs(pair, documentFor).join(", ") || "selection"}.
						</Notice>
					) : diff.length === 0 ? (
						<Notice>No block-level changes between the selected revisions.</Notice>
					) : (
						<ul className="flex flex-col">
							{diff.map((entry, index) => (
								<DiffRow key={`${entry.kind}:${entry.id}`} entry={entry} bordered={index > 0} />
							))}
						</ul>
					)}
				</div>
			</div>
		</section>
	);
}

const DIFF_KIND_CLASSES: Record<PromptBlockDiffKind, string> = {
	inserted: "border-status-success-border bg-status-success-fill/30 text-status-success",
	removed: "border-destructive/45 bg-destructive/10 text-destructive",
	moved: "border-status-warning-border bg-status-warning-fill/30 text-status-warning",
	edited: "border-status-info-border bg-status-info-fill/30 text-status-info",
};

function DiffRow({ entry, bordered }: { entry: PromptBlockDiffEntry; bordered: boolean }) {
	return (
		<li
			className={cn(
				"flex min-w-0 items-center gap-2 px-3 py-1.5",
				bordered && "border-t border-border/60",
			)}
		>
			<span
				className={cn(
					"inline-flex h-5 w-16 shrink-0 items-center justify-center rounded-[2px] border text-[9px] uppercase tracking-[0.1em]",
					DIFF_KIND_CLASSES[entry.kind],
				)}
			>
				{entry.kind}
			</span>
			<span className="shrink-0 rounded-[2px] border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
				{entry.nodeType}
			</span>
			<span className="min-w-0 truncate text-[12px] text-foreground">{entry.label}</span>
			<span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
				{entry.id}
			</span>
		</li>
	);
}

function Notice({
	children,
	tone,
}: {
	children: React.ReactNode;
	tone?: "error";
}) {
	return (
		<p
			className={cn(
				"px-3 py-3 text-[11px] leading-relaxed",
				tone === "error" ? "text-destructive" : "text-muted-foreground/70",
			)}
		>
			{children}
		</p>
	);
}

function missingDocs(
	pair: { older: string; newer: string },
	documentFor: (hash: string) => PromptDocument | undefined,
): string[] {
	return [pair.older, pair.newer]
		.filter((hash) => !documentFor(hash))
		.map((hash) => shortHash(hash));
}

function shortHash(hash: string): string {
	const bare = hash.startsWith("pk1-") ? hash.slice(4) : hash;
	return bare.slice(0, 10);
}

function formatTimestamp(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(date);
}
