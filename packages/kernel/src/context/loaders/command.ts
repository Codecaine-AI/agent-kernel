/**
 * command.ts — Subprocess loader.
 *
 * Spawns `decl.command` + `decl.args` via Bun.spawn with cwd=ctx.cwd and a
 * default 10s timeout. Not shell-interpreted — agents that need a pipeline
 * wrap it in a script. stderr is surfaced only in the error field; content is
 * stdout alone.
 */

import { hashContent } from "./catalog";
import type { CommandLoaderDeclaration, Loader } from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;

async function readStream(
	stream: ReadableStream<Uint8Array> | null | undefined,
): Promise<string> {
	if (!stream) return "";
	return new Response(stream).text();
}

export const commandLoader: Loader<CommandLoaderDeclaration> = {
	kind: "command",
	resolve: async (decl, ctx) => {
		const timeoutMs = decl.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		try {
			const proc = Bun.spawn({
				cmd: [decl.command, ...(decl.args ?? [])],
				cwd: ctx.cwd,
				stdout: "pipe",
				stderr: "pipe",
				timeout: timeoutMs,
			});

			const [stdout, stderr] = await Promise.all([
				readStream(proc.stdout as ReadableStream<Uint8Array> | null),
				readStream(proc.stderr as ReadableStream<Uint8Array> | null),
			]);
			await proc.exited;

			if (proc.exitCode !== 0) {
				return {
					status: "error",
					content: "",
					bytes: 0,
					hash: "",
					error: `exit ${proc.exitCode}: ${stderr.trim() || "no stderr"}`,
				};
			}

			if (stdout.trim().length === 0) {
				return {
					status: "empty",
					content: "",
					bytes: 0,
					hash: hashContent(""),
				};
			}

			return {
				status: "ok",
				content: stdout,
				bytes: Buffer.byteLength(stdout, "utf8"),
				hash: hashContent(stdout),
			};
		} catch (err) {
			return {
				status: "error",
				content: "",
				bytes: 0,
				hash: "",
				error: (err as Error).message,
			};
		}
	},
};

export default commandLoader;
