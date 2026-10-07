/**
 * generate-fixture --check writes nothing: not the fixture JSON, not
 * routes.json, and not a database passed with --db.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = join(import.meta.dir, "generate-fixture.ts");
const REPO_ROOT = resolve(import.meta.dir, "../../../..");

describe("generate-fixture --check", () => {
	it("reports stale files and leaves them, and a supplied --db, untouched", () => {
		const dir = mkdtempSync(join(tmpdir(), "mn-check-"));
		try {
			const db = join(dir, "kept.db");
			const json = join(dir, "fixture.json");
			const routes = join(dir, "routes.json");
			writeFileSync(db, "sentinel db");
			writeFileSync(json, "stale json");
			writeFileSync(routes, "stale routes");

			const result = Bun.spawnSync(
				[process.execPath, SCRIPT, "--check", "--db", db, "--json", json, "--routes", routes],
				{ cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" },
			);

			expect(result.exitCode).toBe(1);
			expect(result.stderr.toString()).toContain(`stale: ${json}`);
			expect(readFileSync(db, "utf8")).toBe("sentinel db");
			expect(readFileSync(json, "utf8")).toBe("stale json");
			expect(readFileSync(routes, "utf8")).toBe("stale routes");
			expect(readdirSync(dir).sort()).toEqual(["fixture.json", "kept.db", "routes.json"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 60_000);
});
