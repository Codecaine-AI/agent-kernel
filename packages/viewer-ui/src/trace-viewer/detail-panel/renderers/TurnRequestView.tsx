"use client";

/**
 * TurnRequestView — the turn renderer: the exact context window one turn ran
 * on, laid out as the three sections the request is built from
 * (docs/10-system-design/explainers/state-shapes.html §2, §7):
 * System prompt (captured separately on the snapshot), Context (the rebuilt
 * L2 set), and State (render(state) plus its real-message tail, sub-grouped
 * but visually continuous, because the tail is part of the state render).
 *
 * Headers are deliberately bare — just the section name. No numerals, counts,
 * or explainer prose: the architecture story lives in docs, not in the UI.
 *
 * Only reached when the snapshot carries section tags; without them the
 * renderer keeps showing the flat context list (see RequestSnapshotRenderer).
 */
import { useMemo, useState, type ReactNode } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronRight } from "lucide-react";
import cn from "classnames";

import { isKernelAuthoredMessage } from "@agent-kernel/protocol";

import type { SanitizedMessage } from "./request-snapshot-api";
import {
	CollapsibleMono,
	KERNEL_ROLE_STYLE,
	MessageCard,
	SystemPromptBody,
	singleTextOf,
} from "./snapshot-message-view";
import { StateBlockView } from "./StateBlockView";
import { looksLikeStateBlock } from "./state-block";
import {
	groupTurnSections,
	type RequestSectionTag,
	type TurnMessageEntry,
} from "./turn-sections";

// ─── Section shell ──────────────────────────────────────────────────────────

function TurnSection({
	id,
	title,
	defaultOpen,
	children,
}: {
	id: string;
	title: string;
	defaultOpen: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<Collapsible.Root
			open={open}
			onOpenChange={setOpen}
			data-turn-section={id}
			className="rounded-md border border-border/60"
		>
			<Collapsible.Trigger asChild>
				<button
					type="button"
					aria-expanded={open}
					aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
					className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-status-info-border"
				>
					<ChevronRight
						aria-hidden="true"
						className={cn(
							"size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out",
							open && "rotate-90",
						)}
					/>
					<span className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
						{title}
					</span>
				</button>
			</Collapsible.Trigger>
			<Collapsible.Content forceMount className="ap-collapsible">
				<div className="ap-collapsible__inner">
					<div className="space-y-2 border-t border-border/60 p-3">{children}</div>
				</div>
			</Collapsible.Content>
		</Collapsible.Root>
	);
}

// ─── Section bodies ─────────────────────────────────────────────────────────

/**
 * A kernel-authored state line that is not a state block — the base renderer's
 * "[turns 1–5 elided]" marker is the canonical case. It is not conversation,
 * so it must not wear a USER badge: it gets the KERNEL badge and plain
 * monospace, no message card.
 */
function KernelLine({ text }: { text: string }) {
	return (
		<div data-message-author="kernel" className="space-y-1">
			<span
				className={cn(
					"text-[10px] font-medium uppercase tracking-wider",
					KERNEL_ROLE_STYLE.className,
				)}
			>
				{KERNEL_ROLE_STYLE.label}
			</span>
			<CollapsibleMono text={text} clampChars={2000} />
		</div>
	);
}

/**
 * A state-section entry: the rendered state block gets the XML-ish treatment,
 * other kernel-authored lines get the KERNEL-badged plain form, and anything
 * else in the state range is a real message and renders as one.
 */
function StateEntry({
	entry,
	apiBase,
}: {
	entry: TurnMessageEntry<SanitizedMessage>;
	apiBase: string;
}) {
	const text = singleTextOf(entry.message);
	if (text !== undefined && looksLikeStateBlock(text)) {
		return <StateBlockView text={text} />;
	}
	if (text !== undefined && text.length > 0) {
		// KERNEL badge only for lines the kernel actually authored; an app's own
		// custom message keeps the unbadged plain form it always had.
		if (isKernelAuthoredMessage(entry.message)) return <KernelLine text={text} />;
		if (entry.message.role === "custom") {
			return <CollapsibleMono text={text} clampChars={2000} />;
		}
	}
	return (
		<MessageCard message={entry.message} index={entry.index} apiBase={apiBase} />
	);
}

function MessageList({
	entries,
	apiBase,
}: {
	entries: TurnMessageEntry<SanitizedMessage>[];
	apiBase: string;
}) {
	if (entries.length === 0) {
		return <div className="text-xs text-muted-foreground">No messages.</div>;
	}
	return (
		<div className="space-y-2">
			{entries.map((entry) => (
				<MessageCard
					key={entry.index}
					message={entry.message}
					index={entry.index}
					apiBase={apiBase}
				/>
			))}
		</div>
	);
}

/** The tail's divider — sub-grouped under State, never a section of its own. */
function TailDivider() {
	return (
		<div className="flex items-center gap-2 pt-1">
			<span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
				Recent messages
			</span>
			<span aria-hidden="true" className="h-px flex-1 bg-border/60" />
		</div>
	);
}

// ─── The view ───────────────────────────────────────────────────────────────

export interface TurnRequestViewProps {
	systemPrompt: string | null;
	messages: SanitizedMessage[];
	sections: RequestSectionTag[];
	apiBase: string;
}

export function TurnRequestView({
	systemPrompt,
	messages,
	sections,
	apiBase,
}: TurnRequestViewProps) {
	const model = useMemo(
		() => groupTurnSections(messages, sections),
		[messages, sections],
	);
	const stateCount = model.state.length + model.tail.length;

	return (
		<div className="space-y-2" data-turn-view="sections">
			<TurnSection id="system" title="System prompt" defaultOpen={false}>
				{systemPrompt ? (
					<SystemPromptBody prompt={systemPrompt} />
				) : (
					<div className="text-xs text-muted-foreground">
						No system prompt captured for this turn.
					</div>
				)}
			</TurnSection>

			<TurnSection id="context" title="Context" defaultOpen={false}>
				<MessageList entries={model.context} apiBase={apiBase} />
			</TurnSection>

			<TurnSection id="state" title="State" defaultOpen>
				{stateCount === 0 ? (
					<div className="text-xs text-muted-foreground">No state rendered.</div>
				) : (
					<>
						{model.state.map((entry) => (
							<StateEntry key={entry.index} entry={entry} apiBase={apiBase} />
						))}
						{model.tail.length > 0 && (
							<div data-turn-subsection="tail" className="space-y-2">
								<TailDivider />
								<MessageList entries={model.tail} apiBase={apiBase} />
							</div>
						)}
					</>
				)}
			</TurnSection>

			{model.untagged.length > 0 && (
				<TurnSection id="untagged" title="Untagged" defaultOpen={false}>
					<MessageList entries={model.untagged} apiBase={apiBase} />
				</TurnSection>
			)}
		</div>
	);
}
