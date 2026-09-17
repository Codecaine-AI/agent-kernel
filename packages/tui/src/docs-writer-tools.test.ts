import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { mdxToDoc } from "@codecaine-ai/docs-cli/migrate/mdx-to-doc";
import { serializeDocDocument } from "@codecaine-ai/docs-model/doc-schema";

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

const runResult = async (name: string, params: Record<string, unknown>) => {
	const tool = tools.get(name);
	if (!tool) throw new Error(`tool not registered: ${name}`);
	const result = await tool.execute("t1", { root: docsRoot, ...params });
	return result;
};

const run = async (name: string, params: Record<string, unknown>) =>
	(await runResult(name, params)).content[0].text;

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

	test("check rejects dangling doc references and internal links", async () => {
		await run("docs_write", {
			path: "10-system-design/20-link-check",
			markdown: [
				"# Link Check",
				"",
				"[Existing doc](/docs/10-system-design/10-example.md)",
				"",
				"[Missing doc](/docs/10-system-design/99-missing.md)",
				"",
				"[Internal path](../30-internal)",
				"",
				"[External URL](https://example.com)",
			].join("\n"),
		});

		const check = await run("docs_check", { path: "10-system-design/20-link-check" });
		expect(check).toContain("1/1 doc(s) failed");
		expect(check).toContain("doc reference does not resolve: docs/10-system-design/99-missing.md");
		expect(check).toContain("internal paths must use a doc reference: ../30-internal");
		expect(check).not.toContain("https://example.com");
	});
});

describe("docs-writer lint diagnostics", () => {
	test("new required prose errors reject before creating folders", async () => {
		const result = await runResult("docs_write", {
			path: "lint/rejected/nested", markdown: "New — prose.",
		});
		expect(result.details.error).toBe(true);
		expect(result.content[0].text).toContain("writing.no-em-dash");
		expect(result.content[0].text).toContain("nothing written");
		expect(existsSync(join(docsRoot, "lint/rejected"))).toBe(false);
		expect(result.details.lint).toMatchObject({ phase: "complete", blocking: [
			expect.objectContaining({ ruleId: "writing.no-em-dash", introduced: true, field: expect.any(String), suggestion: expect.any(String), docsPath: expect.any(String) }),
		] });
	});

	test("warnings write successfully, check reports them, and fixes clear them", async () => {
		const path = "lint/warnings";
		const result = await runResult("docs_write", { path, markdown: "In order to save, press Save." });
		expect(result.details.error).toBeUndefined();
		expect(result.content[0].text).toContain("writing.filler");
		expect(result.details.lint).toMatchObject({ blocking: [], findings: expect.arrayContaining([
			expect.objectContaining({ ruleId: "writing.filler", severity: "warning" }),
		]) });
		expect(existsSync(join(docsRoot, path, "doc.json"))).toBe(true);
		const check = await runResult("docs_check", { path });
		expect(check.details.error).toBeUndefined();
		expect(check.content[0].text).toContain("writing.filler");
		expect(check.details.lintReports).toEqual([expect.objectContaining({ path, report: expect.objectContaining({ phase: "complete" }) })]);
		expect(await run("docs_write", { path, markdown: "Press Save." })).toStartWith("updated");
		const fixed = await runResult("docs_check", { path });
		expect(fixed.details.error).toBeUndefined();
		expect(fixed.details.lintReports).toEqual([{ path, report: { phase: "complete", findings: [], blocking: [] } }]);
	});

	test("baseline survives regenerated block IDs; new errors preserve existing bytes", async () => {
		const path = "lint/legacy";
		const dir = join(docsRoot, path);
		const docFile = join(dir, "doc.json");
		mkdirSync(dir, { recursive: true });
		const original = mdxToDoc("Old — prose.\n\nOriginal body.", path).doc;
		writeFileSync(docFile, serializeDocDocument(original));
		// Before a successful write, checks audit all required findings.
		expect((await runResult("docs_check", { path })).details.error).toBe(true);
		const updated = await runResult("docs_write", { path, markdown: "Old — prose.\n\nUpdated body." });
		expect(updated.details.error).toBeUndefined();
		expect(updated.details.lint).toMatchObject({ blocking: [], findings: expect.arrayContaining([
			expect.objectContaining({ ruleId: "writing.no-em-dash", introduced: false }),
		]) });
		const bytes = readFileSync(docFile, "utf8");
		expect(JSON.parse(bytes).id).toBe(original.id);
		const rejected = await runResult("docs_write", { path, markdown: "Different — prose." });
		expect(rejected.details.error).toBe(true);
		expect(readFileSync(docFile, "utf8")).toBe(bytes);
		const check = await runResult("docs_check", { path });
		expect(check.details.error).toBeUndefined();
		expect(check.content[0].text).toContain("writing.no-em-dash");
		expect(check.details.lintReports).toEqual([expect.objectContaining({ report: expect.objectContaining({
			blocking: [], findings: expect.arrayContaining([expect.objectContaining({ introduced: false })]),
		}) })]);
		expect(await run("docs_write", { path, markdown: "Repaired prose." })).toStartWith("updated");
		expect(await run("docs_check", { path })).toStartWith("ok");
		const restored = await runResult("docs_write", { path, markdown: "Old — prose.\n\nAnother update." });
		expect(restored.details.error).toBeUndefined();
		expect(restored.details.lint).toMatchObject({ blocking: [], findings: expect.arrayContaining([
			expect.objectContaining({ introduced: false }),
		]) });
	});

	test("new documents retain an empty baseline across writes and checks", async () => {
		const path = "lint/new-baseline";
		expect(await run("docs_write", { path, markdown: "Press Save." })).toStartWith("created");
		const docFile = join(docsRoot, path, "doc.json");
		const bytes = readFileSync(docFile, "utf8");
		const bad = await runResult("docs_write", { path, markdown: "New — prose." });
		expect(bad.details.error).toBe(true);
		expect(readFileSync(docFile, "utf8")).toBe(bytes);
		// Even an out-of-band edit cannot become a baseline for a new document.
		writeFileSync(docFile, serializeDocDocument(mdxToDoc("New — prose.", path).doc));
		expect((await runResult("docs_check", { path })).details.error).toBe(true);
		expect((await runResult("docs_write", { path, markdown: "New — prose." })).details.error).toBe(true);
	});

	test("conversion warnings remain visible and code examples are exempt", async () => {
		const result = await runResult("docs_write", {
			path: "lint/conversion",
			markdown: 'Convert the source document.\n\n<UnmappedWidget>\nExample — code.\n</UnmappedWidget>\n',
		});
		expect(result.details.error).toBeUndefined();
		expect(result.content[0].text).toContain("conversion warnings:");
		expect(result.details.warnings).toEqual(expect.arrayContaining([expect.stringContaining("UnmappedWidget")]));
		expect(existsSync(join(docsRoot, "lint/conversion/doc.json"))).toBe(true);
	});

	test("check keeps schema failures separate from lint diagnostics", async () => {
		const dir = join(docsRoot, "lint/invalid-schema");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "doc.json"), JSON.stringify({ title: "Invalid" }));
		const result = await runResult("docs_check", { path: "lint/invalid-schema" });
		expect(result.details.error).toBe(true);
		expect(result.content[0].text).toContain("invalid doc.json");
		expect(result.details.lintReports).toEqual([]);
	});
});
