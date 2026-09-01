import type { PromptEditSession } from "@codecaine-ai/prompt-kit/ui/lab";

import type {
	PromptLabSessionController,
	PromptLabSessionSnapshot,
} from "./prompt-lab-session-controller";

export interface PromptLabSessionPresentation {
	promptEditSession?: PromptEditSession;
	showSessionStrip: boolean;
	stripError?: string;
}

/** Load annotation/session state only when the host enables prompt editing. */
export async function loadPromptLabSession(
	controller: PromptLabSessionController,
	editable: boolean,
): Promise<void> {
	if (!editable) return;
	await controller.load();
}

/** Keep all prompt-edit state out of a read-only lab. */
export function promptLabSessionPresentation(
	controller: PromptLabSessionController,
	snapshot: PromptLabSessionSnapshot,
	editable: boolean,
): PromptLabSessionPresentation {
	if (!editable) {
		return { showSessionStrip: false };
	}

	const promptEditSession = controller.labSession() ?? undefined;
	const showSessionStrip =
		snapshot.session !== null ||
		snapshot.sessionStarting ||
		snapshot.sessionError !== undefined ||
		snapshot.annotationsError !== undefined ||
		snapshot.streamError !== undefined;
	const stripError =
		snapshot.sessionError ??
		snapshot.annotationsError ??
		(snapshot.streamError !== undefined
			? `Event stream dropped (${snapshot.streamError}) — reviews still work.`
			: undefined);

	return {
		...(promptEditSession !== undefined ? { promptEditSession } : {}),
		showSessionStrip,
		...(stripError !== undefined ? { stripError } : {}),
	};
}
