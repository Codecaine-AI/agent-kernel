import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	buildSessionBindingMarkers,
	resolveTargetKernelRoot,
	SESSION_BINDING_CUSTOM_TYPE,
	TUI_SESSION_META_CUSTOM_TYPE,
} from "./session-binding";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AGENT_KERNEL_ROOT = resolve(import.meta.dir, "..", "..", "..");

const tmpDirs: string[] = [];
function makeTmpDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "tui-session-binding-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tmpDirs.length > 0) {
		rmSync(tmpDirs.pop()!, { recursive: true, force: true });
	}
});

describe("resolveTargetKernelRoot", () => {
	test("cwd inside a kernel project resolves that project's .agent-kernel", () => {
		const project = makeTmpDir();
		const kernelDir = join(project, ".agent-kernel");
		mkdirSync(kernelDir);
		writeFileSync(
			join(kernelDir, "kernel.json"),
			JSON.stringify({ kernelId: "test-kernel", catalogRoots: [] }),
		);
		const nested = join(project, "a", "b");
		mkdirSync(nested, { recursive: true });

		const target = resolveTargetKernelRoot(nested);
		expect(target.root).toBe(kernelDir);
		expect(target.kernelId).toBe("test-kernel");
	});

	test("kernel-less cwd falls back to agent-kernel's own .agent-kernel", () => {
		const elsewhere = makeTmpDir();
		const target = resolveTargetKernelRoot(elsewhere);
		expect(target.root).toBe(join(AGENT_KERNEL_ROOT, ".agent-kernel"));
		expect(target.kernelId).toBe("agent-kernel");
	});
});

describe("buildSessionBindingMarkers", () => {
	test("binding payload matches the transcript-recovery mapper contract", () => {
		const project = makeTmpDir();
		const kernelDir = join(project, ".agent-kernel");
		mkdirSync(kernelDir);
		writeFileSync(
			join(kernelDir, "kernel.json"),
			JSON.stringify({ kernelId: "proj" }),
		);

		const markers = buildSessionBindingMarkers({
			agentName: "context-editor",
			source: "generic",
			cwd: project,
		});

		// EventMapper reads data.containerId / data.runId at top level.
		expect(markers.binding).toEqual({
			containerId: markers.containerId,
			runId: markers.runId,
		});
		expect(markers.containerId).toMatch(UUID_RE);
		expect(markers.runId).toMatch(UUID_RE);

		expect(markers.meta).toEqual({
			containerId: markers.containerId,
			runId: markers.runId,
			agentName: "context-editor",
			source: "generic",
			cwd: project,
			kernelId: "proj",
			targetKernelRoot: kernelDir,
			origin: "tui",
		});
	});

	test("each boot mints fresh identity (re-boot = new container)", () => {
		const project = makeTmpDir();
		const a = buildSessionBindingMarkers({
			agentName: "x",
			source: "project",
			cwd: project,
		});
		const b = buildSessionBindingMarkers({
			agentName: "x",
			source: "project",
			cwd: project,
		});
		expect(a.containerId).not.toBe(b.containerId);
		expect(a.runId).not.toBe(b.runId);
	});

	test("custom types are the kernel's canonical marker names", () => {
		expect(SESSION_BINDING_CUSTOM_TYPE).toBe("agent-kernel:session-binding");
		expect(TUI_SESSION_META_CUSTOM_TYPE).toBe("agent-kernel:tui-session-meta");
	});
});
