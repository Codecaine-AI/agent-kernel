import type { RendererProps } from "./types";
import cn from "classnames";
import { readStringAttr } from "../span-style";

function formatTimestamp(ts: Date): string {
  return ts.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function MetadataTab({ span }: RendererProps) {
  const toolName = readStringAttr(span, "tool_name");

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">
          Metadata
        </h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <span className="text-muted-foreground">Span ID</span>
          <span className="font-sans text-xs truncate" title={span.id}>{span.id}</span>

          <span className="text-muted-foreground">Start</span>
          <span className="font-sans text-xs">{formatTimestamp(span.startTime)}</span>

          <span className="text-muted-foreground">End</span>
          <span className="font-sans text-xs">{formatTimestamp(span.endTime)}</span>

          <span className="text-muted-foreground">Duration</span>
          <span className="font-sans text-xs">{formatDuration(span.duration)}</span>

          <span className="text-muted-foreground">Type</span>
          <span className="font-sans text-xs">{span.type}</span>

          <span className="text-muted-foreground">Status</span>
          <span className={cn(
            "font-sans text-xs",
            span.status === "error" && "text-destructive",
            span.status === "warning" && "text-status-warning"
          )}>
            {span.status}
          </span>

          {toolName && (
            <>
              <span className="text-muted-foreground">Tool</span>
              <span className="font-sans text-xs">{toolName}</span>
            </>
          )}
        </div>
      </div>

      {span.attributes && span.attributes.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">
            Attributes
          </h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {span.attributes.map((attr) => (
              <div key={attr.key} className="contents">
                <span className="text-muted-foreground truncate">{attr.key}</span>
                <span className="font-sans text-xs truncate">
                  {attr.value?.stringValue ?? attr.value?.intValue ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
