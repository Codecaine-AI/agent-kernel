"use client";

/**
 * Single source of truth for XML/Markdown syntax coloring shared by the
 * read-only Raw prompt view (PromptView) and the editable Agent XML flow
 * (PromptFlowXml). Both surfaces MUST use this so their coloring can never
 * drift — the design contract is that switching from Raw to the editor feels
 * like toggling editability, not opening a different document.
 *
 * Color roles (Tailwind syntax tokens):
 *   - tag punctuation (`<`, `>`, `/`) -> text-syntax-number
 *   - tag name                        -> text-syntax-key (font-medium)
 *   - attribute name                  -> text-syntax-boolean
 *   - `=`                             -> text-foreground
 *   - attribute value (quoted)        -> text-syntax-string
 */

const TAG_REGEX =
	/<\/?([a-zA-Z_][\w_-]*)((?:\s+[a-zA-Z_][\w_-]*(?:=(?:'[^']*'|"[^"]*"|[^\s>]*))?)*)\s*(\/)?>/g;
const ATTR_REGEX = /([a-zA-Z_][\w_-]*)(?:=('[^']*'|"[^"]*"|[^\s>]*))?/g;

/** True when the text contains at least one XML-ish tag worth highlighting. */
export function hasXmlTags(content: string | null | undefined): boolean {
	return content ? /<\/?[a-zA-Z_][\w_-]*/.test(content) : false;
}

/**
 * Highlight a single line of rendered XML/Markdown. Returns React nodes with
 * the shared syntax classes applied; plain (non-tag) text passes through in
 * the inherited foreground color.
 */
export function highlightXmlLine(line: string): React.ReactNode {
	const result: React.ReactNode[] = [];
	let keyIndex = 0;
	// Regexes carry lastIndex state; keep them local so concurrent callers
	// (each row renders independently) never clobber a shared cursor.
	const tagRegex = new RegExp(TAG_REGEX.source, TAG_REGEX.flags);
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
			const attrRegex = new RegExp(ATTR_REGEX.source, ATTR_REGEX.flags);
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
