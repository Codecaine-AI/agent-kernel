import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { registerDocsTools } from "../../../catalog/docs-writer/tools/runtime";

interface RegisteredTool {
	name: string;
	execute: (id: string, params: Record<string, unknown>) => Promise<{
		content: Array<{ type: string; text: string }>;
		details: Record<string, unknown>;
	}>;
}

const tools = new Map<string, RegisteredTool>();
const piMock = {
	registerTool: (def: RegisteredTool) => tools.set(def.name, def),
} as any;

const root = join(tmpdir(), `docs-writer-tools-${process.pid}`);
const docsRoot = join(root, "docs");

const run = async (name: string, params: Record<string, unknown>) => {
	const tool = tools.get(name);
	if (!tool) throw new Error(`tool not registered: ${name}`);
	const result = await tool.execute("t1", { root: docsRoot, ...params });
	return result.content[0].text;
};

beforeAll(() => {
	mkdirSync(docsRoot, { recursive: true });
	registerDocsTools(piMock);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("docs-writer typed tools", () => {
	test("registers the four-tool surface", () => {
		expect([...tools.keys()].sort()).toEqual([
			"docs_check",
			"docs_read",
			"docs_tree",
			"docs_write",
		]);
	});

	test("write → read → check roundtrip through validated doc.json", async () => {
		const written = await run("docs_write", {
			path: "10-system-design/10-example",
			markdown: "# Example Doc\n\nA paragraph about the example.\n\n- one\n- two\n",
		});
		expect(written).toStartWith("created 10-system-design/10-example");
		expect(existsSync(join(docsRoot, "10-system-design/10-example/doc.json"))).toBe(true);

		const rendered = await run("docs_read", { path: "10-system-design/10-example" });
		expect(rendered).toContain("Example Doc");
		expect(rendered).toContain("one");

		const tree = await run("docs_tree", {});
		expect(tree).toContain("10-system-design/10-example");

		const check = await run("docs_check", {});
		expect(check).toStartWith("ok");
	});

	test("update preserves the document id", async () => {
		const before = JSON.parse(
			await Bun.file(join(docsRoot, "10-system-design/10-example/doc.json")).text(),
		);
		const updated = await run("docs_write", {
			path: "10-system-design/10-example",
			markdown: "# Example Doc v2\n\nRewritten body.\n",
		});
		expect(updated).toStartWith("updated 10-system-design/10-example");
		const after = JSON.parse(
			await Bun.file(join(docsRoot, "10-system-design/10-example/doc.json")).text(),
		);
		expect(after.id).toBe(before.id);
		expect(after.title).not.toBe(before.title);
	});

	test("path escapes are rejected without writing", async () => {
		const result = await run("docs_write", {
			path: "../outside",
			markdown: "# Escape\n",
		});
		expect(result).toStartWith("ERROR:");
		expect(existsSync(join(root, "outside"))).toBe(false);
	});

	test("reading a missing doc errors cleanly", async () => {
		const result = await run("docs_read", { path: "99-none/00-missing" });
		expect(result).toStartWith("ERROR:");
	});
});
