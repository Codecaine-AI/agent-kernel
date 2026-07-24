"use client";

/**
 * RequestSnapshotRenderer — detail view for pi_request_snapshot events (the
 * FULL context window the model saw at one turn).
 *
 * Offline (no TraceViewerApiContext provider / apiBase null): a summary block
 * from the span attributes plus a per-message table of blob refs.
 *
 * Online (apiBase + run_id attr present): fetches the sanitized full context
 * (GET /runs/:runId/turns/:n/context) and renders the whole conversation —
 * system prompt, text/thinking/toolCall/toolResult blocks, and images served
 * straight from the blob store. Any fetch failure falls back to the summary
 * with a one-line muted note.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import cn from "classnames";

import type { PiRequestSnapshotMessageRef } from "@agent-kernel/viewer-core";

import type { RendererProps } from "../types";
import { JsonViewer } from "../JsonViewer";
import { readNumberAttr, readStringAttr } from "../../span-style";
import { useTraceViewerApi } from "../TraceViewerApiContext";
import {
  blobUrl,
  runTurnContextUrl,
  type RunTurnContextResponse,
  type SanitizedContentBlock,
  type SanitizedMessage,
} from "./request-snapshot-api";

// ─── Small shared pieces ────────────────────────────────────────────────────

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
      {children}
    </h4>
  );
}

function formatCount(n: number | undefined): string {
  return n === undefined ? "—" : n.toLocaleString();
}

/** Monospace text that clamps long content behind a "Show all" toggle. */
function CollapsibleMono({
  text,
  clampChars = 1200,
  className,
}: {
  text: string;
  clampChars?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const needsClamp = text.length > clampChars;
  const shown = expanded || !needsClamp ? text : text.slice(0, clampChars);
  return (
    <div className="space-y-1">
      <pre
        className={cn(
          "bg-muted/50 rounded-md p-3 text-xs font-mono overflow-auto max-h-[480px] whitespace-pre-wrap break-words",
          className,
        )}
      >
        {shown}
        {needsClamp && !expanded ? "…" : null}
      </pre>
      {needsClamp && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {expanded
            ? "Show less"
            : `Show all (${text.length.toLocaleString()} chars)`}
        </button>
      )}
    </div>
  );
}

function stringifyArguments(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

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

function SummaryBlock({
  turnNumber,
  messageCount,
  totalTextChars,
  totalImageCount,
  promptHash,
}: {
  turnNumber: number | undefined;
  messageCount: number | undefined;
  totalTextChars: number | undefined;
  totalImageCount: number | undefined;
  promptHash: string | undefined;
}) {
  const stats: Array<[label: string, value: string]> = [
    ["Turn", turnNumber === undefined ? "—" : String(turnNumber)],
    ["Messages", formatCount(messageCount)],
    ["Text chars", formatCount(totalTextChars)],
    ["Images", formatCount(totalImageCount)],
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {stats.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
            <span className="text-sm font-medium tabular-nums">{value}</span>
          </div>
        ))}
      </div>
      {promptHash && (
        <div className="text-[11px] text-muted-foreground font-mono truncate">
          prompt {promptHash}
        </div>
      )}
    </div>
  );
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

function SystemPromptSection({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = prompt.split("\n");
  const clampLines = 5;
  const needsClamp = lines.length > clampLines;
  const shown = expanded || !needsClamp ? prompt : lines.slice(0, clampLines).join("\n");
  return (
    <div className="space-y-1">
      <SectionHeading>System prompt</SectionHeading>
      <pre className="bg-muted/50 rounded-md p-3 text-xs font-mono overflow-auto max-h-[480px] whitespace-pre-wrap break-words">
        {shown}
        {needsClamp && !expanded ? "\n…" : null}
      </pre>
      {needsClamp && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {expanded ? "Show less" : `Show all ${lines.length.toLocaleString()} lines`}
        </button>
      )}
    </div>
  );
}

const ROLE_STYLE: Record<string, { label: string; className: string }> = {
  user: { label: "User", className: "text-trace-user" },
  assistant: { label: "Assistant", className: "text-trace-assistant" },
  toolResult: { label: "Tool result", className: "text-trace-tool" },
  custom: { label: "Custom", className: "text-muted-foreground" },
  branchSummary: { label: "Branch summary", className: "text-muted-foreground" },
  compactionSummary: {
    label: "Compaction summary",
    className: "text-muted-foreground",
  },
  bashExecution: { label: "Bash", className: "text-trace-tool" },
};

function BlobImage({ apiBase, blobHash, mimeType }: { apiBase: string; blobHash: string; mimeType?: string }) {
  const url = blobUrl(apiBase, blobHash);
  return (
    <img
      src={url}
      alt={mimeType ? `${mimeType} attachment` : "image attachment"}
      title="Open raw image"
      onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
      className="max-w-full max-h-[320px] rounded-md border border-border/60 cursor-zoom-in object-contain"
    />
  );
}

