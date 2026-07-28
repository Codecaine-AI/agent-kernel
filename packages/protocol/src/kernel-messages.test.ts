import { describe, expect, test } from "bun:test";

import {
	IMAGE_ELISION_MARKER_PREFIX,
	imageElisionMarkerText,
	isImageElisionMarker,
} from "./kernel-messages";

describe("image elision marker", () => {
	test("shares one full-value envelope between producer and consumers", () => {
		const marker = imageElisionMarkerText("image/png, 79.7 KB");

		expect(marker).toBe("[image elided — image/png, 79.7 KB]");
		expect(isImageElisionMarker(marker)).toBe(true);
		expect(isImageElisionMarker(`${marker} trailing prose`)).toBe(false);
		expect(isImageElisionMarker(`prefix ${marker}`)).toBe(false);
		expect(
			isImageElisionMarker(`${IMAGE_ELISION_MARKER_PREFIX}image/png\n79.7 KB]`),
		).toBe(false);
	});
});
