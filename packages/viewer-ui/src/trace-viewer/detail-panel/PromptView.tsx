"use client";

import { useMemo } from "react";
import cn from "classnames";

import { EDITOR_COLORS } from "../../shared/editor-surface";
import { hasXmlTags as detectXmlTags, highlightXmlLine } from "../../shared/xml-highlight";

export type PromptViewSize = "sm" | "md" | "lg";

const PROMPT_VIEW_SIZE_CLASS: Record<PromptViewSize, string> = {
	sm: "text-[13px] leading-[21px]",
	md: "text-sm",
	lg: "text-base",
};

// One faint ruled-paper hairline per line row. An INSET box-shadow (not a
// border) so it adds zero layout pixels — the row grid stays exact. Shared
// --editor-rule token keeps it identical to the Agent XML flow.
const PROMPT_ROW_RULE = `inset 0 -1px 0 ${EDITOR_COLORS.rule}`;

export function PromptView({
	content,
	title,
	bare = false,
	startLine = 1,
	size = "sm",
}: {
	content: string | null;
	title: string;
	/** Render without the outer rounded/background container, for nesting inside a bordered host (e.g. a file card). */
	bare?: boolean;
	/** Line number to show on the first row. Defaults to 1. Use to continue numbering across split chunks. */
	startLine?: number;
	/** Text size for the prompt body. Defaults to "sm" (extra-small). */
	size?: PromptViewSize;
}) {
	const lines = useMemo(() => (content ? content.split("\n") : []), [content]);
	const lastLine = startLine + Math.max(0, lines.length - 1);
	const lineNumberWidth = useMemo(() => Math.max(2, String(lastLine).length), [lastLine]);
	const hasXmlTags = useMemo(() => detectXmlTags(content), [content]);

	if (!content) {
		return (
			<div className="p-4 text-sm text-muted-foreground">
				No {title.toLowerCase()} available
			</div>
		);
	}

	return (
		<div className="relative w-full overflow-hidden">
			<div
				className={cn("w-full overflow-auto", bare ? undefined : "rounded-[3px]")}
				style={{ background: EDITOR_COLORS.bg, color: EDITOR_COLORS.fg }}
			>
				<table className={cn("w-full table-auto border-separate border-spacing-0 font-mono", PROMPT_VIEW_SIZE_CLASS[size])}>
					<tbody>
						{lines.map((line, index) => {
							const isLastLine = index === lines.length - 1;
							const rowRule = isLastLine ? undefined : PROMPT_ROW_RULE;
							return (
								<tr key={index} className="hover:bg-white/[0.03]">
									<td
										className="sticky left-0 select-none px-3 py-0.5 text-right align-top tabular-nums"
										style={{
											minWidth: `${lineNumberWidth + 2}ch`,
											boxShadow: rowRule,
											background: EDITOR_COLORS.gutterBg,
											color: EDITOR_COLORS.lineNumber,
										}}
									>
										{startLine + index}
									</td>
									<td
										className="w-full py-0.5 pl-3 pr-4"
										style={{
											boxShadow: rowRule,
											background: "transparent",
											whiteSpace: "pre-wrap",
											wordBreak: "break-word",
										}}
									>
										{hasXmlTags ? highlightXmlLine(line) : line || "\u00A0"}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
