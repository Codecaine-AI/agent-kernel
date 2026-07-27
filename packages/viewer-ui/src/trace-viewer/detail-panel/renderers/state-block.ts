/**
 * state-block — pretty-printing for the section ③ state render.
 *
 * The state block is an XML-ish text block (<state v="21"> with nested
 * <board>/<ops>/<lints>/… tags, free text inside) produced by the agent's
 * render(state). It is NOT well-formed XML and must not be reformatted:
 * the indentation inside <board> is load-bearing (indent = containment in the
 * board digest grammar). So the printer only strips the block's own outer
 * indentation and colors the tag syntax — the bytes the model saw stay
 * byte-for-byte otherwise.
 */

/**
 * True when the text reads as a rendered state block: starts with a <state…>
 * tag (leading whitespace tolerated).
 */
export function looksLikeStateBlock(text: string): boolean {
	return /^\s*<state(?:\s[^<>]*)?>/.test(text);
}

/**
 * Strip the common leading indentation and the surrounding blank lines, so a
 * block that was indented inside a larger template renders flush left. Tabs
 * and spaces are counted literally; mixed indentation just means less is
 * stripped.
 */
export function dedent(text: string): string {
	const lines = text.replace(/\s+$/, "").split("\n");
	while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
	if (lines.length === 0) return "";

	let common: number | undefined;
	for (const line of lines) {
		if (line.trim() === "") continue;
		const indent = line.length - line.trimStart().length;
		common = common === undefined ? indent : Math.min(common, indent);
		if (common === 0) break;
	}
	if (!common) return lines.join("\n");
	return lines.map((line) => (line.trim() === "" ? "" : line.slice(common))).join("\n");
}

export type XmlSegmentType =
	| "text"
	| "punct"
	| "tagName"
	| "attrName"
	| "attrValue"
	| "comment";

export interface XmlSegment {
	type: XmlSegmentType;
	value: string;
}

const TAG_RE = /<!--[\s\S]*?-->|<\/?[A-Za-z][^<>]*>/g;
const TAG_PARTS_RE = /^(<\/?)([A-Za-z][\w:.-]*)([\s\S]*?)(\/?>)$/;
const ATTR_RE = /([A-Za-z_:][\w:.-]*)(\s*=\s*)("[^"]*"|'[^']*')/g;

function pushAttrs(out: XmlSegment[], raw: string): void {
	if (raw === "") return;
	let last = 0;
	ATTR_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = ATTR_RE.exec(raw)) !== null) {
		if (match.index > last) {
			out.push({ type: "punct", value: raw.slice(last, match.index) });
		}
		out.push({ type: "attrName", value: match[1]! });
		out.push({ type: "punct", value: match[2]! });
		out.push({ type: "attrValue", value: match[3]! });
		last = ATTR_RE.lastIndex;
	}
	if (last < raw.length) out.push({ type: "punct", value: raw.slice(last) });
}

/**
 * Split XML-ish text into colorable segments. Every character of the input
 * appears in exactly one segment, in order — concatenating the values
 * reproduces the input exactly.
 */
export function highlightXmlish(text: string): XmlSegment[] {
	const out: XmlSegment[] = [];
	let last = 0;
	TAG_RE.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = TAG_RE.exec(text)) !== null) {
		if (match.index > last) {
			out.push({ type: "text", value: text.slice(last, match.index) });
		}
		const tag = match[0]!;
		if (tag.startsWith("<!--")) {
			out.push({ type: "comment", value: tag });
		} else {
			const parts = TAG_PARTS_RE.exec(tag);
			if (parts) {
				out.push({ type: "punct", value: parts[1]! });
				out.push({ type: "tagName", value: parts[2]! });
				pushAttrs(out, parts[3]!);
				out.push({ type: "punct", value: parts[4]! });
			} else {
				out.push({ type: "text", value: tag });
			}
		}
		last = TAG_RE.lastIndex;
	}
	if (last < text.length) out.push({ type: "text", value: text.slice(last) });
	return out;
}
