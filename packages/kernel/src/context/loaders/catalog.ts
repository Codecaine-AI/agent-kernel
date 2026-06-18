/**
 * catalog.ts — In-memory LoaderCatalog registry + shared hashContent helper.
 *
 * Pure module: zero I/O, zero loader imports. Individual loader modules import
 * hashContent from here to keep LoaderResult.hash consistent across kinds.
 */

import { createHash } from "node:crypto";

import type { Loader } from "./types";

export class UnknownLoaderKindError extends Error {
	readonly kind: string;

	constructor(kind: string) {
		super(`Unknown loader kind: ${kind}`);
		this.name = "UnknownLoaderKindError";
		this.kind = kind;
	}
}

export interface LoaderCatalog {
	register(loader: Loader): void;
	get(kind: string): Loader;
	tryGet(kind: string): Loader | null;
	has(kind: string): boolean;
	list(): string[];
}

export function createLoaderCatalog(): LoaderCatalog {
	const loaders = new Map<string, Loader>();

	return {
		register(loader) {
			if (loaders.has(loader.kind)) {
				throw new Error(
					`Loader for kind "${loader.kind}" is already registered`,
				);
			}
			loaders.set(loader.kind, loader);
		},
		get(kind) {
			const loader = loaders.get(kind);
			if (!loader) throw new UnknownLoaderKindError(kind);
			return loader;
		},
		tryGet(kind) {
			return loaders.get(kind) ?? null;
		},
		has(kind) {
			return loaders.has(kind);
		},
		list() {
			return Array.from(loaders.keys()).sort();
		},
	};
}

export function hashContent(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}
