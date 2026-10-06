import type { FC } from "react";

import type { SpanCardChrome } from "../SpanCard";

import { TraceCard } from "../TraceCard";
import { CARD_LINE_LABEL, CARD_TYPE_LABEL } from "./card-type";

interface AgentCardProps {
  name: string;
  chrome: SpanCardChrome;
}

function toTitleCase(str: string): string {
  return str
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const AgentCard: FC<AgentCardProps> = ({ name, chrome }) => (
  <TraceCard
    kind={chrome.descriptor.kind}
    group={chrome.descriptor.group}
    side={chrome.side}
    style={chrome.style}
    label={chrome.label}
  >
    <span style={CARD_LINE_LABEL} className={`${CARD_TYPE_LABEL} font-medium tracking-[var(--ds-letter-spacing-normal)]`}>
      {toTitleCase(name)}
    </span>
  </TraceCard>
);
