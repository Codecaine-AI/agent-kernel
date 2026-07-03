// Slice: sections-surface composition root — title/description header, the
// block list, and interaction wiring; each block renders via FlowBlock.
"use client";

import { EmptyFlow, usePromptFlowInteractions } from "../PromptFlowShared";
import type { PromptFlowViewProps } from "../types";
import { FlowBlock } from "./FlowBlock";

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
