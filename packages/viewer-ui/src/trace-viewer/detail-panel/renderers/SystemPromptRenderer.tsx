import type { RendererProps } from "../types";
import { PromptView } from "../PromptView";
import { readStringAttr } from "../../span-style";
import { BaseRenderer } from "./BaseRenderer";

export function SystemPromptRenderer({ span }: RendererProps) {
  if (!span.output) {
    return <BaseRenderer span={span} />;
  }

  const agentName = readStringAttr(span, "agent_name");

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Agent: {agentName ?? "—"}
      </div>
      <PromptView content={span.output} title="System Prompt" />
    </div>
  );
}
