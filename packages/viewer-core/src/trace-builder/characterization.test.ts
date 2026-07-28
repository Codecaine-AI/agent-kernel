/**
 * Characterization test — pins the FULL buildTraceSpans output for one real
 * research run (examples/simple-research-kernel, exported 2026-07-02 from
 * .agent-kernel/trace.db into __fixtures__/research-run.json).
 *
 * The fixture exercises: phase_start + container_start seed events with no
 * piSessionId/runId (app-level orphans), spawned sub-agents linked by
 * parentSessionId + parentToolUseId, provisioning (system prompt + context
 * build + resolved inputs), tool call pairing by spanId, single-run pi
 * sessions (run wrapper skipped), pi turn lifecycle points, and unknown
 * pi_agent_* event types hitting the generic fallback.
 *
 * Any snapshot diff means the builder's public output changed — refactors
 * must keep these snapshots byte-identical.
 */
import { describe, expect, it } from "bun:test";

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { buildTraceSpans } from "../build-trace-spans";
import type {
  AgentRun,
  KernelContainerSummary,
  PiAgentSession,
  TraceEvent,
} from "../types";

import fixture from "./__fixtures__/research-run.json";
import stateDemoFixture from "./__fixtures__/state-demo-run.json";

const events = fixture.events as TraceEvent[];
const piSessions = fixture.pi_sessions as PiAgentSession[];
const agentRuns = fixture.agent_runs as AgentRun[];
const containers = fixture.containers as KernelContainerSummary[];

/** JSON-safe deep copy of a span tree with Dates rendered as ISO strings. */
function normalize(spans: TraceSpan[]): unknown[] {
  return spans.map((span) => ({
    id: span.id,
    title: span.title,
    type: span.type,
    status: span.status,
    startTime: span.startTime.toISOString(),
    endTime: span.endTime.toISOString(),
    duration: span.duration,
    input: span.input,
    output: span.output,
    attributes: span.attributes,
    raw: span.raw,
    children: span.children ? normalize(span.children) : undefined,
  }));
}

describe("buildTraceSpans characterization (research-run fixture)", () => {
  it("matches the pinned output tree for the live-UI call shape (no containers arg)", () => {
    const spans = buildTraceSpans(events, piSessions, agentRuns);
    expect(normalize(spans)).toMatchSnapshot();
  });

  it("matches the pinned output tree when container summaries are provided", () => {
    const spans = buildTraceSpans(events, piSessions, agentRuns, containers);
    expect(normalize(spans)).toMatchSnapshot();
  });
});

/**
 * Second characterization — the 8-run state-demo session (exported
 * 2026-07-27 from examples/simple-research-kernel/.agent-kernel/trace.db).
 * Unlike research-run.json this trace carries pi_request_snapshot events,
 * so it pins the turn-ownership nesting: every tool call and assistant
 * reply sits under the Turn span that issued it, inside Run #n wrappers
 * (multi-run session). research-run.json above stays byte-identical,
 * proving the no-snapshot flat fallback.
 */
describe("buildTraceSpans characterization (state-demo fixture, turn nesting)", () => {
  it("matches the pinned turn-nested output tree", () => {
    const spans = buildTraceSpans(
      stateDemoFixture.events as TraceEvent[],
      stateDemoFixture.pi_sessions as PiAgentSession[],
      stateDemoFixture.agent_runs as AgentRun[],
    );
    expect(normalize(spans)).toMatchSnapshot();
  });
});
