import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import type { PromptSaveOutcome } from "@codecaine-ai/prompt-kit/ui/lab";
import {
	KERNEL_CATALOG_PATHS,
	type CatalogPromptSaveResult,
	type PromptRevisionDocumentResponse,
} from "@agent-kernel/viewer-core";

type CatalogFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface CatalogPromptConflictResponse {
	currentHash: string;
}

export async function loadPromptRevisionDocument(
	origin: string,
	agentName: string,
	hash: string,
	fetchImpl: CatalogFetch = fetch,
): Promise<PromptRevisionDocumentResponse> {
	const response = await fetchImpl(
		`${origin}${KERNEL_CATALOG_PATHS.revisionDocument(agentName, hash)}`,
	);
	if (!response.ok) {
		throw new Error(`revision document request failed (${response.status})`);
	}
	return (await response.json()) as PromptRevisionDocumentResponse;
}

export async function savePromptDocument(
	origin: string,
	agentName: string,
	document: PromptDocument,
	expectedHash: string | undefined,
	fetchImpl: CatalogFetch = fetch,
): Promise<PromptSaveOutcome> {
	const response = await fetchImpl(`${origin}${KERNEL_CATALOG_PATHS.agentPrompt(agentName)}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ document, expectedHash }),
	});
	const body = (await response.json()) as
		| CatalogPromptSaveResult
		| CatalogPromptConflictResponse;

	if (response.status === 409 && "currentHash" in body) {
		return {
			errors: [
				`Save conflict: this prompt changed on the server (current revision ${body.currentHash}). Reload the agent before saving again.`,
			],
		};
	}
	if (response.ok && "hash" in body) {
		return { hash: body.hash };
	}
	if ("errors" in body && Array.isArray(body.errors)) {
		return { errors: body.errors };
	}
	return { errors: [`Save failed (${response.status})`] };
}
