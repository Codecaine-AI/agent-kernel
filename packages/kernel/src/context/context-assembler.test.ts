/**
 * context-assembler.test.ts — spawn-time context images.
 *
 * Covers the image seam end to end at the kernel layer: the resolver's
 * optional assembleImages hook rides through buildContext untouched, and
 * injectAgentContext converts an image-carrying result into a pi
 * content-block array (text first, then images) while a text-only result
 * keeps injecting the bare rendered string.
 */

import { describe, expect, test } from "bun:test";
import { SessionManager } from "@mariozechner/pi-coding-agent";

import { buildContext } from "./context-assembler";
import { AGENT_CONTEXT_MARKER, injectAgentContext } from "./accumulation-guard";
import { createSpawnContext } from "./create-spawn-context";
import { createDefaultCatalog } from "./loaders";
import type {
	AgentContextResolver,
	ContextImage,
	ContextLifecycleEmitter,
	SpawnContext,
} from "./types";

const PNG_1PX =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function makeSpawnContext(): SpawnContext {
	return createSpawnContext({
		agentName: "image-test-agent",
		runtime: { cwd: "/tmp" },
	});
}

function textResolver(): AgentContextResolver {
	return {
		loaders: [{ kind: "text", content: "hello", label: "greeting" }],
		assemble(loaded) {
			return `<ctx>${loaded.map((li) => li.content).join("")}</ctx>`;
		},
	};
}

function imageResolver(images: ContextImage[]): AgentContextResolver {
	return {
		...textResolver(),
		assembleImages() {
			return images;
		},
	};
}

async function buildWith(resolver: AgentContextResolver) {
	return buildContext({
		resolver,
		spawnContext: makeSpawnContext(),
		catalog: createDefaultCatalog(),
		emitter: null,
	});
}

describe("buildContext image hook", () => {
	test("resolver without the hook produces a result with no contextImages key", async () => {
		const result = await buildWith(textResolver());
		expect(result.renderedContext).toBe("<ctx>hello</ctx>");
		expect("contextImages" in result).toBe(false);
	});

	test("hook returning an empty array keeps the result pure-text", async () => {
		const result = await buildWith(imageResolver([]));
		expect("contextImages" in result).toBe(false);
	});

	test("hook images are copied through; totalBytes counts text only", async () => {
		const images: ContextImage[] = [
			{ data: PNG_1PX, mimeType: "image/png" },
			{ data: PNG_1PX, mimeType: "image/jpeg" },
		];
		const result = await buildWith(imageResolver(images));
		expect(result.contextImages).toEqual(images);
		expect(result.totalBytes).toBe(
			Buffer.byteLength(result.renderedContext, "utf8"),
		);
	});

	test("contextBuildCompleted emits the rendered text only, images excluded", async () => {
		const completed: { rendered_context: string; total_bytes: number }[] = [];
		const emitter: ContextLifecycleEmitter = {
			contextBuildStarted() {},
			contextInputResolved() {},
			contextBuildCompleted(input) {
				completed.push({
					rendered_context: input.rendered_context,
					total_bytes: input.total_bytes,
				});
			},
		};
		await buildContext({
			resolver: imageResolver([{ data: PNG_1PX, mimeType: "image/png" }]),
			spawnContext: makeSpawnContext(),
			catalog: createDefaultCatalog(),
			emitter,
		});
		expect(completed).toHaveLength(1);
		expect(completed[0]!.rendered_context).toBe("<ctx>hello</ctx>");
		expect(completed[0]!.total_bytes).toBe(
			Buffer.byteLength("<ctx>hello</ctx>", "utf8"),
		);
	});
});

describe("injectAgentContext content shape", () => {
	function findContextEntry(mgr: SessionManager) {
		const entry = mgr
			.getEntries()
			.find(
				(e) =>
					(e as { type?: string }).type === "custom_message" &&
					(e as { customType?: string }).customType === AGENT_CONTEXT_MARKER,
			) as { content: unknown } | undefined;
		expect(entry).toBeDefined();
		return entry!;
	}

	test("text-only result injects the bare rendered string", async () => {
		const mgr = SessionManager.inMemory("/tmp");
		const result = await buildWith(textResolver());
		injectAgentContext({ sessionManager: mgr }, "image-test-agent", result);
		const entry = findContextEntry(mgr);
		expect(typeof entry.content).toBe("string");
		expect(entry.content).toBe("<ctx>hello</ctx>");
	});

	test("image-carrying result injects text block first, then images, in context", async () => {
		const mgr = SessionManager.inMemory("/tmp");
		const result = await buildWith(
			imageResolver([
				{ data: PNG_1PX, mimeType: "image/png" },
				{ data: PNG_1PX, mimeType: "image/jpeg" },
			]),
		);
		injectAgentContext({ sessionManager: mgr }, "image-test-agent", result);

		const entry = findContextEntry(mgr);
		expect(entry.content).toEqual([
			{ type: "text", text: "<ctx>hello</ctx>" },
			{ type: "image", data: PNG_1PX, mimeType: "image/png" },
			{ type: "image", data: PNG_1PX, mimeType: "image/jpeg" },
		]);

		// The entry participates in LLM context: buildSessionContext surfaces
		// it as a message carrying the same content blocks.
		const context = mgr.buildSessionContext();
		const contextMessages = context.messages.filter(
			(m) =>
				(m as { customType?: string }).customType === AGENT_CONTEXT_MARKER,
		);
		expect(contextMessages).toHaveLength(1);
		expect((contextMessages[0] as { content: unknown }).content).toEqual([
			{ type: "text", text: "<ctx>hello</ctx>" },
			{ type: "image", data: PNG_1PX, mimeType: "image/png" },
			{ type: "image", data: PNG_1PX, mimeType: "image/jpeg" },
		]);
	});
});

describe("resolver typing", () => {
	test("an embedder supplies images without widening loader or assemble types", () => {
		// Compile-time contract: assemble() stays string-returning, loaders stay
		// LoaderDeclaration[], and the image hook is the only image-aware seam.
		const resolver: AgentContextResolver = {
			loaders: [{ kind: "text", content: "board state" }],
			assemble: (loaded): string => loaded.map((li) => li.content).join("\n"),
			assembleImages: (_loaded, _ctx): ContextImage[] => [
				{ data: PNG_1PX, mimeType: "image/png" },
			],
		};
		expect(typeof resolver.assembleImages).toBe("function");
	});
});
