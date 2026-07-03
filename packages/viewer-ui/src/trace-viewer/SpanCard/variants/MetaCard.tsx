import type { FC } from "react";

import type { SpanCardChrome } from "../SpanCard";

import { TraceCard } from "../TraceCard";
import { CARD_TYPE_META } from "./card-type";

/**
 * MetaCard — the info/debug fallback row (pi_turn_start, "input: …" context
 * rows, etc.). Previously bare, barely-readable text; now a proper mini-card
 * with the SAME anatomy as every other card (tiny icon cap + label), just at
 * the reduced meta size and muted `meta` group color.
 *
 * Warning-status rows arrive here with their group already flipped to "warning"
 * by resolveSpanIcon (status wins), so the "! input:" rows follow the warning
 * group automatically — no special-casing needed.
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
    size="meta"
    label={chrome.label}
  >
    <span
      className={`${CARD_TYPE_META} truncate text-agentprism-muted-foreground`}
      title={title}
    >
      {title}
    </span>
  </TraceCard>
);
