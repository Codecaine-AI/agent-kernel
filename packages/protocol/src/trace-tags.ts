/**
 * The trace tags: the 6 ids that tie a kernel row and a model request to one
 * engine node attempt. One table holds each tag's name (also its column on
 * `containers`), its request header and its environment variable, so no
 * other file repeats the list. The order follows the Trace Contract.
 */
export const TRACE_TAGS = [
	{ tag: "engine", header: "X-Trace-Engine", env: "TRACE_ENGINE" },
	{ tag: "run_id", header: "X-Trace-Run", env: "TRACE_RUN" },
	{ tag: "node_path", header: "X-Trace-Node-Path", env: "TRACE_NODE_PATH" },
	{ tag: "invocation_id", header: "X-Trace-Invocation", env: "TRACE_INVOCATION" },
	{ tag: "attempt_id", header: "X-Trace-Attempt", env: "TRACE_ATTEMPT" },
	{ tag: "loop_path", header: "X-Trace-Loop-Path", env: "TRACE_LOOP_PATH" },
] as const;

export type TraceTagName = (typeof TRACE_TAGS)[number]["tag"];

/**
 * The tags of one engine node attempt. A tag that is not given is not set.
 * `run_id` is the engine's own run id, not the kernel run id.
 */
export type TraceTags = Partial<Record<TraceTagName, string>>;

/** The `X-Trace-*` request headers of the tags that are set. A missing or empty tag sends no header. */
export function traceTagHeaders(tags: TraceTags | undefined): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const { tag, header } of TRACE_TAGS) {
		const value = tags?.[tag];
		if (value) headers[header] = value;
	}
	return headers;
}
