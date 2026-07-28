import type { FC } from "react";

import type { SpanCardChrome } from "../SpanCard";

import { TraceCard } from "../TraceCard";
import { CARD_TYPE_LABEL } from "./card-type";

/**
 * MetaCard — the fallback row for unrecognized event types (pi_turn_start,
 * "input: …" debug rows, etc.). Renders at the SAME standard row size as every
 * other card — one row size, no exceptions — with muted text and the neutral
 * plumbing chrome so it stays visually quiet without shrinking.
 */
interface MetaCardProps {
  title: string;
  chrome: SpanCardChrome;
}

export const MetaCard: FC<MetaCardProps> = ({ title, chrome }) => (
  <TraceCard
    kind={chrome.descriptor.kind}
    group={chrome.descriptor.group}
    side={chrome.side}
    style={chrome.style}
    label={chrome.label}
  >
    <span
      className={`${CARD_TYPE_LABEL} truncate text-agentprism-muted-foreground`}
      title={title}
    >
      {title}
    </span>
  </TraceCard>
);
