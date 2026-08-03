/**
 * Phase 1.5 cross-track integration: annotation sidecar (Track A) →
 * launchPromptEditSession (Track C glue) → the real prompt-editor bundle's
 * context contract (Track B).
 *
 * The fixture is a temp catalog carrying a small target agent bundle, built
 * into ONE registry together with the real catalog root, so the spawn target
 * (PROMPT_EDITOR_AGENT_NAME) and the edit target resolve side by side.
 * Annotations are written through the real kernel catalog service ops (the
 * same surface the HTTP routes ride), the launch helper assembles the
 * session, and the resulting sessionData is fed through the bundle's actual
 * `assemble()` — placeholders in the output mean the contract broke.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	canonicalizePrompt,
	PROMPT_KIT_SCHEMA_VERSION,
	type PromptDocument,
} from "@codecaine-ai/prompt-kit";
import { buildRegistry, type AgentRegistry } from "@agent-kernel/kernel/agent-registry";
import {
	createKernelCatalogService,
	type KernelCatalogService,
} from "@agent-kernel/kernel";
import {
	launchPromptEditSession,
	PROMPT_EDITOR_AGENT_NAME,
	sessionDataForPromptEditSession,
	toolProposeTransaction,
	type LaunchedPromptEditSession,
} from "@agent-kernel/kernel/prompt-edit-session";
import type { LoadedMap, SpawnContext } from "@agent-kernel/kernel/context";

import promptEditorContext from "./prompt-editor/context/index";

const CATALOG_DIR = import.meta.dir;
const TARGET_AGENT = "source-scout";
const DOC_ID = "source-scout-prompt";

function targetPromptDocument(opening: string): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
		id: DOC_ID,
		title: "Source Scout",
		nodes: [
			{
				type: "section",
				id: "sec-purpose",
				tag: "purpose",
				children: [
					{ type: "paragraph", id: "para-0", content: [opening] },
					{
						type: "paragraph",
						id: "para-1",
						content: ["Answer in concise, sourced bullets."],
					},
				],
			},
		],
	} as PromptDocument;
}

function fakeSpawnContext(overrides: Partial<SpawnContext> = {}): SpawnContext {
	return {
		agentName: PROMPT_EDITOR_AGENT_NAME,
		variables: {},
		caller: { kind: "system", id: "test" },
		runtime: { cwd: CATALOG_DIR },
		paths: { workingDir: CATALOG_DIR, activeSessionDir: CATALOG_DIR },
		...overrides,
	};
}

async function loadDeclaredFiles(): Promise<LoadedMap> {
	return promptEditorContext.loaders.map((decl) => {
		const path = String((decl as { path?: unknown }).path ?? "");
		const content = readFileSync(path, "utf8");
		return {
			decl,
			status: "ok" as const,
			content,
			bytes: Buffer.byteLength(content, "utf8"),
			hash: "",
			fromCache: false,
		};
	});
}

let dir: string;
let bundleDir: string;
let registry: AgentRegistry;
let service: KernelCatalogService;
let annotationIds: string[] = [];
let launch: LaunchedPromptEditSession;

async function addAnnotation(input: Record<string, unknown>): Promise<string> {
	const result = await service.addAnnotation(TARGET_AGENT, {
		author: "ford",
		intent: "agent-request",
		...input,
	});
	if (!result || !("annotation" in result))
		throw new Error(`addAnnotation failed: ${JSON.stringify(result)}`);
	return result.annotation.id;
}

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), "prompt-edit-integration-"));
	const tempRoot = join(dir, "agent-catalog");
	bundleDir = join(tempRoot, TARGET_AGENT);
	mkdirSync(bundleDir, { recursive: true });
	writeFileSync(
		join(bundleDir, "agent.json"),
		`${JSON.stringify(
			{
				$schema: "agent-kernel/agent-v1",
				name: TARGET_AGENT,
				description: "Fixture edit target for the prompt-edit loop.",
				model: "test-model-alias",
				variables: {},
			},
			null,
			"\t",
		)}\n`,
		"utf8",
	);
	writeFileSync(
		join(bundleDir, "prompt.json"),
		canonicalizePrompt(targetPromptDocument("You find primary sources.")),
		"utf8",
	);

	// One registry over the temp root AND the real catalog: the edit target
	// and the prompt-editor bundle resolve side by side, like a real kernel.
	registry = await buildRegistry({ roots: [tempRoot, CATALOG_DIR] });
	service = createKernelCatalogService({
		registry: async () => registry,
		db: () => {
			throw new Error("no db in this test");
		},
		allowWrites: true,
	});

	// Track A writes, through the catalog service ops (creation order = R order).
	annotationIds = [
		await addAnnotation({
			target: { kind: "prompt-node", docId: DOC_ID, nodeId: "para-0" },
			body: "Make the opening say WHAT counts as a primary source.",
		}),
		await addAnnotation({
			target: {
				kind: "prompt-range",
				docId: DOC_ID,
				nodeId: "para-1",
				start: 10,
				end: 17,
				quote: "concise",
			},
			body: "Concise how? Give a bullet budget.",
		}),
	];
	// Non-requests: a plain note and a resolved request must NOT enter the queue.
	await addAnnotation({
		intent: "note",
		target: { kind: "prompt-node", docId: DOC_ID, nodeId: "para-1" },
		body: "Ambient observation, not a work item.",
	});
	const resolvedId = await addAnnotation({
		target: { kind: "prompt-node", docId: DOC_ID, nodeId: "para-0" },
		body: "Already handled elsewhere.",
	});
	await service.resolveAnnotation(TARGET_AGENT, resolvedId, {
		resolution: "handled",
	});

	const result = await launchPromptEditSession({
		registry,
		targetAgent: TARGET_AGENT,
		annotationOps: service,
		extraRequests: [
			{
				id: "extra-doc-request",
				target: { kind: "doc" },
				body: "Overall: the prompt never says when to stop searching.",
			},
		],
	});
	if (!result.ok) throw new Error(`launch failed: ${JSON.stringify(result)}`);
	launch = result;
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("launchPromptEditSession over the sidecar", () => {
	test("the spawn target and the edit target live in the same registry", () => {
		const editor = registry.tryGet(PROMPT_EDITOR_AGENT_NAME);
		expect(editor).not.toBeNull();
		expect(Object.keys(editor!.manifest.variables)).toEqual(["targetAgent"]);
		expect(launch.spawn.agentName).toBe(PROMPT_EDITOR_AGENT_NAME);
		expect(launch.spawn.variables).toEqual({ targetAgent: TARGET_AGENT });
	});

	test("requests carry R-aliases in creation order with annotation ids attached", () => {
		const requests = launch.session.requests();
		expect(requests.map((entry) => entry.alias)).toEqual(["R1", "R2", "R3"]);
		expect(requests.map((entry) => entry.annotationId)).toEqual([
			...annotationIds,
			"extra-doc-request",
		]);
		expect(requests[0]?.target).toEqual({ kind: "node", nodeId: "para-0" });
		expect(requests[1]?.target).toEqual({
			kind: "range",
			nodeId: "para-1",
			start: 10,
			end: 17,
			quote: "concise",
		});
		expect(requests[2]?.target).toEqual({ kind: "doc" });
	});

	test("the note and the resolved annotation are skipped with reasons, not dropped silently", () => {
		expect(launch.skipped.map((entry) => entry.reason).sort()).toEqual([
			"not-agent-request",
			"not-open",
		]);
	});

	test("sessionData carries EXACTLY the bundle contract's keys", () => {
		expect(Object.keys(launch.sessionData).sort()).toEqual([
			"requestQueue",
			"targetPromptHash",
			"targetPromptRender",
		]);
		const def = registry.tryGet(TARGET_AGENT)!;
		expect(launch.sessionData.targetPromptHash).toBe(def.promptHash);
		expect(launch.sessionData.targetPromptHash).toStartWith("pk1-");
		expect(launch.sessionData.targetPromptRender).toContain("<!-- #para-0 -->");
		expect(launch.sessionData.requestQueue).toContain("R1 open");
	});

	test("the real bundle context assembles the payload — no placeholders survive", async () => {
		const loaded = await loadDeclaredFiles();
		const out = await promptEditorContext.assemble(
			loaded,
			fakeSpawnContext({
				variables: launch.spawn.variables,
				sessionData: launch.spawn.sessionData,
			}),
		);
		expect(out).toContain(
			`<target_prompt agent="${TARGET_AGENT}" hash="${launch.sessionData.targetPromptHash}">`,
		);
		expect(out).toContain("<!-- #para-0 -->");
		expect(out).toContain("You find primary sources.");
		expect(out).toContain("R1 open");
		expect(out).toContain(
			'"Make the opening say WHAT counts as a primary source."',
		);
		expect(out).not.toContain("(unset)");
		expect(out).not.toContain("(target prompt not loaded");
		expect(out).not.toContain("(no open requests");
	});

	test("propose_transaction round-trips through the tool layer and stages sane changedIds", async () => {
		const result = await toolProposeTransaction(launch.session, {
			requestAlias: "R1",
			ops: [
				{
					op: "update_node",
					nodeId: "para-0",
					patch: {
						content: [
							"You find primary sources: firsthand accounts, original data, and contemporaneous records.",
						],
					},
				},
			],
			summary: "Define primary source in the opening line.",
		});
		expect(result.isError).toBeUndefined();

		const proposals = launch.session.proposals();
		expect(proposals).toHaveLength(1);
		expect(proposals[0]?.changedIds).toEqual(["para-0"]);
		expect(proposals[0]?.requestAlias).toBe("R1");
		expect(proposals[0]?.baseHash).toBe(launch.sessionData.targetPromptHash);
		expect(proposals[0]?.renderedAfter).toContain("firsthand accounts");
		expect(
			launch.session.requests().find((entry) => entry.alias === "R1")?.status,
		).toBe("proposal-ready");
	});

	test("sessionData is live-refreshable from current session state", () => {
		const noted = launch.session.addNote(DOC_ID, "The two purpose paragraphs overlap.");
		expect(noted.ok).toBe(true);
		const rebuilt = sessionDataForPromptEditSession(launch.session);
		expect(rebuilt.requestQueue).toContain("R4");
		expect(rebuilt.targetPromptRender).toContain("firsthand accounts");
		// The hash stays the base revision — staged proposals build on it.
		expect(rebuilt.targetPromptHash).toBe(launch.sessionData.targetPromptHash);
	});

	test("stale-base fires after the target prompt is saved behind the session's back", async () => {
		writeFileSync(
			join(bundleDir, "prompt.json"),
			canonicalizePrompt(
				targetPromptDocument("You find primary sources, fast."),
			),
			"utf8",
		);
		const swapped = registry.reloadAgentPrompt(TARGET_AGENT);
		expect(swapped.promptHash).not.toBe(launch.sessionData.targetPromptHash);

		const result = await launch.session.propose(
			"R2",
			[
				{
					op: "update_node",
					nodeId: "para-1",
					patch: { content: ["Answer in at most five sourced bullets."] },
				},
			],
			"Give concise a bullet budget.",
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected stale_base");
		expect(result.failure).toEqual({
			kind: "stale_base",
			expectedHash: launch.sessionData.targetPromptHash,
			actualHash: swapped.promptHash,
		});
	});
});
