/**
 * Native request and retry cancellation with the REAL BAML module (plan
 * §4.6): a `kernel.call` through `bamlEngine` against a local mock provider
 * stops its in-flight request when the caller aborts, stops a pending retry
 * when the caller aborts or the operation deadline fires during backoff, and
 * records the run aborted. A control run shows the retry policy does retry
 * when nothing cancels it.
 *
 * Nothing under packages/ may load BAML, so the child script lives in the
 * git-ignored spike (`.work/model-nodes/spikes/baml-bun/src/kernel-cancel-child.ts`)
 * and runs `__fixtures__/cancel-scenarios.ts` by absolute path. When the
 * spike is absent (a fresh checkout) the test is skipped with a printed reason.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import type { CancelScenarioResult } from "./__fixtures__/cancel-scenarios";

const REPO_ROOT = resolve(import.meta.dir, "../../../../..");
const SPIKE = join(REPO_ROOT, ".work/model-nodes/spikes/baml-bun");
const CHILD = join(SPIKE, "src/kernel-cancel-child.ts");
const SCENARIOS = join(import.meta.dir, "__fixtures__/cancel-scenarios.ts");

const missing = [
	CHILD,
	join(SPIKE, "node_modules/@boundaryml/baml/package.json"),
	join(SPIKE, "baml_client/index.ts"),
].filter((path) => !existsSync(path));
if (missing.length > 0) {
	console.warn(`skipping the BAML cancellation subprocess test: missing ${missing.join(", ")}`);
}

describe("BAML native cancellation (real module, subprocess)", () => {
	test.skipIf(missing.length > 0)(
		"an abort during the request or the retry backoff, and the deadline during backoff, stop BAML and end the run aborted",
		async () => {
			// No inherited credentials or BAML settings.
			const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
			if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
			const child = Bun.spawn([process.execPath, CHILD, SCENARIOS], { cwd: SPIKE, env, stdout: "pipe", stderr: "pipe" });
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
			if (!line) throw new Error(`child printed no RESULT line (exit ${code}): ${stderr.slice(0, 2_000)}`);
			expect(code).toBe(0);
			const results = JSON.parse(line.slice("RESULT ".length)) as CancelScenarioResult[];
			const byName = Object.fromEntries(results.map((r) => [r.name, r]));

			// The policy retries a 500 once when nothing cancels it.
			expect(byName["retry-control"]).toMatchObject({ outcome: "http", runStatus: "error", requests: 2, doctorOk: true });

			// Abort while BAML's request is in flight: the connection closes, nothing is retried.
			expect(byName["abort-during-request"]).toMatchObject({
				outcome: "aborted",
				runStatus: "aborted",
				endStatus: "aborted",
				endKind: "aborted",
				requests: 1,
				clientClosed: true,
				doctorOk: true,
			});

			// Abort and deadline while the retry policy waits: the retry never goes out.
			expect(byName["abort-during-backoff"]).toMatchObject({
				outcome: "aborted",
				runStatus: "aborted",
				endStatus: "aborted",
				endKind: "aborted",
				requests: 1,
				doctorOk: true,
			});
			expect(byName["deadline-during-backoff"]).toMatchObject({
				outcome: "timeout",
				runStatus: "aborted",
				endStatus: "aborted",
				endKind: "timeout",
				requests: 1,
				doctorOk: true,
			});

			for (const name of ["abort-during-request", "abort-during-backoff", "deadline-during-backoff"]) {
				expect({ name, bounded: byName[name]!.settleMs < 1_000 }).toEqual({ name, bounded: true });
			}
		},
		60_000,
	);
});
