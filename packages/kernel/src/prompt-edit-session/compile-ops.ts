/**
 * prompt-edit-session/compile-ops — the semantic-ops → steps compiler.
 *
 * The tool boundary is ID-RELATIVE (update_node / insert_after / insert_into /
 * remove_node / move_after); prompt-kit steps are PATH-based (insert/remove/
 * move) or id-based (update). This module compiles an op list against the
 * session's CURRENT working document into `PromptStep[]`, resolving node ids
 * to paths at compile time, op by op — later ops see the document produced by
 * earlier ones, so an op may reference a node inserted two ops earlier.
 *
 * Unknown ids and structural misuse come back as typed `PromptEditOpError`s;
 * compilation aborts at the first hard error (the remaining ops would compile
 * against a document state that never existed). Nothing observable is mutated:
 * the caller receives steps plus the resulting document and decides what to
 * commit.
 */
import type {
	PromptBlockNode,
	PromptDocument,
} from "@codecaine-ai/prompt-kit";
import {
	applyStep,
	getPromptBlockNodeById,
	insertPromptBlockNodeWithStep,
	removePromptBlockNodeById,
	type PromptBlockNodePatch,
	type PromptStep,
} from "@codecaine-ai/prompt-kit/ui";

import type {
	PromptEditOp,
	PromptEditOpError,
} from "./types";

export interface CompilePromptEditOpsSuccess {
	ok: true;
	steps: PromptStep[];
	/** The working document with all steps applied (scratch — not committed). */
	doc: PromptDocument;
	/** Primary node id per op, deduplicated, in op order. */
	changedIds: string[];
}

export interface CompilePromptEditOpsFailure {
	ok: false;
	errors: PromptEditOpError[];
}

export type CompilePromptEditOpsResult =
	| CompilePromptEditOpsSuccess
	| CompilePromptEditOpsFailure;

export function compilePromptEditOps(
	doc: PromptDocument,
	ops: readonly PromptEditOp[],
): CompilePromptEditOpsResult {
	if (ops.length === 0) {
		return {
			ok: false,
			errors: [
				{
					code: "empty_ops",
					opIndex: -1,
					message: "propose_transaction requires at least one op.",
				},
			],
		};
	}

	const steps: PromptStep[] = [];
	const changedIds: string[] = [];
	let current = doc;

	for (let index = 0; index < ops.length; index += 1) {
		const op = ops[index]!;
		const outcome = compileOne(current, op, index);
		if ("error" in outcome) return { ok: false, errors: [outcome.error] };
		steps.push(outcome.step);
		current = outcome.doc;
		if (!changedIds.includes(outcome.changedId)) {
			changedIds.push(outcome.changedId);
		}
	}

	return { ok: true, steps, doc: current, changedIds };
}

type CompileOneResult =
	| { step: PromptStep; doc: PromptDocument; changedId: string }
	| { error: PromptEditOpError };

function unknownNode(
	opIndex: number,
	nodeId: string,
	role: string,
): { error: PromptEditOpError } {
	return {
		error: {
			code: "unknown_node",
			opIndex,
			nodeId,
			message: `Op ${opIndex}: no node "${nodeId}" (${role}) in the current document. Node ids are the <!-- #id --> markers in read_prompt.`,
		},
	};
}

function compileOne(
	doc: PromptDocument,
	op: PromptEditOp,
	opIndex: number,
): CompileOneResult {
	switch (op.op) {
		case "update_node":
			return compileUpdate(doc, op.nodeId, op.patch, opIndex);
		case "insert_after":
			return compileInsertAfter(doc, op.refNodeId, op.node, opIndex);
		case "insert_into":
			return compileInsertInto(doc, op.parentNodeId, op.index, op.node, opIndex);
		case "remove_node":
			return compileRemove(doc, op.nodeId, opIndex);
		case "move_after":
			return compileMoveAfter(doc, op.nodeId, op.refNodeId, opIndex);
	}
}

