import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import { MessageBody } from "./MessageBody";

function span(eventType: string, value: string): TraceSpan {
	return {
		id: eventType,
		title: eventType,
		startTime: new Date(0),
		endTime: new Date(1),
		duration: 1,
		type: "event",
		raw: "{}",
		status: "success",
		input: eventType === "user_message" ? value : undefined,
		output: eventType === "assistant_message" ? value : undefined,
		attributes: [
			{ key: "event_type", value: { stringValue: eventType } },
			{
				key: eventType === "user_message" ? "phase" : "block_type",
				value: { stringValue: eventType === "user_message" ? "kickoff" : "text" },
			},
		],
	};
}

describe("MessageBody", () => {
	test("renders user and assistant messages as prose content blocks", () => {
		const user = MessageBody({ span: span("user_message", "Please inspect this.") });
		const assistant = MessageBody({ span: span("assistant_message", "Done.\nNext line.") });

		expect(user.blocks?.[0]).toMatchObject({
			caption: "User message",
		});
		expect(assistant.blocks?.[0]).toMatchObject({
			caption: "Assistant message",
		});
		expect("meta" in (user.blocks?.[0] ?? {})).toBe(false);
		expect("meta" in (assistant.blocks?.[0] ?? {})).toBe(false);
		for (const view of [user, assistant]) {
			const blocks = view.blocks ?? [];
			expect(blocks).toHaveLength(1);
			expect(blocks[0]?.slot).toBe("content");
			const markup = renderToStaticMarkup(<>{blocks[0]?.node}</>);
			expect(markup).toContain("leading-7");
			expect(markup).not.toContain("font-mono");
		}
	});
});
