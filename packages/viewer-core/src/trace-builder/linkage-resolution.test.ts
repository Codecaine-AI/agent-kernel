import { describe, expect, it } from "bun:test";

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { EventType } from "../types";

import {
  groupAgentsByContainer,
  type ContainerRange,
} from "./containerGrouping";
import { groupAgentsByPhase, type PhaseRange } from "./phaseGrouping";
import { findToolCallSpanByToolUseId } from "./nesting";
import { makeAttr } from "./spanAttributes";

// Fixture timestamps. Note: agent.startTime in the OUTSIDE windows below is
// deliberately set so that the legacy timestamp-overlap path would NOT match
// the agent to its declared container/phase. Any test that passes here proves
// the explicit-id code path was taken.
const t100 = new Date("2026-01-01T00:01:40Z");
const t110 = new Date("2026-01-01T00:01:50Z");
const t150 = new Date("2026-01-01T00:02:30Z");
const t200 = new Date("2026-01-01T00:03:20Z");
const t300 = new Date("2026-01-01T00:05:00Z");
const t400 = new Date("2026-01-01T00:06:40Z");
const t900 = new Date("2026-01-01T00:15:00Z"); // outside every window above

function makeAgentSpan(opts: {
  id: string;
  startTime: Date;
  containerId?: string | null;
  phase?: string | null;
  parentToolUseId?: string | null;
}): TraceSpan {
  const attrs = [
    makeAttr("event_type", "pi_agent_container"),
    makeAttr("container_id", opts.containerId ?? null),
    makeAttr("phase", opts.phase ?? null),
    makeAttr("parent_tool_use_id", opts.parentToolUseId ?? null),
  ].filter((a): a is NonNullable<typeof a> => a !== null);
  return {
    id: opts.id,
    title: opts.id,
    startTime: opts.startTime,
    endTime: opts.startTime,
    duration: 0,
    type: "agent_invocation",
    status: "success",
    raw: "",
    attributes: attrs,
  };
}

function makeContainerRange(opts: {
  containerId: string;
  level: "outline" | "checkpoint" | "task_group";
  parentContainerId?: string | null;
  start: Date;
  end: Date;
  label?: string;
}): ContainerRange {
  return {
    containerId: opts.containerId,
    level: opts.level,
    label: opts.label ?? opts.containerId,
    producerStage: opts.level,
    parentContainerId: opts.parentContainerId ?? null,
    checkpointId: null,
    taskGroupId: null,
    phase: null,
    start: opts.start,
    end: opts.end,
  };
}

function makeToolCallSpan(opts: {
  id: string;
  toolUseId: string;
  start: Date;
  end: Date;
  children?: TraceSpan[];
}): TraceSpan {
  const toolUseAttr = makeAttr("tool_use_id", opts.toolUseId);
  const eventTypeAttr = makeAttr("event_type", EventType.TOOL_CALL_START);
  const attrs = [eventTypeAttr, toolUseAttr].filter(
    (a): a is NonNullable<typeof a> => a !== null,
  );
  return {
    id: opts.id,
    title: opts.id,
    startTime: opts.start,
    endTime: opts.end,
    duration: opts.end.getTime() - opts.start.getTime(),
    type: "tool_execution",
    status: "success",
    raw: "",
    attributes: attrs,
    children: opts.children,
  };
}

describe("groupAgentsByContainer routes by explicit container_id, ignoring timestamps", () => {
  it("nests agents under their declared container even when startTime is outside the window", () => {
    const containerMap = new Map<string, ContainerRange>([
      [
        "cp-1",
        makeContainerRange({
          containerId: "cp-1",
          level: "checkpoint",
          start: t100,
          end: t200,
        }),
      ],
      [
        "tg-1",
        makeContainerRange({
          containerId: "tg-1",
          level: "task_group",
          parentContainerId: "cp-1",
          start: t110,
          end: t150,
        }),
      ],
    ]);

    const childEvent: TraceSpan = {
      id: "event-1",
      title: "tool_call",
      startTime: t900,
      endTime: t900,
      duration: 0,
      type: "tool_execution",
      status: "success",
      raw: "",
    };
    const agentA = {
      ...makeAgentSpan({
        id: "pi:agent-A",
        containerId: "tg-1",
        startTime: t900, // outside every container window
      }),
      children: [childEvent],
    };
    const agentB = makeAgentSpan({
      id: "pi:agent-B",
      containerId: "cp-1",
      startTime: t900,
    });

    const result = groupAgentsByContainer([agentA, agentB], containerMap);

    expect(result).toHaveLength(1);
    const cp1 = result[0]!;
    expect(cp1.id).toBe("container:cp-1");

    const cp1Children = cp1.children ?? [];
    const tg1 = cp1Children.find((c) => c.id === "container:tg-1");
    expect(tg1).toBeDefined();
    // Single-agent container folds: agent-A's children are promoted directly
    expect((tg1!.children ?? []).map((c) => c.id)).toContain("event-1");

    const directAgentB = cp1Children.find((c) => c.id === "pi:agent-B");
    expect(directAgentB).toBeDefined();
  });

  it("places spans with no container_id into the tightest time-containing container", () => {
    const containerMap = new Map<string, ContainerRange>([
      [
        "cp-1",
        makeContainerRange({
          containerId: "cp-1",
          level: "checkpoint",
          start: t100,
          end: t200,
        }),
      ],
    ]);

    // startTime t110 is INSIDE cp-1's [t100, t200) window. Explicit
    // container_id placement is preferred, then orphan spans use time fallback.
    const orphan = makeAgentSpan({
      id: "pi:orphan",
      containerId: null,
      startTime: t110,
    });

    const result = groupAgentsByContainer([orphan], containerMap);

    const cp1 = result.find((s) => s.id === "container:cp-1");
    const cp1Children = cp1?.children ?? [];
    expect(cp1Children.find((c) => c.id === "pi:orphan")).toBeDefined();
    expect(result.find((s) => s.id === "pi:orphan")).toBeUndefined();
  });
});

