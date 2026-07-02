import { describe, expect, test } from "bun:test";

import { createKernelTraceReadApi, parseKernelTraceLimit } from "./read-api";

const detail = {
	container: {
		id: "container-1",
		kind: "session",
		appKey: ["req-1"],
		label: "Demo",
		status: "active",
	},
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
	test("serves container trace through the injected service", async () => {
		const calls: Array<{ id: string; after?: string | null; limit?: number }> = [];
		const app = createKernelTraceReadApi({
			async getContainerTrace(containerId, query) {
				calls.push({ id: containerId, ...query });
				return detail;
			},
		});

		const response = await app.handle(
			new Request(
				"http://localhost/kernel/containers/container-1/trace?after=2026&limit=12",
			),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.container.id).toBe("container-1");
		expect(calls).toEqual([{ id: "container-1", after: "2026", limit: 12 }]);
	});

	test("trace-sessions detail is container-backed", async () => {
		const calls: string[] = [];
		const app = createKernelTraceReadApi({
			async getContainerTrace(containerId) {
				calls.push(containerId);
				return detail;
			},
		});

		const response = await app.handle(
			new Request("http://localhost/kernel/trace-sessions/container-1"),
		);

		expect(response.status).toBe(200);
		expect(calls).toEqual(["container-1"]);
	});

	test("returns 404 when the service cannot resolve a container", async () => {
		const app = createKernelTraceReadApi({
			async getContainerTrace() {
				return null;
			},
		});

		const response = await app.handle(
			new Request("http://localhost/kernel/containers/missing/trace"),
		);
		const body = await response.json();

		expect(response.status).toBe(404);
		expect(body.error).toContain("missing");
	});

	test("lists session containers when the service provides list support", async () => {
		const app = createKernelTraceReadApi({
			async getContainerTrace() {
				return detail;
			},
			async listSessionContainers(query) {
				return { sessions: [{ id: "container-1", kind: "session" }], query };
			},
		});

		const response = await app.handle(
			new Request("http://localhost/kernel/trace-sessions?limit=3"),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.sessions[0].id).toBe("container-1");
		expect(body.query.limit).toBe(3);
	});

	test("returns 404 for the list route when list support is absent", async () => {
		const app = createKernelTraceReadApi({
			async getContainerTrace() {
				return detail;
			},
		});

		const response = await app.handle(
			new Request("http://localhost/kernel/trace-sessions"),
		);

		expect(response.status).toBe(404);
	});
});
