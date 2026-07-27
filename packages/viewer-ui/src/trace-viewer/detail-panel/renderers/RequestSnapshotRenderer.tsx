"use client";

/**
 * RequestSnapshotRenderer — detail view for pi_request_snapshot events (the
 * FULL context window the model saw at one turn).
 *
 * Offline (no TraceViewerApiContext provider / apiBase null): a summary block
 * from the span attributes plus a per-message table of blob refs. Only `null`
 * is offline — `""` is a valid same-origin base and stays online.
 *
 * Online (apiBase non-null + run_id attr present): fetches the sanitized full context
 * (GET /runs/:runId/turns/:n/context) and renders the whole conversation —
 * system prompt, text/thinking/toolCall/toolResult blocks, and images served
 * straight from the blob store. Any fetch failure falls back to the summary
 * with a one-line muted note.
 *
 * When the snapshot carries section tags, the fetched context renders as the
 * three-section turn view (TurnRequestView) instead of one flat list.
 * Snapshots without tags keep the flat list exactly as before.
 */
import { useEffect, useMemo, useState } from "react";

import type { PiRequestSnapshotMessageRef } from "@agent-kernel/viewer-core";

import type { RendererProps } from "../types";
import { readNumberAttr, readStringAttr } from "../../span-style";
import { useTraceViewerApi } from "../TraceViewerApiContext";
import {
  hasApiBase,
  runTurnContextUrl,
  type RunTurnContextResponse,
  type SanitizedMessage,
} from "./request-snapshot-api";
import {
  MessageCard,
  SectionHeading,
  SystemPromptBody,
  formatCount,
} from "./snapshot-message-view";
import { TurnRequestView } from "./TurnRequestView";
import { parseSectionTags, type RequestSectionTag } from "./turn-sections";

// ─── Summary (always available, offline-safe) ───────────────────────────────

function parseRefs(input: string | undefined): PiRequestSnapshotMessageRef[] {
  if (!input) return [];
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? (parsed as PiRequestSnapshotMessageRef[]) : [];
  } catch {
    return [];
  }
}

function RefsTable({ refs }: { refs: PiRequestSnapshotMessageRef[] }) {
  if (refs.length === 0) return null;
  return (
    <div className="space-y-1">
      <SectionHeading>Messages</SectionHeading>
      <div className="overflow-auto rounded-md border border-border/60">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-border/60 text-muted-foreground">
              <th className="px-2 py-1 text-right font-medium">#</th>
              <th className="px-2 py-1 text-left font-medium">role</th>
              <th className="px-2 py-1 text-right font-medium">text chars</th>
              <th className="px-2 py-1 text-right font-medium">images</th>
              <th className="px-2 py-1 text-right font-medium">tool calls</th>
            </tr>
          </thead>
          <tbody>
            {refs.map((ref) => (
              <tr key={ref.index} className="border-b border-border/40 last:border-b-0">
                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                  {ref.index}
                </td>
                <td className="px-2 py-1">{ref.role}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {formatCount(ref.text_chars)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {formatCount(ref.image_count)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {formatCount(ref.tool_call_count)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Full-context rendering (online) ────────────────────────────────────────

/**
 * The fetched context window, rendered. Section-tagged snapshots get the
 * three-section turn view; untagged ones get the flat list this renderer has
 * always shown. Exported so both branches are testable without a fetch.
 */
export function SnapshotContextBody({
  systemPrompt,
  messages,
  sections,
  apiBase,
}: {
  systemPrompt: string | null;
  messages: SanitizedMessage[];
  sections: RequestSectionTag[] | null;
  apiBase: string;
}) {
  if (sections) {
    return (
      <TurnRequestView
        systemPrompt={systemPrompt}
        messages={messages}
        sections={sections}
        apiBase={apiBase}
      />
    );
  }
  return (
    <div className="space-y-4" data-turn-view="flat">
      {systemPrompt && (
        <div className="space-y-1">
          <SectionHeading>System prompt</SectionHeading>
          <SystemPromptBody prompt={systemPrompt} />
        </div>
      )}
      <div className="space-y-1">
        <SectionHeading>Context window</SectionHeading>
        <div className="space-y-2">
          {messages.map((message, i) => (
            <MessageCard key={i} message={message} index={i} apiBase={apiBase} />
          ))}
        </div>
      </div>
    </div>
  );
}

type FetchState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "loaded"; context: RunTurnContextResponse };

function useRunTurnContext(
  apiBase: string | null,
  runId: string | undefined,
  turnNumber: number | undefined,
): FetchState {
  const [state, setState] = useState<FetchState>({ phase: "idle" });

  useEffect(() => {
    // `""` is same-origin, not offline — only null means "no API".
    if (!hasApiBase(apiBase) || !runId || turnNumber === undefined) {
      setState({ phase: "idle" });
      return;
    }
    let cancelled = false;
    setState({ phase: "loading" });
    fetch(runTurnContextUrl(apiBase, runId, turnNumber))
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as RunTurnContextResponse;
      })
      .then((context) => {
        if (cancelled) return;
        if (!Array.isArray(context?.messages)) throw new Error("malformed response");
        setState({ phase: "loaded", context });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, runId, turnNumber]);

  return state;
}

// ─── The renderer ───────────────────────────────────────────────────────────

export function RequestSnapshotRenderer({ span }: RendererProps) {
  const { apiBase } = useTraceViewerApi();

  const runId = readStringAttr(span, "run_id");
  const turnNumber = readNumberAttr(span, "turn_number");
  // Section tags ride the turn-context response; the span attribute is the
  // offline/older-transport fallback carrying the same JSON.
  const sectionsAttr = readStringAttr(span, "sections");

  const refs = useMemo(() => parseRefs(span.input), [span.input]);
  const fetchState = useRunTurnContext(apiBase, runId, turnNumber);
  const fetchedSections =
    fetchState.phase === "loaded" ? fetchState.context.sections : undefined;
  const sections = useMemo(
    () => parseSectionTags(fetchedSections ?? sectionsAttr),
    [fetchedSections, sectionsAttr],
  );

  // No stats/hash preamble — turn/message/char/image counts and the prompt
  // hash live in the METADATA tab (span attributes); PRIMARY opens straight
  // into the context window itself.
  if (fetchState.phase === "loaded" && hasApiBase(apiBase)) {
    const { context } = fetchState;
    return (
      <SnapshotContextBody
        systemPrompt={context.system_prompt}
        messages={context.messages}
        sections={sections}
        apiBase={apiBase}
      />
    );
  }

  return (
    <div className="space-y-4">
      {fetchState.phase === "loading" && (
        <div className="text-[11px] text-muted-foreground">Loading full context…</div>
      )}
      {fetchState.phase === "error" && (
        <div className="text-[11px] text-muted-foreground">
          Full context unavailable ({fetchState.message}) — showing snapshot summary.
        </div>
      )}
      <RefsTable refs={refs} />
    </div>
  );
}
