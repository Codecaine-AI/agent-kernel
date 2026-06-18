import type { RendererProps } from "../types";
import { JsonViewer } from "../JsonViewer";

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

export function BaseRenderer({ span }: RendererProps) {
  if (!span.input && !span.output) {
    return (
      <div className="text-sm text-muted-foreground">
        No input or output for this event.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {span.input && <Section label="Input" raw={span.input} />}
      {span.output && <Section label="Output" raw={span.output} />}
    </div>
  );
}