function compileUpdate(
	doc: PromptDocument,
	nodeId: string,
	patch: PromptBlockNodePatch,
	opIndex: number,
): CompileOneResult {
	const entry = getPromptBlockNodeById(doc, nodeId);
	if (!entry) return unknownNode(opIndex, nodeId, "update_node target");

	const patchRecord = patch as Record<string, unknown>;
	if ("id" in patchRecord && patchRecord.id !== nodeId) {
		return {
			error: {
				code: "cannot_change_id",
				opIndex,
				nodeId,
				message: `Op ${opIndex}: update_node must not change a node's id (ids anchor annotations).`,
			},
		};
	}
	if ("type" in patchRecord && patchRecord.type !== entry.node.type) {
		return {
			error: {
				code: "cannot_change_type",
				opIndex,
				nodeId,
				message: `Op ${opIndex}: update_node must not change a node's type ("${entry.node.type}"). Remove and insert instead.`,
			},
		};
	}

	const merged = mergePatch(entry.node, patch);
	const diff = shallowDiff(entry.node, merged);
	if (!diff) {
		return {
			error: {
				code: "noop_update",
				opIndex,
				nodeId,
				message: `Op ${opIndex}: update_node patch left "${nodeId}" unchanged.`,
			},
		};
	}

	const step: PromptStep = {
		op: "update",
		id: nodeId,
		before: diff.before,
		after: diff.after,
	};
	return { step, doc: applyStep(doc, step), changedId: nodeId };
}

function compileInsertAfter(
	doc: PromptDocument,
	refNodeId: string,
	node: PromptBlockNode,
	opIndex: number,
): CompileOneResult {
	if (!getPromptBlockNodeById(doc, refNodeId)) {
		return unknownNode(opIndex, refNodeId, "insert_after reference");
	}
	// The WithStep helper runs prepareBlockForInsert (fresh, collision-free
	// ids for the whole inserted subtree) and returns the path-based step.
	const result = insertPromptBlockNodeWithStep(doc, refNodeId, node, "after");
	if (!result.step || result.step.op !== "insert") {
		return unknownNode(opIndex, refNodeId, "insert_after reference");
	}
	return {
		step: result.step,
		doc: result.prompt,
		changedId: result.step.node.id ?? refNodeId,
	};
}

/** Container key per parent node type; null = cannot hold block children. */
function containerKeyFor(node: PromptBlockNode): "children" | "instructions" | null {
	switch (node.type) {
		case "section":
		case "example":
		case "field":
			return "children";
		case "contextUsage":
			return "instructions";
		default:
			return null;
	}
}

function compileInsertInto(
	doc: PromptDocument,
	parentNodeId: string,
	index: number | undefined,
	node: PromptBlockNode,
	opIndex: number,
): CompileOneResult {
	const parent = getPromptBlockNodeById(doc, parentNodeId);
	if (!parent) return unknownNode(opIndex, parentNodeId, "insert_into parent");
	const containerKey = containerKeyFor(parent.node);
	if (!containerKey) {
		return {
			error: {
				code: "cannot_contain_children",
				opIndex,
				nodeId: parentNodeId,
				message: `Op ${opIndex}: node "${parentNodeId}" is a ${parent.node.type} and cannot contain block children. Use insert_after instead.`,
			},
		};
	}

	// Compile the append via the id-prep helper, then retarget the step index
	// when an explicit position was asked for. Only the position within the
	// same container array changes, so the prepared node stays valid.
	const appended = insertPromptBlockNodeWithStep(doc, parentNodeId, node, "child");
	if (!appended.step || appended.step.op !== "insert") {
		return unknownNode(opIndex, parentNodeId, "insert_into parent");
	}
	const appendPath = appended.step.path;
	const appendIndex = appendPath[appendPath.length - 1];
	const length = typeof appendIndex === "number" ? appendIndex : 0;
	const clamped =
		index === undefined ? length : Math.min(Math.max(index, 0), length);

	if (clamped === length) {
		return {
			step: appended.step,
			doc: appended.prompt,
			changedId: appended.step.node.id ?? parentNodeId,
		};
	}
	const step: PromptStep = {
		op: "insert",
		path: [...appendPath.slice(0, -1), clamped],
		node: appended.step.node,
	};
	return {
		step,
		doc: applyStep(doc, step),
		changedId: step.node.id ?? parentNodeId,
	};
}

