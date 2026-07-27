/**
 * Turn the captured real turn-context JSON into the viewer-ui fixture module.
 * Run after e2e.ts: bun spikes/state-three-section-e2e/emit-fixture.ts
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const spikeDir = import.meta.dir;
const repoRoot = resolve(spikeDir, "../..");
// Machine-specific absolute paths (the system prompt's cwd line) are the one
// thing normalized — nothing else is touched.
const capturedRaw = readFileSync(
	join(spikeDir, "captured-turn-context.json"),
	"utf8",
).replaceAll(repoRoot, "<repo>");
const captured = JSON.parse(capturedRaw) as Record<string, unknown>;

const out = `/**
 * real-turn-context.ts — a REAL captured turn, not a hand-written fixture.
 *
 * Produced by spikes/state-three-section-e2e/e2e.ts: a kernel-spawned agent
 * with the state extension active (manifest \`state.window\`, base module) run
 * against an in-memory provider, then read back through
 * kernel.readApiService.getRunTurnContext(runId, 0) — the same shape the
 * viewer fetches from GET /kernel/runs/:runId/turns/:n/context.
 *
 * It is the fourth prompt on one reused pi session with a 2-turn window, so
 * section ③ opens with the kernel's elision marker and the tail is the two
 * turns that survived the cut. Regenerate with:
 *
 *   bun spikes/state-three-section-e2e/e2e.ts
 *   bun spikes/state-three-section-e2e/emit-fixture.ts
 */
import type { RunTurnContextResponse } from "../request-snapshot-api";

export const realTurnContext: RunTurnContextResponse = ${JSON.stringify(captured, null, "\t").replace(/\n/g, "\n")} as RunTurnContextResponse;
`;

const target = join(
	repoRoot,
	"packages/viewer-ui/src/trace-viewer/detail-panel/renderers/__fixtures__/real-turn-context.ts",
);
await Bun.write(target, out);
console.log(`wrote ${target}`);
