"use client";

import { useState, type ReactNode } from "react";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import cn from "classnames";
import { readStringAttr } from "../span-style";

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
  const tabs = [
    { id: "primary", label: "Primary", content: primary },
    { id: "metadata", label: "Metadata", content: metadata },
    { id: "raw", label: "Raw", content: raw },
  ] as const;

  return (
    <div className="h-full flex flex-col">
      <div className="sticky top-0 bg-background border-b px-6 py-4 flex items-center gap-2 shrink-0">
        <span className="inline-flex shrink-0 items-center justify-center rounded-md border border-border px-2 py-0.5 font-display text-xs font-medium uppercase tracking-wider text-foreground">
          {eventType}
        </span>
        <span className="text-sm font-medium truncate">{span.title}</span>
        {span.duration > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            {formatDuration(span.duration)}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="mx-6 mt-3 inline-flex h-9 w-fit items-center justify-center rounded-md bg-muted p-[3px] text-muted-foreground">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2 py-1 font-display text-xs font-medium uppercase tracking-wider transition-all",
                activeTab === tab.id
                  ? "bg-background text-foreground"
                  : "text-foreground/60 hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {tabs.find((tab) => tab.id === activeTab)?.content}
        </div>
      </div>
    </div>
  );
}
