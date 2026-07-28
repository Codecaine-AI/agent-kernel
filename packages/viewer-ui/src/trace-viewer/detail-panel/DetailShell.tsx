"use client";

/** The sole layout owner for every trace detail view. */
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	isValidElement,
	type JSX,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactElement,
	type ReactNode,
	type Ref,
} from "react";
import { createPortal } from "react-dom";
import type { TraceSpan } from "@evilmartians/agent-prism-types";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronRight, X } from "lucide-react";
import cn from "classnames";

import { resolveSpanIcon, spanIconFor } from "../icons";
import { spanDisplayTypeOf } from "../span-style";
import {
	type DetailBlockSpec,
	type DetailTab,
	type DetailView,
} from "./contract";
import {
	compareDetailBlocks,
	mergeDetailBlockLists,
	useDetailBlocks,
} from "./blocks";
import {
	DetailSubtabs,
	DetailZones,
	partitionZoneBlocks,
} from "./DetailStream";
import { resolveEscapeLayer } from "./escape";
import {
	DetailImageModalProvider,
	type DetailImageSpec,
} from "./DetailImageTrigger";
import { DetailsView } from "./DetailsView";
import { DocFigure, DocFigureCaption } from "./doc-figure/DocFigure";
import { Clamped } from "./doc-figure/Clamped";
import { CLAMP, shouldClamp } from "./doc-figure/clamp";

export interface DetailShellProps {
	span: TraceSpan;
	view: DetailView;
}

/**
 * @internal Pure Escape precedence rule used by the shell and contract tests.
 * The ladder is modal → Details takeover; Details closes only when nothing
 * sits above it.
 */
export function shouldCloseDetailsOnEscape(
	detailsOpen: boolean,
	modalOpen: boolean,
): boolean {
	return resolveEscapeLayer({ modalOpen, detailsOpen }) === "details";
}

function nodeText(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(nodeText).join("");
	if (!isValidElement(node)) return "";
	return nodeText((node as ReactElement<{ children?: ReactNode }>).props.children);
}

function ExpandFigureButton({
	caption,
	onClick,
}: {
	caption: string;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			data-detail-modal-trigger=""
			aria-label={`Expand ${caption}`}
			onClick={onClick}
			className="grid size-6 shrink-0 place-items-center rounded-[3px] font-mono text-sm leading-none text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-info-border"
		>
			<span aria-hidden="true">⤢</span>
		</button>
	);
}

function NodeFigure({
	block,
	isErrorOutput,
	hideCaption,
	onOpenModal,
}: {
	block: DetailBlockSpec;
	isErrorOutput: boolean;
	hideCaption: boolean;
	onOpenModal?: () => void;
}): JSX.Element {
	const text = nodeText(block.node);
	const policy = block.clamp ?? CLAMP.block;
	const needsExpansion = Boolean(
		onOpenModal &&
			shouldClamp(
				policy,
				Math.max(1, text.split("\n").length),
				text.length,
			),
	);
	return (
		<figure
			data-doc-figure=""
			className={cn(
				"min-w-0 max-w-full rounded-md border border-border/60",
				isErrorOutput && "border-destructive/60",
			)}
		>
			{hideCaption ? null : (
				<figcaption className="flex min-w-0 items-center gap-2 border-b border-border/60 bg-muted/20 px-3 py-2">
					<span className={DocFigureCaption}>{block.caption}</span>
					{needsExpansion && onOpenModal ? (
						<div className="ml-auto">
							<ExpandFigureButton
								caption={block.caption}
								onClick={onOpenModal}
							/>
						</div>
					) : null}
				</figcaption>
			)}
			<Clamped
				policy={policy}
				lineCount={Math.max(1, text.split("\n").length)}
				charCount={text.length}
			>
				<div className="min-w-0 p-3">{block.node}</div>
			</Clamped>
		</figure>
	);
}

