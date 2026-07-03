"use client";

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { TabShell } from "./detail-panel/TabShell";
import { PrimaryTab } from "./detail-panel/PrimaryTab";
import { MetadataTab } from "./detail-panel/MetadataTab";
import { RawTab } from "./detail-panel/RawTab";
import type { UsageContext } from "./detail-panel/types";

interface Props {
  span: TraceSpan | null;
  /**
   * Workspace usage data, so container/phase/session/run spans can show a
   * usage aggregate on the PRIMARY tab instead of dead-ending.
   */
  usageContext?: UsageContext;
}

export function SpanDetailPanel({ span, usageContext }: Props) {
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
      primary={<PrimaryTab span={span} usageContext={usageContext} />}
      metadata={<MetadataTab span={span} />}
      raw={<RawTab span={span} />}
    />
  );
}
