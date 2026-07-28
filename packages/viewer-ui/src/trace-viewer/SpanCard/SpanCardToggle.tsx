import type { KeyboardEvent, MouseEvent } from "react";

import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronRight } from "lucide-react";
import cn from "classnames";

interface SpanCardToggleProps {
  isExpanded: boolean;
  title: string;
  onToggleClick: (e: MouseEvent | KeyboardEvent) => void;
}

export const SpanCardToggle = ({
  isExpanded,
  title,
  onToggleClick,
}: SpanCardToggleProps) => (
  <Collapsible.Trigger asChild>
    <button
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-agentprism-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-agentprism-border-subtle",
        !isExpanded && "translate-y-px",
      )}
      onClick={onToggleClick}
      onKeyDown={onToggleClick}
      aria-label={`${isExpanded ? "Collapse" : "Expand"} ${title} children`}
      aria-expanded={isExpanded}
      type="button"
    >
      <ChevronRight
        aria-hidden="true"
        className={cn(
          "text-[rgb(var(--tree-caret,var(--agentprism-muted-foreground))/var(--tree-caret-opacity,1))] size-3.5 transition-transform duration-150 ease-out",
          isExpanded && "rotate-90",
        )}
      />
    </button>
  </Collapsible.Trigger>
);
