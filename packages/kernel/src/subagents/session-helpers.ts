import type { KernelAgentSession } from "./types";

export function extractText(content: unknown[]): string {
	return content
		.filter((c: any) => c.type === "text")
		.map((c: any) => c.text ?? "")
		.join("\n");
}

export function getAgentConversation(session: KernelAgentSession): string {
	const parts: string[] = [];

	for (const msg of session.messages) {
		if (msg.role === "user") {
			const text =
				typeof msg.content === "string"
					? msg.content
					: extractText(msg.content);
			if (text.trim()) parts.push(`[User]: ${text.trim()}`);
		} else if (msg.role === "assistant") {
			const textParts: string[] = [];
			const toolCalls: string[] = [];
			for (const c of msg.content as any[]) {
				if (c.type === "text" && c.text) textParts.push(c.text);
				else if (c.type === "toolCall")
					toolCalls.push(`  Tool: ${c.name ?? c.toolName ?? "unknown"}`);
			}
			if (textParts.length > 0)
				parts.push(`[Assistant]: ${textParts.join("\n")}`);
			if (toolCalls.length > 0)
				parts.push(`[Tool Calls]:\n${toolCalls.join("\n")}`);
		} else if ((msg as any).role === "toolResult") {
			const text = extractText((msg as any).content);
			const truncated =
				text.length > 200 ? text.slice(0, 200) + "..." : text;
			parts.push(
				`[Tool Result (${(msg as any).toolName})]: ${truncated}`,
			);
		}
	}

	return parts.join("\n\n");
}

export async function steerAgent(
	session: KernelAgentSession,
	message: string,
): Promise<void> {
	await session.steer(message);
}
