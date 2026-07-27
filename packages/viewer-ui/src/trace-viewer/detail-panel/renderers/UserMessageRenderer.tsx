import type { RendererProps } from "../types";
import { readStringAttr } from "../../span-style";

export function UserMessageRenderer({ span }: RendererProps) {
  const phase = readStringAttr(span, "phase");

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">
        User{phase && <> · {phase}</>}
      </div>
      <div className="rounded-md bg-muted/30 p-3 text-sm whitespace-pre-wrap break-words">
        {span.input ?? "(empty)"}
      </div>
    </div>
  );
}
