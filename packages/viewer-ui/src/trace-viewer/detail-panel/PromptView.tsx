"use client";

import { useMemo } from "react";

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

export function PromptView({
	content,
	title,
}: {
	content: string | null;
	title: string;
}) {
	const lines = useMemo(() => (content ? content.split("\n") : []), [content]);
	const lineNumberWidth = useMemo(() => Math.max(2, String(lines.length).length), [lines.length]);
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
			<div className="w-full overflow-auto rounded-lg bg-muted/30">
				<table className="w-full border-collapse font-sans text-xs">
					<tbody>
						{lines.map((line, index) => (
							<tr key={index} className="hover:bg-muted/50">
								<td
									className="sticky left-0 select-none border-r border-muted-foreground/20 bg-muted/50 px-3 py-0.5 text-right align-top text-muted-foreground"
									style={{ minWidth: `${lineNumberWidth + 2}ch` }}
								>
									{index + 1}
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
