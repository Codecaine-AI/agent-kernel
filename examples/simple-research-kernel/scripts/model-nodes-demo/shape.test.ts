/**
 * Shape parity (plan M6-D): the real kernel's emission for the model-nodes
 * story must have the structure of the committed synthetic fixture, so the
 * design-system screenshots (taken from the fixture) cannot drift from what a
 * real trace looks like.
 *
 * `run-real.ts` drives createKernel, spawnAgent, call, decide, step and gate
 * through the fixture's story in its offline mode (fake call engine, Pi's real
 * typesafe provider over a scripted wire, a faux Pi chat model; no network, no
 * file outside a temp dir). The trace is read back through the container read
 * service, exactly as the viewer API serves it, and compared with
 * `packages/viewer-core/src/trace-builder/__fixtures__/model-nodes-demo.json`
 * by structure only: ids, times, names and other values are dropped.
 *
 * Runs as an extra `tests.safe` command of the design-system `viewer-ui`
 * entry (not in `bun run verify`), from the agent-kernel root:
 *   bun --no-env-file test ./examples/simple-research-kernel/scripts/model-nodes-demo/shape.test.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openKernelDatabaseReadOnly } from "@agent-kernel/db";
import { createContainerReadService } from "@agent-kernel/kernel";
import { disableNetwork } from "@agent-kernel/kernel/model-nodes/testing";
import {
	buildTraceSpans,
	type AgentRun,
	type KernelContainerSummary,
	type PiAgentSession,
	type TraceEvent,
} from "@agent-kernel/viewer-core";

import fixtureJson from "../../../../packages/viewer-core/src/trace-builder/__fixtures__/model-nodes-demo.json";
import { KERNEL_ID, runRealDemo, type RunRealResult } from "./run-real";

interface TraceRows {
	containers: KernelContainerSummary[];
	pi_sessions: PiAgentSession[];
	agent_runs: AgentRun[];
	events: TraceEvent[];
}

const fixture: TraceRows = {
	containers: fixtureJson.containers as KernelContainerSummary[],
	pi_sessions: fixtureJson.pi_sessions as PiAgentSession[],
	agent_runs: fixtureJson.agent_runs as AgentRun[],
	events: fixtureJson.events as TraceEvent[],
};

let dir: string;
let restoreFetch: () => void;
let result: RunRealResult;
let real: TraceRows;

beforeAll(async () => {
	restoreFetch = disableNetwork();
	dir = mkdtempSync(join(tmpdir(), "mn-shape-"));
	const dbPath = join(dir, "trace.db");
	result = await runRealDemo({ dbPath });
	const handle = openKernelDatabaseReadOnly(dbPath);
	try {
		const detail = await createContainerReadService({ db: handle.db, kernelId: KERNEL_ID }).getContainerTrace(
			result.containerId,
		);
		if (!detail) throw new Error(`container ${result.containerId} was not written`);
		real = JSON.parse(JSON.stringify(detail)) as TraceRows;
	} finally {
		handle.close();
	}
}, 60_000);

afterAll(() => {
	restoreFetch?.();
	if (dir) rmSync(dir, { recursive: true, force: true });
});

// ── event-level structure ──────────────────────────────────────────────────────

function countByType(events: TraceEvent[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;
	return counts;
}

/**
 * Per event type, every distinct envelope shape (source, trace level, which
 * ids are set) with its payload's top-level key set. Values are dropped.
 */
function eventShapes(events: TraceEvent[]): Record<string, string[]> {
	const shapes: Record<string, Set<string>> = {};
	for (const event of events) {
		const envelope = [
			event.source,
			event.traceLevel,
			event.runId ? "run" : "-",
			event.piSessionId ? "pi-session" : "-",
			event.spanId ? "span" : "-",
			event.parentEventId ? "parent" : "-",
		].join(" ");
		const keys = Object.keys((event.eventData ?? {}) as Record<string, unknown>)
			.sort()
			.join(",");
		(shapes[event.type] ??= new Set()).add(`${envelope} | ${keys}`);
	}
	return Object.fromEntries(Object.entries(shapes).map(([type, set]) => [type, [...set].sort()]));
}

