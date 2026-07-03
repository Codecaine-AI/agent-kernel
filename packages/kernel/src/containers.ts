/**
 * Container identity — deterministic, idempotent container derivation.
 *
 * Containers are the kernel's single grouping primitive (see
 * docs/10-system-design/15-identity-model.md). Identity is derived, never
 * minted: the same (kernelId, kind, key) always yields the same container id,
 * so host apps never hash or persist their own grouping ids.
 *
 *   containerId = uuidv5(kernelNamespace(kernelId), `${kind}\n${key.join("\n")}`)
 *   kernelNamespace(kernelId) = uuidv5(AGENT_KERNEL_ROOT_NAMESPACE, kernelId)
 */

import { createHash } from "node:crypto";

import { upsertContainer, type Container, type KernelDatabase } from "@agent-kernel/db";

/**
 * Root namespace for all agent-kernel UUIDv5 derivation. Fixed forever —
 * changing it would re-identify every container in every kernel database.
 */
export const AGENT_KERNEL_ROOT_NAMESPACE =
	"7ba9e01c-96b2-4f0e-8f2b-1d3a5c7e9f04";

function uuidToBytes(uuid: string): Uint8Array {
	const hex = uuid.replace(/-/g, "");
	if (hex.length !== 32 || /[^0-9a-fA-F]/.test(hex)) {
		throw new Error(`invalid UUID: ${uuid}`);
	}
	const bytes = new Uint8Array(16);
	for (let i = 0; i < 16; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
	const hex: string[] = [];
	for (let i = 0; i < 16; i++) {
		hex.push(bytes[i].toString(16).padStart(2, "0"));
	}
	return [
		hex.slice(0, 4).join(""),
		hex.slice(4, 6).join(""),
		hex.slice(6, 8).join(""),
		hex.slice(8, 10).join(""),
		hex.slice(10, 16).join(""),
	].join("-");
}

/**
 * RFC 4122 UUIDv5: SHA-1 over (namespace bytes + name bytes), truncated to
 * 128 bits with the version (5) and variant (10x) bits set.
 */
export function uuidv5(namespace: string, name: string): string {
	const digest = createHash("sha1")
		.update(uuidToBytes(namespace))
		.update(Buffer.from(name, "utf8"))
		.digest();
	const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);
	bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
	return bytesToUuid(bytes);
}

/** Per-kernel derivation namespace. */
export function kernelNamespace(kernelId: string): string {
	return uuidv5(AGENT_KERNEL_ROOT_NAMESPACE, kernelId);
}

/**
 * Deterministic container id from (kernelId, kind, key). The name is the
 * JSON encoding of [kind, ...key], which is unambiguous for any segment
 * content — ["a","b"] and ["a\nb"] derive different ids.
 */
export function deriveContainerId(
	kernelId: string,
	kind: string,
	key: string[],
): string {
	return uuidv5(kernelNamespace(kernelId), JSON.stringify([kind, ...key]));
}

/** Spec accepted by kernel.container(). Kind/key vocabulary is app-defined. */
export interface KernelContainerSpec {
	kind: string;
	key: string[];
	/** Parent container (row or id) for tree grouping. */
	parent?: string | { id: string };
	label?: string;
	phase?: string;
	phaseVocabulary?: string[];
	workingDir?: string;
	/** Opaque to the kernel. */
	metadata?: Record<string, unknown>;
}

export type KernelContainerApi = (spec: KernelContainerSpec) => Promise<Container>;

/**
 * Build the kernel.container() upsert bound to one kernel id + database.
 * Same (kind, key) always resolves to the same container row.
 */
export function createContainerApi(deps: {
	kernelId: string;
	db: KernelDatabase | undefined;
}): KernelContainerApi {
	return async function container(spec: KernelContainerSpec): Promise<Container> {
		if (!deps.db) {
			throw new Error(
				"kernel.container() requires a database — pass `db` to createKernel " +
					"(e.g. openKernelDatabase({ path: kernelDatabasePath(rootDir) }).db)",
			);
		}
		if (!spec.kind) throw new Error("kernel.container() requires spec.kind");
		if (!Array.isArray(spec.key) || spec.key.length === 0) {
			throw new Error("kernel.container() requires a non-empty spec.key array");
		}
		const id = deriveContainerId(deps.kernelId, spec.kind, spec.key);
		const parentContainerId =
			typeof spec.parent === "string" ? spec.parent : spec.parent?.id;
		return upsertContainer(deps.db, {
			id,
			kernelId: deps.kernelId,
			kind: spec.kind,
			appKey: spec.key,
			label: spec.label,
			parentContainerId,
			phase: spec.phase,
			phaseVocabulary: spec.phaseVocabulary,
			workingDir: spec.workingDir,
			metadata: spec.metadata,
		});
	};
}
