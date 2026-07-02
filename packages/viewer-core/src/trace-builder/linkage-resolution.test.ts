import { describe, expect, it } from "bun:test";

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { buildTraceSpans } from "../build-trace-spans";
import { EventType, type KernelContainerSummary, type PiAgentSession, type TraceEvent } from "../types";

import {
  groupAgentsByContainer,
  type ContainerRange,
} from "./containerGrouping";
import { groupAgentsByPhase, type PhaseRange } from "./phaseGrouping";
import {
  findToolCallSpanByToolUseId,
  groupContextInputsByBuild,
  groupProvisioningSpans,
} from "./nesting";
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

function makeEventSpan(opts: {
  id: string;
  eventType: string;
  start: Date;
  end?: Date;
}): TraceSpan {
  const eventTypeAttr = makeAttr("event_type", opts.eventType);
  const attrs = [eventTypeAttr].filter((a): a is NonNullable<typeof a> => a !== null);
  const end = opts.end ?? opts.start;
  return {
    id: opts.id,
    title: opts.id,
    startTime: opts.start,
    endTime: end,
    duration: end.getTime() - opts.start.getTime(),
    type: "agent_invocation",
    status: "success",
    raw: "",
    attributes: attrs,
  };
}

function makeTraceEvent(opts: {
  id: string;
  type: TraceEvent["type"];
  timestamp: string;
  spanId?: string;
  eventData: TraceEvent["eventData"];
  traceLevel?: TraceEvent["traceLevel"];
  containerId?: string | null;
  piSessionId?: string | null;
}): TraceEvent {
  return {
    id: opts.id,
    eventId: opts.id,
    appSessionId: "app-1",
    userId: "user-1",
    type: opts.type,
    source: "kernel",
    traceLevel: opts.traceLevel ?? 1,
    eventData: opts.eventData,
    spanId: opts.spanId,
    parentEventId: null,
    timestamp: opts.timestamp,
    piSessionId: opts.piSessionId === undefined ? "pi-1" : opts.piSessionId,
    agentId: null,
    containerId: opts.containerId ?? null,
  };
}

function makeContainerSummary(opts: {
  id: string;
  parentContainerId?: string | null;
  label: string;
  phase: string;
  status?: string;
  startedAt: string;
  completedAt?: string | null;
}): KernelContainerSummary {
  return {
    id: opts.id,
    parentContainerId: opts.parentContainerId ?? null,
    label: opts.label,
    status: opts.status ?? "running",
    workingDir: "/repo",
    worktreePath: null,
    phase: opts.phase,
    phaseVocabulary: ["session", "prepare", "setup"],
    metadata: {},
    startedAt: opts.startedAt,
    completedAt: opts.completedAt ?? null,
    createdAt: opts.startedAt,
    updatedAt: opts.completedAt ?? opts.startedAt,
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

describe("buildTraceSpans container summaries", () => {
  it("nests app workflow events under persisted session and prepare containers", () => {
    const sharedContainerStart = "2026-01-01T00:00:05.000Z";
    const containers = [
      makeContainerSummary({
        id: "melee:app:session",
        label: "Project session run-1",
        phase: "session",
        startedAt: sharedContainerStart,
      }),
      makeContainerSummary({
        id: "melee:app:session:prepare",
        parentContainerId: "melee:app:session",
        label: "Prepare",
        phase: "prepare",
        startedAt: sharedContainerStart,
      }),
      makeContainerSummary({
        id: "melee:app:session:prepare:sync-intake",
        parentContainerId: "melee:app:session:prepare",
        label: "Sync and intake",
        phase: "setup",
        startedAt: sharedContainerStart,
        completedAt: "2026-01-01T00:00:05.000Z",
        status: "completed",
      }),
    ];
    const events = [
      makeTraceEvent({
        id: "event-session-started",
        type: "melee:session_started" as TraceEvent["type"],
        timestamp: "2026-01-01T00:00:00.000Z",
        piSessionId: null,
        containerId: "melee:app:session",
        eventData: { operation: "New session started", status: "started" },
      }),
      makeTraceEvent({
        id: "event-prepare-started",
        type: "melee:prepare_started" as TraceEvent["type"],
        timestamp: "2026-01-01T00:00:01.000Z",
        piSessionId: null,
        containerId: "melee:app:session:prepare",
        eventData: { operation: "prepareSession", status: "started" },
      }),
      makeTraceEvent({
        id: "event-sync-completed",
        type: "melee:setup_completed" as TraceEvent["type"],
        timestamp: "2026-01-01T00:00:05.000Z",
        piSessionId: null,
        containerId: "melee:app:session:prepare:sync-intake",
        eventData: { operation: "freshRun.syncUpstream", status: "completed" },
      }),
    ];

    const spans = buildTraceSpans(events, [], [], containers);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.id).toBe("container:melee:app:session");
    expect((spans[0]!.children ?? []).map((child) => child.id)).toEqual([
      "event-session-started",
      "container:melee:app:session:prepare",
    ]);

    const prepare = (spans[0]!.children ?? []).find((child) => child.id === "container:melee:app:session:prepare");
    expect(prepare).toBeDefined();
    expect((prepare!.children ?? []).map((child) => child.id)).toEqual([
      "event-prepare-started",
      "container:melee:app:session:prepare:sync-intake",
    ]);
    const sync = (prepare!.children ?? []).find((child) => child.id === "container:melee:app:session:prepare:sync-intake");
    expect(sync).toBeDefined();
    expect((sync!.children ?? []).map((child) => child.id)).toEqual(["event-sync-completed"]);
    expect(sync!.children![0]!.title).toBe("freshRun.syncUpstream");
  });

  it("labels generic app workflow events by operation and status", () => {
    const spans = buildTraceSpans(
      [
        makeTraceEvent({
          id: "event-sync-failed",
          type: "melee:setup_failed" as TraceEvent["type"],
          timestamp: "2026-01-01T00:00:05.000Z",
          piSessionId: null,
          eventData: {
            operation: "prepare.syncGitHub",
            status: "failed",
            detail: "unable to create worktree",
          },
        }),
      ],
      [],
      [],
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]!.title).toBe("prepare.syncGitHub");
    expect(spans[0]!.status).toBe("error");
    expect(spans[0]!.attributes?.some((attr) => attr.key === "detail")).toBe(true);
  });
});

