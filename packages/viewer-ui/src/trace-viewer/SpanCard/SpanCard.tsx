/**
 * SpanCard — Renders a single TraceSpan in the tree view.
 *
 * Dispatches to styled variant components via getSpanDisplay():
 *   UserMessageCard, AssistantMessageCard — inline content cards (edge accent)
 *   ToolCard, UIAskCard, AgentCard — icon + label cards (neutral)
 *   LifecycleCard — neutral card for agent run/session lifecycle
 *   SystemCard — context-accented card for system_prompt_resolved, context_build
 *
 * Fallback renders span.title for unrecognized event types.
 * Color semantics live in icons/resolve-span-icon.tsx (GROUP_ACCENT).
 */
import type { TraceSpan } from "@evilmartians/agent-prism-types";
import type { FC, KeyboardEvent, MouseEvent } from "react";

import * as Collapsible from "@radix-ui/react-collapsible";
import cn from "classnames";
import { useCallback, useMemo } from "react";

import type { SpanCardConnectorType } from "./SpanCardConnector";

import { SpanCardConnector, TREE_LINE_CLASS } from "./SpanCardConnector";
import { SpanCardToggle } from "./SpanCardToggle";
import { TraceCard } from "./TraceCard";
import { UserMessageCard, AssistantMessageCard, ToolCard, SpawnerCard, UIAskCard, AgentCard, LifecycleCard, SystemCard, ContainerCard, MetaCard } from "./variants";
import { readStringAttr, spanDisplayTypeOf } from "../span-style";
import {
  resolveSpanIcon,
  DEFAULT_ICON_SIDE,
  DEFAULT_ICON_STYLE,
  type IconSide,
  type IconStyle,
  type SpanDisplayType,
  type SpanIconDescriptor,
} from "../icons";

const LAYOUT_CONSTANTS = {
  CONNECTOR_WIDTH: 24,
} as const;

const MAX_CONTENT_LENGTH = 200;

/**
 * Chrome bundle threaded from SpanCard into every variant so the shared
 * TraceCard frame renders the same anatomy (icon cap + group border) at every
 * size. `descriptor` carries the resolved kind + group + accent classes.
 */
export interface SpanCardChrome {
  descriptor: SpanIconDescriptor;
  side: IconSide;
  style: IconStyle;
  /** Accessible label for the cap, e.g. the span title. */
  label: string;
}

