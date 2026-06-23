import type { FC } from "react";

interface AgentCardProps {
  name: string;
}

function toTitleCase(str: string): string {
  return str
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const AgentCard: FC<AgentCardProps> = ({ name }) => (
  <span className="inline-block rounded-[2px] border border-agentprism-badge-agent-foreground px-2 py-0.5 text-[13px] font-medium tracking-wide text-foreground">
    {toTitleCase(name)}
  </span>
);
