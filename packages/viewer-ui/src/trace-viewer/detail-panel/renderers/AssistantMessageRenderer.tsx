import type { RendererProps } from "../types";
import { readStringAttr } from "../../span-style";

export function AssistantMessageRenderer({ span }: RendererProps) {
  const blockType = readStringAttr(span, "block_type");

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Assistant{blockType && <> · {blockType}</>}
      </div>
      <div className="rounded-md bg-muted/30 p-3 text-sm whitespace-pre-wrap break-words">
        {span.output ?? "(empty)"}
      </div>
    </div>
  );
}
