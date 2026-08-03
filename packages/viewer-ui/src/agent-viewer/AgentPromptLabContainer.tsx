"use client";

import cn from "classnames";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import {
	KERNEL_CATALOG_PATHS,
	type CatalogAgentDetail,
	type CatalogContextPreview,
	type CatalogManifestSaveResult,
	type PromptRevisionListResponse,
	type PromptRevisionSummary,
} from "@agent-kernel/viewer-core";

import {
	PromptInlineLab,
	type LabContextPreview,
	type ManifestSaveOutcome,
	type PromptSaveOutcome,
} from "@codecaine-ai/prompt-kit/ui/lab";
import type { PromptStyleSettings } from "@codecaine-ai/prompt-kit/ui/style";
import {
	loadPromptRevisionDocument,
	savePromptDocument,
} from "./catalog-client";
import {
	createPromptEditClient,
	type PromptEditClient,
} from "./prompt-edit-client";
import {
	createPromptLabSessionController,
	type PromptLabSessionController,
} from "./prompt-lab-session-controller";
import { RevisionHistoryPanel } from "./RevisionHistoryPanel";
import { RevisionStatsStrip } from "./RevisionStatsStrip";

export interface AgentPromptLabContainerProps {
	/** Kernel API origin, e.g. "http://localhost:4477". */
	baseUrl: string;
	agentName: string;
	className?: string;
	/**
	 * Host override for the CONTEXT view. The catalog detail payload already
	 * carries an assembled context preview; pass this only to substitute a
	 * trace-derived preview from the host's viewer definitions.
	 */
	context?: LabContextPreview;
	/** Viewer-only style settings controlled by the host application. */
	styleSettings?: PromptStyleSettings;
	/**
	 * Test seam: substitute the annotation/session client (defaults to the
	 * real fetch-backed client scoped to baseUrl + agentName).
	 */
	promptEditClient?: PromptEditClient;
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
 * revision history + saved-revision stats beneath the shell.
 *
 * Phase 2 wiring (plan item 9): annotate-mode composer submissions persist to
 * the kernel's annotation sidecar (the lab's in-memory store fallback is
 * unused here), the header strip's "Apply N notes" creates a prompt-edit
 * session (spawning the prompt-editor agent server-side), an SSE subscription
 * mirrors the session state, and staged proposals surface through the lab's
 * `promptEditSession` prop for inline accept/reject/undo. Accepted proposals
 * write new revisions server-side — the container refetches the agent detail
 * per revision move so accepted text renders as normal rows.
 *
 * The shell itself stays host-agnostic — all fetching lives here (and in the
 * framework-free controller, prompt-lab-session-controller.ts).
 */
