import type { FC } from "react";

import type { SpanCardChrome } from "../SpanCard";

import { TraceCard } from "../TraceCard";
import { CARD_TYPE_LABEL, CARD_TYPE_META } from "./card-type";

interface ToolCardProps {
  name: string;
  detail?: string;
  chrome: SpanCardChrome;
}

export const ToolCard: FC<ToolCardProps> = ({ name, detail, chrome }) => (
  <TraceCard
    kind={chrome.descriptor.kind}
    group={chrome.descriptor.group}
    side={chrome.side}
    style={chrome.style}
    label={chrome.label}
  >
    <span className={`${CARD_TYPE_LABEL} font-medium`}>{name}</span>
    {detail && (
      <code
        className={`${CARD_TYPE_META} max-w-[200px] truncate rounded-[2px] bg-agentprism-code-base px-1.5 py-0.5 text-agentprism-muted-foreground`}
      >
        {detail}
      </code>
    )}
  </TraceCard>
);