function ContentBlock({
  block,
  apiBase,
}: {
  block: SanitizedContentBlock;
  apiBase: string;
}) {
  if (block.type === "text" && typeof (block as { text?: unknown }).text === "string") {
    return <CollapsibleMono text={(block as { text: string }).text} clampChars={2000} />;
  }
  if (block.type === "thinking" && typeof (block as { thinking?: unknown }).thinking === "string") {
    return (
      <div className="space-y-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
          Thinking
        </span>
        <CollapsibleMono
          text={(block as { thinking: string }).thinking}
          clampChars={800}
          className="italic text-muted-foreground bg-transparent border border-dashed border-border/60"
        />
      </div>
    );
  }
  if (block.type === "toolCall") {
    const call = block as { name?: string; id?: string; arguments?: unknown };
    const args = stringifyArguments(call.arguments);
    return (
      <div className="space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            Tool call
          </span>
          <span className="text-xs font-mono font-medium">{call.name ?? "tool"}</span>
        </div>
        {args && <CollapsibleMono text={args} clampChars={600} />}
      </div>
    );
  }
  if (block.type === "image" && typeof (block as { blob_hash?: unknown }).blob_hash === "string") {
    const img = block as { blob_hash: string; mimeType?: string };
    return <BlobImage apiBase={apiBase} blobHash={img.blob_hash} mimeType={img.mimeType} />;
  }
  // Unknown block shapes degrade to raw JSON, never dropped silently.
  return <JsonViewer data={block} className="max-h-[240px] overflow-auto" />;
}

function messageFallbackText(message: SanitizedMessage): string | undefined {
  if (typeof message.summary === "string") return message.summary;
  if (message.role !== "bashExecution") return undefined;

  const command = typeof message.command === "string" ? message.command : "";
  const output = typeof message.output === "string" ? message.output : "";
  if (!command) return output || undefined;
  if (!output) return `$ ${command}`;
  return `$ ${command}\n\n${output}`;
}

function MessageCard({
  message,
  index,
  apiBase,
}: {
  message: SanitizedMessage;
  index: number;
  apiBase: string;
}) {
  const isErrorResult = message.role === "toolResult" && message.isError === true;
  const role = ROLE_STYLE[message.role] ?? { label: message.role, className: "text-muted-foreground" };
  const content = message.content ?? messageFallbackText(message);
  const blocks: SanitizedContentBlock[] =
    typeof content === "string"
      ? [{ type: "text", text: content }]
      : (content ?? []);
  return (
    <div
      className={cn(
        "rounded-md border p-3 space-y-2",
        isErrorResult ? "border-destructive/50 bg-destructive/5" : "border-border/60",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "text-[10px] font-medium uppercase tracking-wider",
            isErrorResult ? "text-destructive" : role.className,
          )}
        >
          {role.label}
          {isErrorResult ? " · error" : ""}
        </span>
        {typeof message.customType === "string" && (
          <span className="inline-flex shrink-0 items-center gap-1">
            <span aria-hidden="true" className="text-[10px] text-muted-foreground/60">
              ·
            </span>
            <span className="inline-flex h-4 items-center rounded-[2px] border border-border bg-muted/30 px-1 text-[9px] font-mono text-muted-foreground">
              {message.customType}
            </span>
          </span>
        )}
        {message.role === "toolResult" && typeof message.toolName === "string" && (
          <span className="text-xs font-mono text-muted-foreground">{message.toolName}</span>
        )}
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
          #{index}
        </span>
      </div>
      {blocks.length === 0 ? (
        <div className="text-xs text-muted-foreground">Empty message.</div>
      ) : (
        blocks.map((block, i) => <ContentBlock key={i} block={block} apiBase={apiBase} />)
      )}
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
    if (!apiBase || !runId || turnNumber === undefined) {
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
  const messageCount = readNumberAttr(span, "message_count");
  const totalTextChars = readNumberAttr(span, "total_text_chars");
  const totalImageCount = readNumberAttr(span, "total_image_count");
  const promptHash = readStringAttr(span, "prompt_hash");

  const refs = useMemo(() => parseRefs(span.input), [span.input]);
  const fetchState = useRunTurnContext(apiBase, runId, turnNumber);

  const summary = (
    <SummaryBlock
      turnNumber={turnNumber}
      messageCount={messageCount}
      totalTextChars={totalTextChars}
      totalImageCount={totalImageCount}
      promptHash={promptHash}
    />
  );

  if (fetchState.phase === "loaded" && apiBase) {
    const { context } = fetchState;
    return (
      <div className="space-y-4">
        {summary}
        {context.system_prompt && <SystemPromptSection prompt={context.system_prompt} />}
        <div className="space-y-1">
          <SectionHeading>Context window</SectionHeading>
          <div className="space-y-2">
            {context.messages.map((message, i) => (
              <MessageCard key={i} message={message} index={i} apiBase={apiBase} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summary}
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
