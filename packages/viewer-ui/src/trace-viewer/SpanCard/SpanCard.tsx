/**
 * SpanCard — Renders a single TraceSpan in the tree view.
 *
 * Dispatches to styled variant components via getSpanDisplay():
 *   UserMessageCard, AssistantMessageCard — inline content cards
 *   ToolCard, UIAskCard, AgentCard — icon + label cards
 *   LifecycleCard — ghost border (zinc) for agent run/session lifecycle
 *   SystemCard — ghost border (teal) for system_prompt_resolved, context_build
 *
 * Fallback renders span.title for unrecognized event types.
 */
import type { TraceSpan } from "@evilmartians/agent-prism-types";
import type { FC, KeyboardEvent, MouseEvent } from "react";

import * as Collapsible from "@radix-ui/react-collapsible";
import cn from "classnames";
import { useCallback, useMemo } from "react";

import type { SpanCardConnectorType } from "./SpanCardConnector";

import { SpanCardConnector } from "./SpanCardConnector";
import { SpanCardToggle } from "./SpanCardToggle";
import { UserMessageCard, AssistantMessageCard, ToolCard, UIAskCard, AgentCard, LifecycleCard, SystemCard, ContainerCard } from "./variants";
import { getSpanStyle, readStringAttr } from "../span-style";

const LAYOUT_CONSTANTS = {
  CONNECTOR_WIDTH: 24,
  CONTENT_BASE_WIDTH: 320,
} as const;

const MAX_CONTENT_LENGTH = 200;

type SpanDisplay =
  | { type: "user"; content: string }
  | { type: "assistant"; content: string }
  | { type: "tool"; name: string; detail?: string }
  | { type: "ui_ask"; kind: string }
  | { type: "agent"; name: string }
  | { type: "lifecycle"; label: string }
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
};

const DEFAULT_VIEW_OPTIONS: Required<SpanCardViewOptions> = {
  withStatus: true,
  expandButton: "inside",
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

const getContentWidth = ({
  level,
  hasExpandButton,
  contentPadding,
  expandButton,
}: {
  level: number;
  hasExpandButton: boolean;
  contentPadding: number;
  expandButton: ExpandButtonPlacement;
}) => {
  let width =
    LAYOUT_CONSTANTS.CONTENT_BASE_WIDTH -
    level * LAYOUT_CONSTANTS.CONNECTOR_WIDTH;

  if (hasExpandButton && expandButton === "inside") {
    width -= LAYOUT_CONSTANTS.CONNECTOR_WIDTH;
  }

  if (expandButton === "outside" && level === 0) {
    width -= LAYOUT_CONSTANTS.CONNECTOR_WIDTH;
  }

  return width - contentPadding;
};

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

const getContentPadding = ({
  level,
  hasExpandButton,
}: {
  level: number;
  hasExpandButton: boolean;
}) => {
  if (level === 0) return 0;

  if (hasExpandButton) return 4;

  return 8;
};

const getConnectorsLayout = ({
  level,
  hasExpandButton,
  isLastChild,
  prevConnectors,
  expandButton,
}: {
  hasExpandButton: boolean;
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

  let connectorsColumnWidth =
    connectors.length * LAYOUT_CONSTANTS.CONNECTOR_WIDTH;

  if (hasExpandButton) {
    connectorsColumnWidth += LAYOUT_CONSTANTS.CONNECTOR_WIDTH;
  }

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

  const spanStyle = useMemo(() => getSpanStyle(data), [data]);
  const spanDisplay = useMemo(() => getSpanDisplay(data), [data]);

  const hasExpandButtonAsFirstChild =
    expandButton === "inside" && state.hasChildren;

  const contentPadding = getContentPadding({
    level,
    hasExpandButton: hasExpandButtonAsFirstChild,
  });

  const contentWidth = getContentWidth({
    level,
    hasExpandButton: hasExpandButtonAsFirstChild,
    contentPadding,
    expandButton,
  });

  const { connectors, connectorsColumnWidth } = getConnectorsLayout({
    level,
    hasExpandButton: hasExpandButtonAsFirstChild,
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
          className={cn(
            "relative mb-3 grid w-full items-center",
            state.isSelected &&
              "before:bg-agentprism-muted/75 before:absolute before:-top-2 before:h-2 before:w-full",
            state.isSelected &&
              "from-agentprism-muted/75 to-agentprism-muted/75 bg-gradient-to-b",
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

            {hasExpandButtonAsFirstChild && (
              <div className="relative flex w-6 shrink-0 items-center justify-center self-stretch">
                <SpanCardToggle
                  isExpanded={state.isExpanded}
                  title={data.title}
                  onToggleClick={eventHandlers.handleToggleClick}
                />

                {state.isExpanded && (
                  <span
                    aria-hidden="true"
                    className="bg-agentprism-border-subtle pointer-events-none absolute left-1/2 top-[calc(50%_+_10px)] -bottom-3 w-0.5 -translate-x-1/2"
                  />
                )}
              </div>
            )}
          </div>
          <div
            className={cn(
              "flex items-center gap-2",
              "min-h-6 w-full cursor-pointer",
              level !== 0 && !hasExpandButtonAsFirstChild && "pl-2",
              level !== 0 && hasExpandButtonAsFirstChild && "pl-1",
            )}
          >
            {spanDisplay?.type === "user" && (
              <UserMessageCard content={spanDisplay.content} />
            )}

            {spanDisplay?.type === "assistant" && (
              <AssistantMessageCard content={spanDisplay.content} />
            )}

            {spanDisplay?.type === "tool" && (
              <ToolCard name={spanDisplay.name} detail={spanDisplay.detail} />
            )}

            {spanDisplay?.type === "ui_ask" && (
              <UIAskCard />
            )}

            {spanDisplay?.type === "agent" && (
              <AgentCard name={spanDisplay.name} />
            )}

            {spanDisplay?.type === "lifecycle" && (
              <LifecycleCard label={spanDisplay.label} />
            )}

            {spanDisplay?.type === "system" && (
              <SystemCard label={spanDisplay.label} />
            )}

            {spanDisplay?.type === "container" && (
              <ContainerCard label={spanDisplay.label} />
            )}

            {!spanDisplay && (
              <div
                className="relative flex min-h-5 shrink-0 flex-wrap items-center gap-1.5"
                style={{
                  width: `min(${contentWidth}px, 100%)`,
                  minWidth: 140,
                }}
              >
                {spanStyle.indicator && (
                  <span
                    aria-hidden="true"
                    className="text-agentprism-foreground text-[15px] font-bold leading-none"
                  >
                    {spanStyle.indicator}
                  </span>
                )}

                <h3
                  className={cn(
                    "text-agentprism-foreground max-w-32 truncate leading-[16px]",
                    spanStyle.titleClassName,
                  )}
                  title={data.title}
                >
                  {data.title}
                </h3>
              </div>
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
