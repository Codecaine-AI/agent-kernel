import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { flattenSpans, findTimeRange } from "@evilmartians/agent-prism-data";
import cn from "classnames";
import { type FC } from "react";

import type { SpanCardViewOptions } from "./SpanCard/SpanCard";

import { SpanCard } from "./SpanCard/SpanCard";

interface TreeViewProps {
  spans: TraceSpan[];
  className?: string;
  selectedSpan?: TraceSpan;
  onSpanSelect?: (span: TraceSpan) => void;
  expandedSpansIds: string[];
  onExpandSpansIdsChange: (ids: string[]) => void;
  spanCardViewOptions?: SpanCardViewOptions;
}

function isPhaseSpan(span: TraceSpan): boolean {
  return span.id.startsWith("phase:");
}

export const TreeView: FC<TreeViewProps> = ({
  spans,
  onSpanSelect,
  className = "",
  selectedSpan,
  expandedSpansIds,
  onExpandSpansIdsChange,
  spanCardViewOptions,
}) => {
  const allCards = flattenSpans(spans);
  const { minStart, maxEnd } = findTimeRange(allCards);

  return (
    <div className="w-full min-w-0">
      <ul
        className={cn(className, "overflow-x-auto")}
        role="tree"
        aria-label="Hierarchical card list"
      >
        {spans.map((span, idx) => {
          const isPhase = isPhaseSpan(span);

          return (
            <div
              key={span.id}
              className={cn(
                "px-4 pt-2",
                isPhase && idx > 0 && "border-t border-border/60",
              )}
            >
              <SpanCard
                data={span}
                level={0}
                selectedSpan={selectedSpan}
                onSpanSelect={onSpanSelect}
                minStart={minStart}
                maxEnd={maxEnd}
                isLastChild={idx === spans.length - 1}
                expandedSpansIds={expandedSpansIds}
                onExpandSpansIdsChange={onExpandSpansIdsChange}
                viewOptions={spanCardViewOptions}
              />
            </div>
          );
        })}
      </ul>
    </div>
  );
};
