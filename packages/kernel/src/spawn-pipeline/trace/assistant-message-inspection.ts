export interface AssistantMessageSessionLike {
	messages: any[];
}

function extractText(content: unknown[]): string {
	return content
		.filter((c: any) => c.type === "text")
		.map((c: any) => c.text ?? "")
		.join("\n");
}

export function getLastAssistantText(session: AssistantMessageSessionLike): string {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const msg = session.messages[i];
		if (msg.role !== "assistant") continue;
		const text = extractText((msg.content ?? []) as unknown[]).trim();
		if (text) return text;
	}
	return "";
}

export function getLastAssistantError(
	session: AssistantMessageSessionLike,
): { errorMessage: string } | null {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const msg = session.messages[i];
		if (msg.role !== "assistant") continue;
		if ((msg as any).stopReason === "error") {
			const errorMessage = (msg as any).errorMessage ?? "LLM turn failed";
			return { errorMessage };
		}
		return null;
	}
	return null;
}

export const _test_getLastAssistantError = getLastAssistantError;
