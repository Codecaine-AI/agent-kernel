"use client";

/**
 * snapshot-message-view — the message-level presentation shared by the two
 * request-snapshot layouts: the flat context list (back-compat) and the
 * three-section turn renderer (TurnRequestView).
 *
 * Everything here is presentational and offline-safe apart from BlobImage,
 * which needs an apiBase to resolve blob bytes.
 */
import { useState, type ReactNode } from "react";
import cn from "classnames";

import { isKernelAuthoredMessage } from "@agent-kernel/protocol";

import { JsonViewer } from "../JsonViewer";
import {
  blobUrl,
  type SanitizedContentBlock,
  type SanitizedMessage,
} from "./request-snapshot-api";

/**
 * The ONE section-label style for detail-panel content ("DECLARED INPUTS",
 * "Input", "Metadata"…): small, clear, muted — a label, not a competing
 * headline. Renderers should use SectionHeading / SECTION_LABEL_CLASS instead
 * of hand-rolling heading classes.
 */
export const SECTION_LABEL_CLASS =
  "text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.14em]";

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h4 className={SECTION_LABEL_CLASS}>{children}</h4>;
}

export function formatCount(n: number | undefined): string {
  return n === undefined ? "—" : n.toLocaleString();
}

/** Monospace text that clamps long content behind a "Show all" toggle. */
export function CollapsibleMono({
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
          "bg-muted/30 rounded-md p-3 text-xs leading-relaxed font-mono overflow-auto max-h-[480px] whitespace-pre-wrap break-words",
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

export function stringifyArguments(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** The system prompt body (section ①) without its own heading. */
export function SystemPromptBody({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = prompt.split("\n");
  const clampLines = 5;
  const needsClamp = lines.length > clampLines;
  const shown =
    expanded || !needsClamp ? prompt : lines.slice(0, clampLines).join("\n");
  return (
    <div className="space-y-1">
      <pre className="bg-muted/30 rounded-md p-3 text-xs leading-relaxed font-mono overflow-auto max-h-[480px] whitespace-pre-wrap break-words">
        {shown}
        {needsClamp && !expanded ? "\n…" : null}
      </pre>
      {needsClamp && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {expanded
            ? "Show less"
            : `Show all ${lines.length.toLocaleString()} lines`}
        </button>
      )}
    </div>
  );
}

/**
 * How a kernel-authored line is badged. The builder emits section ②'s context
 * message and section ③'s renderer lines as `role: "custom"` with a
 * `kernel:`-prefixed customType (see @agent-kernel/protocol kernel-messages):
 * they reach the provider as ordinary user messages, but they are NOT things
 * the user said, so the turn view must not badge them USER.
 */
export const KERNEL_ROLE_STYLE = {
  label: "Kernel",
  className: "text-muted-foreground",
} as const;

/** The badge a message wears: KERNEL for kernel-authored lines, else its role. */
export function roleStyleOf(message: SanitizedMessage): {
  label: string;
  className: string;
} {
  if (isKernelAuthoredMessage(message)) return KERNEL_ROLE_STYLE;
  return (
    ROLE_STYLE[message.role] ?? {
      label: message.role,
      className: "text-muted-foreground",
    }
  );
}

export const ROLE_STYLE: Record<string, { label: string; className: string }> = {
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

export function BlobImage({
  apiBase,
  blobHash,
  mimeType,
}: {
  apiBase: string;
  blobHash: string;
  mimeType?: string;
}) {
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

export function ContentBlock({
  block,
  apiBase,
}: {
  block: SanitizedContentBlock;
  apiBase: string;
}) {
  if (
    block.type === "text" &&
    typeof (block as { text?: unknown }).text === "string"
  ) {
    return (
      <CollapsibleMono text={(block as { text: string }).text} clampChars={2000} />
    );
  }
  if (
    block.type === "thinking" &&
    typeof (block as { thinking?: unknown }).thinking === "string"
  ) {
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
          <span className="text-xs font-mono font-medium">
            {call.name ?? "tool"}
          </span>
        </div>
        {args && <CollapsibleMono text={args} clampChars={600} />}
      </div>
    );
  }
  if (
    block.type === "image" &&
    typeof (block as { blob_hash?: unknown }).blob_hash === "string"
  ) {
    const img = block as { blob_hash: string; mimeType?: string };
    return (
      <BlobImage apiBase={apiBase} blobHash={img.blob_hash} mimeType={img.mimeType} />
    );
  }
  // Unknown block shapes degrade to raw JSON, never dropped silently.
  return <JsonViewer data={block} className="max-h-[240px] overflow-auto" />;
}

export function messageFallbackText(
  message: SanitizedMessage,
): string | undefined {
  if (typeof message.summary === "string") return message.summary;
  if (message.role !== "bashExecution") return undefined;

  const command = typeof message.command === "string" ? message.command : "";
  const output = typeof message.output === "string" ? message.output : "";
  if (!command) return output || undefined;
  if (!output) return `$ ${command}`;
  return `$ ${command}\n\n${output}`;
}

/** Normalize a message's content into content blocks (string content lifts to one text block). */
export function contentBlocksOf(
  message: SanitizedMessage,
): SanitizedContentBlock[] {
  const content = message.content ?? messageFallbackText(message);
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content ?? [];
}

/**
 * The message's text when it is carried by a single text block — the shape a
 * rendered <state> block arrives in. Anything richer (images, tool calls,
 * multiple blocks) returns undefined and renders as a normal message.
 */
export function singleTextOf(message: SanitizedMessage): string | undefined {
  const blocks = contentBlocksOf(message);
  if (blocks.length !== 1) return undefined;
  const [block] = blocks;
  if (!block || block.type !== "text") return undefined;
  const text = (block as { text?: unknown }).text;
  return typeof text === "string" ? text : undefined;
}

export function MessageCard({
  message,
  index,
  apiBase,
}: {
  message: SanitizedMessage;
  index: number;
  apiBase: string;
}) {
  const isErrorResult = message.role === "toolResult" && message.isError === true;
  const role = roleStyleOf(message);
  const kernelAuthored = isKernelAuthoredMessage(message);
  const blocks = contentBlocksOf(message);
  return (
    <div
      data-message-role={message.role}
      {...(kernelAuthored ? { "data-message-author": "kernel" } : {})}
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
          <span className="text-xs font-mono text-muted-foreground">
            {message.toolName}
          </span>
        )}
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
          #{index}
        </span>
      </div>
      {blocks.length === 0 ? (
        <div className="text-xs text-muted-foreground">Empty message.</div>
      ) : (
        blocks.map((block, i) => (
          <ContentBlock key={i} block={block} apiBase={apiBase} />
        ))
      )}
    </div>
  );
}
