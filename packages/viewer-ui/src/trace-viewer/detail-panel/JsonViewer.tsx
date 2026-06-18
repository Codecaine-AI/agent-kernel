"use client";

import { useMemo } from "react";
import cn from "classnames";

interface JsonViewerProps {
	data: unknown;
	className?: string;
}

export function JsonViewer({ data, className }: JsonViewerProps) {
	const lines = useMemo(() => {
		if (!data) return [];
		return JSON.stringify(data, null, 2).split("\n");
	}, [data]);

	const gutterWidth = lines.length > 0 ? String(lines.length).length : 1;

	if (!data) return null;

	return (
		<div className={cn("overflow-x-auto rounded-md bg-muted/30 font-sans text-[12px] leading-[1.6]", className)}>
			<table className="w-full border-collapse">
				<tbody>
					{lines.map((line, index) => (
						<tr key={index} className="transition-colors hover:bg-muted/50">
							<td
								className="select-none border-r border-border/70 px-3 text-right align-top text-muted-foreground/50"
								style={{ minWidth: `${gutterWidth + 2}ch` }}
							>
								{index + 1}
							</td>
							<td className="whitespace-pre px-4">
								<JsonLine text={line} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function JsonLine({ text }: { text: string }) {
	const parts: React.ReactNode[] = [];
	let remaining = text;
	let key = 0;

	const indentMatch = remaining.match(/^(\s*)/);
	const indent = indentMatch ? indentMatch[1] : "";
	if (indent) {
		parts.push(<span key={key++}>{indent}</span>);
		remaining = remaining.slice(indent.length);
	}

	const tokenRe =
		/("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)|([{}[\],:])/g;

	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = tokenRe.exec(remaining)) !== null) {
		if (match.index > lastIndex) {
			parts.push(<span key={key++}>{remaining.slice(lastIndex, match.index)}</span>);
		}

		if (match[1]) {
			parts.push(<span key={key++} className="text-foreground/90">{match[1]}</span>);
			const afterKey = remaining.slice(match.index + match[1].length, match.index + match[0].length);
			if (afterKey) {
				parts.push(<span key={key++} className="text-muted-foreground">{afterKey}</span>);
			}
		} else if (match[2]) {
			parts.push(<span key={key++} className="text-syntax-string">{match[2]}</span>);
		} else if (match[3]) {
			parts.push(<span key={key++} className="text-syntax-number">{match[3]}</span>);
		} else if (match[4]) {
			parts.push(<span key={key++} className="text-syntax-boolean">{match[4]}</span>);
		} else if (match[5]) {
			parts.push(<span key={key++} className="text-muted-foreground">{match[5]}</span>);
		}

		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < remaining.length) {
		parts.push(<span key={key++}>{remaining.slice(lastIndex)}</span>);
	}

	return <>{parts}</>;
}
