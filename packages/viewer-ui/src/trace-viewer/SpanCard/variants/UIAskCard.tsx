import type { FC } from "react";

import type { SpanCardChrome } from "../SpanCard";

import { TraceCard } from "../TraceCard";
import { CARD_TYPE_LABEL } from "./card-type";

interface UIAskCardProps {
  chrome: SpanCardChrome;
}

export const UIAskCard: FC<UIAskCardProps> = ({ chrome }) => (
  <TraceCard
    kind={chrome.descriptor.kind}
    group={chrome.descriptor.group}
    side={chrome.side}
    style={chrome.style}
    label={chrome.label}
  >
    <span className={`${CARD_TYPE_LABEL} font-medium`}>User Input Requested</span>
  </TraceCard>
);
