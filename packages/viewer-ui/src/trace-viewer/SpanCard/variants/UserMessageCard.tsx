import type { FC } from "react";

interface UserMessageCardProps {
  content: string;
}

export const UserMessageCard: FC<UserMessageCardProps> = ({ content }) => (
  <div className="rounded border border-agentprism-badge-chain-foreground px-2 py-1 text-foreground">
    <p className="text-sm leading-relaxed">{content}</p>
  </div>
);
