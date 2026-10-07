/**
 * useTraceBlob.mounted.test.tsx — the mounted regression for a retried node
 * row: the same span keeps its id but switches to another attempt's blob. The
 * hook and the call body are rendered for real (react-dom/client, act), the
 * hash changes in place, and responses are released by hand, out of order:
 *
 *   - the first render after the change shows loading, never the old blob;
 *   - a late response for a replaced hash never lands;
 *   - only the current hash's output ever renders.
 *
 * DOM: happy-dom, already installed in this workspace (canvas, annotations,
 * docs-system and sequence declare it), registered for this file only and
 * removed afterwards. fetch is a stub; nothing touches the network or a trace
 * DB.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TraceSpan } from "@evilmartians/agent-prism-types";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, type ReactNode } from "react";
import type { Root } from "react-dom/client";

import { fixtureSpan } from "../../__fixtures__/model-node-trace";
import { SpanDetailPanel } from "../../SpanDetailPanel";
import { TraceViewerApiContext } from "../TraceViewerApiContext";
import { useTraceBlob, type TraceBlobState } from "./useTraceBlob";

type ActGlobal = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

/** Requests the stub fetch is holding, by URL, until the test releases them. */
const held = new Map<string, Array<(body: string) => void>>();

const stubFetch = ((input: RequestInfo | URL) =>
	new Promise<Response>((resolve) => {
		const url = String(input);
		const waiting = held.get(url) ?? [];
		waiting.push((body) => resolve({ ok: true, status: 200, text: async () => body } as Response));
		held.set(url, waiting);
	})) as typeof fetch;

let createRoot: typeof import("react-dom/client").createRoot;
let realFetch: typeof fetch;

beforeAll(async () => {
	GlobalRegistrator.register();
	(globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = true;
	// Loaded after the DOM exists, so react-dom sees a browser.
	({ createRoot } = await import("react-dom/client"));
	realFetch = globalThis.fetch;
	globalThis.fetch = stubFetch;
});

afterAll(async () => {
	globalThis.fetch = realFetch;
	delete (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT;
	await GlobalRegistrator.unregister();
});

/** Release the held request for `hash` with `body`, then let it settle. */
async function release(hash: string, body: string): Promise<void> {
	const url = `/kernel/blobs/${hash}`;
	const waiting = held.get(url);
	const respond = waiting?.shift();
	if (!respond) throw new Error(`no request held for ${url}`);
	await act(async () => {
		respond(body);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function mount(): { root: Root; container: HTMLElement; render: (node: ReactNode) => void } {
	const container = document.createElement("div");
	const root = createRoot(container);
	return {
		root,
		container,
		render: (node) =>
			act(() =>
				root.render(
					<TraceViewerApiContext.Provider value={{ apiBase: "" }}>{node}</TraceViewerApiContext.Provider>,
				),
			),
	};
}

describe("useTraceBlob, mounted", () => {
	test("a hash change renders loading at once; out-of-order responses only ever show the current hash", async () => {
		held.clear();
		const renders: Array<{ hash: string; state: TraceBlobState }> = [];
		function Probe({ hash }: { hash: string }) {
			const state = useTraceBlob(hash);
			renders.push({ hash, state });
			return <output>{state.phase === "loaded" ? state.text : state.phase}</output>;
		}
		const { root, container, render } = mount();

		// Attempt 1's blob loads.
		render(<Probe hash="b1-one" />);
		expect(container.textContent).toBe("loading");
		await release("b1-one", "attempt one");
		expect(container.textContent).toBe("attempt one");

		// Same component, new hash: the first render is already loading.
		render(<Probe hash="b1-two" />);
		expect(container.textContent).toBe("loading");

		// And again before attempt 2's blob arrives; then the responses land
		// newest first, the replaced one last.
		render(<Probe hash="b1-three" />);
		await release("b1-three", "attempt three");
		expect(container.textContent).toBe("attempt three");
		await release("b1-two", "attempt two");
		expect(container.textContent).toBe("attempt three");

		// No render ever showed a blob that was not read for its own hash.
		const bodies: Record<string, string> = {
			"b1-one": "attempt one",
			"b1-two": "attempt two",
			"b1-three": "attempt three",
		};
		for (const { hash, state } of renders) {
			if (state.phase === "loaded") expect(state).toEqual({ phase: "loaded", hash, text: bodies[hash] });
		}
		expect(renders.some((entry) => entry.hash === "b1-two" && entry.state.phase === "loaded")).toBe(false);

		act(() => root.unmount());
	});

	test("a call row that switches attempts shows loading, then only the current attempt's output", async () => {
		held.clear();
		const call = fixtureSpan("call");
		const withOutput = (hash: string): TraceSpan => ({
			...call,
			attributes: (call.attributes ?? []).map((attribute) =>
				attribute.key === "output_blob_hash" ? { key: attribute.key, value: { stringValue: hash } } : attribute,
			),
		});
		const output = (container: HTMLElement) =>
			container.querySelector('[data-detail-block="call-output"]')?.textContent ?? null;
		const { root, container, render } = mount();

		render(<SpanDetailPanel span={withOutput("b1-out-1")} />);
		await release("b1-in-RK", JSON.stringify({ checkpoint: "cp-7" }));
		await release("b1-out-1", JSON.stringify({ kept: "attempt-one" }));
		expect(output(container)).toContain("attempt-one");

		// The node row now summarizes another attempt: same span id, new output hash.
		render(<SpanDetailPanel span={withOutput("b1-out-2")} />);
		expect(output(container)).toBeNull();
		expect(container.querySelector('[data-detail-block="call-output-pending"]')).not.toBeNull();

		render(<SpanDetailPanel span={withOutput("b1-out-3")} />);
		await release("b1-out-3", JSON.stringify({ kept: "attempt-three" }));
		await release("b1-out-2", JSON.stringify({ kept: "attempt-two" }));
		expect(output(container)).toContain("attempt-three");
		expect(container.textContent).not.toContain("attempt-two");
		expect(container.textContent).not.toContain("attempt-one");

		act(() => root.unmount());
	});
});
