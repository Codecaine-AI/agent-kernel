import { describe, expect, test } from "bun:test";
import { KERNEL_CATALOG_PATHS } from "./api";

describe("KERNEL_CATALOG_PATHS", () => {
	test("builds and encodes the revision document path", () => {
		expect(KERNEL_CATALOG_PATHS.revisionDocument("research/agent", "pk1-a+b")).toBe(
			"/kernel/catalog/agents/research%2Fagent/revisions/pk1-a%2Bb/document",
		);
	});
});
