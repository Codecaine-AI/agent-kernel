"use client";

/**
 * StateBlockView — the section ③ state block, printed readably.
 *
 * Monospace, indentation preserved (it is load-bearing in the board digest
 * grammar), light tag highlighting on the same syntax tokens the JSON viewer
 * uses. Long blocks clamp behind a "Show all" toggle.
 */
import { useMemo, useState } from "react";
import cn from "classnames";

import { dedent, highlightXmlish, type XmlSegmentType } from "./state-block";

const SEGMENT_CLASS: Record<XmlSegmentType, string | undefined> = {
	text: undefined,
	punct: "text-muted-foreground/70",
	tagName: "text-syntax-key",
	attrName: "text-syntax-number",
	attrValue: "text-syntax-string",
	comment: "text-muted-foreground/60 italic",
};

const CLAMP_LINES = 40;

export function StateBlockView({
	text,
	className,
}: {
	text: string;
	className?: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const body = useMemo(() => dedent(text), [text]);
	const lineCount = useMemo(() => body.split("\n").length, [body]);
	const needsClamp = lineCount > CLAMP_LINES;
	const shown = useMemo(
		() =>
			expanded || !needsClamp
				? body
				: `${body.split("\n").slice(0, CLAMP_LINES).join("\n")}\n…`,
		[body, expanded, needsClamp],
	);
	const segments = useMemo(() => highlightXmlish(shown), [shown]);

	return (
		<div className="space-y-1" data-state-block="">
			<pre
				className={cn(
					"bg-muted/30 rounded-md p-3 text-xs font-mono overflow-auto max-h-[560px] whitespace-pre break-words",
					className,
				)}
			>
				{segments.map((segment, i) => (
					<span key={i} className={SEGMENT_CLASS[segment.type]}>
						{segment.value}
					</span>
				))}
			</pre>
			{needsClamp && (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
				>
					{expanded
						? "Show less"
						: `Show all ${lineCount.toLocaleString()} lines`}
				</button>
			)}
		</div>
	);
}
