/**
 * turnGrouping.test.ts — causal turn ownership (groupSpansByTurn via
 * buildTraceSpans): tool calls / asks / assistant replies nest under the
 * pi_request_snapshot ("Turn N") span that issued them.
 *
 * Covers the guard rails:
 *   - traces with NO snapshot spans keep today's flat shape
 *   - spans emitted before the first Turn stay siblings
 *   - run boundaries close the open turn (multi-run session), and a span
 *     stamped with a different runId is never folded into a stale turn
 *   - pi_turn_start/end debug events stay siblings (not adopted)
 *   - Turn containers extend end time over adopted children
 */
import { describe, expect, it } from "bun:test";

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { buildTraceSpans } from "../build-trace-spans";
import { EventType, type PiAgentSession, type TraceEvent } from "../types";

const PI_ID = "pi-1";
const CONTAINER_ID = "c-1";

const piSession: PiAgentSession = {
  id: PI_ID,
  containerId: CONTAINER_ID,
  agentName: "layout-editor",
  status: "ended",
  createdAt: "2026-07-27T00:00:00.000Z",
  endedAt: "2026-07-27T00:01:00.000Z",
};

let eventSeq = 0;

function event(
  type: EventType | string,
  timestamp: string,
  eventData: Record<string, unknown> | null,
  overrides: Partial<TraceEvent> = {},
): TraceEvent {
  eventSeq += 1;
  return {
    eventId: `evt-${String(eventSeq).padStart(3, "0")}`,
    containerId: CONTAINER_ID,
    runId: "run-1",
    piSessionId: PI_ID,
    type: type as TraceEvent["type"],
    source: "kernel" as TraceEvent["source"],
    traceLevel: 2,
    eventData,
    timestamp,
    ...overrides,
  };
}

function userMessage(ts: string, content: string, overrides: Partial<TraceEvent> = {}) {
  return event(EventType.USER_MESSAGE, ts, { content }, { traceLevel: 0, ...overrides });
}

function snapshot(ts: string, turn: number, overrides: Partial<TraceEvent> = {}) {
  return event(
    EventType.PI_REQUEST_SNAPSHOT,
    ts,
    { turn_number: turn, message_count: 1 },
    overrides,
  );
}

function toolPair(
  startTs: string,
  endTs: string,
  toolName: string,
  overrides: Partial<TraceEvent> = {},
): TraceEvent[] {
  eventSeq += 1;
  const spanId = `span-tool-${eventSeq}`;
  const toolUseId = `use-${eventSeq}`;
  return [
    event(
      EventType.TOOL_CALL_START,
      startTs,
      { tool_use_id: toolUseId, tool_name: toolName },
      { traceLevel: 1, spanId, ...overrides },
    ),
    event(
      EventType.TOOL_CALL_END,
      endTs,
      { tool_use_id: toolUseId, tool_name: toolName },
      { traceLevel: 1, spanId, ...overrides },
    ),
  ];
}

function assistant(ts: string, content: string, overrides: Partial<TraceEvent> = {}) {
  return event(
    EventType.ASSISTANT_MESSAGE,
    ts,
    { content, block_type: "text" },
    { traceLevel: 0, ...overrides },
  );
}

function turnDebug(type: EventType, ts: string, turn: number) {
  return event(type, ts, { turn_number: turn }, { traceLevel: 3 });
}

/** [title, [child titles…]] shape of a span list, for compact assertions. */
function shape(spans: TraceSpan[]): unknown[] {
  return spans.map((s) => [s.title, shape(s.children ?? [])]);
}

function agentChildren(roots: TraceSpan[]): TraceSpan[] {
  expect(roots).toHaveLength(1);
  return roots[0].children ?? [];
}

