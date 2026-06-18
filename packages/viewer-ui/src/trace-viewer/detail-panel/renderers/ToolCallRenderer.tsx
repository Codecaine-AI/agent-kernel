import type { RendererProps } from "../types";
import { JsonViewer } from "../JsonViewer";
import { readNumberAttr, readStringAttr } from "../../span-style";

function tryParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function Section({ label, raw }: { label: string; raw: string }) {
  const parsed = tryParseJson(raw);
  const isObject = parsed !== null && typeof parsed === "object";
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </h4>
      {isObject ? (
        <JsonViewer data={parsed} className="max-h-[400px] overflow-auto" />
      ) : (
        <pre className="bg-muted/50 rounded-md p-3 text-xs font-sans overflow-auto max-h-96 whitespace-pre-wrap break-words">
          {raw}
        </pre>
      )}
    </div>
  );
}

export function ToolCallRenderer({ span }: RendererProps) {
  const toolName = readStringAttr(span, "tool_name");
  const durationMs = readNumberAttr(span, "duration_ms");

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-baseline">
        <span className="font-sans text-sm font-medium">
          {toolName ?? "tool"}
        </span>
        {durationMs !== undefined && (
          <span className="text-xs text-muted-foreground">{durationMs}ms</span>
        )}
      </div>
      {span.input && <Section label="Input" raw={span.input} />}
      {span.output && <Section label="Output" raw={span.output} />}
    </div>
  );
}
