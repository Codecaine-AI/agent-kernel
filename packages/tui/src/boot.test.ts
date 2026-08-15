import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { bootAgent } from "./boot";
import { resolveAgent } from "./catalog";

const fixturesCatalog = fileURLToPath(
	new URL("../test-fixtures/catalog", import.meta.url),
);
const exampleDir = fileURLToPath(
	new URL("../../../examples/simple-research-kernel", import.meta.url),
);

const tempDirs: string[] = [];
afterAll(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function cleanCwd(): string {
	const dir = mkdtempSync(join(tmpdir(), "tui-boot-"));
	tempDirs.push(dir);
	return dir;
}

describe("bootAgent assembly", () => {
	test("state sidecar: default boot seeds ③ via module.seed", async () => {
		const cwd = cleanCwd();
		const resolved = await resolveAgent("state-echo", cwd, {
			genericRoot: fixturesCatalog,
		});
		expect(resolved).not.toBeNull();
		const booted = await bootAgent(resolved!.def, resolved!.source, { cwd });

		// ① the prompt render
		expect(booted.sections.prompt).toContain("state-echo agent");
		// ③ the seeded state render
		expect(booted.sections.state).toContain("<state>");
		expect(booted.sections.state).toContain("seeded:state-echo");
		// assembled prompt carries both, in order
		expect(booted.systemPrompt.indexOf("state-echo agent")).toBeLessThan(
			booted.systemPrompt.indexOf("seeded:state-echo"),
		);
		expect(booted.warnings).toHaveLength(0);
	});

	test("state sidecar: --fixture routes the fixture state through render", async () => {
		const cwd = cleanCwd();
		const resolved = await resolveAgent("state-echo", cwd, {
			genericRoot: fixturesCatalog,
		});
		const booted = await bootAgent(resolved!.def, resolved!.source, {
			cwd,
			fixtureId: "mid-run",
		});
		expect(booted.fixtureId).toBe("mid-run");
		expect(booted.sections.state).toContain("alpha");
		expect(booted.sections.state).toContain("beta");
		expect(booted.sections.state).not.toContain("seeded:");
	});

	test("unknown fixture id degrades to seed with a warning", async () => {
		const cwd = cleanCwd();
		const resolved = await resolveAgent("state-echo", cwd, {
			genericRoot: fixturesCatalog,
		});
		const booted = await bootAgent(resolved!.def, resolved!.source, {
			cwd,
			fixtureId: "nope",
		});
		expect(booted.fixtureId).toBeNull();
		expect(booted.sections.state).toContain("seeded:state-echo");
		expect(booted.warnings.join("\n")).toContain('fixture "nope" not found');
	});

	test("research-coordinator: ① substituted + ② assembled from its own kernel.json", async () => {
		// cwd inside the example resolves through its .agent-kernel/kernel.json.
		const resolved = await resolveAgent("research-coordinator", exampleDir);
		expect(resolved).not.toBeNull();
		expect(resolved?.source).toBe("project");

		const booted = await bootAgent(resolved!.def, resolved!.source, {
			cwd: exampleDir,
		});
		// ① rendered with declared variable defaults — no leftover declared
		// placeholders survive substitution.
		expect(booted.sections.prompt.length).toBeGreaterThan(0);
		expect(booted.sections.prompt).not.toContain("{{researchMemoryDir}}");
		// ② the bundle's own assemble() tags inside the harness <context> wrap
		expect(booted.sections.context).toContain("<context>");
		expect(booted.sections.context).toContain("<research_coordinator_context>");
		// no state sidecar, no fixture requested → ③ absent
		expect(booted.sections.state).toBeNull();
		expect(booted.systemPrompt).toContain("<research_coordinator_context>");
	});
});
