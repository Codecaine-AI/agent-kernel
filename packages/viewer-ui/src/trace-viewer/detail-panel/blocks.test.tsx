/**
 * blocks.test — the detail-block seam's ordering and failure guarantees.
 *
 * Static rendering exercises the public provider and presenter together,
 * which also proves that hosts can contribute blocks without browser APIs.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import {
	DetailBlocksProvider,
	type DetailBlockProvider,
	useDetailBlocks,
} from "./blocks";

const SPAN: TraceSpan = {
	id: "span-1",
	title: "A span",
	startTime: new Date("2026-07-27T12:00:00.000Z"),
	endTime: new Date("2026-07-27T12:00:00.010Z"),
	duration: 10,
	type: "event",
	raw: "{}",
	status: "success",
};

function ResolvedBlocks({ span }: { span: TraceSpan }) {
	const blocks = useDetailBlocks(span);
	return (
		<>
			{blocks.map((block) => (
				<span key={block.id} data-id={block.id} data-slot={block.slot}>
					{block.caption}
				</span>
			))}
		</>
	);
}

function render(provider: DetailBlockProvider | null): string {
	return renderToStaticMarkup(
		<DetailBlocksProvider provider={provider}>
			<ResolvedBlocks span={SPAN} />
		</DetailBlocksProvider>,
	);
}

describe("detail blocks", () => {
	test("sorts by vocabulary slot, order, then id", () => {
		const markup = render(() => [
			{ id: "z", slot: "content", order: 2, caption: "Last", node: "Z" },
			{ id: "lead", slot: "input", order: -1, caption: "Lead", node: "LEAD" },
			{ id: "b", slot: "content", caption: "Bee", node: "B" },
			{ id: "a", slot: "content", caption: "Aye", node: "A" },
		]);

		expect(markup.indexOf('data-id="lead"')).toBeLessThan(
			markup.indexOf('data-id="a"'),
		);
		expect(markup.indexOf('data-id="a"')).toBeLessThan(
			markup.indexOf('data-id="b"'),
		);
		expect(markup.indexOf('data-id="b"')).toBeLessThan(
			markup.indexOf('data-id="z"'),
		);
	});

	test("keeps the first block when ids are duplicated", () => {
		const markup = render(() => [
			{ id: "same", slot: "content", caption: "FIRST", node: "first" },
			{ id: "same", slot: "content", order: -100, caption: "SECOND", node: "second" },
		]);

		expect(markup).toContain("FIRST");
		expect(markup).not.toContain("SECOND");
	});

	test("renders nothing without a provider", () => {
		expect(render(null)).toBe("");
	});

	test("renders nothing when a provider throws", () => {
		expect(
			render(() => {
				throw new Error("optional host failure");
			}),
		).toBe("");
	});
});