type SpanDisplay =
  | { type: "user"; content: string }
  | { type: "assistant"; content: string }
  | { type: "tool"; name: string; detail?: string }
  | { type: "spawner"; name: string; spawns: string[]; detail?: string }
  | { type: "ui_ask"; kind: string }
  | { type: "agent"; name: string }
  | { type: "lifecycle"; label: string }
  | { type: "turn"; label: string }
  | { type: "system"; label: string }
  | { type: "container"; label: string }
  | null;

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function getSpanDisplay(data: TraceSpan): SpanDisplay {
  const eventType = readStringAttr(data, "event_type");

  if (eventType === "user_message" && data.input) {
    return { type: "user", content: truncate(data.input, MAX_CONTENT_LENGTH) };
  }

  if (eventType === "assistant_message" && data.output) {
    return { type: "assistant", content: truncate(data.output, MAX_CONTENT_LENGTH) };
  }

  if (eventType === "tool_call_start" || eventType === "tool_call_end") {
    const toolName = readStringAttr(data, "tool_name") ?? data.title;
    let detail: string | undefined;
    if (data.input) {
      try {
        const parsed = JSON.parse(data.input);
        const lowerName = toolName.toLowerCase();
        if (lowerName === "read" && parsed?.raw?.path) {
          detail = parsed.raw.path;
        } else if (lowerName === "bash" && parsed?.raw?.command) {
          detail = parsed.raw.command;
        }
      } catch {}
    }
    // Spawner tool calls (D77) read as agent dispatch, not a generic tool.
    if (readStringAttr(data, "tool_kind") === "spawner") {
      const spawnsAttr = readStringAttr(data, "spawns");
      const spawns = spawnsAttr ? spawnsAttr.split(",").filter(Boolean) : [];
      return { type: "spawner", name: toolName, spawns, detail };
    }
    return { type: "tool", name: toolName, detail };
  }

  if (eventType === "ui_ask_requested" || eventType === "ui_ask_answered") {
    const kind = readStringAttr(data, "kind") ?? "ask";
    return { type: "ui_ask", kind };
  }

  if (eventType === "pi_agent_container") {
    return { type: "agent", name: data.title };
  }

  if (eventType === "container_container") {
    return { type: "container", label: data.title };
  }

  if (eventType === "provisioning_container") {
    return { type: "lifecycle", label: "Provisioning" };
  }

  if (eventType === "context_build_started" || eventType === "context_build_completed") {
    return { type: "system", label: "Context Built" };
  }

  // Request snapshots are first-class rows with their own window glyph:
  // standard row size, context group. Title is the display name ("Turn N").
  if (eventType === "pi_request_snapshot") {
    return { type: "turn", label: data.title };
  }

  // Run/phase containers are lifecycle plumbing but still standard-size rows;
  // the title doubles as the lifecycle label so run/phase glyphs resolve.
  if (eventType === "run_container" || eventType === "phase_container") {
    return { type: "lifecycle", label: data.title };
  }

  if (eventType === "system_prompt_resolved") {
    return { type: "system", label: "System Prompt Resolved" };
  }

  if (eventType === "agent_run_start") {
    return { type: "lifecycle", label: "Agent Run Start" };
  }

  if (eventType === "agent_run_end") {
    return { type: "lifecycle", label: "Agent Run End" };
  }

  if (eventType === "agent_session_start") {
    return { type: "lifecycle", label: "Agent Session Start" };
  }

  if (eventType === "agent_session_end") {
    return { type: "lifecycle", label: "Agent Session End" };
  }

  return null;
}

type ExpandButtonPlacement = "inside" | "outside";

export type SpanCardViewOptions = {
  withStatus?: boolean;
  expandButton?: ExpandButtonPlacement;
  /** Which outer edge the scannability chip abuts. Default "left". */
  iconSide?: IconSide;
  /** Chip treatment: hollow "outline" or accent-filled "solid". Default "outline". */
  iconStyle?: IconStyle;
};

const DEFAULT_VIEW_OPTIONS: Required<SpanCardViewOptions> = {
  withStatus: true,
  expandButton: "inside",
  iconSide: DEFAULT_ICON_SIDE,
  iconStyle: DEFAULT_ICON_STYLE,
};

interface SpanCardProps {
  data: TraceSpan;
  level?: number;
  selectedSpan?: TraceSpan;
  onSpanSelect?: (span: TraceSpan) => void;
  minStart: number;
  maxEnd: number;
  isLastChild: boolean;
  prevLevelConnectors?: SpanCardConnectorType[];
  expandedSpansIds: string[];
  onExpandSpansIdsChange: (ids: string[]) => void;
  viewOptions?: SpanCardViewOptions;
}

interface SpanCardState {
  isExpanded: boolean;
  hasChildren: boolean;
  isSelected: boolean;
}

const getGridTemplateColumns = ({
  connectorsColumnWidth,
  expandButton,
}: {
  connectorsColumnWidth: number;
  expandButton: ExpandButtonPlacement;
}) => {
  if (expandButton === "inside") {
    return `${connectorsColumnWidth}px 1fr`;
  }

  return `${connectorsColumnWidth}px 1fr ${LAYOUT_CONSTANTS.CONNECTOR_WIDTH}px`;
};

