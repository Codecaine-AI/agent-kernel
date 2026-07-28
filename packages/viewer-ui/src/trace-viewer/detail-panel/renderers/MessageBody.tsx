import { readStringAttr } from "../../span-style";
import type { DetailView } from "../contract";
import { CLAMP } from "../doc-figure/clamp";
import type { RendererProps } from "../types";

export function MessageBody({ span }: RendererProps): DetailView {
	const eventType = readStringAttr(span, "event_type") ?? span.type;
	const isAssistant = eventType === "assistant_message";
	const role = isAssistant ? "Assistant" : "User";
	const text = (isAssistant ? span.output : span.input) ?? span.output ?? span.input ?? "";

	return {
		blocks: [
			{
				id: "message",
				slot: "content",
				caption: `${role} message`,
				clamp: CLAMP.block,
				node: (
					<p className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
						{text || "Empty message."}
					</p>
				),
			},
		],
	};
}
