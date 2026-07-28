export { TreeView } from "./trace-viewer/TreeView";
export { SpanDetailPanel } from "./trace-viewer/SpanDetailPanel";
export {
	DetailShell,
	type DetailShellProps,
} from "./trace-viewer/detail-panel/DetailShell";
export {
	DetailImageTrigger,
	type DetailImageSpec,
	type DetailImageTriggerProps,
} from "./trace-viewer/detail-panel/DetailImageTrigger";
export {
	DetailsView,
	type DetailsViewProps,
} from "./trace-viewer/detail-panel/DetailsView";
export {
	DocFigure,
	DocFigureCaption,
	type DocFigureProps,
	type DocInlineRow,
} from "./trace-viewer/detail-panel/doc-figure/DocFigure";
export { Clamped } from "./trace-viewer/detail-panel/doc-figure/Clamped";
export {
	CLAMP,
	type ClampPolicy,
} from "./trace-viewer/detail-panel/doc-figure/clamp";
export {
	tokenize,
	type DocLanguage,
	type Token,
	type TokenType,
} from "./trace-viewer/detail-panel/doc-figure/tokenize";
export {
	DetailBlocksContext,
	DetailBlocksProvider,
	useDetailBlocks,
	type DetailBlockProvider,
} from "./trace-viewer/detail-panel/blocks";
export {
	BLOCK_SLOT_ORDER,
	type BlockSlot,
	type DetailBlockSpec,
	type DetailTab,
	type DetailView,
	type DetailZone,
	type DetailBodyRenderer,
} from "./trace-viewer/detail-panel/contract";
export {
	resolveEscapeLayer,
	type DetailEscapeLayer,
	type DetailEscapeState,
} from "./trace-viewer/detail-panel/escape";
export {
	TurnBody,
	buildSnapshotContextView,
	type BuildSnapshotContextViewOptions,
} from "./trace-viewer/detail-panel/renderers/TurnBody";
export {
	SystemPromptSection,
	type SystemPromptSectionProps,
} from "./trace-viewer/detail-panel/renderers/turn/SystemPromptSection";
export {
	ContextSection,
	type ContextSectionProps,
} from "./trace-viewer/detail-panel/renderers/turn/ContextSection";
export {
	StateSection,
	type StateSectionProps,
} from "./trace-viewer/detail-panel/renderers/turn/StateSection";
export type { UsageContext } from "./trace-viewer/detail-panel/types";
export {
	TraceViewerApiContext,
	useTraceViewerApi,
	type TraceViewerApiContextValue,
} from "./trace-viewer/detail-panel/TraceViewerApiContext";
export {
	UsageSummaryPanel,
	type UsageSummaryPanelProps,
} from "./trace-viewer/UsageSummaryPanel";
export { UsageStrip, type UsageStripProps } from "./trace-viewer/UsageStrip";
export {
	summarizeUsage,
	computeTotals,
	rollupByAgent,
	toRunRow,
	durationMs,
	formatTokens,
	formatCost,
	formatDuration,
	aggregateUsageForScope,
	usageScopeForSpanId,
	type UsageSummary,
	type UsageTotals,
	type RunUsageRow,
	type AgentUsageRollup,
	type UsageScope,
	type SpanUsageAggregate,
} from "./trace-viewer/usage-summary";
export {
	DoctorPanel,
	type DoctorPanelProps,
	type DoctorReport,
	type DoctorViolation,
} from "./trace-viewer/DoctorPanel";
export type { SpanCardViewOptions, SpanCardChrome } from "./trace-viewer/SpanCard/SpanCard";
export {
	spanIconFor,
	resolveSpanIcon,
	GROUP_ACCENT,
	SpanIconCap,
	SPAN_CAP_SIZE,
	SPAN_ICON_KINDS,
	DEFAULT_ICON_SIDE,
	DEFAULT_ICON_STYLE,
	TraceIconSettingsProvider,
	useTraceIconSettings,
	type TraceIconSettings,
	type SpanIconKind,
	type SpanDisplayType,
	type SpanColorGroup,
	type SpanIconDescriptor,
	type SpanIconInput,
	type SpanIconCapProps,
	type SpanCapLayout,
	type NucleoIconVariant,
	type IconSide,
	type IconStyle,
} from "./trace-viewer/icons";
export { SpanCard } from "./trace-viewer/SpanCard/SpanCard";
export { SpanCardConnector } from "./trace-viewer/SpanCard/SpanCardConnector";
export type { SpanCardConnectorType } from "./trace-viewer/SpanCard/SpanCardConnector";
export { SpanCardToggle } from "./trace-viewer/SpanCard/SpanCardToggle";
export {
	getSpanStyle,
	readNumberAttr,
	readStringAttr,
	spanDisplayTypeOf,
	type SpanStyle,
} from "./trace-viewer/span-style";
export {
	collectSpanIds,
	filterSpansByTraceLevel,
	findSpanInTree,
	readTraceLevel,
} from "./trace-viewer/trace-tree-utils";
export {
	agentPrismPrefix,
	AGENT_PRISM_TOKENS,
	type AgentPrismToken,
} from "./trace-viewer/theme";
export { AgentCatalogViewer } from "./agent-viewer/AgentCatalogViewer";

// Prompt authoring — the editing surface, the lab shell, and the style model —
// belongs to @codecaine-ai/prompt-kit, which owns the prompt document. It is
// re-exported here so kernel viewers keep a single import for the whole viewer
// UI; what stays behind in this package is the kernel-specific wiring
// (AgentPromptLabContainer's catalog fetches, the revision panels).
export {
	PromptInlineLab,
	PromptStyleRail,
	type PromptInlineLabProps,
	type PromptStyleRailProps,
	type PromptSaveOutcome,
	type ManifestSaveOutcome,
	type LabManifest,
	type LabContextPreview,
	createPromptLabHistory,
	type PromptLabHistory,
	type PromptLabMetaPatch,
} from "@codecaine-ai/prompt-kit/ui/lab";
export {
	loadPromptStyleSettings,
	normalizePromptStyleSettings,
	PROMPT_STYLE_DEFAULTS,
	PROMPT_STYLE_PRESETS,
	PROMPT_STYLE_STORAGE_KEY,
	promptStyleVars,
	savePromptStyleSettings,
	usePromptStyleSettings,
	type PromptMonoFontFamily,
	type PromptRowShading,
	type PromptStylePresetId,
	type PromptStyleSettings,
	type PromptStyleStorage,
} from "@codecaine-ai/prompt-kit/ui/style";
export {
	AgentPromptLabContainer,
	type AgentPromptLabContainerProps,
} from "./agent-viewer/AgentPromptLabContainer";
export {
	RevisionHistoryPanel,
	type RevisionHistoryPanelProps,
} from "./agent-viewer/RevisionHistoryPanel";
export {
	RevisionStatsStrip,
	type RevisionStatsStripProps,
} from "./agent-viewer/RevisionStatsStrip";
export type {
	AgentRenderedPrompt,
	AgentVariableDeclaration,
	AgentViewerDefinition,
} from "./agent-viewer/types";