function DetailBlock({
	block,
	span,
	inModal = false,
	onOpenModal,
}: {
	block: DetailBlockSpec;
	span: TraceSpan;
	inModal?: boolean;
	onOpenModal: (block: DetailBlockSpec) => void;
}): JSX.Element {
	const [open, setOpen] = useState(block.defaultOpen ?? true);
	const hasBody = block.body !== undefined;
	const hasNode = block.node !== undefined;
	if (process.env.NODE_ENV !== "production" && hasBody === hasNode) {
		throw new Error(
			`Detail block "${block.id}" must provide exactly one of body or node.`,
		);
	}
	const clamp = inModal ? CLAMP.none : (block.clamp ?? CLAMP.block);
	const isErrorOutput = span.status === "error" && block.slot === "output";
	const isCollapsible = Boolean(block.collapsible && !inModal);
	const modalCallback =
		!inModal && block.expandable !== false
			? () => onOpenModal(block)
			: undefined;
	const sourceText = hasBody ? (block.body ?? "") : nodeText(block.node);
	const needsShellExpansion = Boolean(
		isCollapsible &&
			modalCallback &&
			shouldClamp(
				clamp,
				Math.max(1, sourceText.split("\n").length),
				sourceText.length,
			),
	);

	const content = (
		<>
			{hasBody ? (
				<>
					<DocFigure
						caption={block.caption}
						body={block.body ?? ""}
						language={block.language}
						gutter={block.gutter}
						inlineRows={block.inlineRows}
						clamp={clamp}
						onOpenModal={modalCallback}
						hideCaption={isCollapsible || inModal}
						className={cn(
							(isCollapsible || inModal) && "rounded-none border-0",
							isErrorOutput && "border-destructive/60",
						)}
					/>
					{block.attachments ? (
						<div className="mt-3 min-w-0">{block.attachments}</div>
					) : null}
				</>
			) : block.selfFramed ? (
				// Self-framed content supplies its own cards; a figure around them
				// would be a frame around N frames. It floats on the surface.
				<div data-detail-block-bare="" className="min-w-0">
					{block.node}
				</div>
			) : (
				<NodeFigure
					block={{ ...block, clamp }}
					isErrorOutput={isErrorOutput}
					hideCaption={isCollapsible || inModal}
					onOpenModal={isCollapsible ? undefined : modalCallback}
				/>
			)}
		</>
	);

	return (
		<section
			data-detail-block={block.id}
			data-detail-slot={block.slot}
			data-detail-clamp={clamp.label}
			{...(block.turnSection
				? { "data-turn-section": block.turnSection }
				: {})}
			{...(isCollapsible
				? { "data-block-open": open ? "true" : "false" }
				: {})}
			className="min-h-0 min-w-0"
		>
			{isCollapsible ? (
				<Collapsible.Root
					open={open}
					onOpenChange={setOpen}
					className={cn(
						"min-w-0 rounded-md border border-border/60",
						isErrorOutput && "border-destructive/60",
					)}
				>
					<div className="flex min-w-0 items-center border-b border-border/60 bg-muted/20">
						<Collapsible.Trigger asChild>
							<button
								type="button"
								aria-label={`${open ? "Hide" : "Show"} ${block.caption}`}
								className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-status-info-border"
							>
								<ChevronRight
									aria-hidden="true"
									className={cn(
										"size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out",
										open && "rotate-90",
									)}
								/>
								<span className={DocFigureCaption}>{block.caption}</span>
							</button>
						</Collapsible.Trigger>
						{needsShellExpansion && modalCallback ? (
							<ExpandFigureButton
								caption={block.caption}
								onClick={modalCallback}
							/>
						) : null}
					</div>
					<Collapsible.Content forceMount className="ap-collapsible">
						<div className="ap-collapsible__inner">{content}</div>
					</Collapsible.Content>
				</Collapsible.Root>
			) : (
				content
			)}
		</section>
	);
}

/**
 * One tab panel. Plain tabs keep the original block list verbatim; a tab that
 * declares zones gets the subtab row and shows one surface at a time.
 */