describe("groupSpansByTurn (via buildTraceSpans)", () => {
  it("nests each turn's tools and assistant reply under its Turn span; debug turn events stay siblings", () => {
    const events: TraceEvent[] = [
      userMessage("2026-07-27T00:00:00.000Z", "tidy the board"),
      turnDebug(EventType.PI_TURN_START, "2026-07-27T00:00:00.100Z", 0),
      snapshot("2026-07-27T00:00:00.200Z", 0),
      ...toolPair("2026-07-27T00:00:01.000Z", "2026-07-27T00:00:01.500Z", "update_sticky"),
      ...toolPair("2026-07-27T00:00:01.600Z", "2026-07-27T00:00:02.000Z", "add_object"),
      turnDebug(EventType.PI_TURN_END, "2026-07-27T00:00:02.100Z", 0),
      turnDebug(EventType.PI_TURN_START, "2026-07-27T00:00:02.200Z", 1),
      snapshot("2026-07-27T00:00:02.300Z", 1),
      ...toolPair("2026-07-27T00:00:03.000Z", "2026-07-27T00:00:03.400Z", "add_connection"),
      assistant("2026-07-27T00:00:04.000Z", "done"),
      turnDebug(EventType.PI_TURN_END, "2026-07-27T00:00:04.100Z", 1),
    ];

    const children = agentChildren(buildTraceSpans(events, [piSession]));

    expect(shape(children)).toEqual([
      [
        "user_message",
        [
          ["turn 0 start", []],
          ["Turn 0", [["update_sticky", []], ["add_object", []]]],
          ["pi_turn_end", []],
          ["turn 1 start", []],
          ["Turn 1", [["add_connection", []], ["text", []]]],
          ["pi_turn_end", []],
        ],
      ],
    ]);
  });

  it("extends the Turn container's end time over adopted children", () => {
    const events: TraceEvent[] = [
      userMessage("2026-07-27T00:00:00.000Z", "go"),
      snapshot("2026-07-27T00:00:00.100Z", 0),
      ...toolPair("2026-07-27T00:00:01.000Z", "2026-07-27T00:00:05.000Z", "look"),
    ];

    const [userSpan] = agentChildren(buildTraceSpans(events, [piSession]));
    const turnSpan = (userSpan.children ?? [])[0];

    expect(turnSpan.title).toBe("Turn 0");
    expect(turnSpan.endTime.toISOString()).toBe("2026-07-27T00:00:05.000Z");
    expect(turnSpan.duration).toBe(
      turnSpan.endTime.getTime() - turnSpan.startTime.getTime(),
    );
  });

  it("keeps today's flat shape for traces without snapshot spans", () => {
    const events: TraceEvent[] = [
      userMessage("2026-07-27T00:00:00.000Z", "old trace"),
      ...toolPair("2026-07-27T00:00:01.000Z", "2026-07-27T00:00:01.500Z", "search"),
      assistant("2026-07-27T00:00:02.000Z", "found it"),
    ];

    const children = agentChildren(buildTraceSpans(events, [piSession]));

    expect(shape(children)).toEqual([
      ["user_message", [["search", []], ["text", []]]],
    ]);
  });

  it("leaves tools emitted before the first Turn span as siblings", () => {
    const events: TraceEvent[] = [
      userMessage("2026-07-27T00:00:00.000Z", "warmup"),
      ...toolPair("2026-07-27T00:00:00.500Z", "2026-07-27T00:00:00.800Z", "pre_turn_tool"),
      snapshot("2026-07-27T00:00:01.000Z", 0),
      ...toolPair("2026-07-27T00:00:02.000Z", "2026-07-27T00:00:02.500Z", "owned_tool"),
    ];

    const children = agentChildren(buildTraceSpans(events, [piSession]));

    expect(shape(children)).toEqual([
      [
        "user_message",
        [
          ["pre_turn_tool", []],
          ["Turn 0", [["owned_tool", []]]],
        ],
      ],
    ]);
  });

  it("does not let a turn claim spans across run boundaries", () => {
    // Two runs in one pi session: run wrappers kick in, and run-2 spans must
    // not fold under run-1's open turn even though they follow it in time.
    const runs = [
      {
        id: "run-1",
        piSessionId: PI_ID,
        containerId: CONTAINER_ID,
        agentName: "layout-editor",
        trigger: "operator",
        status: "ok",
        startedAt: "2026-07-27T00:00:00.000Z",
        endedAt: "2026-07-27T00:00:05.000Z",
      },
      {
        id: "run-2",
        piSessionId: PI_ID,
        containerId: CONTAINER_ID,
        agentName: "layout-editor",
        trigger: "operator",
        status: "ok",
        startedAt: "2026-07-27T00:00:05.000Z",
        endedAt: "2026-07-27T00:00:10.000Z",
      },
    ];
    const events: TraceEvent[] = [
      userMessage("2026-07-27T00:00:00.000Z", "first ask", { runId: "run-1" }),
      snapshot("2026-07-27T00:00:00.100Z", 0, { runId: "run-1" }),
      ...toolPair("2026-07-27T00:00:01.000Z", "2026-07-27T00:00:01.500Z", "first_tool", {
        runId: "run-1",
      }),
      // Run 2: its user_message closes run 1's turn; the tool folds under
      // run 2's own turn only.
      userMessage("2026-07-27T00:00:05.000Z", "second ask", { runId: "run-2" }),
      snapshot("2026-07-27T00:00:05.100Z", 1, { runId: "run-2" }),
      ...toolPair("2026-07-27T00:00:06.000Z", "2026-07-27T00:00:06.500Z", "second_tool", {
        runId: "run-2",
      }),
    ];

    const children = agentChildren(buildTraceSpans(events, [piSession], runs));

    expect(shape(children)).toEqual([
      ["Run #1", [["user_message", [["Turn 0", [["first_tool", []]]]]]]],
      ["Run #2", [["user_message", [["Turn 1", [["second_tool", []]]]]]]],
    ]);
  });

  it("nests app-namespace events under the turn that produced them", () => {
    const events: TraceEvent[] = [
      userMessage("2026-07-27T00:00:00.000Z", "tidy the board"),
      snapshot("2026-07-27T00:00:00.100Z", 0),
      ...toolPair("2026-07-27T00:00:01.000Z", "2026-07-27T00:00:01.500Z", "update_sticky"),
      turnDebug(EventType.PI_TURN_END, "2026-07-27T00:00:01.600Z", 0),
      event(
        "app:board-render",
        "2026-07-27T00:00:01.700Z",
        { blob_hash: "b1-render0", n: 1, summary: "moved a sticky", turn_number: 0 },
        { traceLevel: 1, source: "app" },
      ),
      snapshot("2026-07-27T00:00:02.000Z", 1),
      ...toolPair("2026-07-27T00:00:03.000Z", "2026-07-27T00:00:03.400Z", "add_object"),
      event(
        "app:board-render",
        "2026-07-27T00:00:03.500Z",
        { blob_hash: "b1-render1", n: 2, summary: "added a box", turn_number: 1 },
        { traceLevel: 1, source: "app" },
      ),
    ];

    const children = agentChildren(buildTraceSpans(events, [piSession]));

    expect(shape(children)).toEqual([
      [
        "user_message",
        [
          [
            "Turn 0",
            [["update_sticky", []], ["board render #1", []]],
          ],
          ["pi_turn_end", []],
          [
            "Turn 1",
            [["add_object", []], ["board render #2", []]],
          ],
        ],
      ],
    ]);
  });

  it("keeps an end-of-turn app event inside its own turn in a same-millisecond tie", () => {
    // Instant runs collapse a whole turn into one timestamp. The app event's
    // causal rank places it after its own turn's tail — not at the unknown-type
    // default rank, which would leapfrog it ahead of the request snapshot that
    // produced it and strand it as a sibling.
    const TS = "2026-07-27T00:00:00.000Z";
    const events: TraceEvent[] = [
      userMessage(TS, "go"),
      snapshot(TS, 0),
      ...toolPair(TS, TS, "look"),
      turnDebug(EventType.PI_TURN_END, TS, 0),
      event(
        "app:board-render",
        TS,
        { blob_hash: "b1-fast", n: 1, summary: "instant", turn_number: 0 },
        { traceLevel: 1, source: "app" },
      ),
    ];

    const children = agentChildren(buildTraceSpans(events, [piSession]));

    expect(shape(children)).toEqual([
      [
        "user_message",
        [
          ["Turn 0", [["look", []], ["board render #1", []]]],
          ["pi_turn_end", []],
        ],
      ],
    ]);
  });

  it("never folds an app event stamped with a different runId into the open turn", () => {
    const events: TraceEvent[] = [
      userMessage("2026-07-27T00:00:00.000Z", "ask", { runId: "run-1" }),
      snapshot("2026-07-27T00:00:00.100Z", 0, { runId: "run-1" }),
      event(
        "app:board-render",
        "2026-07-27T00:00:01.000Z",
        { blob_hash: "b1-stray", n: 1, summary: "stray", turn_number: 0 },
        { traceLevel: 1, source: "app", runId: "run-2" },
      ),
    ];

    const children = agentChildren(buildTraceSpans(events, [piSession]));

    expect(shape(children)).toEqual([
      [
        "user_message",
        [
          ["Turn 0", []],
          ["board render #1", []],
        ],
      ],
    ]);
  });

  it("never folds a span whose runId differs from the open turn's runId", () => {
    // Interleaved emission with no boundary event in between: the runId
    // stamp alone must keep run-2's tool out of run-1's turn.
    const events: TraceEvent[] = [
      userMessage("2026-07-27T00:00:00.000Z", "ask", { runId: "run-1" }),
      snapshot("2026-07-27T00:00:00.100Z", 0, { runId: "run-1" }),
      ...toolPair("2026-07-27T00:00:01.000Z", "2026-07-27T00:00:01.500Z", "stray_tool", {
        runId: "run-2",
      }),
    ];

    const children = agentChildren(buildTraceSpans(events, [piSession]));

    expect(shape(children)).toEqual([
      [
        "user_message",
        [
          ["Turn 0", []],
          ["stray_tool", []],
        ],
      ],
    ]);
  });
});
