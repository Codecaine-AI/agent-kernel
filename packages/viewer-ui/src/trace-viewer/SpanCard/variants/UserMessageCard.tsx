import type { FC } from "react";

interface UserMessageCardProps {
  content: string;
}

export const UserMessageCard: FC<UserMessageCardProps> = ({ content }) => (
  <div className="max-w-[90%] rounded-[2px] border border-agentprism-badge-chain-foreground px-2 py-1 text-foreground">
    <p className="line-clamp-5 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{content}</p>
  </div>
);
