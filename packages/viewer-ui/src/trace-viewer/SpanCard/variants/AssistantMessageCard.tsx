import type { FC } from "react";

interface AssistantMessageCardProps {
  content: string;
}

export const AssistantMessageCard: FC<AssistantMessageCardProps> = ({ content }) => (
  <div className="rounded border border-agentprism-badge-llm-foreground px-2 py-1 text-foreground">
    <p className="text-sm leading-relaxed">{content}</p>
  </div>
);
