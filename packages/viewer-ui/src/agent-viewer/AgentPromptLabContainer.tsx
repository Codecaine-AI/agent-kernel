"use client";

import cn from "classnames";
import { useCallback, useEffect, useState } from "react";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import {
	KERNEL_CATALOG_PATHS,
	type CatalogAgentDetail,
	type CatalogManifestSaveResult,
	type CatalogPromptSaveResult,
	type PromptRevisionListResponse,
	type PromptRevisionSummary,
} from "@agent-kernel/viewer-core";

import type { LabContextPreview } from "./PromptInlineLab/ContextSurface";
import {
	PromptInlineLab,
	type ManifestSaveOutcome,
	type PromptSaveOutcome,
} from "./PromptInlineLab";
import { RevisionHistoryPanel } from "./RevisionHistoryPanel";
import { RevisionStatsStrip } from "./RevisionStatsStrip";

export interface AgentPromptLabContainerProps {
	/** Kernel API origin, e.g. "http://localhost:4477". */
	baseUrl: string;
	agentName: string;
	className?: string;
	/**
	 * Read-only assembled context preview for the CONTEXT view. Trace-derived
	 * (the kernel catalog detail carries only the manifest + prompt), so the
	 * host threads it in from its viewer definitions when available.
	 */
	context?: LabContextPreview;
}

interface ManifestFields {
	name: string;
	model: string;
	description: string;
}

/**
 * Host-side container for the prompt lab shell: loads the agent's catalog
 * detail (manifest + prompt + model aliases), wires prompt saves through PUT
 * .../prompt and manifest edits through PUT .../manifest, and mounts the
 * revision history + saved-revision stats beneath the shell. The shell itself
 * stays host-agnostic — all fetching lives here.
 */
export function AgentPromptLabContainer({
	baseUrl,
	agentName,
	className,
	context,
}: AgentPromptLabContainerProps) {
	const origin = trimTrailingSlash(baseUrl);
	const [detail, setDetail] = useState<CatalogAgentDetail | undefined>(undefined);
	const [loadError, setLoadError] = useState<string | undefined>(undefined);
	const [savedHash, setSavedHash] = useState<string | undefined>(undefined);
	const [manifestFields, setManifestFields] = useState<ManifestFields | undefined>(undefined);
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
		setManifestFields(undefined);
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
				setManifestFields(readManifestFields(body, agentName));
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

	const handleManifestSave = useCallback(
		async (patch: { model: string; description: string }): Promise<ManifestSaveOutcome> => {
			try {
				const response = await fetch(`${origin}${KERNEL_CATALOG_PATHS.agentManifest(agentName)}`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(patch),
				});
				const body = (await response.json()) as CatalogManifestSaveResult & { error?: string };
				if (response.ok && "manifest" in body) {
					const manifest = body.manifest;
					setManifestFields({
						name: agentName,
						model: typeof manifest.model === "string" ? manifest.model : patch.model,
						description:
							typeof manifest.description === "string" ? manifest.description : patch.description,
					});
					setDetail((current) => (current ? { ...current, manifest } : current));
					return { ok: true };
				}
				if ("errors" in body && Array.isArray(body.errors)) {
					return { errors: body.errors };
				}
				return { errors: [body.error ?? `Save failed (${response.status})`] };
			} catch (cause) {
				return { errors: [cause instanceof Error ? cause.message : "Save failed"] };
			}
		},
		[origin, agentName],
	);

	if (loadError) {
		return (
			<div className={cn("flex h-full items-center justify-center p-6 font-mono", className)}>
				<p className="text-[12px] text-destructive">{loadError}</p>
			</div>
		);
	}

	if (!detail || !manifestFields) {
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
			<div className="min-h-0 flex-1 overflow-hidden">
				<PromptInlineLab
					key={`${agentName}:${detail.promptHash}`}
					prompt={detail.prompt}
					declaredVariables={detail.declaredVariables}
					savedHash={savedHash}
					onSave={handleSave}
					manifest={{
						name: manifestFields.name,
						model: manifestFields.model,
						description: manifestFields.description,
						modelAliases: detail.modelAliases ?? [],
						editable: true,
					}}
					onManifestSave={handleManifestSave}
					context={context}
					revisionsZone={
						<RevisionHistoryPanel
							revisions={revisions}
							currentHash={savedHash}
							currentDocument={savedHash ? documentsByHash[savedHash] : undefined}
							documentsByHash={documentsByHash}
							loading={revisionsLoading}
							error={revisionsError}
							statsSlot={
								<RevisionStatsStrip
									baseUrl={origin}
									agentName={agentName}
									hash={savedHash}
								/>
							}
						/>
					}
					className="h-full"
				/>
			</div>
		</div>
	);
}

function readManifestFields(detail: CatalogAgentDetail, agentName: string): ManifestFields {
	const manifest = detail.manifest ?? {};
	return {
		name: typeof manifest.name === "string" ? manifest.name : agentName,
		model: typeof manifest.model === "string" ? manifest.model : "",
		description: typeof manifest.description === "string" ? manifest.description : "",
	};
}

function trimTrailingSlash(value: string): string {
	return value.endsWith("/") ? value.slice(0, -1) : value;
}
