"use client";

import { useState, type ReactNode } from "react";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import cn from "classnames";
import { readStringAttr, spanDisplayTypeOf } from "../span-style";
import { resolveSpanIcon, spanIconFor } from "../icons";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

interface TabShellProps {
  span: TraceSpan;
  primary: ReactNode;
  metadata: ReactNode;
  raw: ReactNode;
}

export function TabShell({ span, primary, metadata, raw }: TabShellProps) {
  const [activeTab, setActiveTab] = useState<"primary" | "metadata" | "raw">("primary");
  const eventType = readStringAttr(span, "event_type") ?? span.type;
  // Echo the tree's kind accent: the glyph + tint seen on the span card is the
  // glyph + tint seen when the span is opened.
  const descriptor = resolveSpanIcon({
    displayType: spanDisplayTypeOf(span),
    status: span.status,
  });
  const Glyph = spanIconFor(descriptor.kind, "outline");
  const tabs = [
    { id: "primary", label: "Primary", content: primary },
    { id: "metadata", label: "Metadata", content: metadata },
    { id: "raw", label: "Raw", content: raw },
  ] as const;

  return (
    <div className="h-full flex flex-col">
      {/* Header: the span TITLE leads; the event type is metadata and reads
          as a quiet chip; duration is small, muted, tabular. */}
      <div className="sticky top-0 bg-background border-b border-border px-4 py-3 flex items-center gap-2 shrink-0">
        <span
          aria-hidden="true"
          className={cn("shrink-0 grid place-items-center", descriptor.accentClassName)}
        >
          <Glyph size={14} />
        </span>
        <span className="text-sm font-semibold truncate text-foreground">{span.title}</span>
        <span className="inline-flex shrink-0 items-center justify-center rounded-[2px] border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {eventType}
        </span>
        {span.duration > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground ml-auto shrink-0">
            {formatDuration(span.duration)}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="mx-4 mt-3 inline-flex h-8 w-fit items-center justify-center rounded-[3px] border border-border bg-muted/40 p-[2px] text-muted-foreground">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "inline-flex h-full flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[2px] px-2.5 font-display text-xs font-medium uppercase tracking-wider transition-all",
                activeTab === tab.id
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tabs.find((tab) => tab.id === activeTab)?.content}
        </div>
      </div>
    </div>
  );
}