describe("groupAgentsByPhase routes by explicit phase attribute, ignoring timestamps", () => {
  it("nests agents under their declared phase even when startTime is outside the phase window", () => {
    const phaseMap = new Map<string, PhaseRange>([
      ["plan", { start: t100, end: t200 }],
    ]);

    const agentPlan = makeAgentSpan({
      id: "pi:plan-agent",
      phase: "plan",
      startTime: t900, // outside the phase window
    });
    const agentSpec = makeAgentSpan({
      id: "pi:spec-agent",
      phase: "spec", // no matching phase in the map
      startTime: t900,
    });

    const result = groupAgentsByPhase([agentPlan, agentSpec], phaseMap);

    const planSpan = result.find((s) => s.id === "phase:plan");
    expect(planSpan).toBeDefined();
    expect((planSpan!.children ?? []).map((c) => c.id)).toContain("pi:plan-agent");

    // agent-spec falls into setup-bucket because its phase isn't in the map.
    const setupSpan = result.find((s) => s.id === "phase:setup");
    expect(setupSpan).toBeDefined();
    expect((setupSpan!.children ?? []).map((c) => c.id)).toContain("pi:spec-agent");

    expect(result.find((s) => s.id === "phase:spec")).toBeUndefined();
  });

  it("places agents with no phase attribute into the synthetic phase:setup bucket", () => {
    const phaseMap = new Map<string, PhaseRange>([
      ["plan", { start: t200, end: t300 }],
    ]);

    const orphan = makeAgentSpan({
      id: "pi:no-phase",
      phase: null,
      startTime: t100,
    });

    const result = groupAgentsByPhase([orphan], phaseMap);

    const setup = result.find((s) => s.id === "phase:setup");
    expect(setup).toBeDefined();
    expect((setup!.children ?? []).map((c) => c.id)).toContain("pi:no-phase");
  });
});

describe("findToolCallSpanByToolUseId resolves host by parent_tool_use_id, ignoring timestamps", () => {
  it("returns the tool span whose tool_use_id matches, not the one whose window contains a timestamp", () => {
    const toolA = makeToolCallSpan({
      id: "span:tool-A",
      toolUseId: "tu-A",
      start: t100,
      end: t200,
    });
    const toolB = makeToolCallSpan({
      id: "span:tool-B",
      toolUseId: "tu-B",
      start: t300,
      end: t400,
    });
    const parent: TraceSpan = {
      id: "pi:parent",
      title: "parent",
      startTime: t100,
      endTime: t400,
      duration: 0,
      type: "agent_invocation",
      status: "success",
      raw: "",
      children: [toolA, toolB],
    };

    const typeById = new Map<string, string>([
      [toolA.id, EventType.TOOL_CALL_START],
      [toolB.id, EventType.TOOL_CALL_START],
    ]);

    const found = findToolCallSpanByToolUseId(parent, "tu-B", typeById);
    expect(found).not.toBeNull();
    expect(found!.id).toBe("span:tool-B");
  });

  it("returns null when the tool_use_id is unknown", () => {
    const toolA = makeToolCallSpan({
      id: "span:tool-A",
      toolUseId: "tu-A",
      start: t100,
      end: t200,
    });
    const parent: TraceSpan = {
      id: "pi:parent",
      title: "parent",
      startTime: t100,
      endTime: t200,
      duration: 0,
      type: "agent_invocation",
      status: "success",
      raw: "",
      children: [toolA],
    };

    const typeById = new Map<string, string>([
      [toolA.id, EventType.TOOL_CALL_START],
    ]);

    const found = findToolCallSpanByToolUseId(parent, "tu-MISSING", typeById);
    expect(found).toBeNull();
  });

  it("walks nested tool_call_start spans recursively for explicit match", () => {
    const toolInner = makeToolCallSpan({
      id: "span:tool-inner",
      toolUseId: "tu-inner",
      start: t110,
      end: t150,
    });
    const toolOuter = makeToolCallSpan({
      id: "span:tool-outer",
      toolUseId: "tu-outer",
      start: t100,
      end: t200,
      children: [toolInner],
    });
    const parent: TraceSpan = {
      id: "pi:parent",
      title: "parent",
      startTime: t100,
      endTime: t200,
      duration: 0,
      type: "agent_invocation",
      status: "success",
      raw: "",
      children: [toolOuter],
    };

    const typeById = new Map<string, string>([
      [toolOuter.id, EventType.TOOL_CALL_START],
      [toolInner.id, EventType.TOOL_CALL_START],
    ]);

    const found = findToolCallSpanByToolUseId(parent, "tu-inner", typeById);
    expect(found).not.toBeNull();
    expect(found!.id).toBe("span:tool-inner");
  });
});
