import type { RendererProps } from "./types";
import { resolveRenderer } from "./rendererRegistry";
import { readStringAttr } from "../span-style";

export function PrimaryTab({ span }: RendererProps) {
  const eventType = readStringAttr(span, "event_type") ?? span.type;
  const Renderer = resolveRenderer(eventType);
  return <Renderer span={span} />;
}
