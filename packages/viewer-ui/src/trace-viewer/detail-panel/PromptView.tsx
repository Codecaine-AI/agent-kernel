"use client";

import { useMemo } from "react";
import cn from "classnames";

function highlightXmlLine(line: string): React.ReactNode {
	const result: React.ReactNode[] = [];
	let keyIndex = 0;
	const tagRegex =
		/<\/?([a-zA-Z_][\w_-]*)((?:\s+[a-zA-Z_][\w_-]*(?:=(?:'[^']*'|"[^"]*"|[^\s>]*))?)*)\s*(\/)?>/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = tagRegex.exec(line)) !== null) {
		if (match.index > lastIndex) {
			result.push(<span key={keyIndex++}>{line.slice(lastIndex, match.index)}</span>);
		}

		const fullMatch = match[0];
		const tagName = match[1];
		const attributes = match[2] || "";
		const isClosing = fullMatch.startsWith("</");
		const isSelfClosing = fullMatch.endsWith("/>");
		const formattedAttributes: React.ReactNode[] = [];

		if (attributes.trim()) {
			const attrRegex =
				/([a-zA-Z_][\w_-]*)(?:=('[^']*'|"[^"]*"|[^\s>]*))?/g;
			let attrMatch: RegExpExecArray | null;
			while ((attrMatch = attrRegex.exec(attributes)) !== null) {
				const attrName = attrMatch[1];
				const attrValue = attrMatch[2];
				formattedAttributes.push(
					<span key={keyIndex++}>
						{" "}
						<span className="text-syntax-boolean">{attrName}</span>
						{attrValue && (
							<>
								<span className="text-foreground">=</span>
								<span className="text-syntax-string">{attrValue}</span>
							</>
						)}
					</span>,
				);
			}
		}

		result.push(
			<span key={keyIndex++} className="text-syntax-number">
				{"<"}
				{isClosing && "/"}
				<span className="font-medium text-syntax-key">{tagName}</span>
				{formattedAttributes}
				{isSelfClosing && " /"}
				{">"}
			</span>,
		);
		lastIndex = match.index + fullMatch.length;
	}

	if (lastIndex < line.length) {
		result.push(<span key={keyIndex++}>{line.slice(lastIndex)}</span>);
	}

	return result.length === 0 ? <span>{line}</span> : <>{result}</>;
}

export type PromptViewSize = "sm" | "md" | "lg";

const PROMPT_VIEW_SIZE_CLASS: Record<PromptViewSize, string> = {
	sm: "text-xs",
	md: "text-sm",
	lg: "text-base",
};

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
	const hasXmlTags = useMemo(
		() => (content ? /<\/?[a-zA-Z_][\w_-]*/.test(content) : false),
		[content],
	);

	if (!content) {
		return (
			<div className="p-4 text-sm text-muted-foreground">
				No {title.toLowerCase()} available
			</div>
		);
	}

	return (
		<div className="relative w-full overflow-hidden">
			<div className={cn("w-full overflow-auto", bare ? undefined : "rounded-[3px] border border-border bg-muted/20")}>
				<table className={cn("w-full border-collapse font-mono", PROMPT_VIEW_SIZE_CLASS[size])}>
					<tbody>
						{lines.map((line, index) => (
							<tr key={index} className="hover:bg-muted/40">
								<td
									className="sticky left-0 select-none border-r border-border bg-muted/40 px-3 py-0.5 text-right align-top tabular-nums text-muted-foreground/70"
									style={{ minWidth: `${lineNumberWidth + 2}ch` }}
								>
									{startLine + index}
								</td>
								<td
									className="py-0.5 pl-3 pr-4"
									style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
								>
									{hasXmlTags ? highlightXmlLine(line) : line || "\u00A0"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
