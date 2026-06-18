import type { FC } from "react";

interface ToolCardProps {
  name: string;
  detail?: string;
}

export const ToolCard: FC<ToolCardProps> = ({ name, detail }) => (
  <div className="flex items-center gap-1.5 rounded border border-agentprism-badge-tool-foreground px-2 py-0.5 text-agentprism-badge-tool-foreground">
    <span className="text-xs font-medium">{name}</span>
    {detail && (
      <code className="max-w-[200px] truncate rounded bg-agentprism-code-base px-1.5 py-0.5 font-sans text-[10px] text-agentprism-muted-foreground">
        {detail}
      </code>
    )}
  </div>
);
