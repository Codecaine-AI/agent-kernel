import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { sha256Hex } from "./sha256";

function reference(input: string): string {
	return createHash("sha256").update(input, "utf8").digest("hex");
}

describe("sha256Hex", () => {
	test("matches node:crypto across padding and content edge cases", () => {
		const vectors = [
			"",
			"abc",
			"a".repeat(55), // fits with padding in one block
			"a".repeat(56), // forces a second block
			"a".repeat(63),
			"a".repeat(64), // exactly one block of data
			"a".repeat(65),
			"a".repeat(1000),
			"session-uuid\nentry-id\n3\ntool_call_start",
			"unicode: 日本語 🚀 émoji \n\t mixed",
		];
		for (const v of vectors) {
			expect(sha256Hex(v)).toBe(reference(v));
		}
	});
});
