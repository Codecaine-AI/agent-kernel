import type {
	BulletListNode,
	ListItemNode,
	OrderedListNode,
	PromptBlockNode,
	PromptDocument,
	PromptInline,
} from "@codecaine-ai/prompt-kit";
import {
	editableTextToInline,
	updatePromptBlockNodeByIdWithStep,
	type PromptStep,
} from "@codecaine-ai/prompt-kit/ui";

/**
 * List-item operations compose as UPDATE steps on the *containing list node*,
 * routed through `updatePromptBlockNodeByIdWithStep`. That wrapper diffs the
 * whole node before/after and emits a single invertible `update` step keyed by
 * the list's id, so add / remove / nest / un-nest all undo and redo as one
 * logical action and keep flowing through the same transaction log as every
 * other editor mutation.
 *
 * None of these helpers touch the document directly — they hand a pure updater
 * to the step wrapper and return its `{ prompt, step }` result. A caller with a
 * multi-step logical action (e.g. Notion "Enter": commit text + insert item)
 * collects the returned steps and commits them together as one transaction.
 */

type ListNode = BulletListNode | OrderedListNode;

function isListNode(node: PromptBlockNode): node is ListNode {
	return node.type === "bulletList" || node.type === "orderedList";
}

/** Empty inline content for a freshly created item. */
export function emptyInline(): PromptInline[] {
	return [""];
}

function withItems(node: ListNode, items: ListItemNode[]): ListNode {
	return { ...node, items } as ListNode;
}

export interface ListItemStepResult {
	prompt: PromptDocument;
	step?: PromptStep;
	/** Index the caller should focus after the edit (when meaningful). */
	focusItemIndex?: number;
}

/**
 * Sets the text content of one item. Kept here (rather than inline in the view)
 * so text-commit and the structural ops below share one update path and one
 * inline-parsing rule.
 */
export function setListItemContentStep(
	prompt: PromptDocument,
	listId: string,
	itemIndex: number,
	text: string,
): ListItemStepResult {
	const result = updatePromptBlockNodeByIdWithStep(prompt, listId, (node) => {
		if (!isListNode(node)) return node;
		const items = node.items.map((item, index) =>
			index === itemIndex
				? { ...item, content: editableTextToInline(text) }
				: item,
		);
		return withItems(node, items);
	});
	return { prompt: result.prompt, step: result.step };
}

/**
 * Inserts a new item at `atIndex` (clamped). `content` defaults to a single
 * empty string so the new row is immediately editable. Returns the index of the
 * inserted item so the caller can focus it.
 */
export function insertListItemStep(
	prompt: PromptDocument,
	listId: string,
	atIndex: number,
	content: PromptInline[] = emptyInline(),
): ListItemStepResult {
	let inserted = atIndex;
	const result = updatePromptBlockNodeByIdWithStep(prompt, listId, (node) => {
		if (!isListNode(node)) return node;
		const items = [...node.items];
		inserted = Math.min(Math.max(atIndex, 0), items.length);
		const newItem: ListItemNode = { type: "listItem", content };
		items.splice(inserted, 0, newItem);
		return withItems(node, items);
	});
	return { prompt: result.prompt, step: result.step, focusItemIndex: inserted };
}

/**
 * Removes the item at `itemIndex`. If it was the only item the list node is
 * left empty (`items: []`); callers that want the whole list gone on last-item
 * removal should special-case that before calling. Returns the index of a
 * sensible neighbour to focus (previous item, else the new item at that slot).
 */
export function removeListItemStep(
	prompt: PromptDocument,
	listId: string,
	itemIndex: number,
): ListItemStepResult {
	let focus = itemIndex;
	const result = updatePromptBlockNodeByIdWithStep(prompt, listId, (node) => {
		if (!isListNode(node)) return node;
		const items = node.items.filter((_, index) => index !== itemIndex);
		focus = Math.max(0, Math.min(itemIndex - 1, items.length - 1));
		return withItems(node, items);
	});
	return { prompt: result.prompt, step: result.step, focusItemIndex: focus };
}

/**
 * Nests the item at `itemIndex` under the previous sibling item, moving it into
 * a child list of the *same list type*. If the previous item already has a
 * trailing child list of that type, the item is appended to it; otherwise a new
 * child list is created. The item cannot be nested when it is the first item
 * (no previous sibling) — that returns a no-op result.
 *
 * The whole reparent is expressed as a single update to the containing list
 * node, so it is one invertible step.
 */
