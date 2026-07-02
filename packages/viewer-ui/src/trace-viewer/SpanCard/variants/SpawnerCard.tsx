import type { FC } from "react";

/**
 * SpawnerCard — a spawner tool call (D77) rendered as an agent dispatch rather
 * than a generic tool. It echoes AgentCard's badge-agent accent so "dispatch"
 * and "agent" read as related, lists the dispatched agent names as chips, and
 * still surfaces the tool name + optional params detail like ToolCard so the
 * call stays inspectable.
 */
interface SpawnerCardProps {
  /** The spawner tool name, e.g. "spawn_research_scouts". */
  name: string;
  /** Declared agent names this call dispatches; ["*"] means any. */
  spawns: string[];
  /** Optional inline detail (e.g. a param preview), mirroring ToolCard. */
  detail?: string;
}

function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const SpawnerCard: FC<SpawnerCardProps> = ({ name, spawns, detail }) => {
  const named = spawns.filter((s) => s && s !== "*");
  const anyAgent = named.length === 0;

  return (
    <div className="flex items-center gap-1.5 rounded-[2px] border border-agentprism-badge-agent-foreground px-2 py-0.5 text-foreground">
      <span
        aria-hidden="true"
        className="text-[11px] font-semibold uppercase tracking-wide text-agentprism-badge-agent-foreground"
      >
        Dispatch
      </span>
      <span className="text-[13px] font-medium">{name}</span>
      <span className="flex flex-wrap items-center gap-1">
        {anyAgent ? (
          <span className="inline-block rounded-[2px] border border-agentprism-badge-agent-foreground px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-foreground">
            Any Agent
          </span>
        ) : (
          named.map((agent) => (
            <span
              key={agent}
              className="inline-block rounded-[2px] border border-agentprism-badge-agent-foreground px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-foreground"
            >
              {toTitleCase(agent)}
            </span>
          ))
        )}
      </span>
      {detail && (
        <code className="max-w-[200px] truncate rounded-[2px] bg-agentprism-code-base px-1.5 py-0.5 font-sans text-[11px] text-agentprism-muted-foreground">
          {detail}
        </code>
      )}
    </div>
  );
};
