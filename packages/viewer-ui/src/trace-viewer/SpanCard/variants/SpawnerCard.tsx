import type { FC } from "react";

import type { SpanCardChrome } from "../SpanCard";

import { GROUP_ACCENT } from "../../icons";
import { TraceCard } from "../TraceCard";
import { CARD_TYPE_LABEL, CARD_TYPE_META } from "./card-type";

/**
 * SpawnerCard — a spawner tool call (D77) rendered as an agent dispatch rather
 * than a generic tool. It belongs to the orchestration group (violet), lists
 * the dispatched agent names as chips, and still surfaces the tool name +
 * optional params detail like ToolCard so the call stays inspectable.
 */
interface SpawnerCardProps {
  /** The spawner tool name, e.g. "spawn_research_scouts". */
  name: string;
  /** Declared agent names this call dispatches; ["*"] means any. */
  spawns: string[];
  /** Optional inline detail (e.g. a param preview), mirroring ToolCard. */
  detail?: string;
  chrome: SpanCardChrome;
}

function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const SpawnerCard: FC<SpawnerCardProps> = ({ name, spawns, detail, chrome }) => {
  const named = spawns.filter((s) => s && s !== "*");
  const anyAgent = named.length === 0;
  const accent = GROUP_ACCENT[chrome.descriptor.group];
  const chip = `${CARD_TYPE_META} inline-block rounded-[2px] border px-1.5 py-0.5 font-medium tracking-wide text-foreground ${accent.border}`;

  return (
    <TraceCard
      kind={chrome.descriptor.kind}
      group={chrome.descriptor.group}
      side={chrome.side}
      style={chrome.style}
      label={chrome.label}
    >
      <span
        aria-hidden="true"
        className={`${CARD_TYPE_META} font-semibold uppercase tracking-wide ${accent.text}`}
      >
        Dispatch
      </span>
      <span className={`${CARD_TYPE_LABEL} font-medium`}>{name}</span>
      <span className="flex flex-wrap items-center gap-1">
        {anyAgent ? (
          <span className={chip}>Any Agent</span>
        ) : (
          named.map((agent) => (
            <span key={agent} className={chip}>
              {toTitleCase(agent)}
            </span>
          ))
        )}
      </span>
      {detail && (
        <code
          className={`${CARD_TYPE_META} max-w-[200px] truncate rounded-[2px] bg-agentprism-code-base px-1.5 py-0.5 text-agentprism-muted-foreground`}
        >
          {detail}
        </code>
      )}
    </TraceCard>
  );
};
