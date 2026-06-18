import type { RendererProps } from "./types";
import { JsonViewer } from "./JsonViewer";

export function RawTab({ span }: RendererProps) {
  const { children: _children, ...rest } = span;
  return <JsonViewer data={rest} />;
}