function compileRemove(
	doc: PromptDocument,
	nodeId: string,
	opIndex: number,
): CompileOneResult {
	const entry = getPromptBlockNodeById(doc, nodeId);
	if (!entry) return unknownNode(opIndex, nodeId, "remove_node target");
	const step: PromptStep = {
		op: "remove",
		path: entry.path,
		removed: entry.node,
	};
	return { step, doc: applyStep(doc, step), changedId: nodeId };
}

function compileMoveAfter(
	doc: PromptDocument,
	nodeId: string,
	refNodeId: string,
	opIndex: number,
): CompileOneResult {
	const entry = getPromptBlockNodeById(doc, nodeId);
	if (!entry) return unknownNode(opIndex, nodeId, "move_after subject");
	const ref = getPromptBlockNodeById(doc, refNodeId);
	if (!ref) return unknownNode(opIndex, refNodeId, "move_after reference");
	if (
		nodeId === refNodeId ||
		isPathPrefix(entry.path, ref.path)
	) {
		return {
			error: {
				code: "move_ref_inside_subtree",
				opIndex,
				nodeId,
				message: `Op ${opIndex}: cannot move "${nodeId}" after "${refNodeId}" — the reference sits inside the moved subtree.`,
			},
		};
	}

	// A move step applies as remove-at-from, then insert-at-to in the removed
	// document — so `to` is resolved against the document WITHOUT the node.
	const withoutNode = removePromptBlockNodeById(doc, nodeId);
	const refAfter = getPromptBlockNodeById(withoutNode, refNodeId);
	if (!refAfter) return unknownNode(opIndex, refNodeId, "move_after reference");
	const step: PromptStep = {
		op: "move",
		from: entry.path,
		to: [...refAfter.parentPath, refAfter.index + 1],
	};
	return { step, doc: applyStep(doc, step), changedId: nodeId };
}

// ---------------------------------------------------------------------------
// Patch helpers
// ---------------------------------------------------------------------------

function mergePatch(
	node: PromptBlockNode,
	patch: PromptBlockNodePatch,
): PromptBlockNode {
	const merged: Record<string, unknown> = {
		...(node as unknown as Record<string, unknown>),
		...(patch as Record<string, unknown>),
	};
	for (const key of Object.keys(merged)) {
		if (merged[key] === undefined) delete merged[key];
	}
	return merged as unknown as PromptBlockNode;
}

function shallowDiff(
	before: PromptBlockNode,
	after: PromptBlockNode,
):
	| { before: PromptBlockNodePatch; after: PromptBlockNodePatch }
	| undefined {
	const beforeRecord = before as unknown as Record<string, unknown>;
	const afterRecord = after as unknown as Record<string, unknown>;
	const keys = new Set([
		...Object.keys(beforeRecord),
		...Object.keys(afterRecord),
	]);
	const beforePatch: Record<string, unknown> = {};
	const afterPatch: Record<string, unknown> = {};
	let changed = false;
	for (const key of keys) {
		if (deepEquals(beforeRecord[key], afterRecord[key])) continue;
		beforePatch[key] = beforeRecord[key];
		afterPatch[key] = afterRecord[key];
		changed = true;
	}
	if (!changed) return undefined;
	return {
		before: beforePatch as PromptBlockNodePatch,
		after: afterPatch as PromptBlockNodePatch,
	};
}

function deepEquals(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (typeof a !== "object" || typeof b !== "object") return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((entry, index) => deepEquals(entry, b[index]));
	}
	const aRecord = a as Record<string, unknown>;
	const bRecord = b as Record<string, unknown>;
	const aKeys = Object.keys(aRecord).filter((key) => aRecord[key] !== undefined);
	const bKeys = Object.keys(bRecord).filter((key) => bRecord[key] !== undefined);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every((key) => deepEquals(aRecord[key], bRecord[key]));
}

function isPathPrefix(
	prefix: ReadonlyArray<string | number>,
	path: ReadonlyArray<string | number>,
): boolean {
	if (prefix.length > path.length) return false;
	return prefix.every((segment, index) => path[index] === segment);
}

