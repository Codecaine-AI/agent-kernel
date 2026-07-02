import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import {
	ensureKernelObservabilitySchema,
	openKernelDatabase,
	type KernelDatabaseHandle,
} from "@agent-kernel/db";

import {
	AGENT_KERNEL_ROOT_NAMESPACE,
	createContainerApi,
	deriveContainerId,
	kernelNamespace,
	uuidv5,
} from "./containers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("uuidv5", () => {
	test("matches the RFC 4122 reference vector", () => {
		// uuidv5(NAMESPACE_DNS, "www.example.com") — RFC 4122 appendix B (errata).
		expect(uuidv5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com")).toBe(
			"2ed6657d-e927-568b-95e1-2665a8aea6a2",
		);
	});

	test("sets version 5 and RFC 4122 variant bits", () => {
		for (const name of ["a", "b", "kernel", "long\nmultiline\nname"]) {
			const id = uuidv5(AGENT_KERNEL_ROOT_NAMESPACE, name);
			expect(id).toMatch(UUID_RE);
			expect(id[14]).toBe("5"); // version nibble
			expect(["8", "9", "a", "b"]).toContain(id[19]); // variant 10xx
		}
	});

	test("rejects malformed namespaces", () => {
		expect(() => uuidv5("not-a-uuid", "x")).toThrow("invalid UUID");
	});
});

describe("deriveContainerId", () => {
	test("is deterministic and matches known fixtures", () => {
		expect(kernelNamespace("demo-kernel")).toBe(
			"0aa9c1a5-77a6-5325-b8cc-b47bd98acf77",
		);
		expect(deriveContainerId("demo-kernel", "session", ["req-1"])).toBe(
			"de8c3e03-5de2-5743-9df5-d4bb315c1b87",
		);
		expect(
			deriveContainerId("demo-kernel", "epoch", ["p1", "s1", "r1", "e1"]),
		).toBe("43efd84d-617e-50c2-b1e7-eccda4e4b0db");
		// Same inputs, same id — every time.
		expect(deriveContainerId("demo-kernel", "session", ["req-1"])).toBe(
			deriveContainerId("demo-kernel", "session", ["req-1"]),
		);
	});

	test("changes with kernelId, kind, and key", () => {
		const base = deriveContainerId("demo-kernel", "session", ["req-1"]);
		expect(deriveContainerId("other-kernel", "session", ["req-1"])).not.toBe(base);
		expect(deriveContainerId("demo-kernel", "worker", ["req-1"])).not.toBe(base);
		expect(deriveContainerId("demo-kernel", "session", ["req-2"])).not.toBe(base);
		expect(deriveContainerId("demo-kernel", "session", ["req-1", "x"])).not.toBe(base);
	});

	test("segment boundaries are unambiguous", () => {
		expect(deriveContainerId("k", "kind", ["a", "b"])).not.toBe(
			deriveContainerId("k", "kind", ["a\nb"]),
		);
		expect(deriveContainerId("k", "kind", ["a", "b"])).not.toBe(
			deriveContainerId("k", 'kind", "a', ["b"]),
		);
	});
});

describe("createContainerApi", () => {
	test("throws a clear error when the kernel has no db", async () => {
		const container = createContainerApi({ kernelId: "demo", db: undefined });
		await expect(
			container({ kind: "session", key: ["req-1"] }),
		).rejects.toThrow("requires a database");
	});

	test("validates kind and key", async () => {
		const container = createContainerApi({ kernelId: "demo", db: undefined });
		// Validation errors are the same with or without a db configured
		// (db check runs first), so use a real db here.
		const dir = mkdtempSync(join(tmpdir(), "kernel-container-"));
		const handle: KernelDatabaseHandle = openKernelDatabase({
			path: join(dir, "trace.db"),
		});
		await ensureKernelObservabilitySchema(handle.db);
		const withDb = createContainerApi({ kernelId: "demo", db: handle.db });
		try {
			await expect(withDb({ kind: "", key: ["a"] })).rejects.toThrow("spec.kind");
			await expect(withDb({ kind: "session", key: [] })).rejects.toThrow("spec.key");
		} finally {
			handle.close();
			rmSync(dir, { recursive: true, force: true });
		}
		void container;
	});

	test("upserts idempotently: same (kind, key) resolves to the same row", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kernel-container-"));
		const handle = openKernelDatabase({ path: join(dir, "trace.db") });
		await ensureKernelObservabilitySchema(handle.db);
		const container = createContainerApi({ kernelId: "demo-kernel", db: handle.db });
		try {
			const parent = await container({
				kind: "session",
				key: ["req-1"],
				label: "Request 1",
			});
			expect(parent.id).toBe("de8c3e03-5de2-5743-9df5-d4bb315c1b87");
			expect(parent.kind).toBe("session");
			expect(parent.appKey).toEqual(["req-1"]);

			const again = await container({
				kind: "session",
				key: ["req-1"],
				label: "Request 1 (renamed)",
			});
			expect(again.id).toBe(parent.id);
			expect(again.label).toBe("Request 1 (renamed)");

			const child = await container({
				kind: "worker",
				key: ["req-1", "w1"],
				parent,
				metadata: { slot: 1 },
			});
			expect(child.id).toBe(
				deriveContainerId("demo-kernel", "worker", ["req-1", "w1"]),
			);
			expect(child.parentContainerId).toBe(parent.id);
			expect(child.metadata).toEqual({ slot: 1 });
		} finally {
			handle.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
