import { describe, expect, test } from "bun:test";

import type {
	PromptLabSessionController,
	PromptLabSessionSnapshot,
} from "./prompt-lab-session-controller";
import {
	loadPromptLabSession,
	promptLabSessionPresentation,
} from "./prompt-lab-session-mode";

function snapshot(
	overrides: Partial<PromptLabSessionSnapshot> = {},
): PromptLabSessionSnapshot {
	return {
		annotationsLoaded: false,
		annotations: [],
		annotationsHash: null,
		openRequestCount: 0,
		session: null,
		sessionStarting: false,
		...overrides,
	};
}

function controllerWithAnnotationsFailure() {
	let annotationsRequests = 0;
	const annotationsError = "annotations request failed (404)";
	const controller = {
		async load() {
			annotationsRequests += 1;
		},
		labSession() {
			return null;
		},
	} as PromptLabSessionController;
	return { controller, annotationsError, requests: () => annotationsRequests };
}

describe("prompt lab session mode", () => {
	test("read-only supplied-data mode skips annotations and hides its error", async () => {
		const fake = controllerWithAnnotationsFailure();
		await loadPromptLabSession(fake.controller, false);

		expect(fake.requests()).toBe(0);
		expect(
			promptLabSessionPresentation(
				fake.controller,
				snapshot({ annotationsError: fake.annotationsError }),
				false,
			),
		).toEqual({ showSessionStrip: false });
	});

	test("editable mode still loads annotations and shows endpoint errors", async () => {
		const fake = controllerWithAnnotationsFailure();
		await loadPromptLabSession(fake.controller, true);

		expect(fake.requests()).toBe(1);
		expect(
			promptLabSessionPresentation(
				fake.controller,
				snapshot({ annotationsError: fake.annotationsError }),
				true,
			),
		).toEqual({
			showSessionStrip: true,
			stripError: fake.annotationsError,
		});
	});
});
