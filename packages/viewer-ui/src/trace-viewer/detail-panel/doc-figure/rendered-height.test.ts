/**
 * rendered-height.test — the content measurement without a layout engine.
 * Stub layout metrics stand in for the browser's, and a stand-in
 * ResizeObserver delivers the notifications the browser would after layout.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { observeRenderedHeight } from "./rendered-height";

interface StubContent {
	clientWidth: number;
	scrollHeight: number;
}

class StandInResizeObserver {
	static latest: StandInResizeObserver | undefined;
	readonly observed: StubContent[] = [];
	disconnected = false;

	constructor(private readonly callback: ResizeObserverCallback) {
		StandInResizeObserver.latest = this;
	}

	observe(target: StubContent): void {
		this.observed.push(target);
	}

	unobserve(): void {}

	disconnect(): void {
		this.disconnected = true;
	}

	/** The browser's notification after layout resized an observed element. */
	resized(): void {
		const entries = this.observed.map((target) => ({
			target,
			contentRect: { width: target.clientWidth, height: target.scrollHeight },
		}));
		this.callback(
			entries as unknown as ResizeObserverEntry[],
			this as unknown as ResizeObserver,
		);
	}
}

const globals = globalThis as { ResizeObserver?: unknown };
const platformResizeObserver = globals.ResizeObserver;

afterEach(() => {
	globals.ResizeObserver = platformResizeObserver;
});

describe("observeRenderedHeight", () => {
	test("re-measures on each resize and skips content with no layout", () => {
		globals.ResizeObserver = StandInResizeObserver;
		const content: StubContent = { clientWidth: 640, scrollHeight: 300 };
		const heights: number[] = [];

		const disconnect = observeRenderedHeight(
			content as unknown as HTMLElement,
			(heightPx) => heights.push(heightPx),
		);
		const observer = StandInResizeObserver.latest!;
		expect(observer.observed).toEqual([content]);

		// The panel narrows: the paragraph re-wraps from 300px to 900px.
		content.clientWidth = 320;
		content.scrollHeight = 900;
		observer.resized();
		// Its tab is hidden: no layout box, so nothing is reported.
		content.clientWidth = 0;
		content.scrollHeight = 0;
		observer.resized();
		expect(heights).toEqual([900]);

		disconnect();
		expect(observer.disconnected).toBe(true);
	});
});
