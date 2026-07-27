/**
 * turn-sections — the section-tag contract for per-turn request snapshots,
 * plus the pure grouping the turn renderer runs on it.
 *
 * Every request the model receives is three sections (see
 * docs/10-system-design/explainers/state-shapes.html §2):
 *
 *   ① system prompt — the agent's instructions, set once
 *   ② context      — the L2 set, rebuilt each request
 *   ③ state        — render(state): the working picture plus however much
 *                    recent conversation the renderer emits as real messages
 *                    (the "tail")
 *
 * The snapshot builder captures the system prompt separately and tags where
 * ② and ③ begin in the ordered message list. `tail` is a sub-range of ③ —
 * conceptually part of the state render, so the viewer keeps it under ③.
 *
 * The tags are half-open [start, end) index ranges. Snapshots taken before the
 * builder emitted tags simply have none: `parseSectionTags` returns null and
 * the renderer falls back to the flat context list it has always shown.
 *
 * NOTE — the canonical type lives on PiRequestSnapshotData in
 * @agent-kernel/protocol. This is a local structural mirror so viewer-ui stays
 * buildable against protocol versions that predate the field; the shapes are
 * intentionally identical.
 */

export type RequestSectionKind = "context" | "state" | "tail";

export interface RequestSectionTag {
	kind: RequestSectionKind;
	/** Inclusive index into the snapshot's ordered message list. */
	start: number;
	/** Exclusive index into the snapshot's ordered message list. */
	end: number;
}

const SECTION_KINDS: ReadonlySet<string> = new Set<RequestSectionKind>([
	"context",
	"state",
	"tail",
]);

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Validate section tags coming off a snapshot (either the JSON span attribute
 * or the parsed turn-context response).
 *
 * Returns null — meaning "render flat, as before" — when the field is absent,
 * empty, or malformed in any way. A partially valid array is rejected rather
 * than silently reinterpreted: a wrong grouping is worse than no grouping.
 * Degenerate-but-well-typed ranges (end <= start) are dropped, since an empty
 * section is a legitimate thing for the builder to emit.
 */
export function parseSectionTags(input: unknown): RequestSectionTag[] | null {
	const raw = typeof input === "string" ? safeJson(input) : input;
	if (!Array.isArray(raw) || raw.length === 0) return null;

	const tags: RequestSectionTag[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") return null;
		const { kind, start, end } = entry as {
			kind?: unknown;
			start?: unknown;
			end?: unknown;
		};
		if (typeof kind !== "string" || !SECTION_KINDS.has(kind)) return null;
		if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
		const from = start as number;
		const to = end as number;
		if (from < 0 || to < 0) return null;
		if (to <= from) continue; // empty range — nothing to group
		tags.push({ kind: kind as RequestSectionKind, start: from, end: to });
	}
	return tags.length > 0 ? tags : null;
}

export interface TurnMessageEntry<M> {
	/** Position in the snapshot's ordered message list. */
	index: number;
	message: M;
}

export interface TurnSectionsModel<M> {
	/** Section ② — the rebuilt context message(s). */
	context: TurnMessageEntry<M>[];
	/** Section ③ — the state render, minus its message tail. */
	state: TurnMessageEntry<M>[];
	/** Section ③'s tail — recent conversation emitted as real messages. */
	tail: TurnMessageEntry<M>[];
	/** Messages no tag covers. Surfaced rather than dropped. */
	untagged: TurnMessageEntry<M>[];
}

/**
 * Bucket an ordered message list by its section tags.
 *
 * Ranges are clamped to the list, and each message lands in the first tag that
 * covers it (tags sorted by start, then end) so overlapping tags from a future
 * builder cannot duplicate a message. Messages left over land in `untagged`.
 * Relative order inside every bucket is the context order.
 */
export function groupTurnSections<M>(
	messages: readonly M[],
	tags: readonly RequestSectionTag[],
): TurnSectionsModel<M> {
	const ordered = [...tags].sort((a, b) => a.start - b.start || a.end - b.end);
	const assigned: Array<RequestSectionKind | undefined> = new Array(
		messages.length,
	);

	for (const tag of ordered) {
		const from = Math.max(0, tag.start);
		const to = Math.min(messages.length, tag.end);
		for (let i = from; i < to; i += 1) {
			if (assigned[i] === undefined) assigned[i] = tag.kind;
		}
	}

	const model: TurnSectionsModel<M> = {
		context: [],
		state: [],
		tail: [],
		untagged: [],
	};
	messages.forEach((message, index) => {
		const kind = assigned[index];
		const bucket = kind === undefined ? model.untagged : model[kind];
		bucket.push({ index, message });
	});
	return model;
}
