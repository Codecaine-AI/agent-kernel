/**
 * tokenize — lossless syntax segmentation for the detail panel's doc figures.
 *
 * Doc figures display the exact source the agent saw, so tokenization is only
 * allowed to attach presentation metadata: joining every returned value must
 * always reproduce the input. XML delegates to the state block's established
 * XML-ish parser, JSON uses a bounded scanner that tolerates malformed input,
 * and prompt prose receives a second Markdown-ish pass outside XML syntax.
 */

import { highlightXmlish } from "../renderers/state-block";

export type TokenType =
	| "text"
	| "punct"
	| "tagName"
	| "attrName"
	| "attrValue"
	| "comment"
	| "key"
	| "string"
	| "number"
	| "literal"
	| "heading"
	| "emphasis";

export interface Token {
	type: TokenType;
	value: string;
}

export type DocLanguage = "xml" | "json" | "prompt" | "text";

function pushToken(out: Token[], type: TokenType, value: string): void {
	if (value === "") return;
	const previous = out.at(-1);
	if (previous?.type === type) {
		previous.value += value;
		return;
	}
	out.push({ type, value });
}

function isDigit(char: string | undefined): boolean {
	return char !== undefined && char >= "0" && char <= "9";
}

function isWordChar(char: string | undefined): boolean {
	return (
		char !== undefined &&
		((char >= "A" && char <= "Z") ||
			(char >= "a" && char <= "z") ||
			isDigit(char) ||
			char === "_")
	);
}

function jsonStringEnd(text: string, start: number): number | undefined {
	for (let index = start + 1; index < text.length; index += 1) {
		if (text[index] === "\\") {
			index += 1;
		} else if (text[index] === '"') {
			return index + 1;
		}
	}
	return undefined;
}

function jsonNumberEnd(text: string, start: number): number | undefined {
	let index = start;
	if (text[index] === "-") index += 1;
	if (!isDigit(text[index])) return undefined;

	while (isDigit(text[index])) index += 1;

	if (text[index] === "." && isDigit(text[index + 1])) {
		index += 2;
		while (isDigit(text[index])) index += 1;
	}

	if (
		(text[index] === "e" || text[index] === "E") &&
		(isDigit(text[index + 1]) ||
			((text[index + 1] === "+" || text[index + 1] === "-") &&
				isDigit(text[index + 2])))
	) {
		index += 1;
		if (text[index] === "+" || text[index] === "-") index += 1;
		while (isDigit(text[index])) index += 1;
	}

	return index;
}

function tokenizeJson(text: string): Token[] {
	const out: Token[] = [];
	let plainStart = 0;
	let index = 0;

	const flushPlain = (end: number): void => {
		pushToken(out, "text", text.slice(plainStart, end));
	};

	while (index < text.length) {
		const char = text[index]!;

		if (char === '"') {
			const end = jsonStringEnd(text, index);
			if (end !== undefined) {
				flushPlain(index);
				let after = end;
				while (/\s/.test(text[after] ?? "")) after += 1;
				pushToken(out, text[after] === ":" ? "key" : "string", text.slice(index, end));
				index = end;
				plainStart = end;
				continue;
			}
		}

		if (char === "-" || isDigit(char)) {
			const end = jsonNumberEnd(text, index);
			if (end !== undefined) {
				flushPlain(index);
				pushToken(out, "number", text.slice(index, end));
				index = end;
				plainStart = end;
				continue;
			}
		}

		let literal: "true" | "false" | "null" | undefined;
		if (text.startsWith("true", index)) literal = "true";
		else if (text.startsWith("false", index)) literal = "false";
		else if (text.startsWith("null", index)) literal = "null";
		if (
			literal !== undefined &&
			!isWordChar(text[index - 1]) &&
			!isWordChar(text[index + literal.length])
		) {
			flushPlain(index);
			pushToken(out, "literal", literal);
			index += literal.length;
			plainStart = index;
			continue;
		}

		if ("{}[],:".includes(char)) {
			flushPlain(index);
			pushToken(out, "punct", char);
			index += 1;
			plainStart = index;
			continue;
		}

		index += 1;
	}

	flushPlain(text.length);
	return out;
}

function emphasisEnd(text: string, start: number, delimiter: "**" | "__"): number | undefined {
	let searchFrom = start + delimiter.length;
	while (searchFrom < text.length) {
		const end = text.indexOf(delimiter, searchFrom);
		if (end === -1) return undefined;
		const newline = text.slice(searchFrom, end).search(/[\r\n]/);
		if (newline !== -1) return undefined;
		if (end > start + delimiter.length) return end + delimiter.length;
		searchFrom = end + delimiter.length;
	}
	return undefined;
}

function tokenizePromptText(text: string, startsAtLineStart: boolean): Token[] {
	const out: Token[] = [];
	let plainStart = 0;
	let index = 0;
	let lineStart = startsAtLineStart;

	const flushPlain = (end: number): void => {
		pushToken(out, "text", text.slice(plainStart, end));
	};

	while (index < text.length) {
		if (lineStart && text[index] === "#") {
			let markerEnd = index;
			while (text[markerEnd] === "#") markerEnd += 1;
			const markerLength = markerEnd - index;
			if (
				(markerLength === 1 || markerLength === 2) &&
				(text[markerEnd] === " " || text[markerEnd] === "\t")
			) {
				let end = markerEnd + 1;
				while (end < text.length && text[end] !== "\r" && text[end] !== "\n") {
					end += 1;
				}
				flushPlain(index);
				pushToken(out, "heading", text.slice(index, end));
				index = end;
				plainStart = end;
				lineStart = false;
				continue;
			}
		}

		const delimiter = text.startsWith("**", index)
			? "**"
			: text.startsWith("__", index)
				? "__"
				: undefined;
		if (delimiter !== undefined) {
			const end = emphasisEnd(text, index, delimiter);
			if (end !== undefined) {
				flushPlain(index);
				pushToken(out, "emphasis", text.slice(index, end));
				index = end;
				plainStart = end;
				lineStart = false;
				continue;
			}
		}

		const char = text[index]!;
		if (char === "\r" || char === "\n") lineStart = true;
		else if (lineStart) lineStart = false;
		index += 1;
	}

	flushPlain(text.length);
	return out;
}

function tokenizePrompt(text: string): Token[] {
	const out: Token[] = [];
	let offset = 0;

	for (const segment of highlightXmlish(text)) {
		if (segment.type === "text") {
			const lineStart =
				offset === 0 || text[offset - 1] === "\n" || text[offset - 1] === "\r";
			for (const token of tokenizePromptText(segment.value, lineStart)) {
				pushToken(out, token.type, token.value);
			}
		} else {
			pushToken(out, segment.type, segment.value);
		}
		offset += segment.value.length;
	}

	return out;
}

/**
 * Split source text into colorable, lossless segments for a doc figure.
 *
 * The result never reformats or drops source: concatenating `value` from every
 * token reproduces `text` exactly, including malformed and unbalanced input.
 */
export function tokenize(text: string, language: DocLanguage): Token[] {
	switch (language) {
		case "xml":
			return highlightXmlish(text).map(({ type, value }) => ({ type, value }));
		case "json":
			return tokenizeJson(text);
		case "prompt":
			return tokenizePrompt(text);
		case "text":
			return [{ type: "text", value: text }];
	}
}