function DetailTabPanel({
	tab,
	span,
	active,
	panelId,
	tabId,
	initialZoneId,
	onOpenModal,
}: {
	tab: DetailTab;
	span: TraceSpan;
	active: boolean;
	panelId: string;
	tabId: string;
	/** @internal Deterministic initial surface for SSR verification. */
	initialZoneId?: string;
	onOpenModal: (block: DetailBlockSpec) => void;
}): JSX.Element {
	const zones = tab.zones ?? [];
	const firstZoneId = zones[0]?.id ?? "";
	const [selectedZoneId, setSelectedZoneId] = useState(
		zones.some((zone) => zone.id === initialZoneId)
			? (initialZoneId as string)
			: firstZoneId,
	);
	const activeZoneId = zones.some((zone) => zone.id === selectedZoneId)
		? selectedZoneId
		: firstZoneId;

	const renderBlock = useCallback(
		(block: DetailBlockSpec) => (
			<DetailBlock
				key={block.id}
				block={block}
				span={span}
				onOpenModal={onOpenModal}
			/>
		),
		[onOpenModal, span],
	);

	const zoned = zones.length > 0;
	const partition = useMemo(
		() =>
			tab.zones
				? partitionZoneBlocks(tab.blocks, tab.zones)
				: { zoned: [], rest: tab.blocks },
		[tab.blocks, tab.zones],
	);
	const common = {
		id: panelId,
		role: "tabpanel" as const,
		"data-detail-tab": tab.id,
		"aria-labelledby": tabId,
		tabIndex: 0,
		hidden: !active,
	};

	if (!zoned) {
		return (
			<div {...common} className="min-h-0 min-w-0 space-y-4 p-4">
				{tab.blocks.map((block) => renderBlock(block))}
			</div>
		);
	}

	return (
		<div {...common} className="min-h-0 min-w-0 space-y-3 p-4">
			<DetailSubtabs
				zones={zones}
				activeZoneId={activeZoneId}
				idPrefix={panelId}
				onSelect={setSelectedZoneId}
			/>
			<div data-detail-stream="" className="min-w-0 space-y-4">
				<DetailZones
					zoned={partition.zoned}
					rest={partition.rest}
					activeZoneId={activeZoneId}
					idPrefix={panelId}
					renderBlock={renderBlock}
				/>
			</div>
		</div>
	);
}

/**
 * Stateless rendering frame used by DetailShell after it resolves extensions.
 * Exported from this module for deterministic SSR
 * conformance tests; the package's public DetailShell API remains { span, view }.
 *
 * @internal
 */