/** Session kind, run trigger and run status of every run (the node kinds and their outcomes). */
function runKinds(rows: TraceRows): string[] {
	const kindOf = new Map(rows.pi_sessions.map((session) => [session.id, session.kind ?? "pi"]));
	return rows.agent_runs
		.map((run) => `${kindOf.get(run.piSessionId) ?? "?"} ${run.trigger} ${run.status}`)
		.sort();
}

// ── span skeleton ──────────────────────────────────────────────────────────────

type Span = ReturnType<typeof buildTraceSpans>[number];
interface Skeleton {
	kind: string;
	children: Skeleton[];
}

const NODE_ROWS = new Set(["call_container", "decision_container", "call_attempt", "decision_attempt"]);
/**
 * Spans whose placement the model-nodes build defines. Everything else in a
 * worker session (user and assistant messages, turns, lifecycle, provisioning)
 * is grouped by millisecond timestamps that real Pi emission does not order
 * deterministically (the first turn's request snapshot and the user message
 * share a millisecond), so it is checked at the event level only: its spans
 * are dropped and their children hoisted. Inside a node row every span counts.
 */
const STRUCTURAL = new Set(["container_container", "run_container", ...NODE_ROWS, "gate_start", "step_start", "tool_call_start"]);

function kindOf(span: Span): string {
	return span.attributes?.find((attr) => attr.key === "event_type")?.value.stringValue ?? span.type;
}

function canonical(list: Skeleton[]): Skeleton[] {
	return list
		.map((node) => ({ node, key: JSON.stringify(node) }))
		.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
		.map(({ node }) => node);
}

/** Kind/nesting tree; ids, titles, times and sibling order dropped. */
function skeleton(spans: readonly Span[], insideNode = false): Skeleton[] {
	const out: Skeleton[] = [];
	for (const span of spans) {
		const kind = kindOf(span);
		const children = skeleton(span.children ?? [], insideNode || NODE_ROWS.has(kind));
		if (insideNode || STRUCTURAL.has(kind)) out.push({ kind, children });
		else out.push(...children);
	}
	return canonical(out);
}

function spanSkeleton(rows: TraceRows): Skeleton[] {
	return skeleton(buildTraceSpans(rows.events, rows.pi_sessions, rows.agent_runs, rows.containers));
}

/** Indented text, so a mismatch shows as a readable diff. */
function render(list: Skeleton[], depth = 0): string[] {
	return list.flatMap((node) => [`${"  ".repeat(depth)}${node.kind}`, ...render(node.children, depth + 1)]);
}

describe("model-nodes real emission matches the demo fixture's shape", () => {
	test("the real run is doctor-clean", () => {
		expect(result.doctor.violations).toEqual([]);
		expect(result.doctor.ok).toBe(true);
	});

	test("same event types, with the same counts", () => {
		expect(countByType(real.events)).toEqual(countByType(fixture.events));
	});

	test("same envelopes and payload key sets per event type", () => {
		expect(eventShapes(real.events)).toEqual(eventShapes(fixture.events));
	});

	test("same node kinds, triggers and run outcomes", () => {
		expect(runKinds(real)).toEqual(runKinds(fixture));
	});

	test("same span nesting: node rows, attempts, gate, steps and nested tools", () => {
		const realTree = spanSkeleton(real);
		expect(render(realTree)).toEqual(render(spanSkeleton(fixture)));
		// The skeleton is not vacuous: every model-node kind is in it.
		const kinds = new Set(render(realTree).map((line) => line.trim()));
		for (const kind of [...NODE_ROWS, "gate_start", "step_start", "tool_call_start", "run_container"]) {
			expect(kinds.has(kind)).toBe(true);
		}
	});
});