const getConnectorsLayout = ({
  level,
  isLastChild,
  prevConnectors,
  expandButton,
}: {
  isLastChild: boolean;
  level: number;
  prevConnectors: SpanCardConnectorType[];
  expandButton: ExpandButtonPlacement;
}): {
  connectors: SpanCardConnectorType[];
  connectorsColumnWidth: number;
} => {
  const connectors: SpanCardConnectorType[] = [];

  if (level === 0) {
    return {
      connectors: expandButton === "inside" ? [] : ["vertical"],
      connectorsColumnWidth: LAYOUT_CONSTANTS.CONNECTOR_WIDTH,
    };
  }

  for (let i = 0; i < level - 1; i++) {
    connectors.push("vertical");
  }

  if (!isLastChild) {
    connectors.push("t-right");
  }

  if (isLastChild) {
    connectors.push("corner-top-right");
  }

  // Uniform depth step: every row reserves the toggle slot in "inside" mode
  // — expandable or leaf — so content at depth d always starts at exactly
  // (d + 1) * CONNECTOR_WIDTH. Children thereby render one full step inside
  // their parent's label at every level (a leaf must never sit at the same
  // x-offset as its parent), and the branch connector of a child lines up
  // under its parent's toggle column. In "outside" mode the toggle lives in
  // its own trailing grid column, so the connectors column is just the
  // ancestor guides.
  const connectorsColumnWidth =
    (connectors.length + (expandButton === "inside" ? 1 : 0)) *
    LAYOUT_CONSTANTS.CONNECTOR_WIDTH;

  for (let i = 0; i < prevConnectors.length; i++) {
    if (
      prevConnectors[i] === "empty" ||
      prevConnectors[i] === "corner-top-right"
    ) {
      connectors[i] = "empty";
    }
  }

  return {
    connectors,
    connectorsColumnWidth,
  };
};

const useSpanCardEventHandlers = (
  data: TraceSpan,
  onSpanSelect?: (span: TraceSpan) => void,
) => {
  const handleCardClick = useCallback((): void => {
    onSpanSelect?.(data);
  }, [data, onSpanSelect]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleCardClick();
      }
    },
    [handleCardClick],
  );

  const handleToggleClick = useCallback(
    (e: MouseEvent | KeyboardEvent): void => {
      e.stopPropagation();
    },
    [],
  );

  return {
    handleCardClick,
    handleKeyDown,
    handleToggleClick,
  };
};

const SpanCardChildren: FC<{
  data: TraceSpan;
  level: number;
  selectedSpan?: TraceSpan;
  onSpanSelect?: (span: TraceSpan) => void;
  minStart: number;
  maxEnd: number;
  prevLevelConnectors: SpanCardConnectorType[];
  expandedSpansIds: string[];
  onExpandSpansIdsChange: (ids: string[]) => void;
  viewOptions?: SpanCardViewOptions;
}> = ({
  data,
  level,
  selectedSpan,
  onSpanSelect,
  minStart,
  maxEnd,
  prevLevelConnectors,
  expandedSpansIds,
  onExpandSpansIdsChange,
  viewOptions = DEFAULT_VIEW_OPTIONS,
}) => {
  if (!data.children?.length) return null;

  return (
    <Collapsible.Content forceMount className="ap-collapsible">
      <ul role="group" className="ap-collapsible__inner">
        {data.children.map((child, idx) => (
          <SpanCard
            viewOptions={viewOptions}
            key={child.id}
            data={child}
            minStart={minStart}
            maxEnd={maxEnd}
            level={level + 1}
            selectedSpan={selectedSpan}
            onSpanSelect={onSpanSelect}
            isLastChild={idx === (data.children || []).length - 1}
            prevLevelConnectors={prevLevelConnectors}
            expandedSpansIds={expandedSpansIds}
            onExpandSpansIdsChange={onExpandSpansIdsChange}
          />
        ))}
      </ul>
    </Collapsible.Content>
  );
};

