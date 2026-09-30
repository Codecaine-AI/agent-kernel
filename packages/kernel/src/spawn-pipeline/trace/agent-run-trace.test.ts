import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import type { RunTraceEventIds } from "@agent-kernel/protocol";

import type { TraceWriterSink } from "../../subagents/types";
import { safeEmitAgentRunEnd, safeEmitAgentRunStart } from "./agent-run-trace";

const ids: RunTraceEventIds = {
	containerId: "container-1",
	runId: "run-1",
	piSessionUuid: "session-1",
};

function throwingSink(): TraceWriterSink {
	return {
		submit(): void {
			throw new Error("sink fenced");
		},
	};
}

function recordingLogger() {
	const warnings: Array<{ message: string; data?: Record<string, unknown> }> = [];
	return {
		warnings,
		logger: {
			warn(message: string, data?: Record<string, unknown>): void {
				warnings.push({ message, data });
			},
		},
	};
}

describe("guarded agent-run trace emission", () => {
	test("a throwing start sink is logged and suppressed", () => {
		const { logger, warnings } = recordingLogger();

		expect(() => safeEmitAgentRunStart(throwingSink(), ids, "researcher", logger)).not.toThrow();
		expect(warnings).toEqual([
			{
				message: "emitAgentRunStart failed",
				data: { agent: "researcher", error: "sink fenced" },
			},
		]);
	});

	for (const status of ["ok", "error"] as const) {
		test(`a throwing ${status} end sink does not block terminal bookkeeping`, () => {
			const { logger, warnings } = recordingLogger();
			let terminalStatusWritten = false;

			safeEmitAgentRunEnd(throwingSink(), ids, "researcher", status, logger, "original error");
			terminalStatusWritten = true;

			expect(terminalStatusWritten).toBe(true);
			expect(warnings).toEqual([
				{
					message: "emitAgentRunEnd failed",
					data: { agent: "researcher", error: "sink fenced" },
				},
			]);
		});
	}
});

describe("spawnAgent terminal bookkeeping", () => {
	const source = readFileSync(join(import.meta.dir, "../spawn-agent.ts"), "utf8");

	test("success path guards trace end before marking the run and session done", () => {
		const successPath = source.slice(source.indexOf("const result = sub.readResult()"), source.indexOf("} catch (err)"));

		expect(successPath).toContain("safeEmitAgentRunEnd(traceWriter, ids, name, \"ok\"");
		expect(successPath.indexOf("safeEmitAgentRunEnd")).toBeLessThan(successPath.indexOf("updateAgentRunStatus"));
		expect(successPath).toContain(': "done";');
		expect(successPath).toContain("updateAgentRunStatus(db, runId, status");
		expect(successPath).toContain('updatePiAgentSessionStatus(db, session.sessionId, "ended"');
	});

	test("error path guards trace end, writes terminal statuses, and rethrows the original error", () => {
		const errorPath = source.slice(source.indexOf("} catch (err)"), source.indexOf("} finally {"));

		expect(errorPath).toContain("safeEmitAgentRunEnd(");
		expect(errorPath.indexOf("safeEmitAgentRunEnd")).toBeLessThan(errorPath.indexOf("updateAgentRunStatus"));
		expect(errorPath).toContain('updatePiAgentSessionStatus(db, session.sessionId, "error"');
		expect(errorPath).toContain("throw err;");
	});
});
