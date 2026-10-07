/**
 * Subprocess log-leak test (plan §4.2 rule 4, §4.7): with the REAL BAML
 * native module, nothing the adapter does makes BAML print a prompt or a
 * credential on stdout or stderr, whatever the ambient BAML_LOG.
 *
 * Nothing under packages/ may load BAML, so the child script and the real
 * module live in the git-ignored spike (`.work/model-nodes/spikes/baml-bun`:
 * `src/kernel-log-leak-child.ts`, its `node_modules`, its generated client).
 * The child imports this folder's `index.ts` by absolute path. When the
 * spike is absent (a fresh checkout) the test is skipped with a printed reason.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { BAML_LOG_NORMALIZED_NOTICE } from "./log-level";

const REPO_ROOT = resolve(import.meta.dir, "../../../../..");
const SPIKE = join(REPO_ROOT, ".work/model-nodes/spikes/baml-bun");
const CHILD = join(SPIKE, "src/kernel-log-leak-child.ts");
const ADAPTER = join(import.meta.dir, "index.ts");

const missing = [
	CHILD,
	join(SPIKE, "node_modules/@boundaryml/baml/package.json"),
	join(SPIKE, "baml_client/index.ts"),
].filter((path) => !existsSync(path));
if (missing.length > 0) {
	console.warn(`skipping the BAML log-leak subprocess test: missing ${missing.join(", ")}`);
}

const PROMPT_MARKER = "PROMPTLEAKMARKER-7f3a91";
const CRED_MARKER = "sk-CREDLEAKMARKER-9c2e4b1d";
const HEADER_MARKER = "hdr-CREDLEAKMARKER-55aa0c";
const MARKERS = [PROMPT_MARKER, CRED_MARKER, HEADER_MARKER];

interface ChildRun {
	code: number;
	stdout: string;
	stderr: string;
}

/** A minimal environment: no inherited credentials or BAML settings; `ambient` is the BAML_LOG under test. */
async function runChild(mode: "adapter" | "control", ambient?: string): Promise<ChildRun> {
	const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
	if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
	if (ambient !== undefined) env.BAML_LOG = ambient;
	const child = Bun.spawn([process.execPath, CHILD, ADAPTER, mode, PROMPT_MARKER, CRED_MARKER, HEADER_MARKER], {
		cwd: SPIKE,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, stdout, stderr };
}

function resultOf(run: ChildRun): Record<string, unknown> {
	const line = run.stdout.split("\n").find((l) => l.startsWith("RESULT "));
	if (!line) throw new Error(`child printed no RESULT line (exit ${run.code}); stderr bytes: ${run.stderr.length}`);
	return JSON.parse(line.slice("RESULT ".length)) as Record<string, unknown>;
}

describe("BAML native logging (real module, subprocess)", () => {
	test.skipIf(missing.length > 0)(
		"stdout and stderr carry no prompt or credential on connection, HTTP and parse failures, for any ambient BAML_LOG",
		async () => {
			const ambients = [undefined, "info", "warn", "debug", "trace", "error", "off"];
			const [control, ...runs] = await Promise.all([
				runChild("control"),
				...ambients.map((ambient) => runChild("adapter", ambient)),
			]);

			// Control: without the adapter's settings BAML prints the rendered prompt (0.226.2 writes it to
			// stdout), so the scan below can see a leak.
			expect(control!.code).toBe(0);
			expect(resultOf(control!)).toEqual({ mode: "control" });
			expect(control!.stdout + control!.stderr).toContain(PROMPT_MARKER);
			expect(control!.stdout + control!.stderr).toContain("---PROMPT---");

			for (const [index, run] of runs.entries()) {
				const ambient = ambients[index];
				const output = run.stdout + run.stderr;
				expect({ ambient, code: run.code }).toEqual({ ambient, code: 0 });
				for (const marker of MARKERS) {
					expect({ ambient, marker, leaked: output.includes(marker) }).toEqual({ ambient, marker, leaked: false });
				}
				expect({ ambient, prompt: output.includes("---PROMPT---") }).toEqual({ ambient, prompt: false });

				const kept = ambient === "error" || ambient === "off";
				expect(resultOf(run)).toEqual({
					mode: "adapter",
					ambientAfter: kept ? ambient : "error",
					results: [
						{ name: "native-connection", ok: false, kind: "http", credentialInOutcome: false },
						{ name: "stream-connection", ok: false, kind: "http", credentialInOutcome: false },
						{ name: "native-http", ok: false, kind: "http", credentialInOutcome: false },
						{ name: "native-parse", ok: false, kind: "parse", credentialInOutcome: false },
						{ name: "pi-parse", ok: false, kind: "parse", credentialInOutcome: false },
					],
				});
				// The only line the adapter writes: the one-time notice, by variable name.
				const stderrLines = run.stderr.split("\n").filter((line) => line.trim().length > 0);
				expect({ ambient, stderrLines }).toEqual({ ambient, stderrLines: kept ? [] : [BAML_LOG_NORMALIZED_NOTICE] });
			}
		},
		60_000,
	);
});