export function AgentPromptLabContainer({
	baseUrl,
	agentName,
	className,
	context,
	styleSettings,
	promptEditClient,
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

	const detailRef = useRef<CatalogAgentDetail | undefined>(undefined);
	detailRef.current = detail;

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

	const loadDetail = useCallback(async (): Promise<void> => {
		const response = await fetch(`${origin}${KERNEL_CATALOG_PATHS.agentDetail(agentName)}`);
		if (!response.ok) throw new Error(`agent request failed (${response.status})`);
		const body = (await response.json()) as CatalogAgentDetail;
		setDetail(body);
		setSavedHash(body.promptHash);
		setManifestFields(readManifestFields(body, agentName));
		setDocumentsByHash((current) => ({ ...current, [body.promptHash]: body.prompt }));
	}, [origin, agentName]);

	// Latest-detail refresh, reachable from the (agent-stable) controller.
	const refreshPromptRef = useRef<() => Promise<void>>(async () => {});
	refreshPromptRef.current = async () => {
		await loadDetail();
		void refreshRevisions();
	};

	const client = useMemo<PromptEditClient>(
		() =>
			promptEditClient ??
			createPromptEditClient({ origin, agentName }),
		[promptEditClient, origin, agentName],
	);

	const controller = useMemo<PromptLabSessionController>(
		() =>
			createPromptLabSessionController({
				client,
				docId: () => detailRef.current?.prompt.id ?? "",
				onPromptRefresh: () => refreshPromptRef.current(),
			}),
		[client],
	);

	useEffect(() => {
		void controller.load();
		return () => controller.dispose();
	}, [controller]);

	const sessionSnapshot = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
		controller.getSnapshot,
	);
	const promptEditSession = controller.labSession() ?? undefined;

	useEffect(() => {
		let cancelled = false;
		setDetail(undefined);
		setLoadError(undefined);
		setSavedHash(undefined);
		setManifestFields(undefined);
		setDocumentsByHash({});
		setRevisions([]);

		loadDetail().catch((cause) => {
			if (!cancelled) {
				setLoadError(cause instanceof Error ? cause.message : "agent unavailable");
			}
		});
		void refreshRevisions();

		return () => {
			cancelled = true;
		};
	}, [loadDetail, refreshRevisions]);

	const handleSave = useCallback(
		async (doc: PromptDocument): Promise<PromptSaveOutcome> => {
			try {
				const outcome = await savePromptDocument(origin, agentName, doc, savedHash);
				if ("hash" in outcome) {
					setSavedHash(outcome.hash);
					setDocumentsByHash((current) => ({ ...current, [outcome.hash]: doc }));
					void refreshRevisions();
					return outcome;
				}
				return outcome;
			} catch (cause) {
				return {
					errors: [cause instanceof Error ? cause.message : "Save failed"],
				};
			}
		},
		[origin, agentName, savedHash, refreshRevisions],
	);

	const handleLoadRevisionDocument = useCallback(
		async (hash: string): Promise<PromptDocument> => {
			const revision = await loadPromptRevisionDocument(origin, agentName, hash);
			return revision.document;
		},
		[origin, agentName],
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

	const session = sessionSnapshot.session;
	const stagedCount = promptEditSession?.proposals.length ?? 0;
	const showSessionStrip =
		session !== null ||
		sessionSnapshot.sessionStarting ||
		sessionSnapshot.openRequestCount > 0 ||
		sessionSnapshot.sessionError !== undefined ||
		sessionSnapshot.annotationsError !== undefined ||
		sessionSnapshot.streamError !== undefined;
	const stripError =
		sessionSnapshot.sessionError ??
		sessionSnapshot.annotationsError ??
		(sessionSnapshot.streamError !== undefined
			? `Event stream dropped (${sessionSnapshot.streamError}) — reviews still work.`
			: undefined);

	return (
		<div className={cn("flex h-full min-h-0 flex-col bg-card font-mono", className)}>
			{showSessionStrip && (
				<div
					data-prompt-session-strip=""
					className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-background px-3 py-1.5 text-[11px]"
				>
					{session === null && !sessionSnapshot.sessionStarting && (
						<>
							{sessionSnapshot.openRequestCount > 0 && (
								<span className="text-muted-foreground">
									{sessionSnapshot.openRequestCount} open note
									{sessionSnapshot.openRequestCount === 1 ? "" : "s"}
								</span>
							)}
							{sessionSnapshot.openRequestCount > 0 && (
								<button
									type="button"
									data-prompt-session-run=""
									className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:border-ring"
									onClick={() => void controller.startSession()}
								>
									Apply {sessionSnapshot.openRequestCount} note
									{sessionSnapshot.openRequestCount === 1 ? "" : "s"}
								</button>
							)}
						</>
					)}
					{sessionSnapshot.sessionStarting && (
						<span className="text-muted-foreground">Starting session…</span>
					)}
					{session !== null && (
						<>
							<span className="text-muted-foreground">
								{session.agent.error !== undefined
									? `Agent failed to start: ${session.agent.error}`
									: session.status === "running"
										? session.agent.spawned
											? "Agent working…"
											: "Session open (no agent run)"
										: "Agent finished"}
							</span>
							{stagedCount > 0 && (
								<span className="text-teal-500">
									{stagedCount} proposal{stagedCount === 1 ? "" : "s"} staged
								</span>
							)}
							{stagedCount > 1 && (
								<button
									type="button"
									className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:border-ring"
									onClick={() => void controller.acceptAll()}
								>
									Accept all
								</button>
							)}
							<button
								type="button"
								data-prompt-session-end=""
								className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-ring"
								onClick={() => void controller.endSession()}
							>
								End session
							</button>
						</>
					)}
					{stripError !== undefined && (
						<span className="text-destructive">{stripError}</span>
					)}
				</div>
			)}
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
					context={context ?? toLabContextPreview(detail.context)}
					styleSettings={styleSettings}
					promptEditSession={promptEditSession}
					revisionsZone={
						<RevisionHistoryPanel
							revisions={revisions}
							currentHash={savedHash}
							currentDocument={savedHash ? documentsByHash[savedHash] : undefined}
							documentsByHash={documentsByHash}
							loadDocument={handleLoadRevisionDocument}
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

function toLabContextPreview(
	preview: CatalogContextPreview | null | undefined,
): LabContextPreview | undefined {
	if (!preview) return undefined;
	return {
		renderedContext: preview.renderedContext,
		inputs: preview.inputs,
		modulePath: preview.modulePath,
	};
}

function trimTrailingSlash(value: string): string {
	return value.endsWith("/") ? value.slice(0, -1) : value;
}
