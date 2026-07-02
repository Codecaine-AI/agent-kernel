"use client";

import cn from "classnames";
import { useCallback, useEffect, useState } from "react";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import {
	KERNEL_CATALOG_PATHS,
	type CatalogAgentDetail,
	type CatalogPromptSaveResult,
	type PromptRevisionListResponse,
	type PromptRevisionSummary,
} from "@agent-kernel/viewer-core";

import { PromptInlineLab, type PromptSaveOutcome } from "./PromptInlineLab";
import { RevisionHistoryPanel } from "./RevisionHistoryPanel";
import { RevisionStatsStrip } from "./RevisionStatsStrip";

export interface AgentPromptLabContainerProps {
	/** Kernel API origin, e.g. "http://localhost:4477". */
	baseUrl: string;
	agentName: string;
	className?: string;
}

/**
 * Host-side container for the prompt lab: loads the agent's prompt from the
 * kernel catalog API, wires saving through PUT .../prompt, shows revision
 * history with block-level diffs, and a stats strip for the saved revision.
 * PromptInlineLab itself stays host-agnostic — all fetching lives here.
 */
export function AgentPromptLabContainer({
	baseUrl,
	agentName,
	className,
}: AgentPromptLabContainerProps) {
	const origin = trimTrailingSlash(baseUrl);
	const [detail, setDetail] = useState<CatalogAgentDetail | undefined>(undefined);
	const [loadError, setLoadError] = useState<string | undefined>(undefined);
	const [savedHash, setSavedHash] = useState<string | undefined>(undefined);
	/** Documents we have seen in this session, keyed by revision hash (for diffs). */
	const [documentsByHash, setDocumentsByHash] = useState<Record<string, PromptDocument>>({});
	const [revisions, setRevisions] = useState<PromptRevisionSummary[]>([]);
	const [revisionsLoading, setRevisionsLoading] = useState(false);
	const [revisionsError, setRevisionsError] = useState<string | undefined>(undefined);

	const refreshRevisions = useCallback(async () => {
		setRevisionsLoading(true);
		setRevisionsError(undefined);
		try {
			const response = await fetch(`${origin}${KERNEL_CATALOG_PATHS.agentRevisions(agentName)}`);
			if (!response.ok) throw new Error(`revisions request failed (${response.status})`);
			const body = (await response.json()) as PromptRevisionListResponse;
			setRevisions(body.revisions);
		} catch (cause) {
			setRevisionsError(cause instanceof Error ? cause.message : "revisions unavailable");
		} finally {
			setRevisionsLoading(false);
		}
	}, [origin, agentName]);

	useEffect(() => {
		let cancelled = false;
		setDetail(undefined);
		setLoadError(undefined);
		setSavedHash(undefined);
		setDocumentsByHash({});
		setRevisions([]);

		(async () => {
			try {
				const response = await fetch(`${origin}${KERNEL_CATALOG_PATHS.agentDetail(agentName)}`);
				if (!response.ok) throw new Error(`agent request failed (${response.status})`);
				const body = (await response.json()) as CatalogAgentDetail;
				if (cancelled) return;
				setDetail(body);
				setSavedHash(body.promptHash);
				setDocumentsByHash({ [body.promptHash]: body.prompt });
			} catch (cause) {
				if (!cancelled) {
					setLoadError(cause instanceof Error ? cause.message : "agent unavailable");
				}
			}
		})();
		void refreshRevisions();

		return () => {
			cancelled = true;
		};
	}, [origin, agentName, refreshRevisions]);

	const handleSave = useCallback(
		async (doc: PromptDocument): Promise<PromptSaveOutcome> => {
			try {
				const response = await fetch(`${origin}${KERNEL_CATALOG_PATHS.agentPrompt(agentName)}`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(doc),
				});
				const body = (await response.json()) as CatalogPromptSaveResult;
				if (response.ok && "hash" in body) {
					setSavedHash(body.hash);
					setDocumentsByHash((current) => ({ ...current, [body.hash]: doc }));
					void refreshRevisions();
					return { hash: body.hash };
				}
				if ("errors" in body && Array.isArray(body.errors)) {
					return { errors: body.errors };
				}
				return { errors: [`Save failed (${response.status})`] };
			} catch (cause) {
				return {
					errors: [cause instanceof Error ? cause.message : "Save failed"],
				};
			}
		},
		[origin, agentName, refreshRevisions],
	);

	if (loadError) {
		return (
			<div className={cn("flex h-full items-center justify-center p-6 font-mono", className)}>
				<p className="text-[12px] text-destructive">{loadError}</p>
			</div>
		);
	}

	if (!detail) {
		return (
			<div className={cn("flex h-full items-center justify-center p-6 font-mono", className)}>
				<p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
					Loading {agentName}…
				</p>
			</div>
		);
	}

	return (
		<div className={cn("flex h-full min-h-0 flex-col bg-card font-mono", className)}>
			<header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-3 py-2">
				<h2 className="text-[14px] leading-tight tracking-tight text-foreground">{agentName}</h2>
				<span
					className="rounded-[2px] border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground"
					title={savedHash}
				>
					{savedHash ? shortHash(savedHash) : "unsaved"}
				</span>
				<RevisionStatsStrip
					baseUrl={origin}
					agentName={agentName}
					hash={savedHash}
					className="ml-auto"
				/>
			</header>

			<div className="min-h-0 flex-1 overflow-hidden">
				<PromptInlineLab
					key={`${agentName}:${detail.promptHash}`}
					prompt={detail.prompt}
					declaredVariables={detail.declaredVariables}
					savedHash={savedHash}
					onSave={handleSave}
					className="h-full"
				/>
			</div>

			<RevisionHistoryPanel
				revisions={revisions}
				currentHash={savedHash}
				currentDocument={savedHash ? documentsByHash[savedHash] : undefined}
				documentsByHash={documentsByHash}
				loading={revisionsLoading}
				error={revisionsError}
				className="max-h-56 shrink-0 border-t border-border"
			/>
		</div>
	);
}

function shortHash(hash: string): string {
	const bare = hash.startsWith("pk1-") ? hash.slice(4) : hash;
	return bare.slice(0, 10);
}

function trimTrailingSlash(value: string): string {
	return value.endsWith("/") ? value.slice(0, -1) : value;
}
