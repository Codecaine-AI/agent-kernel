import type { FC } from "react";

interface ToolCardProps {
  name: string;
  detail?: string;
}

export const ToolCard: FC<ToolCardProps> = ({ name, detail }) => (
  <div className="flex items-center gap-1.5 rounded-[2px] border border-agentprism-badge-tool-foreground px-2 py-0.5 text-foreground">
    <span className="text-[13px] font-medium">{name}</span>
    {detail && (
      <code className="max-w-[200px] truncate rounded-[2px] bg-agentprism-code-base px-1.5 py-0.5 font-sans text-[11px] text-agentprism-muted-foreground">
        {detail}
      </code>
    )}
  </div>
);
