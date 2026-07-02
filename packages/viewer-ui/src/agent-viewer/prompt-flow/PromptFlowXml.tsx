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
	PromptBlockNode,
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
	inputWidth,
	InsertPalette,
	normalizeTag,
	PlainTextArea,
	PromptBlockControls,
	updateNode,
	usePromptFlowInteractions,
} from "./PromptFlowShared";
import type { PromptFlowViewProps } from "./types";

type XmlFlowRow =
	| { kind: "node"; entry: PromptEditorTreeEntry }
	| { kind: "close"; entry: PromptEditorTreeEntry; tag: string };

export function PromptFlowXml({
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
	const rows = createXmlRows(model.tree);

	return (
		<section
			className="flex h-full min-h-0 flex-1 flex-col bg-background font-mono"
			onClick={() => onSelectNode(undefined)}
		>
			<header className="shrink-0 border-b border-border bg-muted/20 px-4 py-2.5">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
						Agent XML
					</span>
					<span className="text-[11px] tabular-nums text-muted-foreground/65">
						{rows.length.toLocaleString()} rows
					</span>
				</div>
			</header>
			<div
				data-prompt-flow-scroll="xml"
				className="min-h-0 flex-1 overflow-auto bg-muted/10"
			>
				<div className="min-w-[48rem] px-4 py-4">
					{model.tree.length === 0 ? (
						<EmptyFlow onInsert={(type) => flow.insertBlock(type, null)} />
					) : (
						<div className="flex flex-col">
							{rows.map((row, index) =>
								row.kind === "node" ? (
									<XmlBlock
										key={`node:${row.entry.id}:${row.entry.path.join(".")}`}
										entry={row.entry}
										prompt={prompt}
										lineNumber={index + 1}
										active={row.entry.id === flow.activeId}
										insertOpen={flow.insertAfterId === row.entry.id}
										dragging={flow.draggingId === row.entry.id}
										dropBefore={flow.isDropBefore(row.entry)}
										dropAfter={flow.isDropAfter(row.entry)}
										onSelectNode={onSelectNode}
										onPromptChange={onPromptChange}
										onOpenInsert={() =>
											flow.setInsertAfterId((current) =>
												current === row.entry.id ? null : row.entry.id,
											)
										}
										onInsert={(type) => flow.insertBlock(type, row.entry.id)}
										onInsertChild={(type) => flow.insertBlock(type, row.entry.id, "child")}
										onRemove={() => flow.removeBlock(row.entry)}
										onDragStart={() => flow.setDraggingId(row.entry.id)}
										onDragEnd={flow.handleDragEnd}
										onDragOver={(event) => flow.handleDragOver(event, row.entry)}
										onDrop={(event) => flow.handleDrop(event, row.entry)}
									/>
								) : (
									<XmlCloseRow
										key={`close:${row.entry.id}`}
										entry={row.entry}
										tag={row.tag}
										lineNumber={index + 1}
										active={row.entry.id === flow.activeId}
										onSelectNode={onSelectNode}
									/>
								),
							)}
						</div>
					)}
				</div>
			</div>
		</section>
	);
}

function XmlBlock({
	entry,
	prompt,
	lineNumber,
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
	lineNumber: number;
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
	const childInsert = canHaveChildren(entry.node);

	return (
		<div
			className={cn("group relative", dragging && "opacity-45")}
			style={{ marginLeft: entry.depth * 28 }}
			onDragOver={onDragOver}
			onDrop={onDrop}
		>
			<DropLines dropBefore={dropBefore} dropAfter={dropAfter} leftClassName="left-[6.75rem]" />

			<div className="flex items-start gap-1 py-[1px]">
				<PromptBlockControls
					entry={entry}
					onOpenInsert={onOpenInsert}
					onRemove={onRemove}
					onDragStart={onDragStart}
					onDragEnd={onDragEnd}
				/>
				<LineNumber value={lineNumber} />
				<div
					onClick={(event) => {
						event.stopPropagation();
						onSelectNode(entry.id);
					}}
					onFocusCapture={() => onSelectNode(entry.id)}
					className={cn(
						"min-w-0 flex-1 rounded-[3px] border px-2 py-1 transition-colors",
						active
							? "border-status-success-border bg-status-success-fill/10"
							: "border-transparent hover:bg-muted/20",
					)}
				>
					<XmlRenderedBlock
						entry={entry}
						prompt={prompt}
						onPromptChange={onPromptChange}
					/>
				</div>
			</div>

			{insertOpen && (
				<div className="ml-[7rem] py-1">
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

function XmlCloseRow({
	entry,
	tag,
	lineNumber,
	active,
	onSelectNode,
}: {
	entry: PromptEditorTreeEntry;
	tag: string;
	lineNumber: number;
	active: boolean;
	onSelectNode: PromptFlowViewProps["onSelectNode"];
}) {
	return (
		<div
			className="group relative"
			style={{ marginLeft: entry.depth * 28 }}
		>
			<div className="flex items-start gap-1 py-[1px]">
				<div className="sticky left-0 z-10 w-[4.5rem] shrink-0" />
				<LineNumber value={lineNumber} />
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onSelectNode(entry.id);
					}}
					className={cn(
						"min-w-0 flex-1 rounded-[3px] border px-2 py-1 text-left transition-colors",
						active
							? "border-status-success-border bg-status-success-fill/10"
							: "border-transparent text-muted-foreground/80 hover:bg-muted/20 hover:text-foreground",
					)}
				>
					<XmlCloseTag tag={tag} />
				</button>
			</div>
		</div>
	);
}

function XmlRenderedBlock({
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
				<SectionOpenTag
					node={node}
					onChange={(patch) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "section" ? ({ ...current, ...patch } satisfies SectionNode) : current,
						)
					}
				/>
			);
		case "paragraph":
			return (
				<PlainTextArea
					value={inlineToEditableText(node.content)}
					placeholder="Text"
					className="min-h-6 py-0.5 font-mono text-[12px]"
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
				<XmlListBlock
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
				<XmlFieldBlock
					node={node}
					onChange={(patch) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "field" ? ({ ...current, ...patch } satisfies FieldNode) : current,
						)
					}
				/>
			);
		case "codeBlock":
			return (
				<XmlCodeBlock
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
					placeholder="Raw text"
					className="min-h-6 py-0.5 font-mono text-[12px]"
					spellCheck={false}
					onChange={(value) =>
						updateNode(prompt, entry, onPromptChange, (current) =>
							current.type === "raw" ? ({ ...current, value } satisfies RawNode) : current,
						)
					}
				/>
			);
		case "example":
			return (
				<ExampleOpenTag
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
				<ContextOpenTag
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

function SectionOpenTag({
	node,
	onChange,
}: {
	node: SectionNode;
	onChange: (patch: Partial<SectionNode>) => void;
}) {
	return (
		<XmlLine>
			<XmlPunctuation>{"<"}</XmlPunctuation>
			<TagNameInput
				value={node.tag}
				onChange={(tag) => onChange({ tag: normalizeTag(tag) })}
				ariaLabel="Section tag"
			/>
			<ReadonlyAttributes attrs={node.attrs} />
			<XmlPunctuation>{">"}</XmlPunctuation>
		</XmlLine>
	);
}

function ExampleOpenTag({
	node,
	onChange,
}: {
	node: ExampleNode;
	onChange: (patch: Partial<ExampleNode>) => void;
}) {
	return (
		<XmlLine>
			<XmlPunctuation>{"<"}</XmlPunctuation>
			<span className="font-medium text-syntax-key">example</span>
			<span> </span>
			<XmlAttributeName>title</XmlAttributeName>
			<XmlPunctuation>=&quot;</XmlPunctuation>
			<AttributeInput
				value={node.title ?? ""}
				placeholder="Example"
				onChange={(title) => onChange({ title: title || undefined })}
				ariaLabel="Example title"
			/>
			<XmlPunctuation>&quot;{">"}</XmlPunctuation>
		</XmlLine>
	);
}

function ContextOpenTag({
	node,
	onChange,
}: {
	node: ContextUsageNode;
	onChange: (patch: Partial<ContextUsageNode>) => void;
}) {
	const tag = node.tag ?? "context_usage";

	return (
		<XmlLine>
			<XmlPunctuation>{"<"}</XmlPunctuation>
			<TagNameInput
				value={tag}
				onChange={(value) => {
					const normalized = normalizeTag(value);
					onChange({ tag: normalized === "context_usage" ? undefined : normalized });
				}}
				ariaLabel="Context render tag"
			/>
			<span> </span>
			<XmlAttributeName>context_id</XmlAttributeName>
			<XmlPunctuation>=&quot;</XmlPunctuation>
			<AttributeInput
				value={node.contextId}
				placeholder="contextId"
				onChange={(contextId) => onChange({ contextId })}
				ariaLabel="Context id"
			/>
			<XmlPunctuation>&quot;{">"}</XmlPunctuation>
		</XmlLine>
	);
}

function XmlListBlock({
	node,
	onChange,
}: {
	node: BulletListNode | OrderedListNode;
	onChange: (items: Array<BulletListNode["items"][number]>) => void;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			{node.items.map((item, index) => (
				<div key={item.id ?? index} className="flex min-w-0 items-start gap-2">
					<span className="mt-1 w-8 shrink-0 text-right text-[12px] text-syntax-number">
						{node.type === "orderedList" ? `${(node.start ?? 1) + index}.` : "-"}
					</span>
					<PlainTextArea
						value={inlineToEditableText(item.content)}
						placeholder="List item"
						className="min-h-6 py-0.5 font-mono text-[12px]"
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
				className="ml-9 flex h-6 w-fit items-center gap-1 rounded-[2px] px-1.5 text-[12px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
			>
				<Plus size={13} />
				item
			</button>
		</div>
	);
}

function XmlFieldBlock({
	node,
	onChange,
}: {
	node: FieldNode;
	onChange: (patch: Partial<FieldNode>) => void;
}) {
	return (
		<div className="grid min-w-0 grid-cols-[minmax(6rem,max-content)_auto_1fr] items-start gap-1">
			<input
				value={node.label}
				onChange={(event) => onChange({ label: event.target.value })}
				className="min-w-0 border-0 bg-transparent p-0 py-0.5 font-mono text-[12px] font-medium text-syntax-key outline-none"
				style={{ width: inputWidth(node.label, 6, 24) }}
				aria-label="Field label"
			/>
			<span className="py-0.5 text-[12px] text-muted-foreground">:</span>
			<PlainTextArea
				value={inlineToEditableText(node.value)}
				placeholder="Value"
				className="min-h-6 py-0.5 font-mono text-[12px]"
				onChange={(value) => onChange({ value: editableTextToInline(value) })}
			/>
		</div>
	);
}

function XmlCodeBlock({
	node,
	onChange,
}: {
	node: CodeBlockNode;
	onChange: (patch: Partial<CodeBlockNode>) => void;
}) {
	return (
		<div className="overflow-hidden rounded-[3px] border border-border bg-muted/20">
			<div className="flex min-w-0 items-center border-b border-border bg-background/50 px-2 py-1 text-[12px]">
				<span className="text-syntax-number">```</span>
				<input
					value={node.language ?? ""}
					onChange={(event) => onChange({ language: event.target.value || undefined })}
					placeholder="language"
					className="ml-0.5 min-w-0 border-0 bg-transparent p-0 font-mono text-[12px] text-syntax-key outline-none placeholder:text-muted-foreground/35"
					style={{ width: inputWidth(node.language ?? "", 8, 22) }}
					aria-label="Code language"
				/>
			</div>
			<textarea
				value={node.code}
				onChange={(event) => onChange({ code: event.target.value })}
				rows={Math.max(3, node.code.split("\n").length)}
				className="w-full resize-y border-0 bg-transparent px-2 py-2 font-mono text-[12px] leading-relaxed text-foreground outline-none"
				spellCheck={false}
			/>
			<div className="border-t border-border bg-background/50 px-2 py-1 text-[12px] text-syntax-number">
				```
			</div>
		</div>
	);
}

function XmlCloseTag({ tag }: { tag: string }) {
	return (
		<XmlLine className="text-muted-foreground/85">
			<XmlPunctuation>{"</"}</XmlPunctuation>
			<span className="font-medium text-syntax-key">{tag}</span>
			<XmlPunctuation>{">"}</XmlPunctuation>
		</XmlLine>
	);
}

function XmlLine({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex min-h-6 min-w-0 flex-wrap items-baseline text-[12px] leading-relaxed", className)}>
			{children}
		</div>
	);
}

function TagNameInput({
	value,
	onChange,
	ariaLabel,
}: {
	value: string;
	onChange: (value: string) => void;
	ariaLabel: string;
}) {
	return (
		<input
			value={value}
			onChange={(event) => onChange(event.target.value)}
			className="min-w-0 border-0 bg-transparent p-0 font-mono text-[12px] font-medium text-syntax-key outline-none"
			style={{ width: inputWidth(value, 5, 28) }}
			aria-label={ariaLabel}
			spellCheck={false}
		/>
	);
}

function AttributeInput({
	value,
	placeholder,
	onChange,
	ariaLabel,
}: {
	value: string;
	placeholder: string;
	onChange: (value: string) => void;
	ariaLabel: string;
}) {
	return (
		<input
			value={value}
			placeholder={placeholder}
			onChange={(event) => onChange(event.target.value)}
			className="min-w-0 border-0 bg-transparent p-0 font-mono text-[12px] text-syntax-string outline-none placeholder:text-muted-foreground/35"
			style={{ width: inputWidth(value || placeholder, 6, 30) }}
			aria-label={ariaLabel}
			spellCheck={false}
		/>
	);
}

function ReadonlyAttributes({
	attrs,
}: {
	attrs: SectionNode["attrs"];
}) {
	const entries = Object.entries(attrs ?? {}).filter((entry): entry is [string, string | number | boolean] => {
		const value = entry[1];
		return value !== null && value !== undefined;
	});

	return (
		<>
			{entries.map(([key, value]) => (
				<span key={key}>
					<span> </span>
					<XmlAttributeName>{key}</XmlAttributeName>
					<XmlPunctuation>=&quot;</XmlPunctuation>
					<span className="text-syntax-string">{String(value)}</span>
					<XmlPunctuation>&quot;</XmlPunctuation>
				</span>
			))}
		</>
	);
}

function XmlAttributeName({ children }: { children: React.ReactNode }) {
	return <span className="text-syntax-boolean">{children}</span>;
}

function XmlPunctuation({ children }: { children: React.ReactNode }) {
	return <span className="text-syntax-number">{children}</span>;
}

function LineNumber({ value }: { value: number }) {
	return (
		<div className="w-7 shrink-0 select-none pt-1 text-right text-[10px] tabular-nums text-muted-foreground/55">
			{value}
		</div>
	);
}

function createXmlRows(entries: readonly PromptEditorTreeEntry[]): XmlFlowRow[] {
	const rows: XmlFlowRow[] = [];
	const openStack: PromptEditorTreeEntry[] = [];

	for (const entry of entries) {
		while (openStack.length > 0 && openStack[openStack.length - 1]?.depth >= entry.depth) {
			const closingEntry = openStack.pop();
			if (closingEntry) rows.push({ kind: "close", entry: closingEntry, tag: xmlTagForNode(closingEntry.node) });
		}

		rows.push({ kind: "node", entry });
		if (isXmlContainer(entry.node)) openStack.push(entry);
	}

	while (openStack.length > 0) {
		const closingEntry = openStack.pop();
		if (closingEntry) rows.push({ kind: "close", entry: closingEntry, tag: xmlTagForNode(closingEntry.node) });
	}

	return rows;
}

function isXmlContainer(node: PromptBlockNode): boolean {
	return node.type === "section" || node.type === "example" || node.type === "contextUsage";
}

function xmlTagForNode(node: PromptBlockNode): string {
	if (node.type === "section") return node.tag;
	if (node.type === "example") return "example";
	if (node.type === "contextUsage") return node.tag ?? "context_usage";
	return "";
}