describe("groupContextInputsByBuild", () => {
  it("nests resolved inputs under their matching context build span", () => {
    const prompt = makeEventSpan({
      id: "prompt",
      eventType: EventType.SYSTEM_PROMPT_RESOLVED,
      start: t100,
    });
    const build = makeEventSpan({
      id: "context-build",
      eventType: EventType.CONTEXT_BUILD_STARTED,
      start: t110,
      end: t150,
    });
    const inputA = makeEventSpan({
      id: "input-a",
      eventType: EventType.CONTEXT_INPUT_RESOLVED,
      start: t150,
    });
    const inputB = makeEventSpan({
      id: "input-b",
      eventType: EventType.CONTEXT_INPUT_RESOLVED,
      start: t200,
    });

    const typeById = new Map<string, string>([
      [prompt.id, EventType.SYSTEM_PROMPT_RESOLVED],
      [build.id, EventType.CONTEXT_BUILD_STARTED],
      [inputA.id, EventType.CONTEXT_INPUT_RESOLVED],
      [inputB.id, EventType.CONTEXT_INPUT_RESOLVED],
    ]);
    const protocolSpanIdById = new Map<string, string>([
      [prompt.id, "spawn-1"],
      [build.id, "spawn-1"],
      [inputA.id, "spawn-1"],
      [inputB.id, "spawn-1"],
    ]);

    const result = groupContextInputsByBuild(
      [prompt, build, inputA, inputB],
      typeById,
      protocolSpanIdById,
    );

    expect(result.map((s) => s.id)).toEqual(["prompt", "context-build"]);
    expect(result[1]!.children?.map((s) => s.id)).toEqual(["input-a", "input-b"]);
    expect(result[1]!.endTime).toEqual(t200);
  });

  it("keeps context inputs as siblings when no matching context build exists", () => {
    const input = makeEventSpan({
      id: "input",
      eventType: EventType.CONTEXT_INPUT_RESOLVED,
      start: t100,
    });
    const result = groupContextInputsByBuild(
      [input],
      new Map([[input.id, EventType.CONTEXT_INPUT_RESOLVED]]),
      new Map([[input.id, "spawn-1"]]),
    );

    expect(result.map((s) => s.id)).toEqual(["input"]);
  });
});

