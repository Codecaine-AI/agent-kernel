import type { KernelSessionManagerLike, ResumeToolResultInput } from "../types";
import { findAskCallEntryId } from "./ask-call-entry-lookup";

function hasRealToolResultOnBranch(
	manager: Pick<KernelSessionManagerLike, "getBranch">,
	toolUseId: string,
): boolean {
	for (const entry of manager.getBranch()) {
		if (entry.type !== "message") continue;
		const msg: any = (entry as any).message;
		if (!msg || msg.role !== "toolResult" || msg.toolCallId !== toolUseId) continue;
		const text = Array.isArray(msg.content)
			? msg.content.map((c: any) => (c?.type === "text" ? c.text ?? "" : "")).join("")
			: "";
		if (text !== "[awaiting user answer]") return true;
	}
	return false;
}

export function appendResumeToolResult(
	manager: KernelSessionManagerLike,
	r: ResumeToolResultInput,
): void {
	if (hasRealToolResultOnBranch(manager, r.toolUseId)) return;
	if (r.contentBlocks && r.contentBlocks.length === 0) {
		throw new Error("kernel resume: contentBlocks must be non-empty when provided");
	}
	const askCallEntryId = findAskCallEntryId(manager, r.toolUseId);
	if (!askCallEntryId) {
		throw new Error(
			`kernel resume: no assistant entry found carrying ask toolCall ${r.toolUseId}`,
		);
	}
	manager.branch(askCallEntryId);
	manager.appendMessage({
		role: "toolResult",
		toolCallId: r.toolUseId,
		toolName: r.toolName,
		content: r.contentBlocks ?? [{ type: "text", text: r.content }],
		isError: false,
		timestamp: Date.now(),
	});
}

export const _test_appendResumeToolResult = appendResumeToolResult;
