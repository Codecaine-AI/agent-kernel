/**
 * useTraceBlob.test.ts — the read lifecycle the hook wires together: a node
 * row that switches to another attempt's blob shows loading, then the new
 * blob, and a late response for the old hash is dropped. A stub fetch stands
 * in for the read API; nothing touches the network.
 */
import { describe, expect, test } from "bun:test";

import { currentTraceBlob, loadTraceBlob, traceBlobKey, type TraceBlobSlot } from "./useTraceBlob";

type Pending = { url: string; resolve: (response: Response) => void };

/** A fetch whose responses the test releases by hand, in any order. */
function deferredFetch(): { fetch: typeof fetch; pending: Pending[] } {
	const pending: Pending[] = [];
	const stub = ((input: RequestInfo | URL) =>
		new Promise<Response>((resolve) => {
			pending.push({ url: String(input), resolve });
		})) as typeof fetch;
	return { fetch: stub, pending };
}

/** Let every queued response settle. */
async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("trace blob read lifecycle", () => {
	const API = "";

	test("hash change → loading → the new blob; the late old response is ignored", async () => {
		const { fetch, pending } = deferredFetch();
		let slot = null as TraceBlobSlot | null;
		const settle = (next: TraceBlobSlot) => {
			slot = next;
		};

		// Attempt 1's blob loads.
		const cancelA = loadTraceBlob(API, "b1-a", settle, fetch);
		expect(currentTraceBlob(slot, API, "b1-a")).toEqual({ phase: "loading", hash: "b1-a" });
		pending[0]!.resolve(new Response("attempt one"));
		await flush();
		expect(currentTraceBlob(slot, API, "b1-a")).toEqual({ phase: "loaded", hash: "b1-a", text: "attempt one" });

		// The row now selects attempt 2: its old read is cancelled, a new one starts.
		cancelA();
		const cancelB = loadTraceBlob(API, "b1-b", settle, fetch);
		// Before attempt 2's blob arrives the body shows loading, never attempt 1's blob.
		expect(currentTraceBlob(slot, API, "b1-b")).toEqual({ phase: "loading", hash: "b1-b" });

		pending[1]!.resolve(new Response("attempt two"));
		await flush();
		expect(currentTraceBlob(slot, API, "b1-b")).toEqual({ phase: "loaded", hash: "b1-b", text: "attempt two" });
		cancelB();
	});

	test("a response for a replaced hash never lands, even when it arrives last", async () => {
		const { fetch, pending } = deferredFetch();
		let slot = null as TraceBlobSlot | null;
		const settle = (next: TraceBlobSlot) => {
			slot = next;
		};

		const cancelA = loadTraceBlob(API, "b1-a", settle, fetch);
		cancelA();
		loadTraceBlob(API, "b1-b", settle, fetch);

		pending[1]!.resolve(new Response("attempt two"));
		await flush();
		pending[0]!.resolve(new Response("attempt one"));
		await flush();

		expect(slot).toEqual({
			key: traceBlobKey(API, "b1-b"),
			state: { phase: "loaded", hash: "b1-b", text: "attempt two" },
		});
		expect(pending.map((entry) => entry.url)).toEqual(["/kernel/blobs/b1-a", "/kernel/blobs/b1-b"]);
	});

	test("a read is tied to its API base too, and failures settle as errors", async () => {
		const { fetch, pending } = deferredFetch();
		let slot = null as TraceBlobSlot | null;
		loadTraceBlob("http://kernel.test", "b1-a", (next) => {
			slot = next;
		}, fetch);
		pending[0]!.resolve(new Response("missing", { status: 404 }));
		await flush();

		expect(currentTraceBlob(slot, "http://kernel.test", "b1-a")).toEqual({
			phase: "error",
			hash: "b1-a",
			message: "HTTP 404",
		});
		// Same hash, another API base (or none): not this read.
		expect(currentTraceBlob(slot, "", "b1-a")).toEqual({ phase: "loading", hash: "b1-a" });
		expect(currentTraceBlob(slot, null, "b1-a")).toEqual({ phase: "offline", hash: "b1-a" });
		expect(currentTraceBlob(slot, "", undefined)).toEqual({ phase: "absent" });
	});
});