describe("groupProvisioningSpans", () => {
  it("wraps system prompt and context build spans in prompt-first provisioning order", () => {
    const build = makeEventSpan({
      id: "context-build",
      eventType: EventType.CONTEXT_BUILD_STARTED,
      start: t100,
      end: t200,
    });
    const prompt = makeEventSpan({
      id: "prompt",
      eventType: EventType.SYSTEM_PROMPT_RESOLVED,
      start: t110,
    });
    const runStart = makeEventSpan({
      id: "run-start",
      eventType: EventType.AGENT_RUN_START,
      start: t300,
    });

    const typeById = new Map<string, string>([
      [build.id, EventType.CONTEXT_BUILD_STARTED],
      [prompt.id, EventType.SYSTEM_PROMPT_RESOLVED],
      [runStart.id, EventType.AGENT_RUN_START],
    ]);
    const protocolSpanIdById = new Map<string, string>([
      [build.id, "spawn-1"],
      [prompt.id, "spawn-1"],
      [runStart.id, "run-1"],
    ]);

    const result = groupProvisioningSpans(
      [build, prompt, runStart],
      typeById,
      protocolSpanIdById,
    );

    expect(result.map((s) => s.id)).toEqual(["provisioning:spawn-1", "run-start"]);
    expect(result[0]!.children?.map((s) => s.id)).toEqual(["prompt", "context-build"]);
    expect(result[0]!.startTime).toEqual(t100);
    expect(result[0]!.endTime).toEqual(t200);
  });
});

describe("buildTraceSpans context provisioning", () => {
  it("renders context input resolution as children of the context build span", () => {
    const piSession: PiAgentSession = {
      id: "pi-1",
      appSessionId: "app-1",
      parentId: null,
      agentName: "Research",
      model: "test-model",
      status: "running",
      phase: null,
      containerId: null,
      displayLabel: null,
      startedAt: t100.toISOString(),
      completedAt: null,
      createdAt: t100.toISOString(),
      updatedAt: t300.toISOString(),
    };
    const events: TraceEvent[] = [
      makeTraceEvent({
        id: "prompt",
        type: EventType.SYSTEM_PROMPT_RESOLVED,
        timestamp: t100.toISOString(),
        spanId: "spawn-1",
        eventData: {
          agent_name: "Research",
          rendered_prompt: "Research prompt",
          tools_allowlist: [],
          tools_disallowlist: [],
          extensions: true,
          domain_rules_installed: false,
          variables_resolved: {},
        },
      }),
      makeTraceEvent({
        id: "context-start",
        type: EventType.CONTEXT_BUILD_STARTED,
        timestamp: t110.toISOString(),
        spanId: "spawn-1",
        eventData: {
          agent_name: "Research",
          declared_inputs: [
            { kind: "file", ref: "brief.md" },
            { kind: "directory", ref: "sources" },
          ],
        },
      }),
      makeTraceEvent({
        id: "input-brief",
        type: EventType.CONTEXT_INPUT_RESOLVED,
        timestamp: t150.toISOString(),
        spanId: "spawn-1",
        eventData: {
          loader_kind: "file",
          input_ref: "brief.md",
          status: "ok",
          bytes: 12,
          from_cache: false,
          content_hash: "hash-brief",
        },
        traceLevel: 3,
      }),
      makeTraceEvent({
        id: "input-sources",
        type: EventType.CONTEXT_INPUT_RESOLVED,
        timestamp: t200.toISOString(),
        spanId: "spawn-1",
        eventData: {
          loader_kind: "directory",
          input_ref: "sources",
          status: "ok",
          bytes: 24,
          from_cache: false,
          content_hash: "hash-sources",
        },
        traceLevel: 3,
      }),
      makeTraceEvent({
        id: "context-end",
        type: EventType.CONTEXT_BUILD_COMPLETED,
        timestamp: t300.toISOString(),
        spanId: "spawn-1",
        eventData: {
          inputs: [
            {
              loader_kind: "file",
              input_ref: "brief.md",
              status: "ok",
              bytes: 12,
            },
            {
              loader_kind: "directory",
              input_ref: "sources",
              status: "ok",
              bytes: 24,
            },
          ],
          rendered_context: "Rendered context",
          total_bytes: 36,
        },
      }),
    ];

    const [agentSpan] = buildTraceSpans(events, [piSession], []);
    const children = agentSpan?.children ?? [];
    const provisioning = children.find((span) => span.id === "provisioning:spawn-1");
    const provisioningChildren = provisioning?.children ?? [];
    const contextBuild = provisioningChildren.find((span) => span.id === "context-start");

    expect(children.map((span) => span.id)).toEqual(["provisioning:spawn-1"]);
    expect(provisioningChildren.map((span) => span.id)).toEqual(["prompt", "context-start"]);
    expect(contextBuild).toBeDefined();
    expect(contextBuild!.children?.map((span) => span.id)).toEqual([
      "input-brief",
      "input-sources",
    ]);
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
