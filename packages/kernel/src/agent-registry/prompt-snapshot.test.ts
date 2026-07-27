/**
 * prompt-snapshot.test.ts — generating the markdown render of prompt.json.
 *
 * prompt.json is the source of truth; the markdown beside it is generated.
 * Where it lands follows the bundle form, and the bytes are the prompt body
 * the registry builds (prompt-kit's renderXmlMarkdown) behind a generated-file
 * header — the registry never reads it back.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { renderXmlMarkdown, type PromptDocument } from "@codecaine-ai/prompt-kit";

import {
	RENDERED_SNAPSHOT_HEADER,
	promptSnapshotFor,
	refreshBundlePromptSnapshot,
	refreshCatalogPromptSnapshots,
} from "./prompt-snapshot";
import { buildRegistry } from "./registry/registry";

const PROMPT_DOCUMENT = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "snapshotAgentPrompt",
	nodes: [
		{
			type: "section",
			tag: "role",
			children: [{ type: "paragraph", content: ["Render me to markdown."] }],
		},
	],
} as unknown as PromptDocument;

const MANIFEST = {
	$schema: "agent-kernel/agent-v1",
	name: "snapshot-agent",
	description: "Prompt snapshot test agent.",
	model: "test/model",
};

function tempRoot(): string {
	return mkdtempSync(join(import.meta.dir, ".prompt-snapshot-"));
}

function writeBundle(agentDir: string, form: "file" | "folder"): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "agent.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`);
	const promptFile =
		form === "file"
			? join(agentDir, "prompt.json")
			: join(agentDir, "prompt", "prompt.json");
	mkdirSync(join(promptFile, ".."), { recursive: true });
	// Deliberately non-canonical bytes so the canonicalize pass has work to do.
	writeFileSync(promptFile, `${JSON.stringify(PROMPT_DOCUMENT, null, 4)}\n`);
}

describe("prompt markdown snapshots", () => {
	test("folder-form bundle renders to prompt/system.md", () => {
		const root = tempRoot();
		const agentDir = join(root, "snapshot-agent");
		try {
			writeBundle(agentDir, "folder");
			const result = refreshBundlePromptSnapshot(agentDir);
			expect(result.form).toBe("folder");
			expect(result.renderedFile).toBe(join(agentDir, "prompt", "system.md"));
			expect(result.changed).toBe(true);
			expect(result.canonicalized).toBe(true);
			expect(result.hash).toStartWith("pk1-");

			const md = readFileSync(result.renderedFile, "utf8");
			expect(md.startsWith(RENDERED_SNAPSHOT_HEADER)).toBe(true);
			expect(md).toContain("Render me to markdown.");
			// The body is exactly the registry's system-prompt render.
			expect(md).toBe(promptSnapshotFor(PROMPT_DOCUMENT));
			expect(md.slice(RENDERED_SNAPSHOT_HEADER.length).trimEnd()).toBe(
				renderXmlMarkdown(PROMPT_DOCUMENT).trimEnd(),
			);

			// Second pass is a no-op: idempotent bytes.
			const again = refreshBundlePromptSnapshot(agentDir);
			expect(again.changed).toBe(false);
			expect(again.canonicalized).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("file-form bundle renders to prompt.rendered.md", () => {
		const root = tempRoot();
		const agentDir = join(root, "snapshot-agent");
		try {
			writeBundle(agentDir, "file");
			const result = refreshBundlePromptSnapshot(agentDir);
			expect(result.form).toBe("file");
			expect(result.renderedFile).toBe(join(agentDir, "prompt.rendered.md"));
			expect(existsSync(join(agentDir, "prompt", "system.md"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("dryRun reports staleness without writing", () => {
		const root = tempRoot();
		const agentDir = join(root, "snapshot-agent");
		try {
			writeBundle(agentDir, "folder");
			const result = refreshBundlePromptSnapshot(agentDir, { dryRun: true });
			expect(result.changed).toBe(true);
			expect(existsSync(result.renderedFile)).toBe(false);
			// prompt.json was left in its non-canonical bytes too.
			expect(readFileSync(result.promptFile, "utf8")).toContain("\n    ");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("the generated markdown is invisible to registry discovery", async () => {
		const root = tempRoot();
		const agentDir = join(root, "snapshot-agent");
		try {
			writeBundle(agentDir, "folder");
			refreshBundlePromptSnapshot(agentDir);
			const agent = (await buildRegistry({ roots: [root] })).get("snapshot-agent");
			expect(agent.promptFile).toBe(join(agentDir, "prompt", "prompt.json"));
			expect(agent.renderedPromptFile).toBe(join(agentDir, "prompt", "system.md"));
			// The definition's body comes from prompt.json, not from system.md.
			expect(agent.parsed.body).toBe(renderXmlMarkdown(PROMPT_DOCUMENT));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a whole catalog refreshes in sorted bundle order", () => {
		const root = tempRoot();
		try {
			writeBundle(join(root, "b-agent"), "folder");
			writeBundle(join(root, "a-agent"), "file");
			const results = refreshCatalogPromptSnapshots([root]);
			expect(results.map((r) => r.form)).toEqual(["file", "folder"]);
			expect(results.map((r) => r.agentDir)).toEqual([
				join(root, "a-agent"),
				join(root, "b-agent"),
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a bundle with no prompt.json in either form throws naming both paths", () => {
		const root = tempRoot();
		const agentDir = join(root, "snapshot-agent");
		try {
			mkdirSync(agentDir, { recursive: true });
			expect(() => refreshBundlePromptSnapshot(agentDir)).toThrow(
				/prompt\.json and prompt\/prompt\.json/,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