export function nestListItemStep(
	prompt: PromptDocument,
	listId: string,
	itemIndex: number,
): ListItemStepResult {
	const result = updatePromptBlockNodeByIdWithStep(prompt, listId, (node) => {
		if (!isListNode(node)) return node;
		return nestWithin(node, itemIndex);
	});
	return { prompt: result.prompt, step: result.step };
}

/**
 * Nests item `itemIndex` under its previous sibling within `list` (one level of
 * items). Pure — returns a new list node, or the original when nesting is not
 * possible (first item / out of range).
 */
function nestWithin(list: ListNode, itemIndex: number): ListNode {
	if (itemIndex <= 0 || itemIndex >= list.items.length) return list;
	const items = [...list.items];
	const moving = items[itemIndex];
	const prev = items[itemIndex - 1];
	if (!moving || !prev) return list;

	const childListType = list.type;
	const prevChildren = prev.children ?? [];
	const lastChild = prevChildren[prevChildren.length - 1];

	let nextChildren: PromptBlockNode[];
	if (
		lastChild &&
		(lastChild.type === "bulletList" || lastChild.type === "orderedList") &&
		lastChild.type === childListType
	) {
		// Append to the existing trailing child list of the same kind.
		const merged = {
			...lastChild,
			items: [...lastChild.items, moving],
		} as ListNode;
		nextChildren = [...prevChildren.slice(0, -1), merged];
	} else {
		const childList = { type: childListType, items: [moving] } as ListNode;
		nextChildren = [...prevChildren, childList];
	}

	items[itemIndex - 1] = { ...prev, children: nextChildren };
	items.splice(itemIndex, 1);
	return withItems(list, items);
}

/**
 * Un-nests the item at `childIndex` of the child list embedded in item
 * `parentItemIndex` of `listId`, hoisting it to sit immediately after that
 * parent item in the outer list. The whole two-level reparent is expressed as
 * a single update to the (top-level) list node, so it is one invertible step.
 *
 * `listId` addresses the OUTER list; `parentItemIndex` is the outer item whose
 * `children` hold the nested list; `childIndex` is the position within that
 * nested list. This mirrors how the line model surfaces a nested list: the
 * nested list is a distinct block node, but its logical parent is an item of
 * the outer list, and un-nesting must edit both levels at once.
 */
export function unnestListItemStep(
	prompt: PromptDocument,
	listId: string,
	parentItemIndex: number,
	childIndex: number,
): ListItemStepResult {
	const result = updatePromptBlockNodeByIdWithStep(prompt, listId, (node) => {
		if (!isListNode(node)) return node;
		if (parentItemIndex < 0 || parentItemIndex >= node.items.length) return node;
		const items = [...node.items];
		const parent = items[parentItemIndex];
		if (!parent) return node;

		const children = parent.children ?? [];
		// Un-nesting hoists out of the LAST child list (the one the surface shows
		// directly beneath the parent item).
		const listChildIndex = findLastListChildIndex(children);
		if (listChildIndex < 0) return node;
		const childList = children[listChildIndex] as ListNode;
		if (childIndex < 0 || childIndex >= childList.items.length) return node;

		const nestedItems = [...childList.items];
		const [moving] = nestedItems.splice(childIndex, 1);
		if (!moving) return node;

		// Rebuild the parent's children: shrink (or drop) the child list.
		const nextChildren = [...children];
		if (nestedItems.length === 0) {
			nextChildren.splice(listChildIndex, 1);
		} else {
			nextChildren[listChildIndex] = {
				...childList,
				items: nestedItems,
			} as ListNode;
		}
		items[parentItemIndex] = {
			...parent,
			children: nextChildren.length > 0 ? nextChildren : undefined,
		};
		// Hoist the item to just after its former parent in the outer list.
		items.splice(parentItemIndex + 1, 0, moving);
		return withItems(node, items);
	});
	return { prompt: result.prompt, step: result.step };
}

function findLastListChildIndex(children: readonly PromptBlockNode[]): number {
	for (let i = children.length - 1; i >= 0; i--) {
		const child = children[i];
		if (child && (child.type === "bulletList" || child.type === "orderedList")) {
			return i;
		}
	}
	return -1;
}
