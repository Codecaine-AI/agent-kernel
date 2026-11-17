/**
 * A local HTTP stub that records the `X-Trace-*` headers of each request it
 * receives, for the trace header tests of spawnAgent, kernel.call and
 * kernel.decide. Model-node tests replace `globalThis.fetch`, so a test that
 * sends to the stub passes `realFetch` on purpose.
 */
import type { TraceTags } from "@codecaine-ai/agent-kernel-protocol";

/** The fetch of the runtime, kept before any test file disables the network. */
export const realFetch = globalThis.fetch;

/** All 6 tags. `TRACE_HEADERS` is what a request with them must carry. */
export const TRACE_TAGS_FIXTURE = {
	engine: "archon",
	run_id: "wf-run-1",
	node_path: "review/fix",
	invocation_id: "inv-1",
	attempt_id: "att-1",
	loop_path: "loop/2",
} satisfies Required<TraceTags>;

export const TRACE_HEADERS = {
	"x-trace-engine": "archon",
	"x-trace-run": "wf-run-1",
	"x-trace-node-path": "review/fix",
	"x-trace-invocation": "inv-1",
	"x-trace-attempt": "att-1",
	"x-trace-loop-path": "loop/2",
};

export interface TraceHeaderStub {
	url: string;
	/** The `x-trace-*` headers of each request, in arrival order. */
	received: Array<Record<string, string>>;
	stop(): void;
}

/** `respond` gets the request's arrival index and body, and can hold the reply by returning a promise. */
export function startTraceHeaderStub(
	respond: (index: number, body: string) => Response | Promise<Response>,
): TraceHeaderStub {
	const received: Array<Record<string, string>> = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const trace: Record<string, string> = {};
			req.headers.forEach((value, name) => {
				if (name.startsWith("x-trace-")) trace[name] = value;
			});
			received.push(trace);
			const index = received.length - 1;
			return respond(index, await req.text());
		},
	});
	return { url: `http://127.0.0.1:${server.port}`, received, stop: () => server.stop(true) };
}

/** An OpenAI Responses SSE stream of the given output items (pi-ai's openai-responses parser). */
export function responsesStream(items: Array<Record<string, unknown>>): Response {
	const events = [
		{ type: "response.created", response: { id: "resp_stub", status: "in_progress", output: [] } },
		...items.flatMap((item, index) => [
			{ type: "response.output_item.added", output_index: index, item },
			{ type: "response.output_item.done", output_index: index, item },
		]),
		{
			type: "response.completed",
			response: {
				id: "resp_stub",
				status: "completed",
				output: [],
				usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
			},
		},
	];
	const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export function textItem(text: string): Record<string, unknown> {
	return {
		type: "message",
		id: "msg_stub",
		role: "assistant",
		status: "completed",
		content: [{ type: "output_text", text, annotations: [] }],
	};
}

export function toolCallItem(name: string, args: Record<string, unknown> = {}): Record<string, unknown> {
	return { type: "function_call", id: "fc_stub", call_id: "call_stub", name, arguments: JSON.stringify(args), status: "completed" };
}
