import { describe, expect, test } from "bun:test";
import type { TraceSpan } from "@evilmartians/agent-prism-types";
import type { AgentRun } from "@agent-kernel/viewer-core";

import { UsageAggregateRenderer } from "./UsageAggregateRenderer";
import { WarningRenderer } from "./WarningRenderer";

function span(id: string, eventType: string): TraceSpan {
	return {
		id,
		title: eventType,
		startTime: new Date(0),
		endTime: new Date(1),
		duration: 1,
		type: "event",
		raw: "{}",
		status: "success",
		attributes: [
			{ key: "event_type", value: { stringValue: eventType } },
		],
	};
}

function run(id: string): AgentRun {
	return {
		id,
		piSessionId: `pi-${id}`,
		containerId: "c-1",
		agentName: "layout-editor",
		trigger: "user",
		status: "done",
		startedAt: "2026-07-27T12:00:00.000Z",
		endedAt: "2026-07-27T12:00:01.000Z",
		usageInputTokens: 10,
		usageOutputTokens: 5,
		usageCacheRead: 0,
		usageCacheWrite: 0,
		usageCostEstimate: 0,
	};
}

describe("aggregate detail bodies", () => {
	test("usage keeps its scope in the caption without a count", () => {
		const view = UsageAggregateRenderer({
			span: span("container:c-1", "container_container"),
			usageContext: { runs: [run("a"), run("b"), run("c"), run("d")] },
		});

		const blocks = view.blocks ?? [];
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			id: "usage",
			slot: "content",
			caption: "Container usage",
		});
		expect("meta" in (blocks[0] ?? {})).toBe(false);
	});

	test("warning keeps its type in the caption without a failed-check count", () => {
		const warning = span("warning", "warning");
		warning.status = "warning";
		warning.attributes = [
			{ key: "event_type", value: { stringValue: "warning" } },
			{ key: "warning_type", value: { stringValue: "verification_warning" } },
			{
				key: "message",
				value: {
					stringValue:
						"Verification needs attention\nChecks: layout=fail, links=fail, contrast=pass",
				},
			},
		];

		const view = WarningRenderer({ span: warning });
		expect(view.blocks?.[0]).toMatchObject({
			slot: "content",
			caption: "Verification warning",
		});
		expect("meta" in (view.blocks?.[0] ?? {})).toBe(false);
	});
});