export function DetailShellFrame({
	span,
	view,
	blocks,
	tabs,
	onOpenModal,
	modalOpen = false,
	initialDetailsOpen = false,
	initialActiveTabId,
	initialZoneId,
}: {
	span: TraceSpan;
	view: DetailView;
	/** Resolved untabbed body. Defaults to the renderer-provided blocks. */
	blocks?: DetailBlockSpec[];
	/** Resolved tabbed body. Defaults to the renderer-provided tabs. */
	tabs?: DetailTab[];
	onOpenModal: (block: DetailBlockSpec) => void;
	/** Whether a shell-owned block or image modal is above this frame. */
	modalOpen?: boolean;
	/** @internal Deterministic initial mode for SSR contract verification. */
	initialDetailsOpen?: boolean;
	/** @internal Deterministic initial tab for takeover-preservation verification. */
	initialActiveTabId?: string;
	/** @internal Deterministic initial subtab surface for SSR verification. */
	initialZoneId?: string;
}): JSX.Element {
	const bodyBlocks = blocks ?? view.blocks;
	const bodyTabs = tabs ?? view.tabs;
	const hasBlocks = bodyBlocks !== undefined;
	const hasTabs = bodyTabs !== undefined;
	if (process.env.NODE_ENV !== "production" && hasBlocks === hasTabs) {
		throw new Error("DetailView must provide exactly one of blocks or tabs.");
	}
	if (
		process.env.NODE_ENV !== "production" &&
		bodyTabs !== undefined &&
		bodyTabs.length === 0
	) {
		throw new Error("DetailView.tabs must contain at least one tab.");
	}
	if (process.env.NODE_ENV !== "production" && bodyTabs !== undefined) {
		const tabIds = new Set<string>();
		for (const tab of bodyTabs) {
			if (tab.id.trim().length === 0 || tab.name.trim().length === 0) {
				throw new Error("Every DetailTab must have a non-empty id and name.");
			}
			if (tabIds.has(tab.id)) {
				throw new Error(`DetailView.tabs contains duplicate id "${tab.id}".`);
			}
			tabIds.add(tab.id);
		}
	}

	const orderedBlocks = useMemo(
		() =>
			bodyBlocks === undefined
				? undefined
				: [...bodyBlocks].sort(compareDetailBlocks),
		[bodyBlocks],
	);
	const orderedTabs = useMemo(
		() =>
			bodyTabs?.map((tab) => ({
				...tab,
				blocks: [...tab.blocks].sort(compareDetailBlocks),
			})),
		[bodyTabs],
	);
	const firstTabId = orderedTabs?.[0]?.id ?? "";
	const [activeTabId, setActiveTabId] = useState(
		initialActiveTabId ?? firstTabId,
	);
	const resolvedActiveTabId =
		orderedTabs?.some((tab) => tab.id === activeTabId) === true
			? activeTabId
			: firstTabId;
	const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const [detailsOpen, setDetailsOpen] = useState(initialDetailsOpen);
	const detailsButtonRef = useRef<HTMLButtonElement>(null);
	const closeDetailsButtonRef = useRef<HTMLButtonElement>(null);
	const detailsRegionId = `${useId()}-details-region`;

	useEffect(() => {
		if (firstTabId.length === 0) return;
		if (orderedTabs?.some((tab) => tab.id === activeTabId)) return;
		setActiveTabId(firstTabId);
	}, [activeTabId, firstTabId, orderedTabs]);

	const revealDetails = useCallback(() => {
		setDetailsOpen(true);
		if (typeof window === "undefined") return;
		window.requestAnimationFrame(() => {
			closeDetailsButtonRef.current?.focus();
		});
	}, []);

	const hideDetails = useCallback(() => {
		setDetailsOpen(false);
		if (typeof window === "undefined") return;
		window.requestAnimationFrame(() => {
			detailsButtonRef.current?.focus();
		});
	}, []);

	// One ladder, one layer per press: modal → Details takeover. The modal owns
	// its own listener, so this handler declines while it is open.
	useEffect(() => {
		if (!detailsOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (resolveEscapeLayer({ modalOpen, detailsOpen }) !== "details") return;
			event.preventDefault();
			event.stopPropagation();
			hideDetails();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [detailsOpen, hideDetails, modalOpen]);

	const onTabKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
			if (!orderedTabs || orderedTabs.length === 0) return;
			let nextIndex: number | undefined;
			switch (event.key) {
				case "ArrowRight":
				case "ArrowDown":
					nextIndex = (currentIndex + 1) % orderedTabs.length;
					break;
				case "ArrowLeft":
				case "ArrowUp":
					nextIndex =
						(currentIndex - 1 + orderedTabs.length) % orderedTabs.length;
					break;
				case "Home":
					nextIndex = 0;
					break;
				case "End":
					nextIndex = orderedTabs.length - 1;
					break;
				default:
					return;
			}
			event.preventDefault();
			const nextTab = orderedTabs[nextIndex];
			if (!nextTab) return;
			setActiveTabId(nextTab.id);
			tabRefs.current[nextIndex]?.focus();
		},
		[orderedTabs],
	);

	const descriptor = resolveSpanIcon({
		displayType: spanDisplayTypeOf(span),
		status: span.status,
	});
	const Glyph = spanIconFor(descriptor.kind, "outline");
	const allBlocks = orderedBlocks ?? orderedTabs?.flatMap((tab) => tab.blocks) ?? [];
	const hasTurnSections = allBlocks.some(
		(block) => block.turnSection !== undefined,
	);

	return (
		<div
			data-detail-root=""
			data-detail-details-open={detailsOpen ? "true" : "false"}
			className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
		>
			<div
				data-detail-header=""
				className="sticky top-0 flex h-12 min-w-0 shrink-0 items-center gap-2 border-b border-border bg-background px-4"
			>
				<span
					data-detail-glyph=""
					aria-hidden="true"
					className={cn(
						"grid shrink-0 place-items-center",
						descriptor.accentClassName,
					)}
				>
					<Glyph size={14} />
				</span>
				<span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
					{span.title}
				</span>
				{detailsOpen ? (
					<button
						ref={closeDetailsButtonRef}
						type="button"
						aria-label="Close details"
						onClick={hideDetails}
						className="ml-auto grid h-7 w-[3.75rem] shrink-0 place-items-center rounded-[3px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-info-border"
					>
						<X aria-hidden="true" className="size-4" />
					</button>
				) : (
					<button
						ref={detailsButtonRef}
						type="button"
						aria-label="Details"
						aria-expanded={false}
						aria-controls={detailsRegionId}
						onClick={revealDetails}
						className="ml-auto grid h-7 w-[3.75rem] shrink-0 place-items-center rounded-[3px] text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-info-border"
					>
						Details
					</button>
				)}
			</div>

			<div
				data-detail-body=""
				hidden={detailsOpen}
				aria-hidden={detailsOpen}
				{...(orderedTabs
					? { "data-detail-active-tab": resolvedActiveTabId }
					: {})}
				{...(hasTurnSections ? { "data-turn-view": "sections" } : {})}
				className={cn(
					"min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto",
					!orderedTabs && "space-y-4 p-4",
				)}
			>
				{orderedTabs ? (
					<>
						<div
							role="tablist"
							aria-label="Detail sections"
							className="mx-4 mt-4 flex min-w-0 overflow-hidden rounded-[3px] border border-border bg-muted"
						>
							{orderedTabs.map((tab, index) => {
								const active = tab.id === resolvedActiveTabId;
								const tabId = `${detailsRegionId}-tab-${tab.id}`;
								const panelId = `${detailsRegionId}-tabpanel-${tab.id}`;
								return (
									<button
										key={tab.id}
										ref={(node) => {
											tabRefs.current[index] = node;
										}}
										id={tabId}
										type="button"
										role="tab"
										data-detail-tab-trigger={tab.id}
										aria-selected={active}
										aria-controls={panelId}
										tabIndex={active ? 0 : -1}
										onClick={() => setActiveTabId(tab.id)}
										onKeyDown={(event) => onTabKeyDown(event, index)}
										className={cn(
											"min-w-0 flex-1 px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-status-info-border",
											index > 0 && "border-l border-border",
											active
												? "bg-status-info-fill text-status-info"
												: "bg-muted text-muted-foreground hover:bg-background hover:text-foreground",
										)}
									>
										{tab.name}
									</button>
								);
							})}
						</div>
						{orderedTabs.map((tab) => {
							const active = tab.id === resolvedActiveTabId;
							return (
								<DetailTabPanel
									key={tab.id}
									tab={tab}
									span={span}
									active={active}
									panelId={`${detailsRegionId}-tabpanel-${tab.id}`}
									tabId={`${detailsRegionId}-tab-${tab.id}`}
									initialZoneId={initialZoneId}
									onOpenModal={onOpenModal}
								/>
							);
						})}
					</>
				) : (
					orderedBlocks?.map((block) => (
						<DetailBlock
							key={block.id}
							block={block}
							span={span}
							onOpenModal={onOpenModal}
						/>
					))
				)}
			</div>
			{detailsOpen ? (
				<DetailsView
					id={detailsRegionId}
					span={span}
					extras={view.detailsExtras}
					onOpenModal={onOpenModal}
				/>
			) : null}
		</div>
	);
}

