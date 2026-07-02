"use client";

import cn from "classnames";
import { Plus } from "lucide-react";
import type {
	BulletListNode,
	CodeBlockNode,
	ContextUsageNode,
	ExampleNode,
	FieldNode,
	OrderedListNode,
	ParagraphNode,
	PromptDocument,
	RawNode,
	SectionNode,
} from "@codecaine-ai/prompt-kit";
import {
	editableTextToInline,
	inlineToEditableText,
	type PromptBlockNodeType,
	type PromptEditorTreeEntry,
} from "@codecaine-ai/prompt-kit/ui";

import {
	canHaveChildren,
	DropLines,
	EmptyFlow,
	humanizeTag,
	InsertPalette,
	normalizeTag,
	PlainTextArea,
	PromptBlockControls,
	updateNode,
	usePromptFlowInteractions,
} from "./PromptFlowShared";
import type { PromptFlowViewProps } from "./types";

export function PromptFlowSections({
	prompt,
	model,
	selectedNodeId,
	onSelectNode,
	onPromptChange,
}: PromptFlowViewProps) {
	const flow = usePromptFlowInteractions({
		prompt,
		model,
		selectedNodeId,
		onSelectNode,
		onPromptChange,
	});

	return (
		<section className="flex h-full min-h-0 flex-1 flex-col bg-background font-mono">
			<div
				data-prompt-flow-scroll="sections"
				className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
				onClick={() => onSelectNode(undefined)}
			>
				<div className="mx-auto w-full max-w-4xl px-6 py-6">
					<header className="mb-5 border-b border-border/70 pb-4">
						<input
							value={prompt.title ?? ""}
							onChange={(event) =>
								onPromptChange(
									{ ...prompt, title: event.target.value || undefined },
									flow.activeId,
								)
							}
							placeholder={prompt.id}
							className="w-full border-0 bg-transparent p-0 text-[24px] font-semibold leading-tight text-foreground outline-none placeholder:text-muted-foreground/35"
						/>
						<textarea
							value={prompt.description ?? ""}
							onChange={(event) =>
								onPromptChange(
									{ ...prompt, description: event.target.value || undefined },
									flow.activeId,
								)
							}
							placeholder="Add a short prompt note..."
							rows={1}
							className="mt-2 w-full resize-none border-0 bg-transparent p-0 text-[13px] leading-relaxed text-muted-foreground outline-none placeholder:text-muted-foreground/35"
						/>
					</header>

					{model.tree.length === 0 ? (
						<EmptyFlow onInsert={(type) => flow.insertBlock(type, null)} />
					) : (
						<div className="flex flex-col">
							{model.tree.map((entry) => {
								const active = entry.id === flow.activeId;
								return (
									<FlowBlock
										key={`${entry.id}:${entry.path.join(".")}`}
										entry={entry}
										prompt={prompt}
										active={active}
										insertOpen={flow.insertAfterId === entry.id}
										dragging={flow.draggingId === entry.id}
										dropBefore={flow.isDropBefore(entry)}
										dropAfter={flow.isDropAfter(entry)}
										onSelectNode={onSelectNode}
										onPromptChange={onPromptChange}
										onOpenInsert={() =>
											flow.setInsertAfterId((current) => (current === entry.id ? null : entry.id))
										}
										onInsert={(type) => flow.insertBlock(type, entry.id)}
										onInsertChild={(type) => flow.insertBlock(type, entry.id, "child")}
										onRemove={() => flow.removeBlock(entry)}
										onDragStart={() => flow.setDraggingId(entry.id)}
										onDragEnd={flow.handleDragEnd}
										onDragOver={(event) => flow.handleDragOver(event, entry)}
										onDrop={(event) => flow.handleDrop(event, entry)}
									/>
								);
							})}
						</div>
					)}
				</div>
			</div>
		</section>
	);
}