// ---------------------------------------------------------------------------
// Op-shape parsing (the tool boundary hands us unknown JSON)
// ---------------------------------------------------------------------------

const OP_NAMES = new Set([
	"update_node",
	"insert_after",
	"insert_into",
	"remove_node",
	"move_after",
]);

export type ParsePromptEditOpsResult =
	| { ok: true; ops: PromptEditOp[] }
	| { ok: false; errors: PromptEditOpError[] };

/** Narrow untrusted tool params into `PromptEditOp[]` with typed errors. */
export function parsePromptEditOps(raw: unknown): ParsePromptEditOpsResult {
	if (!Array.isArray(raw)) {
		return {
			ok: false,
			errors: [
				{
					code: "invalid_op_shape",
					opIndex: -1,
					message: "ops must be an array of semantic ops.",
				},
			],
		};
	}
	const ops: PromptEditOp[] = [];
	for (let index = 0; index < raw.length; index += 1) {
		const parsed = parseOne(raw[index], index);
		if ("error" in parsed) return { ok: false, errors: [parsed.error] };
		ops.push(parsed.op);
	}
	return { ok: true, ops };
}

function shapeError(opIndex: number, message: string): { error: PromptEditOpError } {
	return {
		error: {
			code: "invalid_op_shape",
			opIndex,
			message: `Op ${opIndex}: ${message}`,
		},
	};
}

function parseOne(
	raw: unknown,
	index: number,
): { op: PromptEditOp } | { error: PromptEditOpError } {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return shapeError(index, "each op must be an object.");
	}
	const record = raw as Record<string, unknown>;
	const name = record.op;
	if (typeof name !== "string" || !OP_NAMES.has(name)) {
		return shapeError(
			index,
			`"op" must be one of update_node, insert_after, insert_into, remove_node, move_after (got ${JSON.stringify(name)}).`,
		);
	}
	const str = (key: string): string | undefined => {
		const value = record[key];
		return typeof value === "string" && value.trim() !== "" ? value : undefined;
	};
	const obj = (key: string): Record<string, unknown> | undefined => {
		const value = record[key];
		return value !== null && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	};

	switch (name) {
		case "update_node": {
			const nodeId = str("nodeId");
			const patch = obj("patch");
			if (!nodeId) return shapeError(index, "update_node requires nodeId.");
			if (!patch) return shapeError(index, "update_node requires a patch object.");
			return {
				op: { op: "update_node", nodeId, patch: patch as PromptBlockNodePatch },
			};
		}
		case "insert_after": {
			const refNodeId = str("refNodeId");
			const node = obj("node");
			if (!refNodeId) return shapeError(index, "insert_after requires refNodeId.");
			if (!node || typeof node.type !== "string") {
				return shapeError(index, "insert_after requires a block node with a type.");
			}
			return {
				op: {
					op: "insert_after",
					refNodeId,
					node: node as unknown as PromptBlockNode,
				},
			};
		}
		case "insert_into": {
			const parentNodeId = str("parentNodeId");
			const node = obj("node");
			const rawIndex = record.index;
			if (!parentNodeId) {
				return shapeError(index, "insert_into requires parentNodeId.");
			}
			if (!node || typeof node.type !== "string") {
				return shapeError(index, "insert_into requires a block node with a type.");
			}
			if (rawIndex !== undefined && typeof rawIndex !== "number") {
				return shapeError(index, "insert_into index must be a number when given.");
			}
			return {
				op: {
					op: "insert_into",
					parentNodeId,
					index: rawIndex as number | undefined,
					node: node as unknown as PromptBlockNode,
				},
			};
		}
		case "remove_node": {
			const nodeId = str("nodeId");
			if (!nodeId) return shapeError(index, "remove_node requires nodeId.");
			return { op: { op: "remove_node", nodeId } };
		}
		case "move_after": {
			const nodeId = str("nodeId");
			const refNodeId = str("refNodeId");
			if (!nodeId) return shapeError(index, "move_after requires nodeId.");
			if (!refNodeId) return shapeError(index, "move_after requires refNodeId.");
			return { op: { op: "move_after", nodeId, refNodeId } };
		}
		default:
			return shapeError(index, "unreachable op name.");
	}
}
