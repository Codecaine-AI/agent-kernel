import type { FC } from "react";

import type { SpanCardChrome } from "../SpanCard";

import { TraceCard } from "../TraceCard";
import { CARD_TYPE_BODY } from "./card-type";

interface UserMessageCardProps {
  content: string;
  chrome: SpanCardChrome;
}

export const UserMessageCard: FC<UserMessageCardProps> = ({ content, chrome }) => (
  <TraceCard
    kind={chrome.descriptor.kind}
    group={chrome.descriptor.group}
    side={chrome.side}
    style={chrome.style}
    size="box"
    label={chrome.label}
    className="max-w-[90%]"
  >
    <p className={`${CARD_TYPE_BODY} line-clamp-5 whitespace-pre-wrap break-words px-2 py-1`}>
      {content}
    </p>
  </TraceCard>
);