const FOCUSABLE_SELECTOR = [
	"button:not([disabled])",
	"[href]",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

/** @internal Stateless modal surface used for SSR contract verification. */
export function DetailModalFrame({
	block,
	image,
	span,
	onClose,
	labelId,
	dialogRef,
}: {
	block: DetailBlockSpec | null;
	image: DetailImageSpec | null;
	span: TraceSpan;
	onClose: () => void;
	labelId: string;
	dialogRef?: Ref<HTMLDivElement>;
}): JSX.Element {
	const label = block?.caption ?? image?.alt ?? "Image";
	return (
		<div
			data-detail-modal-backdrop=""
			className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-[3vh]"
			onClick={(event) => {
				if (event.currentTarget === event.target) onClose();
			}}
		>
			<div
				ref={dialogRef}
				data-detail-modal=""
				data-detail-modal-kind={image ? "image" : "block"}
				role="dialog"
				aria-modal="true"
				aria-labelledby={labelId}
				tabIndex={-1}
				className="flex h-[92vh] w-[min(1400px,94vw)] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl focus:outline-none"
			>
				<div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
					<h2
						id={labelId}
						className="min-w-0 truncate text-sm font-semibold text-foreground"
					>
						{label}
					</h2>
					<button
						type="button"
						aria-label={`Close ${label}`}
						onClick={onClose}
						className="ml-auto grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-info-border"
					>
						<X aria-hidden="true" className="size-4" />
					</button>
				</div>
				{image ? (
					<div
						data-detail-image-modal-content=""
						className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto p-4"
					>
						<img
							src={image.src}
							alt={image.alt}
							className="h-auto w-auto max-h-full max-w-full object-contain"
						/>
					</div>
				) : block ? (
					<div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
						<DetailBlock
							block={block}
							span={span}
							inModal
							onOpenModal={() => {}}
						/>
					</div>
				) : null}
			</div>
		</div>
	);
}

function DetailModal({
	block,
	image,
	span,
	onClose,
}: {
	block: DetailBlockSpec | null;
	image: DetailImageSpec | null;
	span: TraceSpan;
	onClose: () => void;
}): JSX.Element | null {
	const dialogRef = useRef<HTMLDivElement>(null);
	const labelId = useId();
	const modalOpen = block !== null || image !== null;

	useEffect(() => {
		if (!modalOpen) return;
		const returnTarget =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		const frame = window.requestAnimationFrame(() => {
			const first = dialogRef.current?.querySelector<HTMLElement>(
				FOCUSABLE_SELECTOR,
			);
			(first ?? dialogRef.current)?.focus();
		});

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
				return;
			}
			if (event.key !== "Tab" || !dialogRef.current) return;

			const focusable = Array.from(
				dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
			).filter((element) => element.offsetParent !== null);
			if (focusable.length === 0) {
				event.preventDefault();
				dialogRef.current.focus();
				return;
			}
			const first = focusable[0]!;
			const last = focusable[focusable.length - 1]!;
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", onKeyDown);
		return () => {
			window.cancelAnimationFrame(frame);
			document.removeEventListener("keydown", onKeyDown);
			document.body.style.overflow = previousOverflow;
			returnTarget?.focus();
		};
	}, [modalOpen, onClose]);

	if (!modalOpen || typeof document === "undefined") return null;

	return createPortal(
		<DetailModalFrame
			block={block}
			image={image}
			span={span}
			onClose={onClose}
			labelId={labelId}
			dialogRef={dialogRef}
		/>,
		document.body,
	);
}

