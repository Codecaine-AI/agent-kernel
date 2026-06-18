"use client";

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { TabShell } from "./detail-panel/TabShell";
import { PrimaryTab } from "./detail-panel/PrimaryTab";
import { MetadataTab } from "./detail-panel/MetadataTab";
import { RawTab } from "./detail-panel/RawTab";

interface Props {
  span: TraceSpan | null;
}

export function SpanDetailPanel({ span }: Props) {
  if (!span) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Select an event to inspect
      </div>
    );
  }

  return (
    <TabShell
      span={span}
      primary={<PrimaryTab span={span} />}
      metadata={<MetadataTab span={span} />}
      raw={<RawTab span={span} />}
    />
  );
}
