/**
 * State fixture discovery — the `state/fixtures/` bundle directory.
 *
 * A bundle may ship named state fixtures for the lab's State view:
 *
 *   catalog/<agent>/
 *     state/fixtures/<id>.json    { label?, variables?, state? }
 *
 * A fixture names a hypothetical run: `variables` overlay the manifest
 * variable defaults for the preview's SpawnContext, `state` seeds the
 * bundle's state module (or pretty-prints as-is when the bundle ships none).
 * Fixtures are preview data only — the spawn pipeline never consults them —
 * so discovery reads on demand instead of caching at registry boot, which is
 * also what keeps a fixture edit visible on the next request without a
 * restart (the prompt disk-freshness idiom, minus the hashing).
 *
 * A file that fails to parse or is not shaped like a fixture object is
 * skipped silently (the preview idiom: degrade, never take down the detail
 * route).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const FIXTURES_DIR_NAME = "state/fixtures";

export interface AgentStateFixture {
	/** Filename sans `.json` — the wire id and the default label. */
	id: string;
	/** The fixture's `label`, defaulting to the id. */
	label: string;
	/** Overlay onto manifest variable defaults for the preview SpawnContext. */
	variables: Record<string, unknown>;
	/**
	 * True when the fixture file carries a `state` key at all — `null` is a
	 * legal fixture state, so presence cannot be read off the value.
	 */
	hasState: boolean;
	state: unknown;
	/** Absolute path of the fixture file. */
	filePath: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read every well-formed `state/fixtures/*.json` of one bundle directory,
 * sorted by id. An absent `state/fixtures/` directory and a directory with no
 * parseable fixture both answer `[]`.
 */
export function discoverStateFixtures(bundleDir: string): AgentStateFixture[] {
	const fixturesDir = join(bundleDir, FIXTURES_DIR_NAME);
	if (!existsSync(fixturesDir)) return [];

	const fixtures: AgentStateFixture[] = [];
	for (const entry of readdirSync(fixturesDir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
		const filePath = join(fixturesDir, entry.name);
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(filePath, "utf8"));
		} catch {
			continue;
		}
		if (!isPlainObject(parsed)) continue;
		if (parsed.variables !== undefined && !isPlainObject(parsed.variables)) {
			continue;
		}
		const id = entry.name.slice(0, -".json".length);
		fixtures.push({
			id,
			label: typeof parsed.label === "string" && parsed.label !== "" ? parsed.label : id,
			variables: isPlainObject(parsed.variables) ? parsed.variables : {},
			hasState: "state" in parsed,
			state: parsed.state,
			filePath,
		});
	}
	return fixtures.sort((a, b) => a.id.localeCompare(b.id));
}
