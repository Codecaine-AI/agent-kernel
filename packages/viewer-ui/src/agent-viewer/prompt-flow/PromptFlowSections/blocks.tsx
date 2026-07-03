// Slice: per-node-type block editors for the Sections surface (section, list,
// field, code, example, context) — the leaf inputs each block renders.
"use client";

import { Plus } from "lucide-react";
import type {
	BulletListNode,
	CodeBlockNode,
	ContextUsageNode,
	ExampleNode,
	FieldNode,
	OrderedListNode,
	SectionNode,
} from "@codecaine-ai/prompt-kit";
import {
	editableTextToInline,
	inlineToEditableText,
} from "@codecaine-ai/prompt-kit/ui";

import { humanizeTag, normalizeTag, PlainTextArea } from "../PromptFlowShared";

export function SectionBlock({
	node,
	onChange,
}: {
	node: SectionNode;
	onChange: (patch: Partial<SectionNode>) => void;
}) {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<input
				value={humanizeTag(node.tag)}
				onChange={(event) => onChange({ tag: normalizeTag(event.target.value) })}
				className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[17px] font-semibold leading-tight text-foreground outline-none placeholder:text-muted-foreground/35"
				placeholder="Section"
			/>
		</div>
	);
}

export function ListBlock({
	node,
	onChange,
}: {
	node: BulletListNode | OrderedListNode;
	onChange: (items: Array<BulletListNode["items"][number]>) => void;
}) {
	return (
		<div className="flex flex-col gap-1">
			{node.items.map((item, index) => (
				<div key={item.id ?? index} className="flex min-w-0 items-start gap-2">
					<span className="mt-1.5 w-5 shrink-0 text-right text-[13px] text-muted-foreground">
						{node.type === "orderedList" ? `${(node.start ?? 1) + index}.` : "-"}
					</span>
					<PlainTextArea
						value={inlineToEditableText(item.content)}
						placeholder="List item"
						className="min-h-7 py-0.5"
						onChange={(content) =>
							onChange(
								node.items.map((candidate, itemIndex) =>
									itemIndex === index
										? { ...candidate, content: editableTextToInline(content) }
										: candidate,
								),
							)
						}
					/>
				</div>
			))}
			<button
				type="button"
				onClick={() =>
					onChange([...node.items, { type: "listItem", content: [""] }])
				}
				className="ml-7 flex h-7 w-fit items-center gap-1 rounded-[2px] px-1.5 text-[12px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
			>
				<Plus size={13} />
				item
			</button>
		</div>
	);
}

export function FieldBlock({
	node,
	onChange,
}: {
	node: FieldNode;
	onChange: (patch: Partial<FieldNode>) => void;
}) {
	return (
		<div className="grid min-w-0 grid-cols-[minmax(7rem,0.26fr)_1fr] gap-3">
			<input
				value={node.label}
				onChange={(event) => onChange({ label: event.target.value })}
				className="border-0 bg-transparent p-0 text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground outline-none"
			/>
			<PlainTextArea
				value={inlineToEditableText(node.value)}
				placeholder="Value"
				onChange={(value) => onChange({ value: editableTextToInline(value) })}
			/>
		</div>
	);
}

export function CodeBlock({
	node,
	onChange,
}: {
	node: CodeBlockNode;
	onChange: (patch: Partial<CodeBlockNode>) => void;
}) {
	return (
		<div className="overflow-hidden rounded-[3px] border border-border bg-muted/25">
			<input
				value={node.language ?? ""}
				onChange={(event) => onChange({ language: event.target.value || undefined })}
				placeholder="language"
				className="w-full border-b border-border bg-background/60 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground outline-none"
			/>
			<textarea
				value={node.code}
				onChange={(event) => onChange({ code: event.target.value })}
				rows={Math.max(3, node.code.split("\n").length)}
				className="w-full resize-y border-0 bg-transparent px-2 py-2 font-mono text-[12px] leading-relaxed text-foreground outline-none"
				spellCheck={false}
			/>
		</div>
	);
}

export function ExampleBlock({
	node,
	onChange,
}: {
	node: ExampleNode;
	onChange: (patch: Partial<ExampleNode>) => void;
}) {
	return (
		<div className="rounded-[3px] border border-border/70 bg-muted/20 px-3 py-2">
			<input
				value={node.title ?? ""}
				onChange={(event) => onChange({ title: event.target.value || undefined })}
				placeholder="Example"
				className="w-full border-0 bg-transparent p-0 text-[13px] font-medium text-foreground outline-none placeholder:text-muted-foreground/45"
			/>
			<p className="mt-1 text-[12px] text-muted-foreground">
				{node.children.length} nested block{node.children.length === 1 ? "" : "s"}
			</p>
		</div>
	);
}

export function ContextBlock({
	node,
	onChange,
}: {
	node: ContextUsageNode;
	onChange: (patch: Partial<ContextUsageNode>) => void;
}) {
	return (
		<div className="rounded-[3px] border border-status-info-border/60 bg-status-info-fill/20 px-3 py-2">
			<div className="grid gap-2 sm:grid-cols-[minmax(8rem,0.32fr)_1fr]">
				<input
					value={node.contextId}
					onChange={(event) => onChange({ contextId: event.target.value })}
					placeholder="context id"
					className="border-0 bg-transparent p-0 text-[12px] font-medium text-status-info outline-none placeholder:text-status-info/45"
				/>
				<input
					value={node.tag ?? ""}
					onChange={(event) => onChange({ tag: event.target.value || undefined })}
					placeholder="render tag"
					className="border-0 bg-transparent p-0 text-[12px] text-muted-foreground outline-none placeholder:text-muted-foreground/45"
				/>
			</div>
			<p className="mt-1 text-[12px] text-muted-foreground">
				{node.instructions.length} instruction block{node.instructions.length === 1 ? "" : "s"}
			</p>
		</div>
	);
}
