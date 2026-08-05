/**
 * state-fixtures.test.ts — `state/fixtures/*.json` discovery: id/label defaulting,
 * variables/state carriage, sorted order, and the degrade paths (no fixtures
 * directory, malformed JSON, non-object shapes) that keep the preview surface
 * from ever failing a detail route.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { discoverStateFixtures, FIXTURES_DIR_NAME } from "./state-fixtures";

function tempBundle(): string {
	return mkdtempSync(join(import.meta.dir, ".state-fixtures-test-"));
}

function writeFixture(bundleDir: string, name: string, content: string): void {
	const dir = join(bundleDir, FIXTURES_DIR_NAME);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), content, "utf8");
}

describe("state fixture discovery", () => {
	test("a bundle with no state/fixtures/ directory answers an empty list", () => {
		const dir = tempBundle();
		try {
			expect(discoverStateFixtures(dir)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("fixtures list sorted by id with label defaulting and payload carriage", () => {
		const dir = tempBundle();
		try {
			writeFixture(
				dir,
				"mid-session.json",
				JSON.stringify({
					label: "Mid session",
					variables: { focus: "protocols" },
					state: { turns: 7 },
				}),
			);
			writeFixture(dir, "empty-run.json", JSON.stringify({}));

			const fixtures = discoverStateFixtures(dir);
			expect(fixtures.map((fixture) => fixture.id)).toEqual([
				"empty-run",
				"mid-session",
			]);

			const [emptyRun, midSession] = fixtures;
			// No label → the id doubles as the label; no state key → hasState false.
			expect(emptyRun.label).toBe("empty-run");
			expect(emptyRun.variables).toEqual({});
			expect(emptyRun.hasState).toBe(false);

			expect(midSession.label).toBe("Mid session");
			expect(midSession.variables).toEqual({ focus: "protocols" });
			expect(midSession.hasState).toBe(true);
			expect(midSession.state).toEqual({ turns: 7 });
			expect(midSession.filePath.endsWith("mid-session.json")).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a fixture whose state is null still counts as carrying one", () => {
		const dir = tempBundle();
		try {
			writeFixture(dir, "null-state.json", JSON.stringify({ state: null }));
			const [fixture] = discoverStateFixtures(dir);
			expect(fixture.hasState).toBe(true);
			expect(fixture.state).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("malformed and mis-shaped fixture files are skipped silently", () => {
		const dir = tempBundle();
		try {
			writeFixture(dir, "broken.json", "{ not json");
			writeFixture(dir, "array.json", "[1, 2]");
			writeFixture(dir, "bad-variables.json", JSON.stringify({ variables: 4 }));
			writeFixture(dir, "notes.txt", "not a fixture");
			writeFixture(dir, "good.json", JSON.stringify({ label: "Good" }));

			const fixtures = discoverStateFixtures(dir);
			expect(fixtures.map((fixture) => fixture.id)).toEqual(["good"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
