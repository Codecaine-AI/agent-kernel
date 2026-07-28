"use client";

/**
 * snapshot-message-view — shared request-snapshot message normalization and
 * small presentational primitives.
 *
 * Everything here is presentational and offline-safe apart from BlobImage,
 * which needs an apiBase to resolve blob bytes.
 */
import { type ReactNode } from "react";

import {
  isImageElisionMarker,
  isKernelAuthoredMessage,
} from "@agent-kernel/protocol";

import { DetailImageTrigger } from "../DetailImageTrigger";
import { DocFigure } from "../doc-figure/DocFigure";
import { SECTION_LABEL_CLASS } from "../section-label";
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
export { SECTION_LABEL_CLASS };

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h4 className={SECTION_LABEL_CLASS}>{children}</h4>;
}

export function formatCount(n: number | undefined): string {
  return n === undefined ? "—" : n.toLocaleString();
}

export function stringifyArguments(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function dataLanguage(value: string): "json" | "text" {
  try {
    JSON.parse(value);
    return "json";
  } catch {
    return "text";
  }
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
  const alt = mimeType ? `${mimeType} attachment` : "image attachment";
  return (
    <DetailImageTrigger
      image={{ src: url, alt }}
      title="Open image"
      className="block max-w-full cursor-zoom-in rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-info-border"
      imageClassName="max-h-[320px] max-w-full rounded-md border border-border/60 object-contain"
    />
  );
}

/** An old image's kernel-authored, plain-text replacement — not source data. */
export function ImageElisionPlaceholder({ text }: { text: string }) {
  return (
    <span
      data-image-elision-placeholder=""
      className="break-words text-xs leading-5 text-muted-foreground/70"
    >
      {text}
    </span>
  );
}

export function ContentBlock({
  block,
  apiBase,
  dataText = false,
  dataCaption = "Data",
}: {
  block: SanitizedContentBlock;
  apiBase: string;
  /** Text is prose unless its enclosing message is itself a data result. */
  dataText?: boolean;
  dataCaption?: string;
}) {
  if (
    block.type === "text" &&
    typeof (block as { text?: unknown }).text === "string"
  ) {
    const text = (block as { text: string }).text;
    if (isImageElisionMarker(text)) {
      return <ImageElisionPlaceholder text={text} />;
    }
    if (dataText) {
      return (
        <DocFigure
          caption={dataCaption}
          body={text}
          language={dataLanguage(text)}
          dedent={false}
        />
      );
    }
    return (
      <p className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
        {text}
      </p>
    );
  }
  if (
    block.type === "thinking" &&
    typeof (block as { thinking?: unknown }).thinking === "string"
  ) {
    const thinking = (block as { thinking: string }).thinking;
    return (
      <DocFigure
        caption="Thinking"
        body={thinking}
        language={dataLanguage(thinking)}
        dedent={false}
      />
    );
  }
  if (block.type === "toolCall") {
    const call = block as { name?: string; id?: string; arguments?: unknown };
    const args = stringifyArguments(call.arguments);
    return (
      <div className="space-y-1">
        {args ? (
          <DocFigure
            caption="Tool call"
            body={args}
            language={dataLanguage(args)}
            dedent={false}
          />
        ) : (
          <span className="text-xs font-mono font-medium">
            {call.name ?? "tool"}
          </span>
        )}
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
  const raw = stringifyArguments(block);
  return (
    <DocFigure
      caption="Content block"
      body={raw}
      language={dataLanguage(raw)}
      dedent={false}
    />
  );
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
