import type { DetailBlockSpec } from "../../contract";
import { PRIMARY_FIGURE_CLAMP } from "../primary-figure";

export interface SystemPromptSectionProps {
	systemPrompt: string | null;
	id?: string;
	/** Section markers are only emitted for tagged, three-section snapshots. */
	tagged?: boolean;
	order?: number;
}

/** Section ① as contract data. The shell supplies all framing and controls. */
export function SystemPromptSection({
	systemPrompt,
	id = "turn:system",
	tagged = true,
	order = 10,
}: SystemPromptSectionProps): DetailBlockSpec[] {
	const body = systemPrompt ?? "No system prompt captured for this turn.";
	return [
		{
			id,
			slot: "content",
			caption: "System prompt",
			body,
			language: "prompt",
			// Named, not inherited: this section is also opened standalone by a
			// system_prompt_resolved span, and the document must read the same
			// way in both places.
			clamp: PRIMARY_FIGURE_CLAMP,
			order,
			...(tagged ? { turnSection: "system" as const } : {}),
		},
	];
}