/**
 * Render the invariant header → ordered blocks or tabs document, with Details
 * as a shell-owned full-panel takeover.
 * Renderers can only return data, so they cannot introduce competing chrome.
 */
export function DetailShell({ span, view }: DetailShellProps): JSX.Element {
	const [modalBlock, setModalBlock] = useState<DetailBlockSpec | null>(null);
	const [modalImage, setModalImage] = useState<DetailImageSpec | null>(null);
	const extensionBlocks = useDetailBlocks(span);
	const openBlockModal = useCallback((block: DetailBlockSpec) => {
		setModalImage(null);
		setModalBlock(block);
	}, []);
	const openImageModal = useCallback((image: DetailImageSpec) => {
		setModalBlock(null);
		setModalImage(image);
	}, []);
	const closeModal = useCallback(() => {
		setModalBlock(null);
		setModalImage(null);
	}, []);

	const resolvedBody = useMemo<{
		blocks?: DetailBlockSpec[];
		tabs?: DetailTab[];
	}>(() => {
		if (view.blocks !== undefined) {
			return {
				blocks: mergeDetailBlockLists(view.blocks, extensionBlocks),
			};
		}

		if (view.tabs !== undefined) {
			const bodyIds = new Set(
				view.tabs.flatMap((tab) => tab.blocks.map((block) => block.id)),
			);
			const seenBodyIds = new Set<string>();
			const tabs = view.tabs.map((tab) => ({
				...tab,
				blocks: tab.blocks.filter((block) => {
					if (seenBodyIds.has(block.id)) return false;
					seenBodyIds.add(block.id);
					return true;
				}),
			}));
			const firstTab = tabs[0];
			if (firstTab) {
				tabs[0] = {
					...firstTab,
					blocks: mergeDetailBlockLists(
						firstTab.blocks,
						extensionBlocks.filter((block) => !bodyIds.has(block.id)),
					),
				};
			}
			return { tabs };
		}

		return {};
	}, [view.blocks, view.tabs, extensionBlocks]);
	const resolvedBlocks = resolvedBody.blocks;
	const resolvedTabs = resolvedBody.tabs;
	const allBodyBlocks = useMemo(
		() =>
			resolvedBlocks ??
			resolvedTabs?.flatMap((tab) => tab.blocks) ??
			[],
		[resolvedBlocks, resolvedTabs],
	);

	useEffect(() => {
		if (!modalBlock) return;
		if (allBodyBlocks.some((block) => block.id === modalBlock.id)) return;
		// Details-owned modal blocks are summoned by the shell and are
		// intentionally not part of the body list.
		if (modalBlock.id.startsWith("details:")) return;
		setModalBlock(null);
	}, [allBodyBlocks, modalBlock]);

	return (
		<DetailImageModalProvider onOpen={openImageModal}>
			<DetailShellFrame
				span={span}
				view={view}
				blocks={resolvedBlocks}
				tabs={resolvedTabs}
				onOpenModal={openBlockModal}
				modalOpen={modalBlock !== null || modalImage !== null}
			/>
			<DetailModal
				block={modalBlock}
				image={modalImage}
				span={span}
				onClose={closeModal}
			/>
		</DetailImageModalProvider>
	);
}
