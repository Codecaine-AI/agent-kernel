import type { FC } from "react";

import type { SpanCardChrome } from "../SpanCard";

import { TraceCard } from "../TraceCard";
import { CARD_TYPE_BODY } from "./card-type";

interface AssistantMessageCardProps {
  content: string;
  chrome: SpanCardChrome;
}

export const AssistantMessageCard: FC<AssistantMessageCardProps> = ({ content, chrome }) => (
  <TraceCard
    kind={chrome.descriptor.kind}
    group={chrome.descriptor.group}
    side={chrome.side}
    style={chrome.style}
    size="box"
    label={chrome.label}
    className="max-w-[90%]"
  >
    {/* No top padding: the first line box (13px/relaxed ≈ 21px) must stay flush
        to the frame so its center matches the 22px corner cap's glyph center. */}
    <p className={`${CARD_TYPE_BODY} line-clamp-5 whitespace-pre-wrap break-words px-2 pb-1`}>
      {content}
    </p>
  </TraceCard>
);