function FlowBlock({
	entry,
	prompt,
	active,
	insertOpen,
	dragging,
	dropBefore,
	dropAfter,
	onSelectNode,
	onPromptChange,
	onOpenInsert,
	onInsert,
	onInsertChild,
	onRemove,
	onDragStart,
	onDragEnd,
	onDragOver,
	onDrop,
}: {
	entry: PromptEditorTreeEntry;
	prompt: PromptDocument;
	active: boolean;
	insertOpen: boolean;
	dragging: boolean;
	dropBefore: boolean;
	dropAfter: boolean;
	onSelectNode: PromptFlowViewProps["onSelectNode"];
	onPromptChange: PromptFlowViewProps["onPromptChange"];
	onOpenInsert: () => void;
	onInsert: (type: PromptBlockNodeType) => void;
	onInsertChild: (type: PromptBlockNodeType) => void;
	onRemove: () => void;
	onDragStart: () => void;
	onDragEnd: () => void;
	onDragOver: (event: React.DragEvent<HTMLElement>) => void;
	onDrop: (event: React.DragEvent<HTMLElement>) => void;
}) {
	const node = entry.node;
	const childInsert = canHaveChildren(node);

	return (
		<div
			className={cn("group relative", dragging && "opacity-45")}
			style={{ marginLeft: entry.depth * 22 }}
			onDragOver={onDragOver}
			onDrop={onDrop}
		>
			<DropLines dropBefore={dropBefore} dropAfter={dropAfter} />

			<div className="flex items-start gap-1 py-0.5">
				<PromptBlockControls
					entry={entry}
					onOpenInsert={onOpenInsert}
					onRemove={onRemove}
					onDragStart={onDragStart}
					onDragEnd={onDragEnd}
				/>

				<div
					onClick={(event) => {
						event.stopPropagation();
						onSelectNode(entry.id);
					}}
					onFocusCapture={() => onSelectNode(entry.id)}
					className={cn(
						"min-w-0 flex-1 rounded-[3px] border px-2 py-1.5 transition-colors",
						active
							? "border-status-success-border bg-status-success-fill/10"
							: "border-transparent hover:bg-muted/20",
					)}
				>
					<RenderedBlock
						entry={entry}
						prompt={prompt}
						onPromptChange={onPromptChange}
					/>
				</div>
			</div>

			{insertOpen && (
				<div className="ml-[4.75rem] py-1">
					<InsertPalette
						canInsertChild={childInsert}
						onInsert={onInsert}
						onInsertChild={onInsertChild}
					/>
				</div>
			)}
		</div>
	);
}

function RenderedBlock({
	entry,
	prompt,
	onPromptChange,
}: {
	entry: PromptEditorTreeEntry;
	prompt: PromptDocument;
	onPromptChange: PromptFlowViewProps["onPromptChange"];
}) {
	const node = entry.node;

	switch (node.type) {
		case "section":
			return (
				<SectionBlock
					node={node}
					onChange={(patch) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "section" ? { ...current, ...patch } : current,
						)
					}
				/>
			);
		case "paragraph":
			return (
				<PlainTextArea
					value={inlineToEditableText(node.content)}
					placeholder="Write..."
					onChange={(content) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "paragraph"
								? ({ ...current, content: editableTextToInline(content) } satisfies ParagraphNode)
								: current,
						)
					}
				/>
			);
		case "bulletList":
		case "orderedList":
			return (
				<ListBlock
					node={node}
					onChange={(items) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "bulletList" || current.type === "orderedList"
								? { ...current, items }
								: current,
						)
					}
				/>
			);
		case "field":
			return (
				<FieldBlock
					node={node}
					onChange={(patch) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "field" ? { ...current, ...patch } : current,
						)
					}
				/>
			);
		case "codeBlock":
			return (
				<CodeBlock
					node={node}
					onChange={(patch) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "codeBlock" ? ({ ...current, ...patch } satisfies CodeBlockNode) : current,
						)
					}
				/>
			);
		case "raw":
			return (
				<PlainTextArea
					value={node.value}
					placeholder="Raw text..."
					className="font-mono text-[12px]"
					onChange={(value) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "raw" ? ({ ...current, value } satisfies RawNode) : current,
						)
					}
				/>
			);
		case "example":
			return (
				<ExampleBlock
					node={node}
					onChange={(patch) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "example" ? ({ ...current, ...patch } satisfies ExampleNode) : current,
						)
					}
				/>
			);
		case "contextUsage":
			return (
				<ContextBlock
					node={node}
					onChange={(patch) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "contextUsage"
								? ({ ...current, ...patch } satisfies ContextUsageNode)
								: current,
						)
					}
				/>
			);
	}
}

function SectionBlock({
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

function ListBlock({
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

function FieldBlock({
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

function CodeBlock({
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

function ExampleBlock({
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

function ContextBlock({
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