export const SpanCard: FC<SpanCardProps> = ({
  data,
  level = 0,
  selectedSpan,
  onSpanSelect,
  viewOptions = DEFAULT_VIEW_OPTIONS,
  minStart,
  maxEnd,
  isLastChild,
  prevLevelConnectors = [],
  expandedSpansIds,
  onExpandSpansIdsChange,
}) => {
  const isExpanded = expandedSpansIds.includes(data.id);

  const expandButton =
    viewOptions.expandButton || DEFAULT_VIEW_OPTIONS.expandButton;

  const handleToggleClick = useCallback(
    (expanded: boolean) => {
      const alreadyExpanded = expandedSpansIds.includes(data.id);

      if (alreadyExpanded && !expanded) {
        onExpandSpansIdsChange(expandedSpansIds.filter((id) => id !== data.id));
      }

      if (!alreadyExpanded && expanded) {
        onExpandSpansIdsChange([...expandedSpansIds, data.id]);
      }
    },
    [expandedSpansIds, data.id, onExpandSpansIdsChange],
  );

  const state: SpanCardState = {
    isExpanded,
    hasChildren: Boolean(data.children?.length),
    isSelected: selectedSpan?.id === data.id,
  };

  const eventHandlers = useSpanCardEventHandlers(data, onSpanSelect);

  const spanDisplay = useMemo(() => getSpanDisplay(data), [data]);

  const iconSide = viewOptions.iconSide ?? DEFAULT_VIEW_OPTIONS.iconSide;
  const iconStyle = viewOptions.iconStyle ?? DEFAULT_VIEW_OPTIONS.iconStyle;

  const iconDescriptor = useMemo(() => {
    // Fallback rows (spanDisplay null → MetaCard) still resolve their kind
    // through the shared spanDisplayTypeOf() so chip-style rows keep the same
    // group chrome as everything else — e.g. pi_request_snapshot ("Context
    // window · turn N") wears the context group's violet edge + glyph tint at
    // meta weight instead of degrading to neutral generic.
    const displayType: SpanDisplayType = spanDisplay?.type ?? spanDisplayTypeOf(data);
    const lifecycleLabel =
      spanDisplay?.type === "lifecycle" ? spanDisplay.label : undefined;
    return resolveSpanIcon({ displayType, status: data.status, lifecycleLabel });
  }, [spanDisplay, data]);

  const chrome: SpanCardChrome = {
    descriptor: iconDescriptor,
    side: iconSide,
    style: iconStyle,
    label: `${data.title} span`,
  };

  const hasExpandButtonAsFirstChild =
    expandButton === "inside" && state.hasChildren;

  const { connectors, connectorsColumnWidth } = getConnectorsLayout({
    level,
    isLastChild,
    prevConnectors: prevLevelConnectors,
    expandButton,
  });

  const gridTemplateColumns = getGridTemplateColumns({
    connectorsColumnWidth,
    expandButton,
  });

  return (
    <li
      role="treeitem"
      aria-selected={state.isSelected ? true : selectedSpan ? false : undefined}
      aria-expanded={state.hasChildren ? state.isExpanded : undefined}
      className="list-none"
    >
      <Collapsible.Root
        open={state.isExpanded}
        onOpenChange={handleToggleClick}
      >
        <div
          data-selected={state.isSelected ? "" : undefined}
          data-depth={level}
          className={cn(
            // Named group: the CARD (TraceCard) wears the actual selection
            // ring/fill via group-data-[selected]/spanrow variants. The row
            // contributes NOTHING row-wide — just the left gutter bar. Bar
            // color/opacity/width ride the --selection-* tokens (style-rail
            // adjustable) with baked fallbacks so hosts without the vars keep
            // today's look.
            "group/spanrow relative mb-3 grid w-full items-center",
            state.isSelected &&
              "shadow-[inset_var(--selection-bar-width,3px)_0_0_0_rgb(var(--selection-color,var(--status-info))/var(--selection-opacity,1))]",
          )}
          style={{
            gridTemplateColumns,
            backgroundSize: "auto calc(100% - 8px)",
            backgroundPosition: "top",
            backgroundRepeat: "no-repeat",
          }}
          onClick={eventHandlers.handleCardClick}
          onKeyDown={eventHandlers.handleKeyDown}
          tabIndex={0}
          role="button"
          aria-pressed={state.isSelected}
          aria-describedby={`span-card-desc-${data.id}`}
          aria-expanded={state.hasChildren ? state.isExpanded : undefined}
          aria-label={`${state.isSelected ? "Selected" : "Not selected"} span card for ${data.title} at level ${level}`}
        >
          <div className="flex flex-nowrap self-stretch">
            {connectors.map((connector, idx) => (
              <SpanCardConnector key={`${connector}-${idx}`} type={connector} />
            ))}

            {/* The reserved toggle slot (column index = depth) renders on
                EVERY row in "inside" mode so lines and content share one
                geometry: a toggle for expandable rows (with the drop-line
                continuing down through the children while expanded), or the
                elbow's horizontal continuation across the slot to the card
                edge for leaf rows. Collapsed parents paint no drop-line, so
                nothing dangles. */}
            {hasExpandButtonAsFirstChild && (
              <div
                data-slot="toggle"
                className="relative flex w-6 shrink-0 items-center justify-center self-stretch"
              >
                <SpanCardToggle
                  isExpanded={state.isExpanded}
                  title={data.title}
                  onToggleClick={eventHandlers.handleToggleClick}
                />

                {state.isExpanded && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      TREE_LINE_CLASS,
                      "pointer-events-none absolute left-1/2 top-[calc(50%_+_10px)] -bottom-3 w-px -translate-x-1/2",
                    )}
                  />
                )}
              </div>
            )}

            {expandButton === "inside" && !state.hasChildren && (
              <div
                data-slot={level > 0 ? "leaf-line" : "leaf-empty"}
                className="relative w-6 shrink-0 self-stretch"
              >
                {level > 0 && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      TREE_LINE_CLASS,
                      "absolute inset-x-0 top-1/2 h-px -translate-y-1/2",
                    )}
                  />
                )}
              </div>
            )}
          </div>
          <div
            className={cn(
              "relative flex min-w-0 items-center",
              "min-h-6 w-full cursor-pointer",
              level !== 0 && "pl-1",
            )}
          >
            {spanDisplay?.type === "user" && (
              <UserMessageCard content={spanDisplay.content} chrome={chrome} />
            )}

            {spanDisplay?.type === "assistant" && (
              <AssistantMessageCard content={spanDisplay.content} chrome={chrome} />
            )}

            {spanDisplay?.type === "tool" && (
              <ToolCard name={spanDisplay.name} detail={spanDisplay.detail} chrome={chrome} />
            )}

            {spanDisplay?.type === "spawner" && (
              <SpawnerCard
                name={spanDisplay.name}
                spawns={spanDisplay.spawns}
                detail={spanDisplay.detail}
                chrome={chrome}
              />
            )}

            {spanDisplay?.type === "ui_ask" && (
              <UIAskCard chrome={chrome} />
            )}

            {spanDisplay?.type === "agent" && (
              <AgentCard name={spanDisplay.name} chrome={chrome} />
            )}

            {spanDisplay?.type === "lifecycle" && (
              <LifecycleCard label={spanDisplay.label} chrome={chrome} />
            )}

            {(spanDisplay?.type === "system" || spanDisplay?.type === "turn") && (
              <SystemCard label={spanDisplay.label} chrome={chrome} />
            )}

            {spanDisplay?.type === "container" && (
              <ContainerCard label={spanDisplay.label} chrome={chrome} />
            )}

            {!spanDisplay && (
              <MetaCard title={data.title} chrome={chrome} />
            )}
          </div>

          {expandButton === "outside" &&
            (state.hasChildren ? (
              <SpanCardToggle
                isExpanded={state.isExpanded}
                title={data.title}
                onToggleClick={eventHandlers.handleToggleClick}
              />
            ) : (
              <div />
            ))}
        </div>

        <SpanCardChildren
          minStart={minStart}
          maxEnd={maxEnd}
          viewOptions={viewOptions}
          data={data}
          level={level}
          selectedSpan={selectedSpan}
          onSpanSelect={onSpanSelect}
          prevLevelConnectors={connectors}
          expandedSpansIds={expandedSpansIds}
          onExpandSpansIdsChange={onExpandSpansIdsChange}
        />
      </Collapsible.Root>
    </li>
  );
};
