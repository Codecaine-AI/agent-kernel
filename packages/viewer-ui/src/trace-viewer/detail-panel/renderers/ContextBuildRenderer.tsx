import type { RendererProps } from "../types";
import { JsonViewer } from "../JsonViewer";
import { PromptView } from "@codecaine-ai/prompt-kit/ui/view";
import { readNumberAttr, readStringAttr } from "../../span-style";

function tryParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export function ContextBuildRenderer({ span }: RendererProps) {
  const agentName = readStringAttr(span, "agent_name");
  const totalBytes = readNumberAttr(span, "total_bytes");
  const inputsCount =
    readNumberAttr(span, "inputs_count") ??
    readNumberAttr(span, "declared_inputs_count");

  const headerParts: string[] = [];
  if (agentName) headerParts.push(agentName);
  if (totalBytes !== undefined) headerParts.push(`${totalBytes} bytes`);
  if (inputsCount !== undefined) headerParts.push(`${inputsCount} inputs`);

  const parsedInputs = span.input ? tryParseJson(span.input) : null;
  const inputsAreObject =
    parsedInputs !== null && typeof parsedInputs === "object";

  return (
    <div className="space-y-4">
      {headerParts.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {headerParts.join(" · ")}
        </div>
      )}
      {span.input && (
        <div className="space-y-1">
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">
            Declared Inputs
          </h4>
          {inputsAreObject ? (
            <JsonViewer
              data={parsedInputs}
              className="max-h-[400px] overflow-auto"
            />
          ) : (
            <pre className="bg-muted/30 rounded-md p-3 text-xs leading-relaxed font-sans overflow-auto max-h-96 whitespace-pre-wrap break-words">
              {span.input}
            </pre>
          )}
        </div>
      )}
      {span.output && (
        <PromptView content={span.output} title="Rendered Context" />
      )}
    </div>
  );
}
