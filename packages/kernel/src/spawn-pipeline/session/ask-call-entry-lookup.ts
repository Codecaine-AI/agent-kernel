import type { KernelSessionManagerLike } from "../types";

export function findAskCallEntryId(
	manager: Pick<KernelSessionManagerLike, "getEntries">,
	toolUseId: string,
): string | null {
	for (const entry of manager.getEntries()) {
		if (entry.type !== "message") continue;
		const msg: any = (entry as any).message;
		if (!msg || msg.role !== "assistant") continue;
		const content: any[] = Array.isArray(msg.content) ? msg.content : [];
		for (const item of content) {
			if (item && item.type === "toolCall" && item.id === toolUseId) {
				return entry.id;
			}
		}
	}
	return null;
}

export const _test_findAskCallEntryId = findAskCallEntryId;
