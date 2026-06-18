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
  <span className="inline-block rounded border border-agentprism-badge-agent-foreground px-2 py-0.5 text-xs font-medium tracking-wide text-agentprism-badge-agent-foreground">
    {toTitleCase(name)}
  </span>
);
