import { describe, expect, test } from "bun:test";

import { createKernelTraceReadApi, parseKernelTraceLimit } from "./read-api";

const detail = {
	session: {
		id: "session-1",
		containerId: "container-1",
		appSessionSlug: "demo-session",
		topic: "Demo",
		status: "running",
		appSessionType: "full",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	},
	container: null,
	containers: [],
	pi_sessions: [],
	agent_runs: [],
	events: [],
};

describe("parseKernelTraceLimit", () => {
	test("clamps invalid and oversized limits", () => {
		expect(parseKernelTraceLimit(undefined, { fallback: 50, max: 100 })).toBe(50);
		expect(parseKernelTraceLimit("0", { fallback: 50, max: 100 })).toBe(1);
		expect(parseKernelTraceLimit("500", { fallback: 50, max: 100 })).toBe(100);
	});
});

describe("createKernelTraceReadApi", () => {
	test("serves trace-session detail through the injected service", async () => {
		const calls: Array<{ id: string; after?: string | null; limit?: number }> = [];
		const app = createKernelTraceReadApi({
			async getTraceSessionDetail(id, query) {
				calls.push({ id, ...query });
				return detail;
			},
		});

		const response = await app.handle(
			new Request("http://localhost/kernel/trace-sessions/session-1?after=2026&limit=12"),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.session.id).toBe("session-1");
		expect(calls).toEqual([{ id: "session-1", after: "2026", limit: 12 }]);
	});

	test("returns 404 when the service cannot resolve detail", async () => {
		const app = createKernelTraceReadApi({
			async getTraceSessionDetail() {
				return null;
			},
		});

		const response = await app.handle(
			new Request("http://localhost/kernel/trace-sessions/missing"),
		);
		const body = await response.json();

		expect(response.status).toBe(404);
		expect(body.error).toContain("missing");
	});
});
